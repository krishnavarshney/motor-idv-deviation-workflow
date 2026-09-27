/**
 * Main Worker Run Orchestrator
 *
 * Entry point for the Playwright-based scheduled worker.
 * Orchestrates: CoreHub scrape → OBV lookup → Decision engine → Supabase persist
 *
 * Usage:
 *   npx tsx src/worker/run.ts                    # manual, dry-run by default
 *   AUTOMATION_DRY_RUN=false npx tsx src/worker/run.ts  # live mode
 */

import { chromium } from "playwright";
import { existsSync } from "fs";
import { loadWorkerConfig, type WorkerConfig } from "./config";
import { getAdminClient } from "./supabase-admin";
import { openReferral, scrapeCorehub, type CorehubReferral } from "./corehub-scraper";
import { lookupObv, type ObvBrowserResult } from "./obv-lookup";
import { captureEvidence, type EvidenceArtifact } from "./evidence";
import { evaluateIdvDecision } from "../domain/decision-engine";
import { loadDecisionConfig } from "../server/idv-config";
import { reconcileConditionBands } from "./reconcile";
import type { DecisionConfig } from "../domain/motor-idv";

interface RunSummary {
  runId: string;
  status: "completed" | "failed" | "dry_run_completed";
  casesDiscovered: number;
  casesNew: number;
  casesProcessed: number;
  casesErrored: number;
  durationMs: number;
  errors: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────

async function createRun(
  supabase: ReturnType<typeof getAdminClient>,
  config: WorkerConfig
) {
  const { data, error } = await supabase
    .from("automation_runs")
    .insert({
      run_label: config.pollLabel,
      status: "running",
      dry_run: config.dryRun,
      trigger_source: config.triggerSource,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create automation run: ${error.message}`);
  return data;
}

async function finalizeRun(
  supabase: ReturnType<typeof getAdminClient>,
  runId: string,
  summary: Omit<RunSummary, "runId" | "durationMs">
) {
  await supabase
    .from("automation_runs")
    .update({
      status: summary.status,
      finished_at: new Date().toISOString(),
      cases_discovered: summary.casesDiscovered,
      cases_new: summary.casesNew,
      cases_processed: summary.casesProcessed,
      cases_errored: summary.casesErrored,
      error_summary:
        summary.errors.length > 0 ? summary.errors.join("; ") : null,
    })
    .eq("id", runId);
}

async function isExistingCase(
  supabase: ReturnType<typeof getAdminClient>,
  externalCaseId: string
): Promise<boolean> {
  const { data } = await supabase
    .from("referral_cases")
    .select("id")
    .eq("external_case_id", externalCaseId)
    .maybeSingle();
  return data !== null;
}

async function persistCase(
  supabase: ReturnType<typeof getAdminClient>,
  referral: CorehubReferral,
  obvResult: ObvBrowserResult,
  decision: ReturnType<typeof evaluateIdvDecision>,
  decisionConfig: DecisionConfig,
  workerConfig: WorkerConfig,
  runId: string
) {
  const idempotencyKey = `corehub:${referral.externalCaseId}`;

  const referralStatus =
    decision.decision === "auto_approved" ? "approved" : "manual_review";
  const workflowStatus =
    decision.decision === "auto_approved"
      ? "auto_approved"
      : "queued_for_review";

  // Insert the referral case
  const { data: caseRow, error: caseError } = await supabase
    .from("referral_cases")
    .insert({
      external_case_id: referral.externalCaseId,
      source_system: "corehub-browser",
      idempotency_key: idempotencyKey,
      registration_number: referral.registrationNumber ?? null,
      make_raw: referral.make,
      model_raw: referral.model,
      variant_raw: referral.variant,
      fuel_type_raw: referral.fuelType,
      cc_raw: referral.cc,
      requested_idv: referral.requestedIdv,
      referral_status: referralStatus,
      workflow_status: workflowStatus,
      processed_at: new Date().toISOString(),
      automation_run_id: runId,
      metadata: {
        dry_run: workerConfig.dryRun,
        raw_values: referral.rawValues,
        yom: referral.yom,
        quote_id: referral.quoteId,
        vehicle_details: referral.vehicleDetails,
        obv_source_url: obvResult.sourceUrl,
        obv_reason_code: obvResult.reasonCode,
      },
    })
    .select()
    .single();

  if (caseError) {
    throw new Error(`Failed to insert case ${referral.externalCaseId}: ${caseError.message}`);
  }

  // Insert vehicle resolution (placeholder — scraper provides raw values)
  const { data: resolution } = await supabase
    .from("vehicle_resolutions")
    .insert({
      case_id: caseRow.id,
      normalized_make: referral.make?.toUpperCase() ?? null,
      normalized_model: referral.model?.toUpperCase() ?? null,
      normalized_variant: referral.variant?.toUpperCase() ?? null,
      normalized_fuel: referral.fuelType?.toUpperCase() ?? null,
      normalized_cc: referral.cc ? Number(referral.cc) : null,
      candidate_source: "corehub-browser",
      resolved_vehicle_key: [referral.make, referral.model, referral.variant]
        .filter(Boolean)
        .join("-")
        .toUpperCase()
        .replace(/\s+/g, ""),
      resolved_make: referral.make,
      resolved_model: referral.model,
      resolved_variant: referral.variant,
      confidence_score: 0.9, // Browser extraction = moderate confidence
      match_strategy: "browser_extraction",
      match_reason_codes: ["COREHUB_BROWSER_EXTRACT"],
    })
    .select()
    .single();

  // Insert IDV check
  const providerStatus = obvResult.success
    ? "succeeded"
    : obvResult.reasonCode === "TIMEOUT"
      ? "timeout"
      : obvResult.reasonCode === "CAPTCHA_DETECTED"
        ? "unavailable"
        : "failed";

  const { data: idvCheck } = await supabase
    .from("idv_checks")
    .insert({
      case_id: caseRow.id,
      vehicle_resolution_id: resolution?.id ?? null,
      provider: "obv-http",
      provider_status: providerStatus,
      fetched_idv: obvResult.idv,
      fetched_currency: "INR",
      fetched_at: new Date().toISOString(),
      lookup_latency_ms: obvResult.latencyMs,
      raw_request: {
        make: referral.make,
        model: referral.model,
        variant: referral.variant,
        source_url: workerConfig.obvSearchUrl ?? null,
        // Exact OBV names the raw CoreHub values resolved to (absent when a field had no match).
        resolved: (obvResult.raw as { resolved?: unknown } | undefined)?.resolved ?? null,
      },
      raw_response: {
        idv: obvResult.idv,
        sourceUrl: obvResult.sourceUrl,
        reasonCode: obvResult.reasonCode,
        conditions: obvResult.conditions ?? null,
      },
    })
    .select()
    .single();

  // Insert approval decision
  await supabase.from("approval_decisions").insert({
    case_id: caseRow.id,
    idv_check_id: idvCheck?.id ?? null,
    decision: decision.decision,
    decision_reason_code: decision.reasonCode,
    decision_reason_details: {
      explanation: decision.explanation,
      dry_run: workerConfig.dryRun,
    },
    requested_idv: referral.requestedIdv,
    fetched_idv: obvResult.idv,
    absolute_delta: decision.absoluteDelta,
    percentage_delta: decision.percentageDelta,
    tolerance_mode: "absolute_or_percentage",
    tolerance_value: decisionConfig.absoluteTolerance,
  });

  // If manual review needed, create a review entry
  if (decision.decision === "manual_review") {
    await supabase.from("manual_reviews").insert({
      case_id: caseRow.id,
      review_status: "queued",
      priority: 3,
      review_reason: decision.explanation,
      sla_due_at: new Date(
        Date.now() + decisionConfig.reviewSlaMinutes * 60000
      ).toISOString(),
    });
  }

  // Audit event
  await supabase.from("audit_events").insert({
    case_id: caseRow.id,
    event_type: workerConfig.dryRun
      ? "browser_worker_dry_run"
      : "browser_worker_processed",
    actor_type: "automation",
    severity: "info",
    payload: {
      decision: decision.decision,
      reasonCode: decision.reasonCode,
      requestedIdv: referral.requestedIdv,
      fetchedIdv: obvResult.idv,
      obvSourceUrl: obvResult.sourceUrl,
      dryRun: workerConfig.dryRun,
    },
    correlation_id: caseRow.correlation_id,
  });

  return caseRow;
}

// ─── Main Orchestrator ──────────────────────────────────────────────────

export async function runWorker(
  configOverrides?: Partial<WorkerConfig>
): Promise<RunSummary> {
  const started = Date.now();
  const config = loadWorkerConfig(configOverrides);

  console.log("═══════════════════════════════════════════════════");
  console.log(`🚀 IDV Deviation Worker — ${config.dryRun ? "DRY RUN" : "LIVE"}`);
  console.log(`   Label:   ${config.pollLabel}`);
  console.log(`   Trigger: ${config.triggerSource}`);
  console.log(`   Headless: ${config.headless}`);
  console.log("═══════════════════════════════════════════════════");

  const supabase = getAdminClient(
    config.supabaseUrl,
    config.supabaseServiceRoleKey
  );

  // Create run record
  const run = await createRun(supabase, config);
  const runId = run.id;
  console.log(`📝 Run ID: ${runId}`);

  // Load decision config from Supabase
  const decisionConfig = await loadDecisionConfig(supabase);

  const errors: string[] = [];
  let casesDiscovered = 0;
  let casesNew = 0;
  let casesProcessed = 0;
  let casesErrored = 0;

  // ── Step 0: Reconcile queued reviews against condition bands ────
  // Needs no browser, so it runs even when CoreHub is unreachable.
  console.log("\n🔁 Phase 0: Reconciling queued reviews against condition bands...");
  try {
    const r = await reconcileConditionBands(supabase, decisionConfig, { dryRun: config.dryRun, runId });
    console.log(`   Checked ${r.checked}, ${config.dryRun ? "would approve" : "approved"} ${r.approved}`);
  } catch (err) {
    const errMsg = `Reconciliation failed: ${err}`;
    console.error(`   ❌ ${errMsg}`);
    errors.push(errMsg);
  }

  // Launch browser (uses local Google Chrome if available, or playwright chromium)
  const browser = await chromium
    .launch({
      channel: "chrome",
      headless: config.headless,
    })
    .catch(() =>
      chromium.launch({
        headless: config.headless,
      })
    );

  try {
    const contextOptions: Parameters<typeof browser.newContext>[0] = {
      viewport: { width: 1280, height: 720 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    };
    if (existsSync(config.sessionStoragePath)) {
      contextOptions.storageState = config.sessionStoragePath;
    }
    const context = await browser.newContext(contextOptions);

    const corehubPage = await context.newPage();

    // ── Step 1: Scrape CoreHub ──────────────────────────────────────
    console.log("\n📡 Phase 1: Scraping CoreHub referrals...");
    const scrapeResult = await scrapeCorehub(corehubPage, context, config, runId);
    if (scrapeResult.sessionReused) {
      console.log("♻️  CoreHub session was reused from saved state");
    }

    if (!scrapeResult.success) {
      const errMsg = scrapeResult.error ?? "CoreHub scrape failed";
      console.error(`❌ ${errMsg}`);
      errors.push(errMsg);

      // Log failure audit event
      await supabase.from("audit_events").insert({
        event_type: "browser_worker_corehub_error",
        actor_type: "automation",
        severity: "error",
        payload: { error: errMsg, runId },
      });

      await finalizeRun(supabase, runId, {
        status: "failed",
        casesDiscovered: 0,
        casesNew: 0,
        casesProcessed: 0,
        casesErrored: 0,
        errors,
      });

      return {
        runId,
        status: "failed",
        casesDiscovered: 0,
        casesNew: 0,
        casesProcessed: 0,
        casesErrored: 0,
        durationMs: Date.now() - started,
        errors,
      };
    }

    casesDiscovered = scrapeResult.referrals.length;
    console.log(`📊 Discovered ${casesDiscovered} referrals`);

    // ── Step 2: Filter to new cases (idempotency) ──────────────────
    const newReferrals: CorehubReferral[] = [];
    for (const referral of scrapeResult.referrals) {
      const exists = await isExistingCase(supabase, referral.externalCaseId);
      if (!exists) {
        newReferrals.push(referral);
      } else {
        console.log(`⏭  Skipping existing case: ${referral.externalCaseId}`);
      }
    }
    casesNew = newReferrals.length;
    console.log(`🆕 ${casesNew} new cases to process`);

    if (casesNew === 0) {
      console.log("✅ No new referrals — nothing to do.");

      await supabase.from("audit_events").insert({
        event_type: "browser_worker_no_new_cases",
        actor_type: "automation",
        severity: "info",
        payload: { casesDiscovered, runId },
      });

      const status = config.dryRun ? "dry_run_completed" : "completed";
      await finalizeRun(supabase, runId, {
        status,
        casesDiscovered,
        casesNew: 0,
        casesProcessed: 0,
        casesErrored: 0,
        errors,
      });

      return {
        runId,
        status,
        casesDiscovered,
        casesNew: 0,
        casesProcessed: 0,
        casesErrored: 0,
        durationMs: Date.now() - started,
        errors,
      };
    }

    // ── Step 3: Process each new case ──────────────────────────────
    for (const listed of newReferrals) {
      console.log(`\n🔄 Processing: ${listed.externalCaseId}`);
      let referral = listed;

      try {
        // Vehicle + requested IDV come from the quote the review page loads
        referral = await openReferral(corehubPage, config, listed);
        console.log(`   Vehicle: ${referral.make} ${referral.model} ${referral.variant} ${referral.fuelType ?? ""} (${referral.yom ?? "YOM ?"})`);
        console.log(`   Requested IDV: ₹${referral.requestedIdv?.toLocaleString("en-IN") ?? "N/A"}`);

        // OBV lookup
        let obvResult: ObvBrowserResult;

        if (
          referral.make &&
          referral.model &&
          referral.variant
        ) {
          obvResult = await lookupObv({
            make: referral.make,
            model: referral.model,
            variant: referral.variant,
            year: referral.yom ?? undefined,
            fuel: referral.fuelType,
          });
        } else {
          // Missing vehicle details — cannot lookup
          obvResult = {
            success: false,
            idv: null,
            sourceUrl: null,
            reasonCode: "NO_RESULTS",
            latencyMs: 0,
            evidence: [],
            raw: { reason: "Missing make/model/variant from CoreHub" },
          };
        }

        console.log(
          `   OBV result: ${obvResult.success ? `₹${obvResult.idv?.toLocaleString("en-IN")}` : obvResult.reasonCode}`
        );

        // Run decision engine
        const providerStatus = obvResult.success
          ? "succeeded"
          : obvResult.reasonCode === "TIMEOUT"
            ? "timeout"
            : "unavailable";

        const decision = evaluateIdvDecision(
          {
            requestedIdv: referral.requestedIdv,
            fetchedIdv: obvResult.idv,
            vehicleConfidence: 0.9,
            providerStatus,
            conditions: obvResult.conditions,
          },
          decisionConfig
        );

        console.log(
          `   Decision: ${decision.decision} — ${decision.reasonCode}`
        );

        // Persist everything to Supabase
        await persistCase(
          supabase,
          referral,
          obvResult,
          decision,
          decisionConfig,
          config,
          runId
        );

        casesProcessed++;
        console.log(`   ✅ Case persisted: ${referral.externalCaseId}`);
      } catch (err) {
        casesErrored++;
        const errMsg = `Error processing ${referral.externalCaseId}: ${err}`;
        console.error(`   ❌ ${errMsg}`);
        errors.push(errMsg);

        // Audit event for the error
        await supabase.from("audit_events").insert({
          event_type: "browser_worker_case_error",
          actor_type: "automation",
          severity: "error",
          payload: {
            externalCaseId: referral.externalCaseId,
            error: String(err),
            runId,
          },
        });
      }
    }

    await corehubPage.close();
    await context.close();
  } finally {
    await browser.close();
  }

  // ── Finalize ────────────────────────────────────────────────────
  const status =
    casesErrored > 0 && casesProcessed === 0
      ? "failed"
      : config.dryRun
        ? "dry_run_completed"
        : "completed";

  await finalizeRun(supabase, runId, {
    status,
    casesDiscovered,
    casesNew,
    casesProcessed,
    casesErrored,
    errors,
  });

  const durationMs = Date.now() - started;

  console.log("\n═══════════════════════════════════════════════════");
  console.log(`🏁 Worker run finished in ${(durationMs / 1000).toFixed(1)}s`);
  console.log(`   Status:     ${status}`);
  console.log(`   Discovered: ${casesDiscovered}`);
  console.log(`   New:        ${casesNew}`);
  console.log(`   Processed:  ${casesProcessed}`);
  console.log(`   Errored:    ${casesErrored}`);
  if (errors.length > 0) {
    console.log(`   Errors:`);
    errors.forEach((e) => console.log(`     - ${e}`));
  }
  console.log("═══════════════════════════════════════════════════");

  return {
    runId,
    status,
    casesDiscovered,
    casesNew,
    casesProcessed,
    casesErrored,
    durationMs,
    errors,
  };
}

// ─── CLI Entry Point ────────────────────────────────────────────────────

const isDirectRun =
  process.argv[1]?.endsWith("run.ts") ||
  process.argv[1]?.endsWith("run.js");

if (isDirectRun) {
  runWorker()
    .then((summary) => {
      process.exit(summary.status === "failed" ? 1 : 0);
    })
    .catch((err) => {
      console.error("💥 Worker crashed:", err);
      process.exit(1);
    });
}
