/**
 * OrangeBookValue lookup over plain HTTP — the same endpoints OBV's own search form calls.
 *
 * 1. Resolve free-text make / model / year / variant to OBV's exact catalog names (`/mmyt`)
 * 2. POST the valuation form (`/result`) and read every condition band from the page
 *
 * ~1-2s per vehicle, no browser.
 */

import type { EvidenceArtifact } from "./evidence";

export interface ConditionRange {
  min: number;
  max: number;
  midpoint: number;
  raw: string;
}

export interface ObvBrowserResult {
  success: boolean;
  /** The primary benchmark IDV (Very Good or Good midpoint) */
  idv: number | null;
  /** Valuations for the 3 insurable condition tiers: good, veryGood, excellent */
  conditions?: {
    good?: ConditionRange;
    veryGood?: ConditionRange;
    excellent?: ConditionRange;
  };
  /** The URL of the result page (evidence) */
  sourceUrl: string | null;
  /** Structured reason when lookup fails */
  reasonCode:
    | "SUCCESS"
    | "NO_RESULTS"
    | "AMBIGUOUS_RESULTS"
    | "CAPTCHA_DETECTED"
    | "TIMEOUT"
    | "SELECTOR_MISMATCH"
    | "PARSE_ERROR"
    | "NAVIGATION_ERROR"
    | "UNKNOWN_ERROR";
  latencyMs: number;
  evidence: EvidenceArtifact[];
  raw?: unknown;
}

const OBV_ORIGIN = "https://www.orangebookvalue.com";
// OBV's CDN 403s requests without a browser user agent.
const OBV_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
};

/**
 * OBV's own cascading make → model → year → trim catalog (the JSON its search form uses).
 * Returns exact names OBV accepts; an empty list means nothing matched.
 */
export async function fetchObvOptions(q: { make?: string; model?: string; year?: string | number }): Promise<string[]> {
  const params = new URLSearchParams({ category_id: "1", api_version: "3" });
  if (q.make) params.set("make", q.make);
  if (q.make && q.model) params.set("model", q.model);
  if (q.make && q.model && q.year) {
    params.set("year", String(q.year));
    params.set("check_obv", "1");
  }
  const res = await fetch(`${OBV_ORIGIN}/mmyt?${params}`, { headers: OBV_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`OBV catalog HTTP ${res.status}`);
  const { data } = (await res.json()) as { data?: unknown };
  // Makes arrive as {name, selectable} with section headers; models/years as strings; trims under data.result.
  const list: unknown[] = Array.isArray(data) ? data : ((data as { result?: unknown[] } | undefined)?.result ?? []);
  const names = list.flatMap((d) =>
    typeof d === "string" ? [d] : d && typeof d === "object" && (d as { selectable?: boolean }).selectable ? [String((d as { name: unknown }).name)] : []
  );
  return [...new Set(names)];
}

/**
 * Valuation via OBV's result endpoint directly (~1-2s, no browser). The result page embeds every
 * condition band as `all_prices["Good"]["range_from"] = "31,21,938"`. An MMV OBV doesn't know
 * redirects (302) to the home page, reported as NO_RESULTS.
 */
export async function lookupObvHttp(vehicle: ObvVehicleInput): Promise<ObvBrowserResult> {
  const started = Date.now();
  const sourceUrl = `${OBV_ORIGIN}/result?car_sell_dealer`;
  const fail = (reasonCode: ObvBrowserResult["reasonCode"], raw?: unknown): ObvBrowserResult => ({
    success: false,
    idv: null,
    sourceUrl,
    reasonCode,
    latencyMs: Date.now() - started,
    evidence: [],
    raw,
  });

  const form = new URLSearchParams({
    feature: "used",
    customer_type: "dealer",
    category: "1",
    make: vehicle.make,
    model: vehicle.model,
    year: String(vehicle.year ?? ""),
    trim: vehicle.variant,
    kms_driven: String(vehicle.kmsDriven ?? "15000"),
    city: "",
    phone: "1111111111",
    userType: "dealer",
    transaction_type: "s",
    is_taxi: "0",
  });

  let html: string;
  try {
    const res = await fetch(sourceUrl, {
      method: "POST",
      headers: { ...OBV_HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });
    if (res.status >= 300 && res.status < 400) return fail("NO_RESULTS", { status: res.status });
    if (!res.ok) return fail("NAVIGATION_ERROR", { status: res.status });
    html = await res.text();
  } catch (err) {
    return fail(err instanceof Error && err.name === "TimeoutError" ? "TIMEOUT" : "NAVIGATION_ERROR", { error: String(err) });
  }

  const bands: Record<string, { from?: number; to?: number }> = {};
  for (const m of html.matchAll(/all_prices\["([A-Za-z ]+)"\]\["range_(from|to)"\]\s*=\s*"([\d,]+)"/g)) {
    (bands[m[1]] ??= {})[m[2] as "from" | "to"] = Number(m[3].replace(/,/g, ""));
  }
  const range = (label: string): ConditionRange | undefined => {
    const b = bands[label];
    if (!b?.from || !b?.to) return undefined;
    const min = Math.min(b.from, b.to);
    const max = Math.max(b.from, b.to);
    return { min, max, midpoint: Math.round((min + max) / 2), raw: `₹${min.toLocaleString("en-IN")} - ₹${max.toLocaleString("en-IN")}` };
  };
  const conditions = { good: range("Good"), veryGood: range("Very Good"), excellent: range("Excellent") };
  const idv = conditions.veryGood?.midpoint ?? conditions.good?.midpoint ?? conditions.excellent?.midpoint ?? null;
  if (idv === null) return fail("PARSE_ERROR");

  return { success: true, idv, conditions, sourceUrl, reasonCode: "SUCCESS", latencyMs: Date.now() - started, evidence: [], raw: { conditions } };
}

const FUELS = ["petrol", "diesel", "cng", "electric"];
const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9.]+/).filter(Boolean);

