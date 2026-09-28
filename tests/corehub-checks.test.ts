import assert from "node:assert/strict";
import { actionChecks, blocking, parseRupees, reviewChecks, type QuoteSnapshot } from "../src/worker/corehub-checks";

// Real CoreHub referral P000000063670: quote API + what its review page renders.
const live: QuoteSnapshot = {
  quoteId: "Q000000283405",
  quoteStatus: "Underwriter review",
  make: "MAHINDRA",
  model: "XUV 7XO",
  variant: "AX7 2WD DIESEL 2.2L TURBO AT 7 STR",
  fuelType: "DIESEL",
  yom: 2026,
  requestedIdv: 2600000,
  idvRange: { min: 1453500, max: 2519400 },
  review: {
    url: "https://corehub.kiwiinsurance.com/proposals/Q000000283405/P000000063670/review",
    title: "MAHINDRA XUV 7XO 2026",
    subtitle: "AX7 2WD DIESEL 2.2L TURBO AT 7 STR · DIESEL",
    fields: { IDV: "₹2600000", "Reason for NSTP": "IDV limits breached, case referred to UW" },
  },
};

assert.equal(parseRupees("₹2600000"), 2600000);
assert.equal(parseRupees("₹26,00,000"), 2600000);
assert.equal(parseRupees("—"), null);

const fetchChecks = reviewChecks(live);
assert.deepEqual(blocking(fetchChecks), []);
const range = fetchChecks.find((c) => c.key === "corehub_range")!;
assert.equal(range.ok, null); // informational
assert.match(range.detail, /3\.2% above max/);

// Page shows a different IDV than the API → flagged.
assert.equal(blocking(reviewChecks({ ...live, review: { ...live.review!, fields: { ...live.review!.fields, IDV: "₹2500000" } } }))[0].key, "page_idv");
// Page not read → flagged, not silently passed.
assert.equal(blocking(reviewChecks({ ...live, review: null }))[0].key, "review_page");

const evaluated = {
  external_case_id: "P000000063670",
  requested_idv: "2600000",
  make_raw: "MAHINDRA",
  model_raw: "XUV 7XO",
  variant_raw: "AX7 2WD DIESEL 2.2L TURBO AT 7 STR",
  metadata: { yom: 2026 },
};
assert.deepEqual(blocking(actionChecks(evaluated, live)), []);
// Anything that changed since evaluation stops the click.
assert.deepEqual(blocking(actionChecks(evaluated, { ...live, quoteStatus: "Approved" })).map((c) => c.key), ["still_pending"]);
assert.deepEqual(
  blocking(actionChecks(evaluated, { ...live, requestedIdv: 2700000, review: { ...live.review!, fields: { IDV: "₹2700000" } } })).map((c) => c.key),
  ["idv_unchanged", "page_idv"]
);
assert.deepEqual(blocking(actionChecks(evaluated, { ...live, variant: "AX5 2WD DIESEL" })).map((c) => c.key), ["vehicle_unchanged"]);
assert.deepEqual(blocking(actionChecks(evaluated, { ...live, review: null })).map((c) => c.key), ["page_idv"]);

console.log("corehub-checks tests passed");
