import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertCircle, CheckCircle2, ChevronLeft, CloudDownload, Inbox, ListChecks, Sparkles, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList, KpiCard, PageHeader } from "@/components/console";
import { DecisionBadge } from "@/components/status";
import { CaseTable } from "@/components/case-table";
import { FetchRunBar } from "@/components/fetch-run-bar";
import { LiveRefresh } from "@/components/live-refresh";
import { StepTimeline, type JobStep } from "@/components/step-timeline";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Job detail" };

function fmt(start: string | null, end: string | null) {
  if (!start || !end) return "—";
  const s = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default async function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("automation_jobs")
    .select("*, automation_schedules(name), automation_runs(*)")
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();

  const caseIds: string[] = job.progress?.case_ids ?? job.params?.case_ids ?? [];
  const { data: cases } = caseIds.length
    ? await supabase.from("referral_cases").select("*").in("id", caseIds).order("received_at", { ascending: false })
    : { data: [] };
  const run = job.automation_runs;
  const active = job.status === "queued" || job.status === "running";
  const steps: JobStep[] = job.progress?.steps ?? [];
  const title = `${job.type}${job.params?.then_evaluate ? " + evaluate" : ""}`;

  const summary = (
    <span>
      <span className="capitalize">{title}</span> {job.status === "failed" ? "failed" : job.status === "cancelled" ? "was cancelled" : "finished"} in{" "}
      <span className="font-mono tabular-nums">{fmt(job.started_at, job.finished_at)}</span>
      {run && (
        <>
          {" "}· {run.cases_discovered} discovered · {run.cases_new} new
        </>
      )}
    </span>
  );

  return (
    <>
      {active && <LiveRefresh tables={["automation_jobs", "referral_cases"]} />}
      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" asChild className="w-fit">
          <Link href="/automation">
            <ChevronLeft data-icon="inline-start" />
            Runs
          </Link>
        </Button>
        <PageHeader
          eyebrow="Automation job"
          title={<span className="capitalize">{title}</span>}
          description={`${job.automation_schedules?.name ?? (job.schedule_id ? "Deleted schedule" : "Started manually")} · queued ${dateTime(job.created_at)}`}
          actions={<DecisionBadge status={job.status} className="h-7 px-3 text-sm" />}
        />
      </div>

      <FetchRunBar active={active ? job : null} last={active ? null : job} disabledReason={false} summary={active ? undefined : summary} showJobLink={false} keepOutcome />

      {job.error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Job reported errors</AlertTitle>
          <AlertDescription className="break-words">{job.error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard label="Discovered in CoreHub" value={run?.cases_discovered ?? 0} icon={CloudDownload} />
        <KpiCard label="New referrals" value={run?.cases_new ?? 0} icon={Sparkles} />
        <KpiCard label="Evaluated" value={run?.cases_processed ?? 0} icon={CheckCircle2} />
        <KpiCard label="Errored" value={run?.cases_errored ?? 0} icon={AlertCircle} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ListChecks className="size-4 text-muted-foreground" />
              Steps
            </CardTitle>
            <CardDescription>Each checkpoint the worker reported, with time spent in it</CardDescription>
          </CardHeader>
          <CardContent>
            <StepTimeline steps={steps} status={job.status} finishedAt={job.finished_at} />
          </CardContent>
        </Card>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Execution</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                ["Mode", job.params?.dry_run ? "Dry run" : "Live"],
                ["Completion", job.params?.completion_mode === "in_app" ? "In app" : "CoreHub write-back"],
                ["Worker", <span key="w" className="font-mono text-xs normal-case">{job.worker_id ?? "—"}</span>],
                ["Started", dateTime(job.started_at)],
                ["Finished", dateTime(job.finished_at)],
                ["Duration", fmt(job.started_at, job.finished_at)],
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="pb-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="size-4 text-muted-foreground" />
            {caseIds.length} case{caseIds.length === 1 ? "" : "s"}
          </CardTitle>
          <CardDescription>Referrals this job fetched or evaluated</CardDescription>
        </CardHeader>
        <CaseTable rows={cases ?? []} newIds={job.type === "fetch" ? caseIds : []} emptyText="This job touched no cases." />
      </Card>
    </>
  );
}
