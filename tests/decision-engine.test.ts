import{strict as assert}from"node:assert";import{evaluateIdvDecision}from"../src/domain/decision-engine";
const cfg={absoluteTolerance:5000,percentageTolerance:2,minimumVehicleConfidence:.85,providerTimeoutSeconds:4,retryCount:2,reviewSlaMinutes:240};
const base={requestedIdv:500000,fetchedIdv:500000,vehicleConfidence:.95,providerStatus:"succeeded" as const};
assert.equal(evaluateIdvDecision(base,cfg).reasonCode,"EXACT_IDV_MATCH");
assert.equal(evaluateIdvDecision({...base,fetchedIdv:496000},cfg).decision,"auto_approved");
assert.equal(evaluateIdvDecision({...base,fetchedIdv:490000},cfg).decision,"manual_review");
assert.equal(evaluateIdvDecision({...base,vehicleConfidence:.70},cfg).reasonCode,"LOW_VEHICLE_CONFIDENCE");
assert.equal(evaluateIdvDecision({...base,providerStatus:"timeout"},cfg).reasonCode,"PROVIDER_FAILURE");
console.log("decision-engine tests passed");