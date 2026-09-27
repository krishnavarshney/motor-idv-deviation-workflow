import assert from "node:assert/strict";
import {
  calculateSimulatedObvSpectrum,
  analyzeDecisionAllowance,
  COREHUB_BENCHMARK_PRESETS,
} from "../lib/idv-simulator-engine";
import type { DecisionConfig } from "../src/domain/motor-idv";

const TEST_CONFIG: DecisionConfig = {
  absoluteTolerance: 15000,
  percentageTolerance: 3.5,
  minimumVehicleConfidence: 0.8,
  providerTimeoutSeconds: 20,
  retryCount: 2,
  reviewSlaMinutes: 120,
};

// Test 1: Condition spectrum calculation
const spectrum2022 = calculateSimulatedObvSpectrum({
  make: "Maruti Suzuki",
  model: "Baleno",
  variant: "Zeta Petrol",
  year: 2022,
  currentYear: 2026,
});

assert.ok(spectrum2022.benchmarkIdv > 0, "Benchmark IDV should be positive");
assert.ok(spectrum2022.good.min < spectrum2022.veryGood.min, "Good min should be lower than Very Good min");
assert.ok(spectrum2022.veryGood.max < spectrum2022.excellent.max, "Very Good max should be lower than Excellent max");

// Test 2: Allowance analysis within tolerance
const analysisWithin = analyzeDecisionAllowance(
  spectrum2022.benchmarkIdv + 5000,
  spectrum2022.benchmarkIdv,
  TEST_CONFIG,
  spectrum2022
);
assert.equal(analysisWithin.verdict, "auto_approved", "Should be auto-approved when within tolerance");
assert.ok(analysisWithin.isAllowed, "isAllowed must be true");
assert.ok(analysisWithin.minAllowedIdv < analysisWithin.benchmarkIdv, "Floor must be below benchmark");
assert.ok(analysisWithin.maxAllowedIdv > analysisWithin.benchmarkIdv, "Ceiling must be above benchmark");

// Test 3: Allowance analysis outside tolerance (excessive IDV)
const analysisExceeded = analyzeDecisionAllowance(
  analysisWithin.maxAllowedIdv + 25000,
  spectrum2022.benchmarkIdv,
  TEST_CONFIG,
  spectrum2022
);
assert.equal(analysisExceeded.verdict, "manual_review", "Should be manual review when tolerance exceeded");
assert.equal(analysisExceeded.isAllowed, false, "isAllowed must be false");
assert.ok(analysisExceeded.adjustmentRupeesNeeded > 0, "Should specify adjustment needed in INR");

// Test 4: Verify presets exist and have valid values
assert.ok(COREHUB_BENCHMARK_PRESETS.length >= 4, "Should have at least 4 CoreHub presets");
for (const p of COREHUB_BENCHMARK_PRESETS) {
  assert.ok(p.requestedIdv > 100000, "Preset requested IDV must be valid");
  assert.ok(p.year >= 2016 && p.year <= 2026, "Preset year must be valid");
}

// Test 5: Verify condition band auto-approval and pickedCondition logging
const goodBandAnalysis = analyzeDecisionAllowance(
  spectrum2022.good.midpoint,
  spectrum2022.benchmarkIdv,
  TEST_CONFIG,
  spectrum2022
);
assert.equal(goodBandAnalysis.verdict, "auto_approved");
assert.equal(goodBandAnalysis.activeRule, "WITHIN_CONDITION_BAND");
assert.equal(goodBandAnalysis.pickedCondition, "good");

const excellentBandAnalysis = analyzeDecisionAllowance(
  spectrum2022.excellent.midpoint,
  spectrum2022.benchmarkIdv,
  TEST_CONFIG,
  spectrum2022
);
assert.equal(excellentBandAnalysis.verdict, "auto_approved");
assert.equal(excellentBandAnalysis.activeRule, "WITHIN_CONDITION_BAND");
assert.equal(excellentBandAnalysis.pickedCondition, "excellent");

console.log("simulator tests passed");
