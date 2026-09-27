import Link from "next/link";
import { AlertTriangle, Bot, CheckCircle2, History, Server } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyRow, KpiCard, PageHeader } from "@/components/console";
import { DecisionBadge } from "@/components/status";
import { CancelJobButton, FetchButton } from "@/components/job-buttons";
import { JobProgress } from "@/components/job-progress";
import { LiveRefresh } from "@/components/live-refresh";
import { getSessionProfile } from "@/lib/api-auth";
import { can } from "@/lib/authz";
import { getWorkerStatus } from "@/lib/worker-status";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Automation runs" };

function duration(start: string | null, end: string | null) {
  if (!start || !end) return "—";
  const s = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default async function Runs() {
  const supabase = await createClient();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [worker, profile, { data: jobs }, { count: failed24h }, { count: obvFailures24h }, { data: lastOk }] = await Promise.all([
    getWorkerStatus(supabase),
    getSessionProfile(supabase),
    supabase
      .from("automation_jobs")
      .select("*, automation_schedules(name), automation_runs(cases_discovered,cases_new,cases_processed,cases_errored,dry_run)")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("automation_jobs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since),
    supabase.from("idv_checks").select("id", { count: "exact", head: true }).neq("provider_status", "succeeded").gte("fetched_at", since),
    supabase.from("automation_jobs").select("finished_at").eq("status", "succeeded").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const rows = jobs ?? [];
  const active = rows.filter((j) => j.status === "queued" || j.status === "running");
  const canRun = can(profile?.role, "run_jobs");
  const fetchReason = !worker.online ? "Worker offline" : active.some((j) => j.type === "fetch") ? "Fetch already in progress" : null;

  return (
    <>
      <LiveRefresh tables={["automation_jobs"]} />
      <PageHeader
        eyebrow="Automation"
        title="Runs"
        description="Every CoreHub fetch and evaluation, whether started here or by a schedule."
        actions={canRun ? <FetchButton disabledReason={fetchReason} /> : undefined}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Worker"
          value={worker.online ? "Online" : "Offline"}
          foot={worker.lastSeenAt ? `Last heartbeat ${dateTime(worker.lastSeenAt)}` : "No heartbeat received"}
          icon={Server}
        />
        <KpiCard label="Last successful run" value={lastOk?.finished_at ? dateTime(lastOk.finished_at) : "—"} icon={CheckCircle2} />
        <KpiCard label="Failed jobs (24h)" value={failed24h ?? 0} icon={AlertTriangle} />
        <KpiCard label="OBV lookup failures (24h)" value={obvFailures24h ?? 0} icon={History} />
      </div>

      {active.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>In progress</CardTitle>
            <CardDescription>Jobs run one at a time in the order they were queued.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {active.map((j) => (
              <div key={j.id} className="flex flex-wrap items-center justify-between gap-4 py-3">
                <div className="flex items-center gap-3">
                  <DecisionBadge status={j.status} />
                  <Link href={`/automation/jobs/${j.id}`} className="font-medium capitalize hover:underline">
                    {j.type}
                  </Link>
                  <span className="text-xs text-muted-foreground">{j.automation_schedules?.name ?? "Manual"}</span>
                </div>
                <JobProgress progress={j.progress} status={j.status} />
                {j.status === "queued" && canRun && <CancelJobButton jobId={j.id} />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="pb-0">
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>Latest 50 jobs</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Job</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">New / processed / errored</TableHead>
              <TableHead className="hidden md:table-cell">Duration</TableHead>
              <TableHead className="hidden pr-4 lg:table-cell">Queued</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((j) => {
              const run = j.automation_runs;
              return (
                <TableRow key={j.id}>
                  <TableCell className="pl-4">
                    <Link href={`/automation/jobs/${j.id}`} className="font-medium capitalize hover:underline">
                      {j.type}
                      {j.params?.then_evaluate ? " + evaluate" : ""}
                    </Link>
                    {j.params?.dry_run && <div className="text-xs text-muted-foreground">Dry run</div>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{j.automation_schedules?.name ?? (j.schedule_id ? "Deleted schedule" : "Manual")}</TableCell>
                  <TableCell>
                    <DecisionBadge status={j.status} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {run ? `${run.cases_new} / ${run.cases_processed} / ${run.cases_errored}` : "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{duration(j.started_at, j.finished_at)}</TableCell>
                  <TableCell className="hidden pr-4 text-muted-foreground lg:table-cell">{dateTime(j.created_at)}</TableCell>
                </TableRow>
              );
            })}
            {!rows.length && <EmptyRow colSpan={6} icon={Bot} title="No runs yet" description="Fetch from CoreHub or enable a schedule to start." />}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
