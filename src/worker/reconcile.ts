/**
 * Condition-band reconciliation.
 *
 * Re-evaluates cases sitting untouched in the manual-review queue against the
 * current decision engine. Cases decided before OBV condition bands were part
 * of the decision (or before the worker passed them in) are auto-approved when
 * the requested IDV falls inside a band. Anything else is left for a human.
 *
 * Only reviews still `queued` are touched: once an underwriter has picked a
 * case up, automation never overrides them.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { evaluateIdvDecision } from "../domain/decision-engine";
import type { DecisionConfig, DecisionResult, ProviderStatus } from "../domain/motor-idv";

const TIER_LABEL = { good: "Good", very_good: "Very Good", excellent: "Excellent" } as const;

export interface ReconcileCandidate {
  requestedIdv: number | null;
  fetchedIdv: number | null;
  vehicleConfidence: number | null;
  providerStatus: ProviderStatus;
  conditions: unknown;
}

/** Pure: returns the band approval for a candidate, or null if it must stay in review. */
export function bandApproval(c: ReconcileCandidate, config: DecisionConfig): DecisionResult | null {
  if (!c.conditions || typeof c.conditions !== "object") return null;
  const result = evaluateIdvDecision(
    {
      requestedIdv: c.requestedIdv,
      fetchedIdv: c.fetchedIdv,
      vehicleConfidence: c.vehicleConfidence,
      providerStatus: c.providerStatus,
      conditions: c.conditions as Parameters<typeof evaluateIdvDecision>[0]["conditions"],
    },
    config,
  );
  return result.decision === "auto_approved" && result.reasonCode === "WITHIN_CONDITION_BAND" ? result : null;
}

export async function reconcileConditionBands(
  supabase: SupabaseClient,
  config: DecisionConfig,
  opts: { dryRun: boolean; runId: string },
): Promise<{ checked: number; approved: number }> {
  const { data: reviews, error } = await supabase
    .from("manual_reviews")
    .select("id, case_id, referral_cases!inner(id, requested_idv, referral_status, correlation_id)")
    .eq("review_status", "queued")
    .eq("referral_cases.referral_status", "manual_review");
  if (error) throw new Error(`Reconcile query failed: ${error.message}`);

  let approved = 0;
  for (const review of reviews ?? []) {
    const caseRow = review.referral_cases as unknown as { id: string; requested_idv: number | null; correlation_id: string };
    const [{ data: idv }, { data: resolution }] = await Promise.all([
      supabase.from("idv_checks").select("fetched_idv, provider_status, raw_response").eq("case_id", caseRow.id).maybeSingle(),
      supabase.from("vehicle_resolutions").select("confidence_score").eq("case_id", caseRow.id).maybeSingle(),
    ]);
    if (!idv) continue;

    const result = bandApproval(
      {
        requestedIdv: caseRow.requested_idv == null ? null : Number(caseRow.requested_idv),
        fetchedIdv: idv.fetched_idv == null ? null : Number(idv.fetched_idv),
        vehicleConfidence: resolution?.confidence_score == null ? null : Number(resolution.confidence_score),
        providerStatus: idv.provider_status as ProviderStatus,
        conditions: (idv.raw_response as { conditions?: unknown } | null)?.conditions,
      },
      config,
    );
    if (!result) continue;

    approved++;
    const tier = TIER_LABEL[result.matchedCondition ?? "very_good"];
    const payload = { matchedCondition: result.matchedCondition, requestedIdv: caseRow.requested_idv, explanation: result.explanation, runId: opts.runId };
    console.log(`   ${opts.dryRun ? "[dry-run] would approve" : "Approving"} ${caseRow.id} — ${tier} band`);

    if (opts.dryRun) {
      await supabase.from("audit_events").insert({
        case_id: caseRow.id,
        event_type: "condition_band_reconcile_dry_run",
        actor_type: "automation",
        severity: "info",
        payload,
        correlation_id: caseRow.correlation_id,
      });
      continue;
    }

    const now = new Date().toISOString();
    await supabase
      .from("referral_cases")
      .update({ referral_status: "approved", workflow_status: "auto_approved", processed_at: now })
      .eq("id", caseRow.id);
    await supabase
      .from("approval_decisions")
      .update({
        decision: "auto_approved",
        decision_reason_code: result.reasonCode,
        decision_reason_details: { explanation: result.explanation, matchedCondition: result.matchedCondition },
        absolute_delta: result.absoluteDelta,
        percentage_delta: result.percentageDelta,
      })
      .eq("case_id", caseRow.id);
    await supabase
      .from("manual_reviews")
      .update({
        review_status: "completed",
        reviewer_decision: "auto_approved",
        reviewer_notes: `Auto-approved by worker reconciliation (${tier} condition band match)`,
        reviewed_at: now,
      })
      .eq("id", review.id);
    await supabase.from("audit_events").insert({
      case_id: caseRow.id,
      event_type: "condition_band_auto_approved",
      actor_type: "automation",
      severity: "info",
      payload,
      correlation_id: caseRow.correlation_id,
    });
  }

  return { checked: reviews?.length ?? 0, approved };
}
