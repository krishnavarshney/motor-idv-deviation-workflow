/**
 * Daemon loop steps. All I/O goes through DaemonDeps so the logic is testable
 * without Supabase or a browser (see tests/daemon.test.ts).
 */

import { nextRunAt, type CompletionMode } from "../../lib/schedule";

export const STALE_AFTER_MS = 5 * 60_000;

export type JobType = "fetch" | "evaluate";

export interface JobParams {
  dry_run: boolean;
  completion_mode: CompletionMode;
  then_evaluate?: boolean;
  case_ids?: string[];
  all_received?: boolean;
}

export interface Job {
  id: string;
  type: JobType;
  params: JobParams;
  schedule_id: string | null;
  requested_by: string | null;
}

export type NewJob = Omit<Job, "id">;

export interface Schedule {
  id: string;
  cron: string;
  timezone: string;
  dry_run: boolean;
  completion_mode: CompletionMode;
}

export interface StaleJob {
  id: string;
  caseIds: string[];
}

export interface ExecuteResult {
  runId: string;
  failed: boolean;
  error: string | null;
}

export interface DaemonDeps {
  claimJob(): Promise<Job | null>;
  execute(job: Job): Promise<ExecuteResult>;
  finishJob(id: string, r: { status: "succeeded" | "failed"; runId: string | null; error: string | null }): Promise<void>;
  dueSchedules(now: Date): Promise<Schedule[]>;
  hasActiveJob(scheduleId: string): Promise<boolean>;
  enqueue(job: NewJob): Promise<void>;
  advanceSchedule(id: string, nextRun: Date, ranAt: Date | null): Promise<void>;
  logScheduleSkipped(id: string): Promise<void>;
  staleJobs(cutoff: Date): Promise<StaleJob[]>;
  failStaleJob(job: StaleJob): Promise<void>;
}

export async function processNextJob(d: DaemonDeps): Promise<boolean> {
  const job = await d.claimJob();
  if (!job) return false;
  try {
    const r = await d.execute(job);
    await d.finishJob(job.id, { status: r.failed ? "failed" : "succeeded", runId: r.runId, error: r.error });
  } catch (err) {
    await d.finishJob(job.id, { status: "failed", runId: null, error: err instanceof Error ? err.message : String(err) });
  }
  return true;
}

export async function scheduleTick(d: DaemonDeps, now: Date): Promise<number> {
  let enqueued = 0;
  for (const s of await d.dueSchedules(now)) {
    let next: Date;
    try {
      next = nextRunAt(s.cron, s.timezone, now);
    } catch (err) {
      console.error(`⚠ Schedule ${s.id} has an invalid cron "${s.cron}":`, err);
      continue;
    }
    // One run per schedule at a time: skip this slot if the previous one hasn't finished.
    if (await d.hasActiveJob(s.id)) {
      await d.logScheduleSkipped(s.id);
      await d.advanceSchedule(s.id, next, null);
      continue;
    }
    await d.enqueue({
      type: "fetch",
      schedule_id: s.id,
      requested_by: null,
      params: { dry_run: s.dry_run, completion_mode: s.completion_mode, then_evaluate: true },
    });
    await d.advanceSchedule(s.id, next, now);
    enqueued++;
  }
  return enqueued;
}

export async function recoverStale(d: DaemonDeps, now: Date): Promise<number> {
  const stale = await d.staleJobs(new Date(now.getTime() - STALE_AFTER_MS));
  for (const job of stale) await d.failStaleJob(job);
  return stale.length;
}
