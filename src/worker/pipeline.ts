/**
 * Reusable worker pipeline steps shared by the CLI (run.ts) and the daemon.
 * fetchReferrals: CoreHub → referral_cases (status received)
 * evaluateCases:  referral_cases → OBV → decision engine → decisions/reviews
 * executeCorehubActions: person-confirmed Approve/Reject → re-check live referral → CoreHub button
 */

import { chromium, type BrowserContext } from "playwright";
import { existsSync } from "fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "./config";
import { openReferral, performCorehubAction, scrapeCorehub, type ActionLogLine, type CorehubReferral } from "./corehub-scraper";
import { actionChecks, blocking, type Check } from "./corehub-checks";
import { lookupObv, type ObvBrowserResult } from "./obv-lookup";
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

export type StepReporter = (label: string, done?: number, total?: number) => void | Promise<void>;

export async function fetchReferrals(s: Session, onStep?: StepReporter): Promise<{ discovered: number; newCaseIds: string[] }> {
  const step = async (label: string, done?: number, total?: number) => {
    try {
      await onStep?.(label, done, total);
    } catch {}
  };
  const page = await s.context.newPage();
  try {
    const result = await scrapeCorehub(page, s.context, s.config, s.runId, (label) => step(label));
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

    // Vehicle + requested IDV live on the quote the review page loads; open only referrals we don't have yet,
    // plus ones stored earlier without vehicle data (their review page couldn't be read) and still undecided.
    const { data: known, error: knownError } = await s.supabase
      .from("referral_cases")
      .select("id,external_case_id,make_raw,referral_status,metadata")
      .in("external_case_id", result.referrals.map((r) => r.externalCaseId));
    if (knownError) throw new Error(`Failed to check existing referrals: ${knownError.message}`);
    const knownIds = new Set((known ?? []).map((k) => k.external_case_id as string));
    const incomplete = new Map(
      (known ?? [])
        .filter((k) => !k.make_raw && ["received", "failed", "manual_review"].includes(k.referral_status))
        .map((k) => [k.external_case_id as string, k]),
    );
    const refreshedIds: string[] = [];
    for (const listed of result.referrals.filter((r) => incomplete.has(r.externalCaseId))) {
      const k = incomplete.get(listed.externalCaseId)!;
      await step(`Re-reading ${listed.externalCaseId} (stored without vehicle details)`);
      try {
        const o = await openReferral(page, s.config, listed);
        const row = newCaseRow(o, s.runId, s.config.dryRun);
        const { error: updateError } = await s.supabase
          .from("referral_cases")
          .update({
            registration_number: row.registration_number,
            make_raw: row.make_raw,
            model_raw: row.model_raw,
            variant_raw: row.variant_raw,
            fuel_type_raw: row.fuel_type_raw,
            requested_idv: row.requested_idv,
            referral_status: "received",
            workflow_status: "intake_pending",
            last_error_message: null,
            metadata: { ...(k.metadata ?? {}), ...row.metadata },
          })
          .eq("id", k.id);
        if (updateError) throw new Error(updateError.message);
        refreshedIds.push(k.id as string);
      } catch (err) {
        console.error(`   Could not re-read ${listed.externalCaseId}: ${err instanceof Error ? err.message : err}`);
      }
    }
    const opened: CorehubReferral[] = [];
    const fresh = result.referrals.filter((r) => !knownIds.has(r.externalCaseId));
    for (const [i, listed] of fresh.entries()) {
      await step(`Opening referral ${i + 1} of ${fresh.length} · ${listed.externalCaseId}`, i, fresh.length);
      try {
        opened.push(await openReferral(page, s.config, listed));
      } catch (err) {
        // Stored with listing data only; evaluation routes it to manual review as missing data.
        console.error(`   Could not open ${listed.externalCaseId}: ${err instanceof Error ? err.message : err}`);
        opened.push(listed);
      }
    }
    if (!opened.length) return { discovered: result.referrals.length, newCaseIds: refreshedIds };

    await step(`Saving ${opened.length} new referral${opened.length === 1 ? "" : "s"}`, fresh.length, fresh.length);
    // ON CONFLICT DO NOTHING: a referral stored meanwhile by another run is skipped.
    const { data, error } = await s.supabase
      .from("referral_cases")
      .upsert(opened.map((r) => newCaseRow(r, s.runId, s.config.dryRun)), {
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
    return { discovered: result.referrals.length, newCaseIds: [...refreshedIds, ...rows.map((r) => r.id as string)] };
  } finally {
    await page.close();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function evaluateOne(s: Session, c: any) {
  const dryRun = s.config.dryRun;
  await s.supabase
    .from("referral_cases")
    .update({ referral_status: "processing", workflow_status: "lookup_pending", last_error_message: null })
    .eq("id", c.id);

  const obv: ObvBrowserResult =
    c.make_raw && c.model_raw && c.variant_raw
      ? await lookupObv({
          make: c.make_raw,
          model: c.model_raw,
          variant: c.variant_raw,
          year: c.metadata?.yom ?? undefined,
          fuel: c.fuel_type_raw,
        })
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
  const obvRaw = obv.raw as { resolved?: { make: string; model: string; variant: string; year: string }; unmatched?: string } | undefined;
  const resolved = obvRaw?.resolved ?? null;
  const unmatched = obvRaw?.unmatched ?? null;
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
        // Resolved = the exact OBV catalogue entry that was valued; null when OBV had no confident match.
        resolved_vehicle_key: resolved
          ? ["OBV", resolved.make, resolved.model, resolved.variant, resolved.year].join("-").toUpperCase().replace(/\s+/g, "")
          : null,
        resolved_make: resolved?.make ?? null,
        resolved_model: resolved?.model ?? null,
        resolved_variant: resolved ? `${resolved.variant} (${resolved.year})` : null,
        confidence_score: resolved ? BROWSER_VEHICLE_CONFIDENCE : null,
        match_strategy: resolved ? "obv_catalog_match" : unmatched ? `no_obv_${unmatched}_match` : "not_looked_up",
        match_reason_codes: [
          "COREHUB_QUOTE_API",
          ...(resolved ? ["OBV_CATALOG_MATCH"] : unmatched ? [`OBV_${unmatched.toUpperCase()}_UNMATCHED`] : []),
        ],
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
        provider: "obv-http",
        provider_status: providerStatusFor(obv),
        fetched_idv: obv.idv,
        fetched_currency: "INR",
        fetched_at: now,
        lookup_latency_ms: obv.latencyMs,
        raw_request: {
          make: c.make_raw,
          model: c.model_raw,
          variant: c.variant_raw,
          source_url: s.config.obvSearchUrl ?? null,
          // Exact OBV names the raw CoreHub values resolved to (absent when a field had no match).
          resolved: (obv.raw as { resolved?: unknown } | undefined)?.resolved ?? null,
        },
        raw_response: {
          idv: obv.idv,
          sourceUrl: obv.sourceUrl,
          reasonCode: obv.reasonCode,
          conditions: obv.conditions ?? null,
          log: (obv.raw as { log?: unknown } | undefined)?.log ?? [],
        },
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
      await evaluateOne(s, c);
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
  return counts;
}

/** Just enough of a stored case to reopen it in CoreHub. */
function referralFromCase(c: { external_case_id: string; metadata?: { quote_id?: string | null } | null }): CorehubReferral {
  return {
    externalCaseId: c.external_case_id,
    registrationNumber: null,
    quoteId: c.metadata?.quote_id ?? null,
    make: null,
    model: null,
    variant: null,
    fuelType: null,
    cc: null,
    requestedIdv: null,
    yom: null,
    rawValues: {},
    vehicleDetails: null,
    quoteStatus: null,
    idvRange: null,
    review: null,
  };
}

/** Tell the person who confirmed the action how it went (notification center; service role). */
async function notifyRequester(
  s: Session,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  a: any,
  kind: "success" | "info" | "error",
  title: string,
  description: string,
) {
  if (!a.requested_by) return;
  await s.supabase
    .from("notifications")
    .insert({ user_id: a.requested_by, kind, title: title.slice(0, 200), description: description.slice(0, 1000), href: `/referrals/${a.case_id}?tab=corehub` })
    .then(
      () => {},
      () => {},
    );
}

// The console decision each CoreHub action must still agree with when the worker gets to it.
const REQUIRED_STATUS = { approve: "approved", reject: "rejected" } as const;

/**
 * Run queued CoreHub actions one by one. Each attempt: confirm our own decision still matches →
 * open the live referral → re-check it against what was evaluated → click the button (or rehearse).
 * Any failed check stops that action before anything is clicked. Every step lands in the action's log.
 */
export async function executeCorehubActions(
  s: Session,
  actionIds: string[],
  onProgress?: (done: number, total: number, label: string) => Promise<void>,
) {
  const counts = { casesProcessed: 0, casesErrored: 0, errors: [] as string[] };
  const { data: actions, error } = await s.supabase
    .from("corehub_actions")
    .select("*, referral_cases(*)")
    .in("id", actionIds)
    .eq("status", "queued")
    .order("created_at");
  if (error) throw new Error(`Failed to load CoreHub actions: ${error.message}`);
  const rows = actions ?? [];
  if (!rows.length) return counts;

  const page = await s.context.newPage();
  try {
    for (const [i, a] of rows.entries()) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = a.referral_cases as any;
      const verb = a.action === "approve" ? "Approving" : "Rejecting";
      await onProgress?.(i, rows.length, `${a.dry_run ? "Rehearsing" : verb} ${c.external_case_id} in CoreHub`);

      const log: ActionLogLine[] = [];
      const add = (msg: string, data?: unknown) => log.push({ at: new Date().toISOString(), msg, data });
      let checks: Check[] = [];
      let write: unknown = null;
      await s.supabase.from("corehub_actions").update({ status: "running", started_at: new Date().toISOString(), job_id: a.job_id }).eq("id", a.id);

      try {
        const required = REQUIRED_STATUS[a.action as "approve" | "reject"];
        if (c.referral_status !== required) {
          throw new Error(`Case is now "${c.referral_status}" in the console, not "${required}" — re-confirm before sending to CoreHub`);
        }
        add(`Console decision is ${c.referral_status}; opening ${c.external_case_id} in CoreHub`);

        const live = await openReferral(page, s.config, referralFromCase(c));
        add("Read live quote and review page", {
          url: live.review?.url ?? page.url(),
          quote_status: live.quoteStatus,
          requested_idv: live.requestedIdv,
          vehicle: [live.make, live.model, live.variant, live.fuelType, live.yom].filter(Boolean).join(" "),
          page_fields: live.review?.fields ?? null,
        });

        checks = actionChecks(c, live);
        const failed = blocking(checks);
        add(failed.length ? `${failed.length} pre-check(s) failed — not clicking anything` : `All ${checks.length} pre-checks passed`, checks);
        if (failed.length) throw new Error(failed.map((k) => `${k.label}: ${k.detail}`).join("; "));

        const result = await performCorehubAction(page, s.config, { action: a.action, reason: a.reason, dryRun: a.dry_run }, add);
        write = result.write;
        const now = new Date().toISOString();
        await s.supabase
          .from("corehub_actions")
          .update({ status: result.outcome === "submitted" ? "succeeded" : "rehearsed", checks, log, corehub_response: write, finished_at: now })
          .eq("id", a.id);

        if (result.outcome === "submitted") {
          await s.supabase
            .from("referral_cases")
            .update({
              workflow_status: "completed",
              metadata: { ...(c.metadata ?? {}), corehub_action: { id: a.id, action: a.action, at: now } },
            })
            .eq("id", c.id);
        }
        const past = a.action === "approve" ? "approved" : "rejected";
        await notifyRequester(
          s,
          a,
          result.outcome === "submitted" ? "success" : "info",
          result.outcome === "submitted" ? `${c.external_case_id} ${past} in CoreHub` : `${c.external_case_id}: CoreHub rehearsal done`,
          result.outcome === "submitted"
            ? `CoreHub accepted the ${a.action} (HTTP ${result.write?.status}). The agent has been notified by CoreHub.`
            : `All ${checks.length} live checks passed and the "Yes, ${a.action === "approve" ? "Approve" : "Reject"}" dialog opened — cancelled because this is a dry run.`,
        );
        await s.supabase.from("audit_events").insert({
          case_id: c.id,
          event_type: result.outcome === "submitted" ? `corehub_${a.action}_submitted` : "corehub_action_rehearsed",
          actor_type: "automation",
          severity: "info",
          payload: { actionId: a.id, action: a.action, dryRun: a.dry_run, requestedBy: a.requested_by, corehubStatus: result.write?.status ?? null, runId: s.runId },
          correlation_id: c.correlation_id,
        });
        counts.casesProcessed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        add(`Stopped: ${message}`);
        write = (err as { write?: unknown }).write ?? write;
        counts.casesErrored++;
        counts.errors.push(`${c.external_case_id}: ${message}`);
        await s.supabase
          .from("corehub_actions")
          .update({ status: "failed", checks, log, corehub_response: write, error: message, finished_at: new Date().toISOString() })
          .eq("id", a.id);
        await notifyRequester(s, a, "error", `${c.external_case_id}: not ${a.action === "approve" ? "approved" : "rejected"} in CoreHub`, message);
        await s.supabase.from("audit_events").insert({
          case_id: c.id,
          event_type: "corehub_action_failed",
          actor_type: "automation",
          severity: "error",
          payload: { actionId: a.id, action: a.action, error: message, runId: s.runId },
          correlation_id: c.correlation_id,
        });
      }
      await onProgress?.(i + 1, rows.length, `${a.dry_run ? "Rehearsed" : "Sent"} ${i + 1} of ${rows.length}`);
    }
  } finally {
    await page.close();
  }
  return counts;
}
