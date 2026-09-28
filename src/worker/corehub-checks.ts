/**
 * Pure checks over CoreHub data — no browser, so they are unit-tested (tests/corehub-checks.test.ts).
 *
 * reviewChecks: at fetch time, does the review page agree with the quote API?
 * actionChecks: right before Approve/Reject, is the live referral still the one we evaluated?
 */

/** ok: true pass, false blocks, null informational. */
export interface Check {
  key: string;
  label: string;
  ok: boolean | null;
  detail: string;
}

/** What the review page renders (read from the DOM, not the API). */
export interface ReviewPage {
  url: string;
  title: string | null;
  subtitle: string | null;
  /** Label → value rows, e.g. { "IDV": "₹2600000", "Reason for NSTP": "IDV limits breached, ..." } */
  fields: Record<string, string>;
}

export interface QuoteSnapshot {
  quoteId: string | null;
  quoteStatus: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  fuelType: string | null;
  yom: number | null;
  requestedIdv: number | null;
  idvRange: { min: number; max: number } | null;
  review: ReviewPage | null;
}

export const parseRupees = (s: string | null | undefined) => {
  const n = Number(String(s ?? "").replace(/[^\d.]/g, ""));
  return s && Number.isFinite(n) && n > 0 ? n : null;
};
const inr = (n: number | null) => (n == null ? "—" : `₹${n.toLocaleString("en-IN")}`);
const has = (hay: string | null, needle: string | number | null) =>
  !!hay && needle != null && hay.toLowerCase().includes(String(needle).toLowerCase());
const AWAITING_UW = /underwriter review/i;

export function reviewChecks(q: QuoteSnapshot): Check[] {
  const checks: Check[] = [
    {
      key: "quote_status",
      label: "Awaiting underwriter",
      ok: AWAITING_UW.test(q.quoteStatus ?? ""),
      detail: `Quote status "${q.quoteStatus ?? "unknown"}"`,
    },
  ];
  if (q.requestedIdv != null && q.idvRange) {
    const over = q.requestedIdv > q.idvRange.max;
    const under = q.requestedIdv < q.idvRange.min;
    const pct = over ? (q.requestedIdv / q.idvRange.max - 1) * 100 : under ? (1 - q.requestedIdv / q.idvRange.min) * 100 : 0;
    checks.push({
      key: "corehub_range",
      label: "CoreHub IDV range",
      ok: null,
      detail: `Requested ${inr(q.requestedIdv)} vs allowed ${inr(q.idvRange.min)}–${inr(q.idvRange.max)}${
        over || under ? ` (${pct.toFixed(1)}% ${over ? "above max" : "below min"})` : " (within range)"
      }`,
    });
  }
  const r = q.review;
  if (!r) return [...checks, { key: "review_page", label: "Review page read", ok: false, detail: "Review page fields could not be read" }];

  const pageIdv = parseRupees(r.fields["IDV"]);
  checks.push(
    {
      key: "page_idv",
      label: "Page IDV matches quote",
      ok: pageIdv != null && pageIdv === q.requestedIdv,
      detail: `Page ${inr(pageIdv)} · quote ${inr(q.requestedIdv)}`,
    },
    {
      key: "page_vehicle",
      label: "Page vehicle matches quote",
      ok: has(r.title, q.make) && has(r.title, q.model) && has(r.title, q.yom) && has(r.subtitle, q.variant),
      detail: `Page "${[r.title, r.subtitle].filter(Boolean).join(" · ")}"`,
    },
    {
      key: "nstp_reason",
      label: "Referred for IDV",
      ok: /\bidv\b/i.test(r.fields["Reason for NSTP"] ?? ""),
      detail: `Reason "${r.fields["Reason for NSTP"] ?? "—"}"`,
    },
  );
  return checks;
}

/** Stored case fields the action was decided on. */
export interface EvaluatedCase {
  external_case_id: string;
  requested_idv: number | string | null;
  make_raw: string | null;
  model_raw: string | null;
  variant_raw: string | null;
  metadata?: { yom?: number | null } | null;
}

const same = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

export function actionChecks(c: EvaluatedCase, live: QuoteSnapshot): Check[] {
  const requested = c.requested_idv == null ? null : Number(c.requested_idv);
  const pageIdv = parseRupees(live.review?.fields["IDV"]);
  return [
    {
      key: "still_pending",
      label: "Still awaiting underwriter in CoreHub",
      ok: AWAITING_UW.test(live.quoteStatus ?? ""),
      detail: `Quote status "${live.quoteStatus ?? "unknown"}"`,
    },
    {
      key: "idv_unchanged",
      label: "Requested IDV unchanged",
      ok: requested != null && live.requestedIdv === requested,
      detail: `Evaluated ${inr(requested)} · CoreHub now ${inr(live.requestedIdv)}`,
    },
    {
      key: "vehicle_unchanged",
      label: "Vehicle unchanged",
      ok:
        same(c.make_raw, live.make) &&
        same(c.model_raw, live.model) &&
        same(c.variant_raw, live.variant) &&
        (c.metadata?.yom == null || c.metadata.yom === live.yom),
      detail: `Evaluated ${[c.make_raw, c.model_raw, c.variant_raw, c.metadata?.yom].filter(Boolean).join(" ")} · CoreHub now ${[
        live.make,
        live.model,
        live.variant,
        live.yom,
      ]
        .filter(Boolean)
        .join(" ")}`,
    },
    {
      key: "page_idv",
      label: "Review page shows the same IDV",
      ok: pageIdv != null && pageIdv === requested,
      detail: `Page ${inr(pageIdv)}`,
    },
  ];
}

export const blocking = (checks: Check[]) => checks.filter((k) => k.ok === false);
