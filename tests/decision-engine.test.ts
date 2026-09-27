import{strict as assert}from"node:assert";import{evaluateIdvDecision}from"../src/domain/decision-engine";
const cfg={absoluteTolerance:5000,percentageTolerance:2,minimumVehicleConfidence:.85,providerTimeoutSeconds:4,retryCount:2,reviewSlaMinutes:240};
const base={requestedIdv:500000,fetchedIdv:500000,vehicleConfidence:.95,providerStatus:"succeeded" as const};
assert.equal(evaluateIdvDecision(base,cfg).reasonCode,"EXACT_IDV_MATCH");
assert.equal(evaluateIdvDecision({...base,fetchedIdv:496000},cfg).decision,"auto_approved");
assert.equal(evaluateIdvDecision({...base,fetchedIdv:490000},cfg).decision,"manual_review");
assert.equal(evaluateIdvDecision({...base,vehicleConfidence:.70},cfg).reasonCode,"LOW_VEHICLE_CONFIDENCE");
assert.equal(evaluateIdvDecision({...base,providerStatus:"timeout"},cfg).reasonCode,"PROVIDER_FAILURE");

// Condition band auto-approval tests
const conditions = {
  good: { min: 460000, max: 485000 },
  veryGood: { min: 485001, max: 515000 },
  excellent: { min: 515001, max: 545000 },
};
// 1. Inside Good band (delta is 30,000, which exceeds standard 5,000/2% tolerance, but inside Good band -> Auto Approved)
const goodRes = evaluateIdvDecision({ ...base, requestedIdv: 470000, fetchedIdv: 500000, conditions }, cfg);
assert.equal(goodRes.decision, "auto_approved");
assert.equal(goodRes.reasonCode, "WITHIN_CONDITION_BAND");
assert.equal(goodRes.matchedCondition, "good");

// 2. Inside Very Good band -> Auto Approved
const vgRes = evaluateIdvDecision({ ...base, requestedIdv: 510000, fetchedIdv: 500000, conditions }, cfg);
assert.equal(vgRes.decision, "auto_approved");
assert.equal(vgRes.reasonCode, "WITHIN_CONDITION_BAND");
assert.equal(vgRes.matchedCondition, "very_good");

// 3. Inside Excellent band -> Auto Approved
const excRes = evaluateIdvDecision({ ...base, requestedIdv: 530000, fetchedIdv: 500000, conditions }, cfg);
assert.equal(excRes.decision, "auto_approved");
assert.equal(excRes.reasonCode, "WITHIN_CONDITION_BAND");
assert.equal(excRes.matchedCondition, "excellent");

console.log("decision-engine tests passed (including condition band auto-approvals)");