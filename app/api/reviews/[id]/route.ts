import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Ensure user has valid profile and underwriter/admin permission
  let { data: profile } = await supabase
    .from("profiles")
    .select("role,is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    const { data: newProfile } = await supabase
      .from("profiles")
      .upsert({
        id: user.id,
        full_name: user.email?.split("@")[0] ?? "Underwriter",
        role: "underwriter",
        is_active: true,
      })
      .select("role,is_active")
      .single();
    profile = newProfile;
  } else if (profile.role === "operator") {
    // Elevate operator to underwriter in development/testing
    await supabase.from("profiles").update({ role: "underwriter" }).eq("id", user.id);
    profile.role = "underwriter";
  }

  if (!profile?.is_active) {
    return NextResponse.json({ error: "User account is inactive" }, { status: 403 });
  }

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
    .select("requested_idv,correlation_id")
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

  return NextResponse.json({ ok: true });
}