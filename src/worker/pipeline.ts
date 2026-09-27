/**
 * Reusable worker pipeline steps shared by the CLI (run.ts) and the daemon.
 * fetchReferrals: CoreHub → referral_cases (status received)
 * evaluateCases:  referral_cases → OBV → decision engine → decisions/reviews
 */

import { chromium, type BrowserContext, type Page } from "playwright";
import { existsSync } from "fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "./config";
import { scrapeCorehub } from "./corehub-scraper";
import { lookupObvBrowser, type ObvBrowserResult } from "./obv-lookup";
import { reconcileConditionBands } from "./reconcile";
import { BROWSER_VEHICLE_CONFIDENCE, caseStatusesFor, decisionInputFor, hasHumanDecision, newCaseRow, providerStatusFor } from "./case-mapping";
import { evaluateIdvDecision } from "../domain/decision-engine";
import { loadDecisionConfig } from "../server/idv-config";
import type { DecisionConfig } from "../domain/motor-idv";

export interface Session {
  supabase: SupabaseClient;
  config: WorkerConfig;
  context: BrowserContext;
  decisionConfig: DecisionConfig;
  runId: string;
}

export interface RunCounts {
  casesDiscovered: number;
  casesNew: number;
  casesProcessed: number;
  casesErrored: number;
  errors: string[];
}

export const emptyCounts = (): RunCounts => ({ casesDiscovered: 0, casesNew: 0, casesProcessed: 0, casesErrored: 0, errors: [] });

