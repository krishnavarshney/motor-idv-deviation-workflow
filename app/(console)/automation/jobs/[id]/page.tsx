import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList, PageHeader } from "@/components/console";
import { DecisionBadge } from "@/components/status";
import { CaseTable } from "@/components/case-table";
import { JobProgress } from "@/components/job-progress";
import { LiveRefresh } from "@/components/live-refresh";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Job detail" };

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
          title={<span className="capitalize">{job.type}{job.params?.then_evaluate ? " + evaluate" : ""}</span>}
          description={`${job.automation_schedules?.name ?? (job.schedule_id ? "Deleted schedule" : "Started manually")} · queued ${dateTime(job.created_at)}`}
          actions={<DecisionBadge status={job.status} className="h-7 px-3 text-sm" />}
        />
      </div>

      {job.error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Job reported errors</AlertTitle>
          <AlertDescription className="break-words">{job.error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Execution</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {active && <JobProgress progress={job.progress} status={job.status} />}
            <DetailList
              items={[
                ["Mode", job.params?.dry_run ? "Dry run" : "Live"],
                ["Completion", job.params?.completion_mode === "in_app" ? "In app" : "CoreHub write-back"],
                ["Worker", job.worker_id ?? "—"],
                ["Started", dateTime(job.started_at)],
                ["Finished", dateTime(job.finished_at)],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Counts</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                ["Discovered in CoreHub", run?.cases_discovered ?? "—"],
                ["New", run?.cases_new ?? "—"],
                ["Processed", run?.cases_processed ?? "—"],
                ["Errored", run?.cases_errored ?? "—"],
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="pb-0">
        <CardHeader>
          <CardTitle>{caseIds.length} cases</CardTitle>
        </CardHeader>
        <CaseTable rows={cases ?? []} emptyText="This job touched no cases." />
      </Card>
    </>
  );
}
