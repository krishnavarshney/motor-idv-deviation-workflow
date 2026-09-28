import assert from "node:assert/strict";
import { planCorehubAction } from "../lib/corehub-actions";

const c = (referral_status: string, source_system = "corehub-browser") => ({ id: "c1", source_system, referral_status });

assert.deepEqual(planCorehubAction(c("approved"), null, null), { case_id: "c1", action: "approve", reason: null });
assert.deepEqual(planCorehubAction(c("rejected"), null, "  IDV 40% above OBV Excellent band "), {
  case_id: "c1",
  action: "reject",
  reason: "IDV 40% above OBV Excellent band",
});
// Never guessed: undecided, unreviewed or already-sent cases are blocked with a reason.
assert.match((planCorehubAction(c("manual_review"), null, null) as { blocked: string }).blocked, /underwriter/);
assert.match((planCorehubAction(c("received"), null, null) as { blocked: string }).blocked, /Not decided/);
assert.match((planCorehubAction(c("rejected"), null, "") as { blocked: string }).blocked, /reason/);
assert.match((planCorehubAction(c("approved", "manual"), null, null) as { blocked: string }).blocked, /Not a CoreHub/);
assert.match((planCorehubAction(c("approved"), { status: "succeeded", action: "approve" }, null) as { blocked: string }).blocked, /Already approved/);
assert.match((planCorehubAction(c("approved"), { status: "running", action: "approve" }, null) as { blocked: string }).blocked, /in progress/);
// A failed or rehearsed attempt can be sent again.
assert.equal((planCorehubAction(c("approved"), { status: "failed", action: "approve" }, null) as { action: string }).action, "approve");
assert.equal((planCorehubAction(c("approved"), { status: "rehearsed", action: "approve" }, null) as { action: string }).action, "approve");

console.log("corehub-actions tests passed");
