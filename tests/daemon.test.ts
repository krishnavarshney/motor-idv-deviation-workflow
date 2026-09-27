import { strict as assert } from "node:assert";
import { STALE_AFTER_MS, processNextJob, recoverStale, scheduleTick, type DaemonDeps, type Job } from "../src/worker/daemon-core";

type Calls = Record<string, unknown[][]>;

function fake(over: Partial<DaemonDeps> = {}) {
  const calls: Calls = {};
  const rec =
    (name: string) =>
    async (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
    };
  const deps: DaemonDeps = {
    claimJob: async () => null,
    execute: async () => ({ runId: "run-1", failed: false, error: null }),
    finishJob: rec("finishJob"),
    dueSchedules: async () => [],
    hasActiveJob: async () => false,
    enqueue: rec("enqueue"),
    advanceSchedule: rec("advanceSchedule"),
    logScheduleSkipped: rec("logScheduleSkipped"),
    staleJobs: async () => [],
    failStaleJob: rec("failStaleJob"),
    ...over,
  };
  return { deps, calls };
}

const job: Job = { id: "job-1", type: "fetch", params: { dry_run: true, completion_mode: "in_app" }, schedule_id: null, requested_by: "u1" };

async function main() {
  // Empty queue
  {
    const { deps, calls } = fake();
    assert.equal(await processNextJob(deps), false);
    assert.equal(calls.finishJob, undefined);
  }
  // Success
  {
    const { deps, calls } = fake({ claimJob: async () => job });
    assert.equal(await processNextJob(deps), true);
    assert.deepEqual(calls.finishJob, [["job-1", { status: "succeeded", runId: "run-1", error: null }]]);
  }
  // Execution reports failure
  {
    const { deps, calls } = fake({ claimJob: async () => job, execute: async () => ({ runId: "run-2", failed: true, error: "CoreHub login failed" }) });
    await processNextJob(deps);
    assert.deepEqual(calls.finishJob, [["job-1", { status: "failed", runId: "run-2", error: "CoreHub login failed" }]]);
  }
  // Execution throws
  {
    const { deps, calls } = fake({
      claimJob: async () => job,
      execute: async () => {
        throw new Error("browser crashed");
      },
    });
    await processNextJob(deps);
    assert.deepEqual(calls.finishJob, [["job-1", { status: "failed", runId: null, error: "browser crashed" }]]);
  }
  // Scheduler: one due, one due-but-still-active, one with a broken cron
  {
    const now = new Date("2026-09-28T04:00:00Z"); // Mon 09:30 IST
    const base = { timezone: "Asia/Kolkata", dry_run: true, completion_mode: "in_app" as const };
    const { deps, calls } = fake({
      dueSchedules: async () => [
        { id: "s-due", cron: "*/15 9-18 * * 1,2,3,4,5,6", ...base },
        { id: "s-busy", cron: "0 23 * * *", ...base },
        { id: "s-broken", cron: "not a cron", ...base },
      ],
      hasActiveJob: async (id) => id === "s-busy",
    });
    assert.equal(await scheduleTick(deps, now), 1);
    assert.deepEqual(calls.enqueue, [
      [{ type: "fetch", schedule_id: "s-due", requested_by: null, params: { dry_run: true, completion_mode: "in_app", then_evaluate: true } }],
    ]);
    assert.deepEqual(calls.logScheduleSkipped, [["s-busy"]]);
    const advanced = calls.advanceSchedule as [string, Date, Date | null][];
    assert.equal(advanced.length, 2, "broken schedule is not advanced");
    assert.equal(advanced[0][0], "s-due");
    assert.equal(advanced[0][1].toISOString(), "2026-09-28T04:15:00.000Z");
    assert.equal(advanced[0][2], now);
    assert.equal(advanced[1][0], "s-busy");
    assert.equal(advanced[1][2], null, "skipped schedule keeps last_run_at");
  }
  // Stale recovery uses a 5-minute cutoff
  {
    const now = new Date("2026-09-28T04:00:00Z");
    let cutoff: Date | null = null;
    const stale = { id: "job-9", caseIds: ["c1"], runId: "run-9" };
    const { deps, calls } = fake({
      staleJobs: async (c) => {
        cutoff = c;
        return [stale];
      },
    });
    assert.equal(await recoverStale(deps, now), 1);
    assert.equal(cutoff!.getTime(), now.getTime() - STALE_AFTER_MS);
    assert.deepEqual(calls.failStaleJob, [[stale]]);
  }

  console.log("daemon tests passed");
}

main();
