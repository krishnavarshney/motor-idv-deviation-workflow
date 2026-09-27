import Link from "next/link";
import { ArrowUpRight, Bot, CheckCircle2, Clock3, ShieldCheck, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CaseTable } from "@/components/case-table";
import { DetailList, KpiCard, PageHeader } from "@/components/console";
import { IntakeChart, type IntakeDay } from "@/components/intake-chart";
import { dateTime, humanize, startOfDayIst } from "@/lib/format";
import { getWorkerStatus } from "@/lib/worker-status";
import { cn } from "@/lib/utils";

export const metadata = { title: "Overview" };

export default async function Dashboard() {
  const supabase = await createClient();
  const since = new Date(Date.now() - 13 * 86_400_000);
  since.setHours(0, 0, 0, 0);
  const [{ count: total }, { count: approved }, { count: reviews }, { count: failed }, { data: cases }, { data: events }, { data: recent }] =
    await Promise.all([
      supabase.from("referral_cases").select("*", { count: "exact", head: true }),
      supabase.from("referral_cases").select("*", { count: "exact", head: true }).eq("referral_status", "approved"),
      supabase.from("manual_reviews").select("*", { count: "exact", head: true }).neq("review_status", "completed"),
      supabase.from("referral_cases").select("*", { count: "exact", head: true }).eq("referral_status", "failed"),
      supabase.from("referral_cases").select("*").order("received_at", { ascending: false }).limit(10),
      supabase.from("audit_events").select("*").order("created_at", { ascending: false }).limit(8),
      supabase.from("referral_cases").select("received_at,referral_status").gte("received_at", since.toISOString()).limit(5000),
    ]);

  const today = startOfDayIst(new Date()).toISOString();
  const soon = new Date(Date.now() + 3_600_000).toISOString();
  const [worker, { data: nextSchedule }, { data: todayCases }, { data: slaRisk }, { data: failedJobs }] = await Promise.all([
    getWorkerStatus(supabase),
    supabase.from("automation_schedules").select("name,next_run_at").eq("enabled", true).order("next_run_at").limit(1).maybeSingle(),
    supabase.from("referral_cases").select("referral_status").gte("received_at", today).limit(5000),
    supabase
      .from("manual_reviews")
      .select("id,sla_due_at,referral_cases(external_case_id)")
      .neq("review_status", "completed")
      .lt("sla_due_at", soon)
      .order("sla_due_at")
      .limit(5),
    supabase
      .from("automation_jobs")
      .select("id,type,error,finished_at")
      .eq("status", "failed")
      .gte("created_at", new Date(Date.now() - 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  const funnel = { fetched: todayCases?.length ?? 0, approved: 0, manual: 0, failed: 0 };
  for (const c of todayCases ?? []) {
    if (c.referral_status === "approved") funnel.approved++;
    else if (c.referral_status === "manual_review") funnel.manual++;
    else if (c.referral_status === "failed") funnel.failed++;
  }

  const days: IntakeDay[] = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(since.getTime() + i * 86_400_000);
    return { day: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), approved: 0, manual_review: 0, failed: 0, other: 0 };
  });
  for (const r of recent ?? []) {
    const bucket = days[Math.floor((new Date(r.received_at).getTime() - since.getTime()) / 86_400_000)];
    if (!bucket) continue;
    const s = r.referral_status;
    if (s === "approved") bucket.approved++;
    else if (s === "manual_review") bucket.manual_review++;
    else if (s === "failed" || s === "rejected") bucket.failed++;
    else bucket.other++;
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="IDV decision control center"
        description="Referral intake, vehicle resolution, valuation evidence and exception handling in one workspace."
        actions={
          <Button asChild variant="outline">
            <Link href="/automation">
              View runs <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
        }
      />

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard icon={ShieldCheck} label="Cases processed" value={total ?? 0} foot="All persisted cases" />
        <KpiCard icon={CheckCircle2} label="Approved" value={approved ?? 0} foot="Final case status" />
        <KpiCard icon={TriangleAlert} label="Manual review" value={reviews ?? 0} foot="Awaiting underwriter" />
        <KpiCard icon={Clock3} label="Failed / retry" value={failed ?? 0} foot="Provider or workflow failures" />
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Intake by outcome</CardTitle>
              <CardDescription>Referrals received in the last 14 days, by current status</CardDescription>
            </CardHeader>
            <CardContent>
              <IntakeChart data={days} />
            </CardContent>
          </Card>

          <Card className="pb-0">
            <CardHeader>
              <CardTitle>Referral queue</CardTitle>
              <CardDescription>Latest cases and their current workflow state</CardDescription>
              <CardAction>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/referrals">Open full queue</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CaseTable rows={cases ?? []} />
          </Card>
        </div>

        <div className="flex flex-col gap-4 self-start">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="size-4 text-muted-foreground" />
                Automation
              </CardTitle>
              <CardAction>
                <Button variant="link" size="sm" asChild className="px-0">
                  <Link href="/automation">Runs</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  ["Worker", worker.online ? "Online" : "Offline"],
                  ["Next scheduled run", nextSchedule ? `${dateTime(nextSchedule.next_run_at)} · ${nextSchedule.name}` : "No schedule enabled"],
                  ["Received today", funnel.fetched],
                  ["Auto-approved today", funnel.approved],
                  ["Manual review today", funnel.manual],
                  ["Failed today", funnel.failed],
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Needs attention</CardTitle>
              <CardDescription>Reviews due within an hour and jobs that failed in the last day</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-3 text-sm">
                {(slaRisk ?? []).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3">
                    <Link href={`/reviews/${r.id}`} className="font-mono hover:underline">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {(r.referral_cases as any)?.external_case_id ?? "Review"}
                    </Link>
                    <span className={cn("text-xs", new Date(r.sla_due_at).getTime() < Date.now() ? "text-destructive" : "text-warning")}>
                      SLA {dateTime(r.sla_due_at)}
                    </span>
                  </li>
                ))}
                {(failedJobs ?? []).map((j) => (
                  <li key={j.id} className="flex items-center justify-between gap-3">
                    <Link href={`/automation/jobs/${j.id}`} className="capitalize hover:underline">
                      {j.type} job failed
                    </Link>
                    <span className="truncate text-xs text-muted-foreground" title={j.error ?? undefined}>
                      {dateTime(j.finished_at)}
                    </span>
                  </li>
                ))}
                {!slaRisk?.length && !failedJobs?.length && <li className="text-muted-foreground">Nothing needs attention.</li>}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent audit activity</CardTitle>
              <CardAction>
                <Button variant="link" size="sm" asChild className="px-0">
                  <Link href="/audit">View all</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <ol className="relative flex flex-col gap-4 border-l pl-4">
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
                      {dateTime(e.created_at)} · {e.severity}
                    </div>
                  </li>
                ))}
                {!events?.length && <li className="text-sm text-muted-foreground">No audit activity yet.</li>}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
