import Link from "next/link";
import { Bot, Inbox, Search, TriangleAlert } from "lucide-react";
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
// "Pending action": CoreHub-fetched cases that still need automation or an underwriter.
const PENDING = ["received", "processing", "manual_review", "failed"] as const;
const COREHUB = "corehub-browser";

export default async function Referrals({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; view?: string }> }) {
  const p = await searchParams;
  const status = STATUSES.find((s) => s === p.status);
  // Strip PostgREST filter syntax so user input can't alter the .or() expression.
  const q = (p.q ?? "").replace(/[,()%*\\]/g, " ").trim();

  // Filters and search look at every case; with neither, the queue opens on pending CoreHub work.
  const mode: "pending" | "all" | "filtered" = status || q ? "filtered" : p.view === "all" ? "all" : "pending";

  const supabase = await createClient();
  const base = () => supabase.from("referral_cases").select("*").order("received_at", { ascending: false }).limit(100);
  let query = base();
  if (mode === "pending") query = query.eq("source_system", COREHUB).in("referral_status", [...PENDING]);
  if (status) query = query.eq("referral_status", status);
  if (q) query = query.or(["external_case_id", "registration_number", "make_raw", "model_raw"].map((c) => `${c}.ilike.%${q}%`).join(","));
  const [{ data }, worker, profile, { data: activeJobs }, { data: lastFetchJobs }, { data: lastRun }] = await Promise.all([
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
    supabase.from("automation_runs").select("id").order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  let rows = data ?? [];
  // Freshly fetched = brought in by the latest worker run; shown first.
  const newIds = mode === "pending" ? rows.filter((r) => lastRun && r.automation_run_id === lastRun.id).map((r) => r.id as string) : [];
  rows = [...rows.filter((r) => newIds.includes(r.id)), ...rows.filter((r) => !newIds.includes(r.id))];
  const fellBack = mode === "pending" && rows.length === 0;
  if (fellBack) rows = (await base()).data ?? [];
  const jobs = activeJobs ?? [];
  const lastFetchJob = (lastFetchJobs ?? [])[0] ?? null;
  const canRun = can(profile?.role, "run_jobs");
  const offline = worker.online ? null : "Worker offline";
  const fetchReason = offline ?? (jobs.some((j) => j.type === "fetch") ? "Fetch already in progress" : null);
  const selectable = canRun && (status === "received" || status === "failed");

  const href = (s?: string, view?: string) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (s) sp.set("status", s);
    if (view) sp.set("view", view);
    const qs = sp.toString();
    return "/referrals" + (qs ? "?" + qs : "");
  };
  const chips = [
    { key: "pending", label: "Pending action", href: "/referrals", active: mode === "pending" },
    { key: "all", label: "All", href: href(undefined, "all"), active: mode === "all" || (mode === "filtered" && !status) },
    ...STATUSES.map((s) => ({ key: s, label: LABELS[s] ?? s.replaceAll("_", " "), href: href(s), active: s === status })),
  ];
  const pendingView = mode === "pending" && !fellBack;

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
          {chips.map((c) => (
            <Button key={c.key} size="sm" variant={c.active ? "secondary" : "ghost"} asChild className="capitalize">
              <Link href={c.href} aria-current={c.active ? "page" : undefined}>
                {c.label}
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
      {fellBack && (
        <Alert>
          <Inbox />
          <AlertTitle>No CoreHub referrals pending action</AlertTitle>
          <AlertDescription>
            Nothing fetched from CoreHub is waiting on automation or review, so all cases are shown below.
            {canRun && " Use Fetch from CoreHub to pull new referrals."}
          </AlertDescription>
        </Alert>
      )}
      <Card className="pb-0">
        <CardHeader>
          <CardTitle>{pendingView ? `${rows.length} pending action${newIds.length ? ` · ${newIds.length} new` : ""}` : `${rows.length} cases`}</CardTitle>
          <CardDescription>
            {pendingView
              ? "CoreHub referrals awaiting evaluation or an underwriter — latest fetch first"
              : rows.length === 100
                ? "Showing newest 100 — refine the search to narrow"
                : "Newest first"}
          </CardDescription>
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
        <CaseTable
          rows={rows}
          newIds={newIds}
          emptyText={mode === "filtered" ? "No cases match these filters." : "No referral cases yet."}
          selectable={selectable}
          disabledReason={offline}
        />
      </Card>
    </>
  );
}
