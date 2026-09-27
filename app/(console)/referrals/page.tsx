import Link from "next/link";
import { Bot, Search, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { CaseTable } from "@/components/case-table";
import { PageHeader } from "@/components/console";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EvaluateButton, FetchButton } from "@/components/job-buttons";
import { JobProgress } from "@/components/job-progress";
import { LiveRefresh } from "@/components/live-refresh";
import { getSessionProfile } from "@/lib/api-auth";
import { can } from "@/lib/authz";
import { getWorkerStatus } from "@/lib/worker-status";

export const metadata = { title: "Referral queue" };

const STATUSES = ["received", "processing", "approved", "manual_review", "rejected", "failed"] as const;
const LABELS: Partial<Record<(typeof STATUSES)[number], string>> = { processing: "Evaluating", approved: "Auto-approved" };

export default async function Referrals({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const p = await searchParams;
  const status = STATUSES.find((s) => s === p.status);
  // Strip PostgREST filter syntax so user input can't alter the .or() expression.
  const q = (p.q ?? "").replace(/[,()%*\\]/g, " ").trim();

  const supabase = await createClient();
  let query = supabase.from("referral_cases").select("*").order("received_at", { ascending: false }).limit(100);
  if (status) query = query.eq("referral_status", status);
  if (q) query = query.or(["external_case_id", "registration_number", "make_raw", "model_raw"].map((c) => `${c}.ilike.%${q}%`).join(","));
  const [{ data }, worker, profile, { data: activeJobs }, { data: lastFetchJobs }] = await Promise.all([
    query,
    getWorkerStatus(supabase),
    getSessionProfile(supabase),
    supabase.from("automation_jobs").select("id,type,status,progress").in("status", ["queued", "running"]).order("created_at"),
    supabase
      .from("automation_jobs")
      .select("id,status,error")
      .eq("type", "fetch")
      .in("status", ["succeeded", "failed"])
      .order("finished_at", { ascending: false })
      .limit(1),
  ]);
  const rows = data ?? [];
  const jobs = activeJobs ?? [];
  const lastFetchJob = (lastFetchJobs ?? [])[0] ?? null;
  const canRun = can(profile?.role, "run_jobs");
  const offline = worker.online ? null : "Worker offline";
  const fetchReason = offline ?? (jobs.some((j) => j.type === "fetch") ? "Fetch already in progress" : null);
  const selectable = canRun && (status === "received" || status === "failed");

  const href = (s?: string) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (s) sp.set("status", s);
    const qs = sp.toString();
    return "/referrals" + (qs ? "?" + qs : "");
  };

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Referral queue"
        description="Every case is traceable from intake through valuation and decision."
        actions={canRun ? <FetchButton disabledReason={fetchReason} /> : undefined}
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <form className="w-full lg:max-w-md">
          {status && <input type="hidden" name="status" value={status} />}
          <InputGroup>
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput name="q" defaultValue={q} placeholder="Case, registration, make or model" aria-label="Search referrals" />
          </InputGroup>
        </form>
        <nav aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {[undefined, ...STATUSES].map((s) => (
            <Button key={s ?? "all"} size="sm" variant={s === status ? "secondary" : "ghost"} asChild className="capitalize">
              <Link href={href(s)} aria-current={s === status ? "page" : undefined}>
                {s ? (LABELS[s] ?? s.replaceAll("_", " ")) : "All"}
              </Link>
            </Button>
          ))}
        </nav>
      </div>

      <LiveRefresh tables={["referral_cases", "automation_jobs"]} />
      {lastFetchJob?.status === "failed" && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Last CoreHub fetch failed</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <span>{lastFetchJob.error || "Unknown error"}</span>
            <Link href={`/automation/jobs/${lastFetchJob.id}`} className="w-fit text-sm underline underline-offset-4">
              View job
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {jobs.length > 0 && (
        <Alert>
          <Bot />
          <AlertTitle>
            {jobs.length === 1 ? "Automation job in progress" : `${jobs.length} automation jobs in progress`}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <JobProgress progress={jobs[0].progress} status={jobs[0].status} />
            <Link href="/automation" className="w-fit text-sm underline underline-offset-4">
              View runs
            </Link>
          </AlertDescription>
        </Alert>
      )}
      <Card className="pb-0">
        <CardHeader>
          <CardTitle>{rows.length} cases</CardTitle>
          <CardDescription>{rows.length === 100 ? "Showing newest 100 — refine the search to narrow" : "Newest first"}</CardDescription>
          {((canRun && status === "received" && rows.length > 0) || q || status) && (
            <CardAction className="flex gap-2">
              {canRun && status === "received" && rows.length > 0 && (
                <EvaluateButton caseIds={[]} all label="Evaluate all received" variant="outline" disabledReason={offline} />
              )}
              {(q || status) && (
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/referrals">Clear filters</Link>
                </Button>
              )}
            </CardAction>
          )}
        </CardHeader>
        <CaseTable rows={rows} emptyText="No cases match these filters." selectable={selectable} disabledReason={offline} />
      </Card>
    </>
  );
}
