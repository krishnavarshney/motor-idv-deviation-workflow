import { Suspense } from "react";
import { AlertTriangle, ClipboardCheck, Database, FileClock, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList, KpiCard, PageHeader } from "@/components/console";
import { SectionLoaded, SectionProgress } from "@/components/section-progress";
import { DetailListSkeleton, KpiRowSkeleton } from "@/components/skeletons";
import { loadDecisionConfig } from "@/src/server/idv-config";

export const metadata = { title: "System health" };

export default function Health() {
  return (
    <SectionProgress total={2}>
      <PageHeader eyebrow="Governance" title="System health" description="Operational telemetry from the application data plane." />
      <Suspense fallback={<KpiRowSkeleton />}>
        <Kpis />
      </Suspense>
      <div className="grid gap-4 lg:grid-cols-2">
        <Suspense fallback={<DetailListSkeleton description />}>
          <Policy />
        </Suspense>
        <Card>
          <CardHeader>
            <CardTitle>Failure policy</CardTitle>
          </CardHeader>
          <CardContent>
            <Alert>
              <ShieldAlert />
              <AlertTitle>Fail closed to manual review</AlertTitle>
              <AlertDescription>
                External valuation uncertainty never auto-approves. Timeouts, provider errors, rate limits, low vehicle confidence and
                ambiguous results route to manual review after bounded retries.
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    </SectionProgress>
  );
}

async function Kpis() {
  const supabase = await createClient();
  const [{ count: cases }, { count: reviews }, { count: events }, { count: failed }] = await Promise.all([
    supabase.from("referral_cases").select("*", { count: "exact", head: true }),
    supabase.from("manual_reviews").select("*", { count: "exact", head: true }).neq("review_status", "completed"),
    supabase.from("audit_events").select("*", { count: "exact", head: true }),
    supabase.from("idv_checks").select("*", { count: "exact", head: true }).in("provider_status", ["failed", "timeout", "rate_limited", "unavailable"]),
  ]);
  return (
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <SectionLoaded />
      <KpiCard icon={Database} label="Referral records" value={cases ?? 0} />
      <KpiCard icon={ClipboardCheck} label="Review backlog" value={reviews ?? 0} />
      <KpiCard icon={FileClock} label="Audit events" value={events ?? 0} />
      <KpiCard icon={AlertTriangle} label="Provider failures" value={failed ?? 0} />
    </section>
  );
}

async function Policy() {
  const config = await loadDecisionConfig(await createClient());
  return (
    <Card>
      <SectionLoaded />
      <CardHeader>
        <CardTitle>Active decision policy</CardTitle>
        <CardDescription>Loaded live from configuration</CardDescription>
      </CardHeader>
      <CardContent>
        <DetailList
          items={[
            ["Absolute IDV tolerance", "₹" + config.absoluteTolerance.toLocaleString("en-IN")],
            ["Percentage tolerance", config.percentageTolerance + "%"],
            ["Minimum vehicle confidence", (config.minimumVehicleConfidence * 100).toFixed(0) + "%"],
            ["Provider timeout", config.providerTimeoutSeconds + "s"],
            ["Transient retries", String(config.retryCount)],
            ["Manual review SLA", config.reviewSlaMinutes / 60 + "h"],
          ]}
        />
      </CardContent>
    </Card>
  );
}
