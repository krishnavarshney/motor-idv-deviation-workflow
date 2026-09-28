import type { SupabaseClient } from "@supabase/supabase-js";
import { planCorehubAction, type LatestAction } from "@/lib/corehub-actions";
import { vehicleName } from "@/lib/format";
import type { ReadyRow } from "@/components/corehub-ready";

const BAND_LABEL: Record<string, string> = { good: "Good band", very_good: "Very Good band", excellent: "Excellent band" };

/** CoreHub referrals decided in the console whose decision hasn't been carried out in CoreHub yet. */
export async function loadCorehubReady(supabase: SupabaseClient): Promise<ReadyRow[]> {
  const { data: cases } = await supabase
    .from("referral_cases")
    .select("id,external_case_id,source_system,referral_status,make_raw,model_raw,variant_raw,fuel_type_raw,requested_idv,metadata")
    .eq("source_system", "corehub-browser")
    .in("referral_status", ["approved", "rejected"])
    .order("processed_at", { ascending: false })
    .limit(100);
  const rows = cases ?? [];
  if (!rows.length) return [];
  const ids = rows.map((c) => c.id as string);

  const [{ data: actions }, { data: decisions }, { data: reviews }] = await Promise.all([
    supabase.from("corehub_actions").select("case_id,status,action,error,created_at").in("case_id", ids).order("created_at", { ascending: false }),
    supabase.from("approval_decisions").select("case_id,decision_reason_code,decision_reason_details,fetched_idv,decided_by").in("case_id", ids),
    supabase
      .from("manual_reviews")
      .select("case_id,reviewer_notes,reviewed_at")
      .in("case_id", ids)
      .eq("reviewer_decision", "rejected")
      .order("reviewed_at", { ascending: false }),
  ]);
  const latest = new Map<string, LatestAction & { error: string | null }>();
  for (const a of actions ?? []) if (!latest.has(a.case_id)) latest.set(a.case_id, a);
  const notes = new Map<string, string | null>();
  for (const r of reviews ?? []) if (!notes.has(r.case_id)) notes.set(r.case_id, r.reviewer_notes);
  const decisionBy = new Map((decisions ?? []).map((d) => [d.case_id as string, d]));

  return rows.flatMap((c): ReadyRow[] => {
    const last = latest.get(c.id) ?? null;
    const plan = planCorehubAction(c, last, notes.get(c.id) ?? null);
    if (!("action" in plan)) return [];
    const d = decisionBy.get(c.id);
    const matched = d?.decision_reason_details?.matchedCondition as string | undefined;
    return [
      {
        id: c.id,
        proposalId: c.external_case_id,
        vehicle: vehicleName(c.make_raw, c.model_raw, c.variant_raw, c.fuel_type_raw, c.metadata?.yom ? String(c.metadata.yom) : null),
        requestedIdv: c.requested_idv == null ? null : Number(c.requested_idv),
        obvIdv: d?.fetched_idv == null ? null : Number(d.fetched_idv),
        band: matched ? (BAND_LABEL[matched] ?? matched) : null,
        reasonCode: d?.decision_reason_code ?? null,
        decidedBy: d?.decided_by ? "Underwriter" : "Automation",
        action: plan.action,
        reason: plan.reason,
        checks: c.metadata?.corehub?.checks ?? [],
        lastAttempt: last ? { status: last.status, error: last.error } : null,
      },
    ];
  });
}
