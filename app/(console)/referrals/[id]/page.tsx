import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DecisionBadge } from "@/components/status";
import { DetailList, PageHeader } from "@/components/console";
import { DecisionEvidence, VehicleCard } from "@/components/decision-evidence";
import { EvaluateButton } from "@/components/job-buttons";
import { LiveRefresh } from "@/components/live-refresh";
import { getSessionProfile } from "@/lib/api-auth";
import { can } from "@/lib/authz";
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

  const profile = await getSessionProfile(supabase);
  const canReevaluate = can(profile?.role, "run_jobs") && caseRow.referral_status !== "processing";

  return (
    <>
      <LiveRefresh tables={["referral_cases"]} />
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
              {canReevaluate && <EvaluateButton caseIds={[caseRow.id]} label="Re-evaluate" variant="outline" />}
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
