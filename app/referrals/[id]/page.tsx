import Link from "next/link"; import { notFound, redirect } from "next/navigation"; import { createClient } from "@/lib/supabase/server"; import { OperationsShell } from "@/components/operations-shell"; import { DecisionBadge, ConfidenceMeter } from "@/components/status"; import { ConditionSpectrum } from "@/components/condition-spectrum";
export default async function CaseDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { data: caseRow },
    { data: resolution },
    { data: idv },
    { data: decision },
    { data: review },
    { data: events },
  ] = await Promise.all([
    supabase.from("referral_cases").select("*").eq("id", id).maybeSingle(),
    supabase.from("vehicle_resolutions").select("*").eq("case_id", id).maybeSingle(),
    supabase.from("idv_checks").select("*").eq("case_id", id).maybeSingle(),
    supabase.from("approval_decisions").select("*").eq("case_id", id).maybeSingle(),
    supabase.from("manual_reviews").select("*").eq("case_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("audit_events").select("*").eq("case_id", id).order("created_at", { ascending: false }),
  ]);

  if (!caseRow) notFound();

  // If case is in manual review but qualifies for condition band auto-approval, auto-upgrade it!
  const rawConds = (idv?.raw_response as any)?.conditions;
  if (caseRow.referral_status === "manual_review" && rawConds && caseRow.requested_idv) {
    const req = Number(caseRow.requested_idv);
    const matched =
      rawConds.veryGood && req >= rawConds.veryGood.min && req <= rawConds.veryGood.max
        ? "very_good"
        : rawConds.good && req >= rawConds.good.min && req <= rawConds.good.max
        ? "good"
        : rawConds.excellent && req >= rawConds.excellent.min && req <= rawConds.excellent.max
        ? "excellent"
        : null;

    if (matched) {
      const matchedLabel = matched === "very_good" ? "Very Good" : matched === "good" ? "Good" : "Excellent";
      const now = new Date().toISOString();
      await supabase
        .from("referral_cases")
        .update({
          referral_status: "approved",
          workflow_status: "auto_approved",
          processed_at: now,
        })
        .eq("id", id);

      await supabase
        .from("approval_decisions")
        .update({
          decision: "auto_approved",
          decision_reason_code: "WITHIN_CONDITION_BAND",
          decision_reason_details: {
            explanation: `Requested IDV of ₹${req.toLocaleString("en-IN")} lies within the ${matchedLabel} condition valuation band and is auto-approved under condition spectrum policy.`,
            matchedCondition: matched,
          },
        })
        .eq("case_id", id);

      if (review && review.review_status !== "completed") {
        await supabase
          .from("manual_reviews")
          .update({
            review_status: "completed",
            reviewer_decision: "auto_approved",
            reviewer_notes: `Auto-approved via condition spectrum policy (${matchedLabel} tier match)`,
            reviewed_at: now,
          })
          .eq("id", review.id);
      }

      await supabase.from("audit_events").insert({
        case_id: id,
        event_type: "condition_band_auto_approved",
        actor_type: "system",
        severity: "info",
        payload: {
          matchedCondition: matched,
          requestedIdv: req,
          explanation: `Auto-approved via ${matchedLabel} condition tier match`,
        },
        correlation_id: caseRow.correlation_id,
      });

      caseRow.referral_status = "approved";
      caseRow.workflow_status = "auto_approved";
      if (decision) {
        decision.decision = "auto_approved";
        decision.decision_reason_code = "WITHIN_CONDITION_BAND";
        decision.decision_reason_details = {
          explanation: `Requested IDV of ₹${req.toLocaleString("en-IN")} lies within the ${matchedLabel} condition valuation band and is auto-approved under condition spectrum policy.`,
          matchedCondition: matched,
        };
      }
    }
  }

  return (
    <OperationsShell userEmail={user.email ?? ""}>
      <main className="content">
        <div className="page-head">
          <div>
            <Link href="/referrals" className="subtext">
              ← Referral queue
            </Link>
            <h1 className="page-title">{caseRow.external_case_id}</h1>
            <div className="subtext">
              {caseRow.source_system} · {new Date(caseRow.received_at).toLocaleString()}
            </div>
          </div>
          <DecisionBadge status={caseRow.referral_status} />
        </div>
        <div className="layout-2">
          <div className="stack">
            <section className="panel">
              <div className="panel-head">
                <div className="panel-title">Decision evidence</div>
                <span className="subtext">{decision?.decision_reason_code ?? "Pending"}</span>
              </div>
              <div style={{ padding: 16 }}>
                <div className="idv-grid">
                  <Evidence label="Requested IDV" value={money(decision?.requested_idv ?? caseRow.requested_idv)} />
                  <Evidence label="OBV IDV" value={money(decision?.fetched_idv ?? idv?.fetched_idv)} />
                  <Evidence label="Absolute delta" value={money(decision?.absolute_delta)} />
                  <Evidence label="Percentage delta" value={decision?.percentage_delta == null ? "—" : Number(decision.percentage_delta).toFixed(2) + "%"} />
                </div>
                {decision && (
                  <div style={{ marginTop: 16, padding: 12, background: "#f8fafc", borderRadius: 8 }}>
                    <div style={{ fontWeight: 650, fontSize: 13 }}>Why this decision?</div>
                    <div className="subtext" style={{ marginTop: 5 }}>
                      {decision.decision_reason_details?.explanation ?? decision.decision_reason_code}
                    </div>
                  </div>
                )}
                <ConditionSpectrum
                  conditions={(idv?.raw_response as any)?.conditions}
                  requestedIdv={Number(decision?.requested_idv ?? caseRow.requested_idv)}
                  sourceUrl={(idv?.raw_response as any)?.sourceUrl}
                />
              </div>
            </section>
            <section className="panel">
              <div className="panel-head">
                <div className="panel-title">Resolved vehicle</div>
                <span className="subtext">{resolution?.match_strategy ?? "Not resolved"}</span>
              </div>
              <div style={{ padding: 16 }}>
                <div style={{ fontSize: 18, fontWeight: 650 }}>
                  {[resolution?.resolved_make, resolution?.resolved_model, resolution?.resolved_variant].filter(Boolean).join(" ") || "Unresolved"}
                </div>
                <div className="subtext" style={{ marginTop: 5 }}>
                  {resolution?.normalized_fuel || caseRow.fuel_type_raw || "Fuel n/a"} · {resolution?.normalized_cc || caseRow.cc_raw || "CC n/a"} CC
                </div>
                <div style={{ marginTop: 14 }}>
                  <div className="subtext" style={{ marginBottom: 6 }}>Match confidence</div>
                  <ConfidenceMeter score={resolution?.confidence_score ? Number(resolution.confidence_score) : null} />
                </div>
              </div>
            </section>
          </div>
          <aside className="stack">
            <section className="panel">
              <div className="panel-head">
                <div className="panel-title">Case details</div>
              </div>
              <div style={{ padding: 16 }}>
                <Detail label="Registration" value={caseRow.registration_number || "—"} />
                <Detail label="Make" value={caseRow.make_raw || "—"} />
                <Detail label="Model" value={caseRow.model_raw || "—"} />
                <Detail label="Variant" value={caseRow.variant_raw || "—"} />
                <Detail label="Fuel" value={caseRow.fuel_type_raw || "—"} />
                <Detail label="Workflow" value={caseRow.workflow_status.replaceAll("_", " ")} />
              </div>
            </section>
            <section className="panel">
              <div className="panel-head">
                <div className="panel-title">Audit timeline</div>
              </div>
              <div style={{ padding: "4px 16px" }}>
                {(events ?? []).map((e) => (
                  <div key={e.id} style={{ padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{e.event_type.replaceAll("_", " ")}</div>
                    <div className="subtext">{new Date(e.created_at).toLocaleString()} · {e.severity}</div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </main>
    </OperationsShell>
  );
}

function money(v: unknown) { if (v == null || v === "") return "—"; return "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 }) } function Evidence({ label, value }: { label: string; value: string }) { return <div className="evidence"><div className="subtext">{label}</div><div style={{ fontSize: 20, fontWeight: 700, marginTop: 5 }}>{value}</div></div> } function Detail({ label, value }: { label: string; value: string }) { return <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "9px 0", borderBottom: "1px solid #f1f5f9", fontSize: 12 }}><span className="subtext">{label}</span><strong>{value}</strong></div> }