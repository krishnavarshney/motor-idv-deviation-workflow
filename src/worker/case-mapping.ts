import type { CorehubReferral } from "./corehub-scraper";
import type { ObvBrowserResult } from "./obv-lookup";
import type { DecisionInput, DecisionType, ProviderStatus } from "../domain/motor-idv";

/** Vehicle identity extracted from the CoreHub table rather than matched: moderate confidence. */
export const BROWSER_VEHICLE_CONFIDENCE = 0.9;

/** A human decision (approved/rejected by a person) is final: automation must never overwrite it. */
export function hasHumanDecision(decision: { decided_by: string | null } | null): boolean {
  return decision?.decided_by != null;
}

export function providerStatusFor(obv: Pick<ObvBrowserResult, "success" | "reasonCode">): ProviderStatus {
  if (obv.success) return "succeeded";
  if (obv.reasonCode === "TIMEOUT") return "timeout";
  if (obv.reasonCode === "CAPTCHA_DETECTED") return "unavailable";
  return "failed";
}

export function decisionInputFor(requestedIdv: number | null, obv: ObvBrowserResult): DecisionInput {
  return {
    requestedIdv,
    fetchedIdv: obv.idv,
    vehicleConfidence: BROWSER_VEHICLE_CONFIDENCE,
    providerStatus: providerStatusFor(obv),
    conditions: obv.conditions ?? null,
  };
}

export function caseStatusesFor(decision: DecisionType) {
  return decision === "auto_approved"
    ? ({ referral_status: "approved", workflow_status: "auto_approved" } as const)
    : ({ referral_status: "manual_review", workflow_status: "queued_for_review" } as const);
}

export function newCaseRow(r: CorehubReferral, runId: string, dryRun: boolean) {
  return {
    external_case_id: r.externalCaseId,
    source_system: "corehub-browser",
    idempotency_key: `corehub:${r.externalCaseId}`,
    registration_number: r.registrationNumber ?? null,
    make_raw: r.make,
    model_raw: r.model,
    variant_raw: r.variant,
    fuel_type_raw: r.fuelType,
    cc_raw: r.cc,
    requested_idv: r.requestedIdv,
    referral_status: "received" as const,
    workflow_status: "intake_pending" as const,
    automation_run_id: runId,
    metadata: { dry_run: dryRun, raw_values: r.rawValues },
  };
}
