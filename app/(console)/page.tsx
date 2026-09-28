import Link from "next/link";
import { ArrowRight, BellRing, CheckCircle2, ChevronRight, Clock, Inbox, Sparkles, TriangleAlert, UserCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/api-auth";
import { can } from "@/lib/authz";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NumberTicker } from "@/components/ui/number-ticker";
import { CaseTable } from "@/components/case-table";
import { PageHeader } from "@/components/console";
import { AutoRateTrend, DecisionDonut, type MixSlice, type RateDay } from "@/components/overview-charts";
import { dateTime, humanize } from "@/lib/format";
import { getWorkerStatus } from "@/lib/worker-status";
import { cn } from "@/lib/utils";

export const metadata = { title: "Overview" };

const DAYS = 14;

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
function ago(iso: string | null | undefined) {
  if (!iso) return "never";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
function until(iso: string) {
  const m = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (m <= 0) return { text: `${-m < 60 ? `${-m}m` : `${Math.round(-m / 60)}h`} overdue`, late: true };
  return { text: `due in ${m < 60 ? `${m}m` : `${Math.round(m / 60)}h`}`, late: false };
}

export default async function Overview() {
  const supabase = await createClient();
  const { role, fullName, user } = (await getSessionProfile(supabase))!;
  const since = new Date(Date.now() - (DAYS - 1) * 86_400_000);
  since.setHours(0, 0, 0, 0);
  const soon = new Date(Date.now() + 3_600_000).toISOString();

  const [worker, { data: windowCases }, { data: latest }, { data: events }, { data: slaRisk }, { data: failedJobs }, { data: lastFetch }, { count: waiting }] =
    await Promise.all([
      getWorkerStatus(supabase),
      supabase.from("referral_cases").select("received_at,referral_status,workflow_status").gte("received_at", since.toISOString()).limit(5000),
      supabase.from("referral_cases").select("*").order("received_at", { ascending: false }).limit(6),
      supabase.from("audit_events").select("id,event_type,severity,created_at").order("created_at", { ascending: false }).limit(8),
      supabase
        .from("manual_reviews")
        .select("id,sla_due_at,review_reason,referral_cases(external_case_id,make_raw,model_raw)")
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
        .limit(3),
      supabase.from("automation_jobs").select("finished_at").eq("type", "fetch").eq("status", "succeeded").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("referral_cases").select("id", { count: "exact", head: true }).eq("referral_status", "received"),
    ]);

  // Classify each case by how it was (or will be) decided.
  const kind = (c: { referral_status: string; workflow_status: string }) =>
    c.workflow_status === "auto_approved"
      ? "auto"
      : c.referral_status === "manual_review"
        ? "review"
        : c.referral_status === "approved" || c.referral_status === "rejected"
          ? "underwriter"
          : c.referral_status === "failed"
            ? "failed"
            : "inflight";
  const cases = windowCases ?? [];
  const n = { auto: 0, review: 0, underwriter: 0, failed: 0, inflight: 0 };
  const days = Array.from({ length: DAYS }, (_, i) => ({
    day: new Date(since.getTime() + i * 86_400_000).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    auto: 0,
    decided: 0,
  }));
  for (const c of cases) {
    const k = kind(c);
    n[k]++;
    const d = days[Math.floor((new Date(c.received_at).getTime() - since.getTime()) / 86_400_000)];
    if (!d || k === "inflight") continue;
    d.decided++;
    if (k === "auto") d.auto++;
  }
  const trend: RateDay[] = days.map((d) => ({ day: d.day, cases: d.decided, rate: d.decided ? Math.round((d.auto / d.decided) * 100) : null }));
  const mix: MixSlice[] = [
    { key: "auto", value: n.auto },
    { key: "underwriter", value: n.underwriter },
    { key: "review", value: n.review },
    { key: "failed", value: n.failed },
  ];
  const received = cases.length;
  const evaluated = received - n.inflight;
  const reviewed = n.review + n.underwriter;

  const canReview = can(role, "review");
  const attention = (slaRisk?.length ?? 0) + (failedJobs?.length ?? 0) + (waiting ? 1 : 0);
  const name = fullName?.split(" ")[0] ?? user.email?.split("@")[0] ?? "there";

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title={`${greeting()}, ${name}`}
        description={`Underwriting outcomes over the last ${DAYS} days and what needs a person today.`}
        actions={
          <Link
            href="/automation"
            className="group flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-muted"
          >
            <span className="relative flex size-2">
              {worker.online && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />}
              <span className={cn("relative inline-flex size-2 rounded-full", worker.online ? "bg-success" : "bg-destructive")} />
            </span>
            Worker {worker.online ? "online" : "offline"}
            <span className="text-muted-foreground">· last fetch {ago(lastFetch?.finished_at)}</span>
            <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
        }
      />

      {/* Case flow: how referrals moved through automation and review in the window. */}
      <Card>
        <CardHeader>
          <CardTitle>Case flow</CardTitle>
          <CardDescription>Referrals received in the last {DAYS} days, by where they ended up</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="grid gap-3 md:grid-cols-4">
            <FlowStage icon={Inbox} label="Received" value={received} of={received} hint={`${n.inflight} still in flight`} />
            <FlowStage icon={CheckCircle2} label="Evaluated" value={evaluated} of={received} hint="valuation + rules run" />
            <FlowStage icon={Sparkles} label="Straight-through" value={n.auto} of={evaluated} hint="auto-approved, no underwriter" tone="success" />
            <FlowStage icon={UserCheck} label="Needed a person" value={reviewed} of={evaluated} hint={`${n.underwriter} decided · ${n.review} waiting`} tone="warning" last />
          </ol>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_380px]">
        <Card>
          <CardHeader>
            <CardTitle>Decision mix</CardTitle>
            <CardDescription>How cases in the window were decided</CardDescription>
          </CardHeader>
          <CardContent>
            <DecisionDonut data={mix} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Auto-approval rate</CardTitle>
            <CardDescription>Share of evaluated cases per day that needed no underwriter</CardDescription>
          </CardHeader>
          <CardContent>
            <AutoRateTrend data={trend} />
          </CardContent>
        </Card>

        <Card className={cn("xl:row-span-2", attention > 0 && "ring-warning/40")}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BellRing className={cn("size-4", attention ? "text-warning" : "text-muted-foreground")} />
              Needs attention
            </CardTitle>
            <CardDescription>{attention ? `${attention} item${attention === 1 ? "" : "s"} for today` : "You're all caught up"}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {(slaRisk ?? []).map((r) => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const c = r.referral_cases as any;
                const due = until(r.sla_due_at);
                const body = (
                  <>
                    <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", due.late ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning")}>
                      <Clock className="size-4" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-mono text-sm font-medium">{c?.external_case_id ?? "Review"}</span>
                      <span className="truncate text-xs text-muted-foreground">{[c?.make_raw, c?.model_raw].filter(Boolean).join(" ") || r.review_reason}</span>
                    </span>
                    <Badge variant={due.late ? "destructive" : "warning"} className="shrink-0">
                      {due.text}
                    </Badge>
                  </>
                );
                return (
                  <li key={r.id}>
                    {canReview ? (
                      <Link href={`/reviews/${r.id}`} className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted">
                        {body}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-3 p-2">{body}</div>
                    )}
                  </li>
                );
              })}
              {(failedJobs ?? []).map((j) => (
                <li key={j.id}>
                  <Link href={`/automation/jobs/${j.id}`} className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                      <TriangleAlert className="size-4" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-medium capitalize">{j.type} job failed</span>
                      <span className="truncate text-xs text-muted-foreground" title={j.error ?? undefined}>
                        {j.error ?? dateTime(j.finished_at)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
              {!!waiting && (
                <li>
                  <Link href="/referrals?status=received" className="flex items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-info/10 text-info">
                      <Inbox className="size-4" />
                    </span>
                    <span className="flex-1 text-sm">
                      <span className="font-mono font-medium tabular-nums">{waiting}</span> referral{waiting === 1 ? "" : "s"} waiting for evaluation
                    </span>
                    <ArrowRight className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              )}
              {!attention && (
                <li className="flex items-center gap-3 p-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-4 text-success" />
                  No overdue reviews, failed jobs or unevaluated referrals.
                </li>
              )}
            </ul>
          </CardContent>
        </Card>

        <Card className="pb-0 xl:col-span-2">
          <CardHeader>
            <CardTitle>Latest referrals</CardTitle>
            <CardDescription>Newest cases and where they are now</CardDescription>
            <CardAction>
              <Button variant="outline" size="sm" asChild>
                <Link href="/referrals">Open queue</Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CaseTable rows={latest ?? []} />
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
          {can(role, "audit") && (
            <CardAction>
              <Button variant="link" size="sm" asChild className="px-0">
                <Link href="/audit">Audit log</Link>
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          <ol className="grid gap-x-8 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
            {(events ?? []).map((e) => (
              <li key={e.id} className="flex items-start gap-2.5">
                <span
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    e.severity === "error" ? "bg-destructive" : e.severity === "warning" ? "bg-warning" : "bg-foreground/40",
                  )}
                />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm capitalize">{humanize(e.event_type)}</span>
                  <span className="text-xs text-muted-foreground">{ago(e.created_at)}</span>
                </span>
              </li>
            ))}
            {!events?.length && <li className="text-sm text-muted-foreground">No activity yet.</li>}
          </ol>
        </CardContent>
      </Card>
    </>
  );
}

function FlowStage({
  icon: Icon,
  label,
  value,
  of,
  hint,
  tone,
  last,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  of: number;
  hint: string;
  tone?: "success" | "warning";
  last?: boolean;
}) {
  const pct = of ? Math.round((value / of) * 100) : 0;
  return (
    <li className="relative flex flex-col gap-3 rounded-xl border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className={cn("size-4", tone === "success" && "text-success", tone === "warning" && "text-warning")} />
          {label}
        </span>
        {label !== "Received" && <span className="font-mono text-xs text-muted-foreground tabular-nums">{pct}%</span>}
      </div>
      <span className="text-3xl font-semibold tracking-tight tabular-nums">{value ? <NumberTicker value={value} /> : 0}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("h-full rounded-full transition-[width] duration-700", tone === "success" ? "bg-success" : tone === "warning" ? "bg-warning" : "bg-foreground/50")}
          style={{ width: `${label === "Received" ? 100 : pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground">{hint}</span>
      {!last && (
        <ChevronRight
          aria-hidden
          className="absolute top-1/2 -right-3 z-10 hidden size-5 -translate-y-1/2 rounded-full border bg-card p-0.5 text-muted-foreground md:block"
        />
      )}
    </li>
  );
}
