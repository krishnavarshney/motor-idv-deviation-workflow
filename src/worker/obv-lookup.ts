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
// "TypeError: fetch failed" hides the real reason (TLS, DNS, reset) in err.cause.
const errText = (err: unknown) => {
  const cause = (err as { cause?: { code?: string; message?: string } })?.cause;
  return cause ? `${String(err)} — ${[cause.code, cause.message].filter(Boolean).join(": ")}` : String(err);
};
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
    return fail(err instanceof Error && err.name === "TimeoutError" ? "TIMEOUT" : "NAVIGATION_ERROR", { error: errText(err) });
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
 * Best OBV option for a free-text value. Case-insensitive exact match wins. Otherwise options are
 * ranked by containment — how much of the shorter name the other covers (CoreHub's
 * "AX7 2WD DIESEL 2.2L TURBO AT 7 STR" fully covers OBV's "AX7 Diesel AT") — then by words shared,
 * then by fewest extra words. The top option must be unique and at least 75% contained.
 * Fuel is never crossed: an option naming another fuel is dropped, and when CoreHub names a fuel
 * that some options mention, only those are considered. null = no confident match → manual review.
 */
export function matchObvOption(options: string[], value: string, fuel?: string | null): string | null {
  const t = value.toLowerCase().trim();
  if (!t) return null;
  const exact = options.find((o) => o.toLowerCase().trim() === t);
  if (exact) return exact;

  const want = new Set(tokens(`${value} ${fuel ?? ""}`));
  const wantFuel = FUELS.find((f) => want.has(f));
  let pool = options.map((o) => ({ o, have: new Set(tokens(o)) }));
  if (wantFuel) {
    pool = pool.filter(({ have }) => !FUELS.some((f) => f !== wantFuel && have.has(f)));
    if (pool.some(({ have }) => have.has(wantFuel))) pool = pool.filter(({ have }) => have.has(wantFuel));
  }
  const ranked = pool
    .map(({ o, have }) => {
      const shared = [...want].filter((w) => have.has(w)).length;
      const union = new Set([...want, ...have]).size;
      return { o, shared, union, containment: shared / Math.min(want.size, have.size) };
    })
    .filter((r) => r.shared > 0 && r.containment >= 0.75)
    .sort((a, b) => b.containment - a.containment || b.shared - a.shared || a.union - b.union);
  const [best, second] = ranked;
  if (!best) return null;
  const tied = second && second.containment === best.containment && second.shared === best.shared && second.union === best.union;
  return tied ? null : best.o;
}

type ObvVehicleInput = { make: string; model: string; variant: string; year?: string | number; kmsDriven?: string | number; fuel?: string | null };

export interface ObvLogLine {
  at: string;
  step: string;
  detail: string;
  data?: unknown;
}

/**
 * Map raw intake names (e.g. CoreHub "VOLKSWAGEN" / "TIGUAN") onto OBV's catalog, one level at a time.
 * Returns the first field OBV has no match for instead of guessing.
 */
export async function resolveObvVehicle(
  v: ObvVehicleInput,
  log: (line: Omit<ObvLogLine, "at">) => void = () => {}
): Promise<{ make: string; model: string; year: string; variant: string } | { unmatched: "make" | "model" | "year" | "variant" }> {
  const level = async (field: "make" | "model" | "year" | "variant", input: string | undefined, q: Parameters<typeof fetchObvOptions>[0], fuel?: string | null) => {
    const options = input ? await fetchObvOptions(q) : [];
    const matched = input ? matchObvOption(options, input, fuel) : null;
    log({
      step: `match_${field}`,
      detail: matched ? `${field} "${input}" → "${matched}"` : input ? `${field} "${input}" not in OBV's ${options.length} options` : `${field} missing`,
      data: { input: input ?? null, matched, options: options.length > 40 ? `${options.length} options` : options },
    });
    return matched;
  };
  const make = await level("make", v.make, {});
  if (!make) return { unmatched: "make" };
  const model = await level("model", v.model, { make });
  if (!model) return { unmatched: "model" };
  // No YOM = no valuation: a guessed year would value the wrong car.
  const year = await level("year", v.year ? String(v.year) : undefined, { make, model });
  if (!year) return { unmatched: "year" };
  const variant = await level("variant", v.variant, { make, model, year }, v.fuel);
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

  // Step-by-step log kept with the result, so a decision can be traced back to exactly what OBV said.
  const log: ObvLogLine[] = [];
  const add = (l: Omit<ObvLogLine, "at">) => log.push({ at: new Date().toISOString(), ...l });

  let resolved: Awaited<ReturnType<typeof resolveObvVehicle>>;
  try {
    resolved = await resolveObvVehicle(vehicle, add);
  } catch (err) {
    add({ step: "catalog_error", detail: errText(err) });
    return fail("NAVIGATION_ERROR", { error: errText(err), input: vehicle, log });
  }
  if ("unmatched" in resolved) return fail("NO_RESULTS", { unmatched: resolved.unmatched, input: vehicle, log });

  const result = await lookupObvHttp({ ...resolved, kmsDriven: vehicle.kmsDriven });
  add({
    step: "valuation",
    detail: result.success
      ? `OBV valued ${resolved.make} ${resolved.model} ${resolved.variant} ${resolved.year} in ${result.latencyMs} ms`
      : `OBV valuation failed: ${result.reasonCode}`,
    data: { request: { ...resolved, kmsDriven: vehicle.kmsDriven ?? 15000 }, reasonCode: result.reasonCode, sourceUrl: result.sourceUrl, conditions: result.conditions ?? null, raw: result.raw },
  });
  return { ...result, latencyMs: Date.now() - started, raw: { ...(result.raw as object | undefined), resolved, input: vehicle, log } };
}
