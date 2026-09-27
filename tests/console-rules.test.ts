import { strict as assert } from "node:assert";
import { can } from "../lib/authz";
import { activeHref, visibleNav } from "../components/nav";
import { MAX_CASES_PER_JOB, parseJobRequest } from "../lib/jobs";
import { isWorkerOnline } from "../lib/worker-status";

function main() {
  // Role matrix (spec section 3)
  assert.equal(can("operator", "run_jobs"), true);
  assert.equal(can("operator", "review"), false);
  assert.equal(can("operator", "manage"), false);
  assert.equal(can("underwriter", "review"), true);
  assert.equal(can("underwriter", "test_lookup"), true);
  assert.equal(can("underwriter", "audit"), false);
  assert.equal(can("auditor", "view"), true);
  assert.equal(can("auditor", "run_jobs"), false);
  assert.equal(can("auditor", "audit"), true);
  assert.equal(can("admin", "manage"), true);
  assert.equal(can(null, "view"), false);
  assert.equal(can("hacker", "view"), false);

  // Job requests
  const id = "3f1c2b9e-0000-4000-8000-000000000001";
  assert.deepEqual(parseJobRequest({ type: "fetch" }), { ok: true, value: { type: "fetch" } });
  assert.deepEqual(parseJobRequest({ type: "evaluate", all_received: true }), { ok: true, value: { type: "evaluate", all_received: true } });
  assert.deepEqual(parseJobRequest({ type: "evaluate", case_ids: [id, id] }), { ok: true, value: { type: "evaluate", case_ids: [id] } });
  assert.equal(parseJobRequest({ type: "evaluate", case_ids: [] }).ok, false);
  assert.equal(parseJobRequest({ type: "evaluate", case_ids: ["not-a-uuid"] }).ok, false);
  const tooMany = Array.from({ length: MAX_CASES_PER_JOB + 1 }, (_, i) => `3f1c2b9e-0000-4000-8000-${String(i).padStart(12, "0")}`);
  assert.equal(parseJobRequest({ type: "evaluate", case_ids: tooMany }).ok, false);
  assert.equal(parseJobRequest({ type: "delete" }).ok, false);
  assert.equal(parseJobRequest(null).ok, false);

  // Worker online window: 2 minutes
  const now = Date.parse("2026-09-27T12:00:00Z");
  assert.equal(isWorkerOnline("2026-09-27T11:59:00Z", now), true);
  assert.equal(isWorkerOnline("2026-09-27T11:57:59Z", now), false);
  assert.equal(isWorkerOnline(null, now), false);

  // Sidebar visibility
  const titles = (role: string | null) => visibleNav(role).flatMap((g) => g.items.map((i) => i.title));
  assert.deepEqual(titles("operator"), ["Overview", "Referrals", "Runs", "Schedules"]);
  assert.deepEqual(titles("underwriter"), ["Overview", "Referrals", "Review queue", "Runs", "Schedules"]);
  assert.deepEqual(titles("auditor"), ["Overview", "Referrals", "Runs", "Schedules", "Audit log"]);
  assert.deepEqual(titles("admin"), ["Overview", "Referrals", "Review queue", "Runs", "Schedules", "Decision rules", "Team", "Audit log"]);
  assert.deepEqual(visibleNav(null), []);
  assert.equal(activeHref("/automation/schedules"), "/automation/schedules");
  assert.equal(activeHref("/automation/jobs/123"), "/automation");
  assert.equal(activeHref("/"), "/");

  console.log("console rules tests passed");
}

main();
