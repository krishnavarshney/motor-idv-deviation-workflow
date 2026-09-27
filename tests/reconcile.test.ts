import { strict as assert } from "node:assert";
import { bandApproval } from "../src/worker/reconcile";

const cfg = {
  absoluteTolerance: 5000,
  percentageTolerance: 2,
  minimumVehicleConfidence: 0.85,
  providerTimeoutSeconds: 4,
  retryCount: 2,
  reviewSlaMinutes: 240,
};
const conditions = {
  good: { min: 1078721, max: 1145447 },
  veryGood: { min: 1105689, max: 1174083 },
  excellent: { min: 1132657, max: 1202719 },
};
// Real queued case: outside ±₹5k / 2% of OBV ₹11,39,886 but inside Very Good band.
const base = { requestedIdv: 1108721, fetchedIdv: 1139886, vehicleConfidence: 0.95, providerStatus: "succeeded" as const, conditions };

const hit = bandApproval(base, cfg);
assert.equal(hit?.reasonCode, "WITHIN_CONDITION_BAND");
assert.equal(hit?.matchedCondition, "very_good");

assert.equal(bandApproval({ ...base, vehicleConfidence: 0.6 }, cfg), null, "low confidence stays in review");
assert.equal(bandApproval({ ...base, providerStatus: "failed" }, cfg), null, "provider failure stays in review");
assert.equal(bandApproval({ ...base, conditions: null }, cfg), null, "no bands stays in review");
assert.equal(bandApproval({ ...base, requestedIdv: 900000 }, cfg), null, "outside every band stays in review");
// Within plain tolerance is not this step's job — only band approvals are reconciled.
assert.equal(bandApproval({ ...base, requestedIdv: 1139886, conditions: { good: { min: 1, max: 2 } } }, cfg), null);

console.log("reconcile tests passed");
