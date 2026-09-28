/** Supabase-backed DaemonDeps and job execution. Service role only. */

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWorkerConfig } from "./config";
import type { DaemonDeps, ExecuteResult, Job } from "./daemon-core";
import { createRun, emptyCounts, evaluateCases, fetchReferrals, finalizeRun, openSession, runReconcile } from "./pipeline";
import { loadDecisionConfig } from "../server/idv-config";

export function createDaemonDeps(supabase: SupabaseClient, workerId: string, execute: DaemonDeps["execute"]): DaemonDeps {
  return {
    async claimJob() {
      const { data, error } = await supabase.rpc("claim_next_job", { p_worker_id: workerId });
      if (error) throw new Error(`claim_next_job failed: ${error.message}`);
      return ((data as Job[] | null) ?? [])[0] ?? null;
    },
    execute,
    async finishJob(id, r) {
      await supabase
        .from("automation_jobs")
        .update({ status: r.status, run_id: r.runId, error: r.error, finished_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "running");
    },
    async dueSchedules(now) {
      const { data, error } = await supabase
        .from("automation_schedules")
        .select("id,cron,timezone,dry_run,completion_mode")
        .eq("enabled", true)
        .lte("next_run_at", now.toISOString());
      if (error) throw new Error(`Loading schedules failed: ${error.message}`);
      return data ?? [];
    },
    async hasActiveJob(scheduleId) {
      const { count, error } = await supabase
        .from("automation_jobs")
        .select("id", { count: "exact", head: true })
        .eq("schedule_id", scheduleId)
        .in("status", ["queued", "running"]);
      if (error) throw new Error(`Checking active job failed: ${error.message}`);
      return (count ?? 0) > 0;
    },
    async enqueue(job) {
      const { error } = await supabase.from("automation_jobs").insert(job);
      if (error) throw new Error(`Enqueue failed: ${error.message}`);
    },
    async advanceSchedule(id, nextRun, ranAt) {
      const { error } = await supabase
        .from("automation_schedules")
        .update({ next_run_at: nextRun.toISOString(), ...(ranAt ? { last_run_at: ranAt.toISOString() } : {}) })
        .eq("id", id);
      if (error) throw new Error(`Advancing schedule failed: ${error.message}`);
    },
    async logScheduleSkipped(id) {
      await supabase.from("audit_events").insert({
        event_type: "schedule_skipped",
        actor_type: "automation",
        severity: "warning",
        payload: { scheduleId: id, reason: "previous run still active" },
      });
    },
    async staleJobs(cutoff) {
      const { data } = await supabase
        .from("automation_jobs")
        .select("id,params,progress,run_id")
        .eq("status", "running")
        .lt("heartbeat_at", cutoff.toISOString());
      return (data ?? []).map((j) => ({
        id: j.id as string,
        caseIds: [...new Set([...(j.params?.case_ids ?? []), ...(j.progress?.case_ids ?? [])])] as string[],
        runId: (j.run_id as string | null) ?? null,
      }));
    },
    async failStaleJob(job) {
      await supabase
        .from("automation_jobs")
        .update({ status: "failed", error: "stale_heartbeat", finished_at: new Date().toISOString() })
        .eq("id", job.id);
      if (job.runId) {
        await supabase
          .from("automation_runs")
          .update({ status: "failed", finished_at: new Date().toISOString(), error_summary: "stale_heartbeat" })
          .eq("id", job.runId);
      }
      if (job.caseIds.length) {
        await supabase
          .from("referral_cases")
          .update({ referral_status: "received", workflow_status: "intake_pending" })
          .in("id", job.caseIds)
          .eq("referral_status", "processing");
      }
    },
  };
}

async function receivedCaseIds(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase
    .from("referral_cases")
    .select("id")
    .eq("referral_status", "received")
    .order("received_at")
    .limit(200);
  return (data ?? []).map((r) => r.id as string);
}

export async function executeJob(supabase: SupabaseClient, job: Job): Promise<ExecuteResult> {
  if (job.params.completion_mode !== "in_app") throw new Error("CoreHub write-back is not implemented");

  const config = loadWorkerConfig({ dryRun: job.params.dry_run, triggerSource: job.schedule_id ? "schedule" : "ui" });
  const runId = await createRun(supabase, config);
  await supabase.from("automation_jobs").update({ run_id: runId }).eq("id", job.id);

  // `step` counts distinct checkpoints so the UI can show "Step n" without a fixed step list;
  // `steps` keeps when each one started so the job page can draw a timeline.
  const steps: { label: string; at: string }[] = [];
  let stepNo = 0;
  const progress = async (p: { current_step: string; done: number; total: number; case_ids?: string[] }) => {
    const at = new Date().toISOString();
    if (p.current_step !== steps.at(-1)?.label) {
      stepNo++;
      steps.push({ label: p.current_step, at });
      // ponytail: per-referral steps can be many; keep the latest 40, first ones are the least interesting.
      if (steps.length > 40) steps.splice(0, steps.length - 40);
    }
    await supabase
      .from("automation_jobs")
      .update({ progress: { ...p, step: stepNo, steps }, heartbeat_at: at })
      .eq("id", job.id);
  };

  const counts = emptyCounts();
  let failed = false;
  let close: (() => Promise<void>) | undefined;
  try {
    // Load the decision config once: reconciliation (which must run even if
    // Chrome fails to launch) and the browser session both need it.
    const decisionConfig = await loadDecisionConfig(supabase);

    if (job.type === "fetch" && job.schedule_id) {
      const reconcileError = await runReconcile(supabase, decisionConfig, { dryRun: config.dryRun, runId });
      if (reconcileError) counts.errors.push(reconcileError);
    }

    await progress({ current_step: "Launching browser", done: 0, total: 0 });
    const opened = await openSession(supabase, config, runId, decisionConfig);
    close = opened.close;
    const s = opened.session;

    let caseIds: string[] = [];
    if (job.type === "fetch") {
      const fetched = await fetchReferrals(s, (label, done = 0, total = 0) => progress({ current_step: label, done, total }));
      counts.casesDiscovered = fetched.discovered;
      counts.casesNew = fetched.newCaseIds.length;
      if (job.params.then_evaluate) caseIds = fetched.newCaseIds;
      else await progress({ current_step: `Fetched ${fetched.newCaseIds.length} new referrals`, done: 0, total: 0, case_ids: fetched.newCaseIds });
    } else {
      caseIds = job.params.all_received ? await receivedCaseIds(supabase) : (job.params.case_ids ?? []);
    }

    if (caseIds.length) {
      await progress({ current_step: "Evaluating", done: 0, total: caseIds.length, case_ids: caseIds });
      const evaluated = await evaluateCases(s, caseIds, (done, total) =>
        progress({ current_step: "Evaluating", done, total, case_ids: caseIds }),
      );
      counts.casesProcessed = evaluated.casesProcessed;
      counts.casesErrored = evaluated.casesErrored;
      counts.errors.push(...evaluated.errors);
    } else if (job.params.then_evaluate || job.type === "evaluate") {
      await progress({ current_step: "No cases to evaluate", done: 0, total: 0, case_ids: [] });
    }
  } catch (err) {
    failed = true;
    counts.errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await close?.();
  }

  const status = await finalizeRun(supabase, runId, config.dryRun, counts, failed);
  return { runId, failed: status === "failed", error: counts.errors.join("; ") || null };
}
