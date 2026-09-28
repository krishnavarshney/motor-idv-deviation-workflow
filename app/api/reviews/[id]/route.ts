import { NextResponse } from "next/server";
import { requireAction } from "@/lib/api-auth";
import { enqueueCorehubActions } from "@/lib/corehub-enqueue";
import { loadAutomationSettings } from "@/lib/automation-settings";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireAction("review");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const body = await request.json();
  const decision = body.decision;
  if (!["auto_approved", "rejected"].includes(decision)) {
    return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
  }

  const notes = String(body.notes ?? "").trim();
  if (notes.length < 3) {
    return NextResponse.json({ error: "Reviewer notes are required (min 3 chars)" }, { status: 400 });
  }

  const { data: review } = await supabase
    .from("manual_reviews")
    .select("id,case_id,review_status")
    .eq("id", id)
    .maybeSingle();

  if (!review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  if (review.review_status === "completed") {
    return NextResponse.json({ error: "Review already completed" }, { status: 409 });
  }

  const now = new Date().toISOString();
  const { data: caseRow } = await supabase
    .from("referral_cases")
    .select("requested_idv,correlation_id,source_system")
    .eq("id", review.case_id)
    .maybeSingle();

  const { data: idv } = await supabase
    .from("idv_checks")
    .select("id,fetched_idv")
    .eq("case_id", review.case_id)
    .maybeSingle();

  const { error: reviewError } = await supabase
    .from("manual_reviews")
    .update({
      review_status: "completed",
      reviewer_decision: decision,
      reviewer_notes: notes,
      reviewed_at: now,
      assigned_to: user.id,
    })
    .eq("id", id);

  if (reviewError) {
    return NextResponse.json({ error: reviewError.message }, { status: 400 });
  }

  // Update or insert approval_decisions
  const { data: existingDecision } = await supabase
    .from("approval_decisions")
    .select("id")
    .eq("case_id", review.case_id)
    .maybeSingle();

  if (existingDecision) {
    const { error: updateDecisionErr } = await supabase
      .from("approval_decisions")
      .update({
        decision,
        decision_reason_code: "MANUAL_UNDERWRITER_DECISION",
        decision_reason_details: { notes, source: "manual_review" },
        decided_by: user.id,
        decided_at: now,
      })
      .eq("id", existingDecision.id);

    if (updateDecisionErr) {
      return NextResponse.json({ error: updateDecisionErr.message }, { status: 400 });
    }
  } else {
    const { error: decisionError } = await supabase
      .from("approval_decisions")
      .insert({
        case_id: review.case_id,
        idv_check_id: idv?.id,
        decision,
        decision_reason_code: "MANUAL_UNDERWRITER_DECISION",
        decision_reason_details: { notes, source: "manual_review" },
        requested_idv: caseRow?.requested_idv ?? null,
        fetched_idv: idv?.fetched_idv ?? null,
        decided_by: user.id,
        decided_at: now,
      });

    if (decisionError) {
      return NextResponse.json({ error: decisionError.message }, { status: 400 });
    }
  }

  const { error: caseError } = await supabase
    .from("referral_cases")
    .update({
      referral_status: decision === "auto_approved" ? "approved" : "rejected",
      workflow_status: "completed",
      processed_at: now,
    })
    .eq("id", review.case_id);

  if (caseError) {
    return NextResponse.json({ error: caseError.message }, { status: 400 });
  }

  await supabase.from("audit_events").insert({
    case_id: review.case_id,
    event_type: "manual_review_completed",
    actor_type: "user",
    actor_id: user.id,
    severity: "info",
    payload: { decision, notes },
    correlation_id: caseRow?.correlation_id,
  });

  // The underwriter's confirmed decision is carried out in CoreHub straight away (the worker re-checks
  // the live referral first). Queued even if the worker is offline — it runs when the worker is back.
  let corehub: { queued: boolean; action?: string; dryRun?: boolean; error?: string } | null = null;
  if (caseRow?.source_system === "corehub-browser" && (await loadAutomationSettings(supabase)).autoSendReviews) {
    const r = await enqueueCorehubActions(supabase, user.id, [review.case_id]);
    corehub = r.ok ? { queued: true, action: r.queued[0]?.action, dryRun: r.dryRun } : { queued: false, error: r.error };
  }

  return NextResponse.json({ ok: true, corehub });
}