/**
 * Best OBV option for a free-text value. Case-insensitive exact match wins; otherwise the option
 * sharing the most words (Jaccard >= 0.5) wins, but only if it is the single best. An option naming
 * a different fuel is never picked. null = no confident match — callers route to manual review.
 */
export function matchObvOption(options: string[], value: string, fuel?: string | null): string | null {
  const t = value.toLowerCase().trim();
  if (!t) return null;
  const exact = options.find((o) => o.toLowerCase().trim() === t);
  if (exact) return exact;

  const want = new Set(tokens(`${value} ${fuel ?? ""}`));
  const wantFuel = FUELS.find((f) => want.has(f));
  let best: string | null = null;
  let bestScore = 0;
  let tie = false;
  for (const o of options) {
    const have = new Set(tokens(o));
    if (wantFuel && FUELS.some((f) => f !== wantFuel && have.has(f))) continue;
    const shared = [...want].filter((w) => have.has(w)).length;
    const score = shared / new Set([...want, ...have]).size;
    if (score > bestScore) [best, bestScore, tie] = [o, score, false];
    else if (score === bestScore && score > 0) tie = true;
  }
  return bestScore >= 0.5 && !tie ? best : null;
}

type ObvVehicleInput = { make: string; model: string; variant: string; year?: string | number; kmsDriven?: string | number; fuel?: string | null };

/**
 * Map raw intake names (e.g. CoreHub "VOLKSWAGEN" / "TIGUAN") onto OBV's catalog, one level at a time.
 * Returns the first field OBV has no match for instead of guessing.
 */
export async function resolveObvVehicle(
  v: ObvVehicleInput
): Promise<{ make: string; model: string; year: string; variant: string } | { unmatched: "make" | "model" | "year" | "variant" }> {
  const make = matchObvOption(await fetchObvOptions({}), v.make);
  if (!make) return { unmatched: "make" };
  const model = matchObvOption(await fetchObvOptions({ make }), v.model);
  if (!model) return { unmatched: "model" };
  // No YOM = no valuation: a guessed year would value the wrong car.
  const year = v.year ? matchObvOption(await fetchObvOptions({ make, model }), String(v.year)) : null;
  if (!year) return { unmatched: "year" };
  const variant = matchObvOption(await fetchObvOptions({ make, model, year }), v.variant, v.fuel);
  if (!variant) return { unmatched: "variant" };
  return { make, model, year, variant };
}

/** Worker entry: resolve raw MMV, then value it. `raw.resolved` records exactly what OBV valued. */
export async function lookupObv(vehicle: ObvVehicleInput): Promise<ObvBrowserResult> {
  const started = Date.now();
  const fail = (reasonCode: ObvBrowserResult["reasonCode"], raw: unknown): ObvBrowserResult => ({
    success: false,
    idv: null,
    sourceUrl: null,
    reasonCode,
    latencyMs: Date.now() - started,
    evidence: [],
    raw,
  });

  let resolved: Awaited<ReturnType<typeof resolveObvVehicle>>;
  try {
    resolved = await resolveObvVehicle(vehicle);
  } catch (err) {
    return fail("NAVIGATION_ERROR", { error: String(err), input: vehicle });
  }
  if ("unmatched" in resolved) return fail("NO_RESULTS", { unmatched: resolved.unmatched, input: vehicle });

  const result = await lookupObvHttp({ ...resolved, kmsDriven: vehicle.kmsDriven });
  return { ...result, latencyMs: Date.now() - started, raw: { ...(result.raw as object | undefined), resolved, input: vehicle } };
}
