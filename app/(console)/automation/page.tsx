import Link from "next/link";
import { AlertTriangle, Bot, CheckCircle2, CloudDownload, FlaskConical, Gauge, History, Server } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AnimatedShinyText } from "@/components/ui/animated-shiny-text";
import { EmptyRow, KpiCard, PageHeader } from "@/components/console";
import { DecisionBadge } from "@/components/status";
import { CancelJobButton } from "@/components/job-buttons";
import { FetchRunBar } from "@/components/fetch-run-bar";
import { LiveRefresh } from "@/components/live-refresh";
import { JobDurationChart, type DurationPoint } from "@/components/job-duration-chart";
import { getSessionProfile } from "@/lib/api-auth";
import { can } from "@/lib/authz";
import { getWorkerStatus } from "@/lib/worker-status";
import { dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata = { title: "Automation runs" };

const JOB_COLS = "*, automation_schedules(name), automation_runs(cases_discovered,cases_new,cases_processed,cases_errored,dry_run)";

function ms(start: string | null, end: string | null) {
  return start && end ? Math.max(0, new Date(end).getTime() - new Date(start).getTime()) : null;
}
function fmt(d: number | null) {
  if (d == null) return "—";
  const s = Math.round(d / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
function ago(iso: string | null) {
  if (!iso) return "—";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

export default async function Runs() {
  const supabase = await createClient();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const chartFrom = new Date(Date.now() - 13 * 86_400_000);
  chartFrom.setHours(0, 0, 0, 0);
  const [worker, profile, { data: jobs }, { count: failed24h }, { count: obvFailures24h }, { data: lastOk }, { data: recent }] = await Promise.all([
    getWorkerStatus(supabase),
    getSessionProfile(supabase),
    supabase.from("automation_jobs").select(JOB_COLS).order("created_at", { ascending: false }).limit(50),
    supabase.from("automation_jobs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since),
    supabase.from("idv_checks").select("id", { count: "exact", head: true }).neq("provider_status", "succeeded").gte("fetched_at", since),
    supabase.from("automation_jobs").select("finished_at").eq("status", "succeeded").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("automation_jobs").select("created_at,status").gte("created_at", chartFrom.toISOString()).limit(2000),
  ]);

  const rows = jobs ?? [];
  const active = rows.filter((j) => j.status === "queued" || j.status === "running");
  const activeFetch = active.find((j) => j.type === "fetch") ?? null;
  const lastFetch = rows.find((j) => j.type === "fetch" && ["succeeded", "failed", "cancelled"].includes(j.status)) ?? null;
  const canRun = can(profile?.role, "run_jobs");
  const canTest = can(profile?.role, "test_lookup");

  // Speed and reliability, not volume: one bar per finished job, oldest first.
  const durations: DurationPoint[] = rows
    .filter((j) => j.started_at && j.finished_at)
    .slice(0, 30)
    .reverse()
    .map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status,
      seconds: Math.round((ms(j.started_at, j.finished_at) ?? 0) / 1000),
      label: new Date(j.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
      when: dateTime(j.created_at),
    }));
  const finished = (recent ?? []).filter((j) => j.status === "succeeded" || j.status === "failed");
  const successRate = finished.length ? Math.round((finished.filter((j) => j.status === "succeeded").length / finished.length) * 100) : null;
  const longest = Math.max(1, ...rows.map((j) => ms(j.started_at, j.finished_at) ?? 0));

  return (
    <>
      <LiveRefresh tables={["automation_jobs"]} />
      <PageHeader
        eyebrow="Automation"
        title="Runs"
        description="Every CoreHub fetch and evaluation, whether started here or by a schedule."
        actions={
          canTest && (
            <Button variant="outline" asChild>
              <Link href="/simulate">
                <FlaskConical data-icon="inline-start" />
                Test lookup
              </Link>
            </Button>
          )
        }
      />

      <FetchRunBar active={activeFetch} last={lastFetch} disabledReason={canRun ? (worker.online ? null : "Worker offline") : false} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Worker"
          value={
            <span className="flex items-center gap-2">
              <span className="relative flex size-2.5">
                {worker.online && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />}
                <span className={cn("relative inline-flex size-2.5 rounded-full", worker.online ? "bg-success" : "bg-destructive")} />
              </span>
              {worker.online ? "Online" : "Offline"}
            </span>
          }
          foot={worker.lastSeenAt ? `Heartbeat ${ago(worker.lastSeenAt)} · ${dateTime(worker.lastSeenAt)}` : "No heartbeat received"}
          icon={Server}
        />
        <KpiCard label="Last successful run" value={ago(lastOk?.finished_at ?? null)} foot={lastOk?.finished_at ? dateTime(lastOk.finished_at) : undefined} icon={CheckCircle2} />
        <KpiCard label="Success rate (14d)" value={successRate == null ? "—" : `${successRate}%`} foot={`${finished.length} finished jobs`} icon={Gauge} />
        <KpiCard label="Failures (24h)" value={(failed24h ?? 0) + (obvFailures24h ?? 0)} foot={`${failed24h ?? 0} jobs · ${obvFailures24h ?? 0} OBV lookups`} icon={AlertTriangle} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardHeader>
            <CardTitle>Job durations</CardTitle>
            <CardDescription>Last {durations.length} finished jobs, oldest to newest · click a bar to open it</CardDescription>
          </CardHeader>
          <CardContent>
            <JobDurationChart data={durations} />
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader>
            <CardTitle>In progress</CardTitle>
            <CardDescription>Jobs run one at a time, in queue order</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {active.map((j) => {
              const p = j.progress ?? {};
              const total = p.total ?? 0;
              return (
                <div key={j.id} className="flex flex-col gap-2 rounded-lg border p-3 duration-300 animate-in fade-in slide-in-from-top-1">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/automation/jobs/${j.id}`} className="flex items-center gap-2 font-medium capitalize hover:underline">
                      {j.type === "fetch" ? <CloudDownload className="size-4 text-muted-foreground" /> : <Gauge className="size-4 text-muted-foreground" />}
                      {j.type}
                    </Link>
                    <div className="flex items-center gap-2">
                      <DecisionBadge status={j.status} />
                      {j.status === "queued" && canRun && <CancelJobButton jobId={j.id} />}
                    </div>
                  </div>
                  <div key={p.step ?? 0} className="truncate text-sm duration-200 animate-in fade-in slide-in-from-bottom-1">
                    {j.status === "queued" ? (
                      <span className="text-muted-foreground">Waiting for worker…</span>
                    ) : (
                      <AnimatedShinyText className="mx-0 max-w-none">{p.current_step ?? "Starting"}…</AnimatedShinyText>
                    )}
                  </div>
                  {total > 0 && (
                    <div className="flex items-center gap-2">
                      <Progress value={((p.done ?? 0) / total) * 100} className="h-1.5 flex-1" aria-label="Job progress" />
                      <span className="font-mono text-xs text-muted-foreground tabular-nums">
                        {p.done ?? 0}/{total}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
            {!active.length && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Bot className="size-4" />
                Nothing running. {canRun ? "Start a fetch from the bar above." : ""}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="pb-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="size-4 text-muted-foreground" />
            History
          </CardTitle>
          <CardDescription>Latest 50 jobs</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Job</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Cases</TableHead>
              <TableHead className="hidden md:table-cell">Duration</TableHead>
              <TableHead className="hidden pr-4 lg:table-cell">Queued</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((j) => {
              const run = j.automation_runs;
              const d = ms(j.started_at, j.finished_at);
              const Icon = j.type === "fetch" ? CloudDownload : Gauge;
              return (
                <TableRow key={j.id} className="group">
                  <TableCell className="pl-4">
                    <Link href={`/automation/jobs/${j.id}`} className="flex items-center gap-2.5">
                      <span className="flex size-8 items-center justify-center rounded-md border bg-muted/50 transition-colors group-hover:bg-muted">
                        <Icon className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
                      </span>
                      <span className="flex flex-col">
                        <span className="font-medium capitalize group-hover:underline">
                          {j.type}
                          {j.params?.then_evaluate ? " + evaluate" : ""}
                        </span>
                        <span className="text-xs text-muted-foreground">{j.params?.dry_run ? "Dry run" : "Live"}</span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{j.automation_schedules?.name ?? (j.schedule_id ? "Deleted schedule" : "Manual")}</TableCell>
                  <TableCell>
                    <DecisionBadge status={j.status} />
                  </TableCell>
                  <TableCell>
                    {run ? (
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={run.cases_new ? "info" : "secondary"} className="font-mono tabular-nums">
                          {run.cases_new} new
                        </Badge>
                        <Badge variant="secondary" className="font-mono tabular-nums">
                          {run.cases_processed} done
                        </Badge>
                        {run.cases_errored > 0 && (
                          <Badge variant="destructive" className="font-mono tabular-nums">
                            {run.cases_errored} errored
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn("h-full rounded-full", j.status === "failed" ? "bg-destructive" : "bg-foreground/40")}
                          style={{ width: `${d == null ? 0 : Math.max(4, (d / longest) * 100)}%` }}
                        />
                      </div>
                      <span className="font-mono text-xs tabular-nums">{fmt(d)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="hidden pr-4 text-muted-foreground lg:table-cell" title={dateTime(j.created_at)}>
                    {ago(j.created_at)}
                  </TableCell>
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
