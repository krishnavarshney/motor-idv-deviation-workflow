/**
 * Always-on worker daemon.
 *
 * Every 10 s: heartbeat → recover stale jobs → enqueue due schedules → run the
 * next queued job. Jobs run one at a time (one CoreHub browser session).
 *
 * Usage: npm run worker:daemon   (keep it running under a process manager)
 */

import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { loadWorkerConfig } from "./config";
import { getAdminClient } from "./supabase-admin";
import { processNextJob, recoverStale, scheduleTick, type DaemonDeps } from "./daemon-core";
import { createDaemonDeps, executeJob } from "./daemon-store";

const WORKER_ID = process.env.WORKER_ID || `${hostname()}-${process.pid}`;
const POLL_MS = 10_000;
const JOB_HEARTBEAT_MS = 30_000;

async function main() {
  const config = loadWorkerConfig();
  const supabase = getAdminClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  let currentJobId: string | null = null;
  let stopping = false;

  const beat = async () => {
    await supabase.from("worker_heartbeats").upsert({
      worker_id: WORKER_ID,
      last_seen_at: new Date().toISOString(),
      version: process.env.npm_package_version ?? null,
      current_job_id: currentJobId,
    });
  };

  const execute: DaemonDeps["execute"] = async (job) => {
    currentJobId = job.id;
    await beat();
    console.log(`▶ Job ${job.id} (${job.type}${job.schedule_id ? ", scheduled" : ""})`);
    // Keep both heartbeats fresh during long OBV lookups.
    const timer = setInterval(async () => {
      await Promise.all([
        beat(),
        supabase.from("automation_jobs").update({ heartbeat_at: new Date().toISOString() }).eq("id", job.id),
      ]).catch((err) => console.error("heartbeat failed:", err));
    }, JOB_HEARTBEAT_MS);
    try {
      const result = await executeJob(supabase, job);
      console.log(`■ Job ${job.id} ${result.failed ? "failed" : "succeeded"}${result.error ? ` — ${result.error}` : ""}`);
      return result;
    } finally {
      clearInterval(timer);
      currentJobId = null;
    }
  };

  const deps = createDaemonDeps(supabase, WORKER_ID, execute);
  const stop = () => {
    console.log("Stopping after the current step…");
    stopping = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  console.log(`🤖 IDV worker daemon ${WORKER_ID} started`);
  while (!stopping) {
    try {
      await beat();
      const now = new Date();
      const recovered = await recoverStale(deps, now);
      if (recovered) console.log(`♻ Recovered ${recovered} stale job(s)`);
      const enqueued = await scheduleTick(deps, now);
      if (enqueued) console.log(`⏰ Enqueued ${enqueued} scheduled job(s)`);
      if (await processNextJob(deps)) continue;
    } catch (err) {
      console.error("Daemon tick failed:", err);
    }
    await sleep(POLL_MS);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("💥 Daemon crashed:", err);
  process.exit(1);
});
