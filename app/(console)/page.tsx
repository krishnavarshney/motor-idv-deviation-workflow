import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Clock3, ShieldCheck, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CaseTable } from "@/components/case-table";
import { KpiCard, PageHeader } from "@/components/console";
import { IntakeChart, type IntakeDay } from "@/components/intake-chart";
import { dateTime, humanize } from "@/lib/format";
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
          <Button asChild>
            <Link href="/simulate">
              Run controlled test <ArrowUpRight data-icon="inline-end" />
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
    </>
  );
}
