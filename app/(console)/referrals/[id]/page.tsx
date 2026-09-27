import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DecisionBadge } from "@/components/status";
import { DetailList, PageHeader } from "@/components/console";
import { DecisionEvidence, VehicleCard } from "@/components/decision-evidence";
import { dateTime, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Case detail" };

export default async function CaseDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: caseRow }, { data: resolution }, { data: idv }, { data: decision }, { data: review }, { data: events }] =
    await Promise.all([
      supabase.from("referral_cases").select("*").eq("id", id).maybeSingle(),
      supabase.from("vehicle_resolutions").select("*").eq("case_id", id).maybeSingle(),
      supabase.from("idv_checks").select("*").eq("case_id", id).maybeSingle(),
      supabase.from("approval_decisions").select("*").eq("case_id", id).maybeSingle(),
      supabase.from("manual_reviews").select("*").eq("case_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("audit_events").select("*").eq("case_id", id).order("created_at", { ascending: false }),
    ]);

  if (!caseRow) notFound();

  // WARNING: pre-existing behaviour, preserved as-is during the UI rewrite. Rendering this page (including
  // <Link> prefetch) writes an approval to the database. This should move to the worker/decision pipeline.
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
    <>
      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" asChild className="w-fit">
          <Link href="/referrals">
            <ChevronLeft data-icon="inline-start" />
            Referral queue
          </Link>
        </Button>
        <PageHeader
          title={<span className="font-mono">{caseRow.external_case_id}</span>}
          description={`${caseRow.source_system} · received ${dateTime(caseRow.received_at)}`}
          actions={
            <>
              {review && review.review_status !== "completed" && (
                <Button variant="outline" asChild>
                  <Link href={"/reviews/" + review.id}>Open review</Link>
                </Button>
              )}
              <DecisionBadge status={caseRow.referral_status} className="h-7 px-3 text-sm" />
            </>
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <DecisionEvidence decision={decision} idv={idv} requestedIdv={caseRow.requested_idv} />
          <VehicleCard resolution={resolution} fallback={caseRow} />
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Case details</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  ["Registration", <span key="r" className="font-mono uppercase">{caseRow.registration_number || "—"}</span>],
                  ["Make", caseRow.make_raw || "—"],
                  ["Model", caseRow.model_raw || "—"],
                  ["Variant", caseRow.variant_raw || "—"],
                  ["Fuel", caseRow.fuel_type_raw || "—"],
                  ["Workflow", humanize(caseRow.workflow_status)],
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="size-4 text-muted-foreground" />
                Audit timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-4 border-l pl-4">
                {(events ?? []).map((e) => (
                  <li key={e.id} className="relative">
                    <span
                      className={cn(
                        "absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-4 ring-card",
                        e.severity === "error" ? "bg-destructive" : e.severity === "warning" ? "bg-warning" : "bg-primary",
                      )}
                    />
                    <div className="text-sm font-medium capitalize">{humanize(e.event_type)}</div>
                    <div className="text-xs text-muted-foreground">
                      {dateTime(e.created_at)} · {e.actor_type} · {e.severity}
                    </div>
                  </li>
                ))}
                {!events?.length && <li className="text-sm text-muted-foreground">No events recorded.</li>}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
