import assert from "node:assert/strict";
import { findQuote, isIdvDeviationReferral, quoteIdsFromBody, vehicleFromQuote } from "../src/worker/corehub-scraper";

// Trimmed from a real CoreHub quote API response (P000000062392).
const quote = {
  id: "Q000000281926",
  proposal_id: "P000000062392",
  vehicle_details: {
    make: "KIA",
    model: "SYROS",
    variant: "HTE 1.0 TURBO MT",
    fuel_type: "PETROL",
    manufacture_year: "2026",
    idv_value: 1050000,
  },
};

assert.equal(findQuote(quote, "P000000062392"), quote);
assert.equal(findQuote({ data: quote }, "P000000062392"), quote);
assert.equal(findQuote(quote, "P000000062340"), null); // another proposal's quote
assert.equal(findQuote({ premiums: {} }, "P000000062392"), null);
// Real shape: POST /api/v1/motor/quote/resume → data.quote_info
assert.equal(findQuote({ type: "success", status: 200, data: { suggestions: [{ idv: {} }], configs: {}, quote_info: quote } }, "P000000062392"), quote);

assert.deepEqual(
  { ...vehicleFromQuote({ ...quote, quote_status: "Underwriter review", idv: { default: 1050000, min: 598429, max: 1037276 } } as never), vehicleDetails: undefined },
  {
    quoteId: "Q000000281926",
    quoteStatus: "Underwriter review",
    make: "KIA",
    model: "SYROS",
    variant: "HTE 1.0 TURBO MT",
    fuelType: "PETROL",
    requestedIdv: 1050000,
    yom: 2026,
    idvRange: { min: 598429, max: 1037276 },
    vehicleDetails: undefined,
  }
);

// Listing API shape is undocumented: find proposal → quote pairs wherever they sit.
const listing = { data: { items: [{ proposal_id: "P000000063670", quote: { id: "Q000000283405" } }, { proposalId: "P000000062416", quoteId: "Q000000281999", nested: { x: 1 } }] } };
const ids = quoteIdsFromBody(listing);
assert.equal(ids.get("P000000062416"), "Q000000281999");
assert.equal(ids.get("P000000063670"), undefined); // proposal and quote in different objects: not paired, row click is used instead
assert.equal(quoteIdsFromBody([{ id: "Q000000283405", proposal_id: "P000000063670" }]).get("P000000063670"), "Q000000283405");
assert.equal(quoteIdsFromBody({ id: "Q1", proposal_id: "P2" }).size, 0); // too short to be real IDs

const row = (o: Record<string, string>) => ({ "proposal / endo id": "P000000062392", product: "4W", status: "PENDING", "reason of nstp": "IDV limits breached, case referred to UW", ...o });
assert.equal(isIdvDeviationReferral(row({})), true);
assert.equal(isIdvDeviationReferral(row({ product: "2W" })), false);
assert.equal(isIdvDeviationReferral(row({ "reason of nstp": "-" })), false);
assert.equal(isIdvDeviationReferral(row({ status: "APPROVED" })), false);

console.log("corehub-referral tests passed");
