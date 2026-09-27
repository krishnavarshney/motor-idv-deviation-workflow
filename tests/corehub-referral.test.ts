import assert from "node:assert/strict";
import { findQuote, isIdvDeviationReferral, vehicleFromQuote } from "../src/worker/corehub-scraper";

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

assert.deepEqual(
  { ...vehicleFromQuote(quote), vehicleDetails: undefined },
  { quoteId: "Q000000281926", make: "KIA", model: "SYROS", variant: "HTE 1.0 TURBO MT", fuelType: "PETROL", requestedIdv: 1050000, yom: 2026, vehicleDetails: undefined }
);

const row = (o: Record<string, string>) => ({ "proposal / endo id": "P000000062392", product: "4W", status: "PENDING", "reason of nstp": "IDV limits breached, case referred to UW", ...o });
assert.equal(isIdvDeviationReferral(row({})), true);
assert.equal(isIdvDeviationReferral(row({ product: "2W" })), false);
assert.equal(isIdvDeviationReferral(row({ "reason of nstp": "-" })), false);
assert.equal(isIdvDeviationReferral(row({ status: "APPROVED" })), false);

console.log("corehub-referral tests passed");
