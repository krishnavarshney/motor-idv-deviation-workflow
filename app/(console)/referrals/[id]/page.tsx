import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, History } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DecisionBadge } from "@/components/status";
import { DetailList, PageHeader } from "@/components/console";
import { DecisionEvidence, VehicleCard } from "@/components/decision-evidence";
import { SectionLoaded, SectionProgress } from "@/components/section-progress";
import { EvidenceSkeleton, TimelineSkeleton, VehicleSkeleton } from "@/components/skeletons";
import { dateTime, humanize } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Case detail" };

export default async function CaseDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // Header data + existence check up front so a missing id still 404s; the rest streams.
  const [{ data: caseRow }, { data: review }] = await Promise.all([
    supabase.from("referral_cases").select("*").eq("id", id).maybeSingle(),
    supabase.from("manual_reviews").select("*").eq("case_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (!caseRow) notFound();

  return (
    <SectionProgress total={3}>
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
          <Suspense fallback={<EvidenceSkeleton />}>
            <Evidence id={id} requestedIdv={caseRow.requested_idv} />
          </Suspense>
          <Suspense fallback={<VehicleSkeleton />}>
            <Vehicle id={id} fallback={caseRow} />
          </Suspense>
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
          <Suspense fallback={<TimelineSkeleton />}>
            <Timeline id={id} />
          </Suspense>
        </div>
      </div>
    </SectionProgress>
  );
}

async function Evidence({ id, requestedIdv }: { id: string; requestedIdv: unknown }) {
  const supabase = await createClient();
  const [{ data: idv }, { data: decision }] = await Promise.all([
    supabase.from("idv_checks").select("*").eq("case_id", id).maybeSingle(),
    supabase.from("approval_decisions").select("*").eq("case_id", id).maybeSingle(),
  ]);
  return (
    <>
      <SectionLoaded />
      <DecisionEvidence decision={decision} idv={idv} requestedIdv={requestedIdv} />
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function Vehicle({ id, fallback }: { id: string; fallback: any }) {
  const supabase = await createClient();
  const { data: resolution } = await supabase.from("vehicle_resolutions").select("*").eq("case_id", id).maybeSingle();
  return (
    <>
      <SectionLoaded />
      <VehicleCard resolution={resolution} fallback={fallback} />
    </>
  );
}

async function Timeline({ id }: { id: string }) {
  const supabase = await createClient();
  const { data: events } = await supabase.from("audit_events").select("*").eq("case_id", id).order("created_at", { ascending: false });
  return (
    <Card>
      <SectionLoaded />
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
  );
}
