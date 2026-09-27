/**
 * CLI worker run: reconcile queued reviews, fetch new CoreHub referrals, evaluate them.
 *
 * Usage:
 *   npx tsx src/worker/run.ts                           # dry-run by default
 *   AUTOMATION_DRY_RUN=false npx tsx src/worker/run.ts  # live mode
 *
 * The console uses the daemon (daemon.ts) instead; this stays for local and
 * emergency GitHub Actions runs.
 */

import { loadWorkerConfig, type WorkerConfig } from "./config";
import { getAdminClient } from "./supabase-admin";
import { createRun, emptyCounts, evaluateCases, fetchReferrals, finalizeRun, openSession, runReconcile } from "./pipeline";

export async function runWorker(configOverrides?: Partial<WorkerConfig>) {
  const started = Date.now();
  const config = loadWorkerConfig(configOverrides);
  const supabase = getAdminClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const runId = await createRun(supabase, config);
  console.log(`🚀 IDV worker ${config.dryRun ? "DRY RUN" : "LIVE"} — run ${runId} (${config.triggerSource})`);

  const counts = emptyCounts();
  let failed = false;
  let close: (() => Promise<void>) | undefined;
  try {
    const opened = await openSession(supabase, config, runId);
    close = opened.close;
    const reconcileError = await runReconcile(opened.session);
    if (reconcileError) counts.errors.push(reconcileError);

    const fetched = await fetchReferrals(opened.session);
    counts.casesDiscovered = fetched.discovered;
    counts.casesNew = fetched.newCaseIds.length;
    const evaluated = await evaluateCases(opened.session, fetched.newCaseIds, async (done, total) => {
      console.log(`   ${done}/${total} evaluated`);
    });
    counts.casesProcessed = evaluated.casesProcessed;
    counts.casesErrored = evaluated.casesErrored;
    counts.errors.push(...evaluated.errors);
  } catch (err) {
    failed = true;
    counts.errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await close?.();
  }

  const status = await finalizeRun(supabase, runId, config.dryRun, counts, failed);
  const durationMs = Date.now() - started;
  console.log(
    `🏁 ${status} in ${(durationMs / 1000).toFixed(1)}s — discovered ${counts.casesDiscovered}, new ${counts.casesNew}, processed ${counts.casesProcessed}, errored ${counts.casesErrored}`,
  );
  counts.errors.forEach((e) => console.log(`   - ${e}`));
  return { runId, status, durationMs, ...counts };
}

const isDirectRun = process.argv[1]?.endsWith("run.ts") || process.argv[1]?.endsWith("run.js");

if (isDirectRun) {
  runWorker()
    .then((summary) => process.exit(summary.status === "failed" ? 1 : 0))
    .catch((err) => {
      console.error("💥 Worker crashed:", err);
      process.exit(1);
    });
}
