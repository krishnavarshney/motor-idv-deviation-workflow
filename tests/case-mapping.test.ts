import { strict as assert } from "node:assert";
import { evaluateIdvDecision } from "../src/domain/decision-engine";
import { caseStatusesFor, decisionInputFor, hasHumanDecision, newCaseRow, providerStatusFor } from "../src/worker/case-mapping";
import type { ObvBrowserResult } from "../src/worker/obv-lookup";

const cfg = {
  absoluteTolerance: 5000,
  percentageTolerance: 2,
  minimumVehicleConfidence: 0.85,
  providerTimeoutSeconds: 4,
  retryCount: 2,
  reviewSlaMinutes: 240,
};

function obv(over: Partial<ObvBrowserResult> = {}): ObvBrowserResult {
  return { success: true, idv: 500000, sourceUrl: "https://obv.test/r/1", reasonCode: "SUCCESS", latencyMs: 10, evidence: [], ...over };
}

function main() {
  assert.equal(providerStatusFor({ success: true, reasonCode: "SUCCESS" }), "succeeded");
  assert.equal(providerStatusFor({ success: false, reasonCode: "TIMEOUT" }), "timeout");
  assert.equal(providerStatusFor({ success: false, reasonCode: "CAPTCHA_DETECTED" }), "unavailable");
  assert.equal(providerStatusFor({ success: false, reasonCode: "NO_RESULTS" }), "failed");

  // Requested IDV 8% above base valuation but inside the Very Good band → condition-band approval.
  const banded = obv({ conditions: { veryGood: { min: 520000, max: 560000, midpoint: 540000, raw: "5.2 - 5.6 Lakh" } } });
  const d = evaluateIdvDecision(decisionInputFor(540000, banded), cfg);
  assert.equal(d.decision, "auto_approved");
  assert.equal(d.reasonCode, "WITHIN_CONDITION_BAND");
  assert.equal(d.matchedCondition, "very_good");

  // Same request without bands → manual review.
  assert.equal(evaluateIdvDecision(decisionInputFor(540000, obv()), cfg).decision, "manual_review");

  assert.equal(hasHumanDecision(null), false);
  assert.equal(hasHumanDecision({ decided_by: null }), false);
  assert.equal(hasHumanDecision({ decided_by: "user-1" }), true);

  assert.deepEqual(caseStatusesFor("auto_approved"), { referral_status: "approved", workflow_status: "auto_approved" });
  assert.deepEqual(caseStatusesFor("manual_review"), { referral_status: "manual_review", workflow_status: "queued_for_review" });

  const row = newCaseRow(
    { externalCaseId: "REF-9", registrationNumber: "MH01AB1234", make: "Maruti", model: "Baleno", variant: "Zeta", fuelType: "Petrol", cc: "1197", requestedIdv: 540000, rawValues: { a: "b" } },
    "run-1",
    true,
  );
  assert.equal(row.idempotency_key, "corehub:REF-9");
  assert.equal(row.referral_status, "received");
  assert.equal(row.workflow_status, "intake_pending");
  assert.equal(row.automation_run_id, "run-1");
  assert.deepEqual(row.metadata, { dry_run: true, raw_values: { a: "b" } });

  console.log("case mapping tests passed");
}

main();
