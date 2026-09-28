import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { planCorehubAction, type ActionPlan, type LatestAction } from "@/lib/corehub-actions";
import { loadAutomationSettings } from "@/lib/automation-settings";

export type EnqueueResult =
  | { ok: true; jobId: string; queued: { case_id: string; action: string }[]; blocked: { case_id: string; blocked: string }[]; dryRun: boolean }
  | { ok: false; error: string; status: number; blocked: { case_id: string; blocked: string }[] };

/**
 * Queue CoreHub actions for cases a person has confirmed (a review decision, or the ready panel).
 * The action and rejection reason come from each case's stored console decision (planCorehubAction);
 * the worker re-checks the live referral before it clicks anything.
 */
export async function enqueueCorehubActions(supabase: SupabaseClient, userId: string, caseIds: string[]): Promise<EnqueueResult> {
  const [{ data: cases, error }, { data: actions }, { data: reviews }] = await Promise.all([
    supabase.from("referral_cases").select("id,source_system,referral_status,correlation_id").in("id", caseIds),
    supabase.from("corehub_actions").select("case_id,status,action,created_at").in("case_id", caseIds).order("created_at", { ascending: false }),
    supabase
      .from("manual_reviews")
      .select("case_id,reviewer_notes,reviewed_at")
      .in("case_id", caseIds)
      .eq("reviewer_decision", "rejected")
      .order("reviewed_at", { ascending: false }),
  ]);
  if (error) return { ok: false, error: error.message, status: 400, blocked: [] };

  const latest = new Map<string, LatestAction>();
  for (const a of actions ?? []) if (!latest.has(a.case_id)) latest.set(a.case_id, a);
  const notes = new Map<string, string | null>();
  for (const r of reviews ?? []) if (!notes.has(r.case_id)) notes.set(r.case_id, r.reviewer_notes);

  const plans: ActionPlan[] = (cases ?? []).map((c) => planCorehubAction(c, latest.get(c.id) ?? null, notes.get(c.id) ?? null));
  const ready = plans.filter((p): p is Extract<ActionPlan, { action: string }> => "action" in p);
  const blocked = [
    ...plans.filter((p): p is Extract<ActionPlan, { blocked: string }> => "blocked" in p),
    ...caseIds.filter((id) => !(cases ?? []).some((c) => c.id === id)).map((id) => ({ case_id: id, blocked: "Case not found" })),
  ];
  if (!ready.length) return { ok: false, error: blocked[0]?.blocked ?? "Nothing to send to CoreHub", status: 409, blocked };

  let admin: SupabaseClient;
  try {
    admin = createAdminClient();
  } catch {
    return { ok: false, error: "Automation is not configured", status: 500, blocked };
  }
  // Settings → CoreHub write-back mode (rehearse / live); an env kill switch can force rehearsals.
  const { dryRun } = await loadAutomationSettings(supabase);
  const { data: inserted, error: insertError } = await admin
    .from("corehub_actions")
    .insert(ready.map((p) => ({ case_id: p.case_id, action: p.action, reason: p.reason, dry_run: dryRun, requested_by: userId })))
    .select("id,case_id,action");
  // The unique indexes reject a second in-flight or already-submitted action for a case.
  if (insertError) return { ok: false, error: insertError.message, status: 409, blocked };

  const rows = inserted ?? [];
  const actionIds = rows.map((a) => a.id as string);
  const { data: job, error: jobError } = await admin
    .from("automation_jobs")
    .insert({ type: "corehub_action", params: { dry_run: dryRun, completion_mode: "corehub_writeback", action_ids: actionIds }, requested_by: userId })
    .select("id")
    .single();
  if (jobError) {
    await admin.from("corehub_actions").delete().in("id", actionIds);
    return { ok: false, error: jobError.message, status: 400, blocked };
  }
  await admin.from("corehub_actions").update({ job_id: job.id }).in("id", actionIds);

  const correlation = new Map((cases ?? []).map((c) => [c.id, c.correlation_id]));
  await supabase.from("audit_events").insert(
    rows.map((a) => ({
      case_id: a.case_id,
      event_type: "corehub_action_requested",
      actor_type: "user",
      actor_id: userId,
      severity: "info",
      payload: { actionId: a.id, action: a.action, jobId: job.id, dryRun },
      correlation_id: correlation.get(a.case_id) ?? null,
    })),
  );
  return { ok: true, jobId: job.id as string, queued: rows.map((a) => ({ case_id: a.case_id, action: a.action })), blocked, dryRun };
}