export async function createRun(supabase: SupabaseClient, config: WorkerConfig): Promise<string> {
  const { data, error } = await supabase
    .from("automation_runs")
    .insert({ run_label: config.pollLabel, status: "running", dry_run: config.dryRun, trigger_source: config.triggerSource })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create automation run: ${error.message}`);
  return data.id as string;
}

export async function finalizeRun(supabase: SupabaseClient, runId: string, dryRun: boolean, c: RunCounts, failed: boolean) {
  const status =
    failed || (c.casesErrored > 0 && c.casesProcessed === 0) ? "failed" : dryRun ? "dry_run_completed" : "completed";
  await supabase
    .from("automation_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      cases_discovered: c.casesDiscovered,
      cases_new: c.casesNew,
      cases_processed: c.casesProcessed,
      cases_errored: c.casesErrored,
      error_summary: c.errors.length ? c.errors.join("; ") : null,
    })
    .eq("id", runId);
  return status as "completed" | "failed" | "dry_run_completed";
}

export async function openSession(
  supabase: SupabaseClient,
  config: WorkerConfig,
  runId: string,
  decisionConfig?: DecisionConfig,
) {
  const resolvedDecisionConfig = decisionConfig ?? (await loadDecisionConfig(supabase));
  // Prefer the system Chrome, fall back to bundled Chromium.
  const browser = await chromium
    .launch({ channel: "chrome", headless: config.headless })
    .catch(() => chromium.launch({ headless: config.headless }));
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    ...(existsSync(config.sessionStoragePath) ? { storageState: config.sessionStoragePath } : {}),
  });
  const session: Session = { supabase, config, context, decisionConfig: resolvedDecisionConfig, runId };
  const close = async () => {
    await context.close().catch(() => {});
    await browser.close();
  };
  return { session, close };
}

/** Queued reviews re-checked against condition bands. Never throws. */
export async function runReconcile(
  supabase: SupabaseClient,
  decisionConfig: DecisionConfig,
  opts: { dryRun: boolean; runId: string },
): Promise<string | null> {
  try {
    const r = await reconcileConditionBands(supabase, decisionConfig, opts);
    console.log(`🔁 Reconciled ${r.checked} queued reviews, ${opts.dryRun ? "would approve" : "approved"} ${r.approved}`);
    return null;
  } catch (err) {
    return `Reconciliation failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function fetchReferrals(s: Session): Promise<{ discovered: number; newCaseIds: string[] }> {
  const page = await s.context.newPage();
  try {
    const result = await scrapeCorehub(page, s.context, s.config, s.runId);
    if (!result.success) {
      const error = result.error ?? "CoreHub scrape failed";
      await s.supabase.from("audit_events").insert({
        event_type: "browser_worker_corehub_error",
        actor_type: "automation",
        severity: "error",
        payload: { error, runId: s.runId },
      });
      throw new Error(error);
    }
    if (!result.referrals.length) return { discovered: 0, newCaseIds: [] };

    // ON CONFLICT DO NOTHING: only genuinely new referrals come back.
    const { data, error } = await s.supabase
      .from("referral_cases")
      .upsert(result.referrals.map((r) => newCaseRow(r, s.runId, s.config.dryRun)), {
        onConflict: "external_case_id",
        ignoreDuplicates: true,
      })
      .select("id,correlation_id");
    if (error) throw new Error(`Failed to store referrals: ${error.message}`);

    const rows = data ?? [];
    if (rows.length) {
      await s.supabase.from("audit_events").insert(
        rows.map((r) => ({
          case_id: r.id,
          event_type: "referral_received",
          actor_type: "automation",
          severity: "info",
          payload: { source: "corehub-browser", runId: s.runId },
          correlation_id: r.correlation_id,
        })),
      );
    }
    console.log(`📊 CoreHub: ${result.referrals.length} referrals, ${rows.length} new`);
    return { discovered: result.referrals.length, newCaseIds: rows.map((r) => r.id as string) };
  } finally {
    await page.close();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function evaluateOne(s: Session, page: Page, c: any) {
  const dryRun = s.config.dryRun;
  await s.supabase
    .from("referral_cases")
    .update({ referral_status: "processing", workflow_status: "lookup_pending", last_error_message: null })
    .eq("id", c.id);

  const obv: ObvBrowserResult =
    c.make_raw && c.model_raw && c.variant_raw
      ? await lookupObvBrowser(page, { make: c.make_raw, model: c.model_raw, variant: c.variant_raw }, s.config, s.runId)
      : {
          success: false,
          idv: null,
          sourceUrl: null,
          reasonCode: "NO_RESULTS",
          latencyMs: 0,
          evidence: [],
          raw: { reason: "Missing make/model/variant from CoreHub" },
        };

  const requestedIdv = c.requested_idv == null ? null : Number(c.requested_idv);
  const decision = evaluateIdvDecision(decisionInputFor(requestedIdv, obv), s.decisionConfig);
  const now = new Date().toISOString();

  // Upserts on case_id so a re-evaluation replaces the previous evidence.
  const { data: resolution } = await s.supabase
    .from("vehicle_resolutions")
    .upsert(
      {
        case_id: c.id,
        normalized_make: c.make_raw?.toUpperCase() ?? null,
        normalized_model: c.model_raw?.toUpperCase() ?? null,
        normalized_variant: c.variant_raw?.toUpperCase() ?? null,
        normalized_fuel: c.fuel_type_raw?.toUpperCase() ?? null,
        normalized_cc: c.cc_raw ? Number(c.cc_raw) : null,
        candidate_source: "corehub-browser",
        resolved_vehicle_key: [c.make_raw, c.model_raw, c.variant_raw].filter(Boolean).join("-").toUpperCase().replace(/\s+/g, ""),
        resolved_make: c.make_raw,
        resolved_model: c.model_raw,
        resolved_variant: c.variant_raw,
        confidence_score: BROWSER_VEHICLE_CONFIDENCE,
        match_strategy: "browser_extraction",
        match_reason_codes: ["COREHUB_BROWSER_EXTRACT"],
      },
      { onConflict: "case_id" },
    )
    .select("id")
    .single();

  const { data: idvCheck } = await s.supabase
    .from("idv_checks")
    .upsert(
      {
        case_id: c.id,
        vehicle_resolution_id: resolution?.id ?? null,
        provider: "obv-browser",
        provider_status: providerStatusFor(obv),
        fetched_idv: obv.idv,
        fetched_currency: "INR",
        fetched_at: now,
        lookup_latency_ms: obv.latencyMs,
        raw_request: { make: c.make_raw, model: c.model_raw, variant: c.variant_raw, source_url: s.config.obvSearchUrl ?? null },
        raw_response: { idv: obv.idv, sourceUrl: obv.sourceUrl, reasonCode: obv.reasonCode, conditions: obv.conditions ?? null },
      },
      { onConflict: "case_id" },
    )
    .select("id")
    .single();

  await s.supabase.from("approval_decisions").upsert(
    {
      case_id: c.id,
      idv_check_id: idvCheck?.id ?? null,
      decision: decision.decision,
      decision_reason_code: decision.reasonCode,
      decision_reason_details: { explanation: decision.explanation, matchedCondition: decision.matchedCondition ?? null, dry_run: dryRun },
      requested_idv: requestedIdv,
      fetched_idv: obv.idv,
      absolute_delta: decision.absoluteDelta,
      percentage_delta: decision.percentageDelta,
      tolerance_mode: "absolute_or_percentage",
      tolerance_value: s.decisionConfig.absoluteTolerance,
      decided_by: null,
      decided_at: now,
    },
    { onConflict: "case_id" },
  );

  const { data: openReview } = await s.supabase
    .from("manual_reviews")
    .select("id")
    .eq("case_id", c.id)
    .neq("review_status", "completed")
    .limit(1)
    .maybeSingle();

  if (decision.decision === "manual_review" && !openReview) {
    await s.supabase.from("manual_reviews").insert({
      case_id: c.id,
      review_status: "queued",
      priority: 3,
      review_reason: decision.explanation,
      sla_due_at: new Date(Date.now() + s.decisionConfig.reviewSlaMinutes * 60_000).toISOString(),
    });
  }
  if (decision.decision === "auto_approved" && openReview) {
    await s.supabase
      .from("manual_reviews")
      .update({
        review_status: "completed",
        reviewer_decision: "auto_approved",
        reviewer_notes: "Superseded by automated re-evaluation",
        reviewed_at: now,
      })
      .eq("id", openReview.id);
  }

  const { error } = await s.supabase
    .from("referral_cases")
    .update({
      ...caseStatusesFor(decision.decision),
      processed_at: now,
      metadata: { ...(c.metadata ?? {}), dry_run: dryRun, obv_source_url: obv.sourceUrl, obv_reason_code: obv.reasonCode },
    })
    .eq("id", c.id);
  if (error) throw new Error(`Failed to update case: ${error.message}`);

  await s.supabase.from("audit_events").insert({
    case_id: c.id,
    event_type: dryRun ? "browser_worker_dry_run" : "browser_worker_processed",
    actor_type: "automation",
    severity: "info",
    payload: {
      decision: decision.decision,
      reasonCode: decision.reasonCode,
      matchedCondition: decision.matchedCondition ?? null,
      requestedIdv,
      fetchedIdv: obv.idv,
      obvSourceUrl: obv.sourceUrl,
      dryRun,
      runId: s.runId,
    },
    correlation_id: c.correlation_id,
  });
  console.log(`   ${c.external_case_id}: ${decision.decision} — ${decision.reasonCode}`);
}

export async function evaluateCases(
  s: Session,
  caseIds: string[],
  onProgress?: (done: number, total: number) => Promise<void>,
) {
  const counts = { casesProcessed: 0, casesErrored: 0, errors: [] as string[] };
  if (!caseIds.length) return counts;
  const { data: cases, error } = await s.supabase.from("referral_cases").select("*").in("id", caseIds);
  if (error) throw new Error(`Failed to load cases: ${error.message}`);

  const { data: decisions, error: decisionsError } = await s.supabase
    .from("approval_decisions")
    .select("case_id,decided_by")
    .in("case_id", caseIds);
  if (decisionsError) throw new Error(`Failed to load decisions: ${decisionsError.message}`);
  const decisionByCaseId = new Map((decisions ?? []).map((d) => [d.case_id as string, { decided_by: d.decided_by as string | null }]));

  const rows = cases ?? [];
  const page = await s.context.newPage();
  try {
    for (const [i, c] of rows.entries()) {
      if (hasHumanDecision(decisionByCaseId.get(c.id) ?? null)) {
        await s.supabase.from("audit_events").insert({
          case_id: c.id,
          event_type: "browser_worker_case_skipped",
          actor_type: "automation",
          severity: "info",
          payload: { reason: "human_decision", runId: s.runId },
          correlation_id: c.correlation_id,
        });
        await onProgress?.(i + 1, rows.length);
        continue;
      }
      try {
        await evaluateOne(s, page, c);
        counts.casesProcessed++;
      } catch (err) {
        counts.casesErrored++;
        const message = err instanceof Error ? err.message : String(err);
        counts.errors.push(`Error evaluating ${c.external_case_id}: ${message}`);
        await s.supabase
          .from("referral_cases")
          .update({ referral_status: "failed", workflow_status: "failed_retrying", last_error_message: message })
          .eq("id", c.id);
        await s.supabase.from("audit_events").insert({
          case_id: c.id,
          event_type: "browser_worker_case_error",
          actor_type: "automation",
          severity: "error",
          payload: { error: message, runId: s.runId },
          correlation_id: c.correlation_id,
        });
      }
      await onProgress?.(i + 1, rows.length);
    }
  } finally {
    await page.close();
  }
  return counts;
}
