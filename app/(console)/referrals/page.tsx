import { Suspense } from "react";
import Link from "next/link";
import { FlaskConical, Inbox, Search } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { CaseTable } from "@/components/case-table";
import { PageHeader } from "@/components/console";
import { SectionLoaded, SectionProgress } from "@/components/section-progress";
import { TableSkeleton } from "@/components/skeletons";

export const metadata = { title: "Referral queue" };

const STATUSES = ["received", "processing", "approved", "manual_review", "rejected", "failed"] as const;
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

  const href = (s?: string, view?: string) => {
    const sp = new URLSearchParams();
    if (q && s !== "pending") sp.set("q", q);
    if (s && s !== "pending" && s !== "all") sp.set("status", s);
    if (view) sp.set("view", view);
    const qs = sp.toString();
    return "/referrals" + (qs ? "?" + qs : "");
  };
  const chips = [
    { key: "pending", label: "Pending action", href: "/referrals", active: mode === "pending" },
    { key: "all", label: "All", href: href("all", "all"), active: mode === "all" || (mode === "filtered" && !status) },
    ...STATUSES.map((s) => ({ key: s, label: s.replaceAll("_", " "), href: href(s), active: s === status })),
  ];

  return (
    <SectionProgress total={1}>
      <PageHeader
        eyebrow="Operations"
        title="Referral queue"
        description="Every case is traceable from intake through valuation and decision."
        actions={
          <Button asChild>
            <Link href="/simulate">
              <FlaskConical data-icon="inline-start" />
              Run controlled test
            </Link>
          </Button>
        }
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

      {/* key: remount on filter change so the skeleton shows instead of stale rows */}
      <Suspense key={`${mode}|${status}|${q}`} fallback={<TableSkeleton cols={["w-28", "w-40", "w-20", "w-24"]} />}>
        <Results mode={mode} status={status} q={q} />
      </Suspense>
    </SectionProgress>
  );
}

async function Results({ mode, status, q }: { mode: "pending" | "all" | "filtered"; status?: (typeof STATUSES)[number]; q: string }) {
  const supabase = await createClient();
  const base = () => supabase.from("referral_cases").select("*").order("received_at", { ascending: false }).limit(100);

  let rows: Record<string, unknown>[] = [];
  let newIds: string[] = [];
  let fellBack = false;
  if (mode === "pending") {
    const [{ data: pending }, { data: lastRun }] = await Promise.all([
      base().eq("source_system", COREHUB).in("referral_status", [...PENDING]),
      supabase.from("automation_runs").select("id").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    rows = pending ?? [];
    // Freshly fetched = brought in by the latest worker run; shown first.
    newIds = rows.filter((r) => lastRun && r.automation_run_id === lastRun.id).map((r) => r.id as string);
    rows = [...rows.filter((r) => newIds.includes(r.id as string)), ...rows.filter((r) => !newIds.includes(r.id as string))];
    if (!rows.length) {
      fellBack = true;
      rows = (await base()).data ?? [];
    }
  } else {
    let query = base();
    if (status) query = query.eq("referral_status", status);
    if (q) query = query.or(["external_case_id", "registration_number", "make_raw", "model_raw"].map((c) => `${c}.ilike.%${q}%`).join(","));
    rows = (await query).data ?? [];
  }

  const title =
    mode === "pending" && !fellBack
      ? `${rows.length} pending action${newIds.length ? ` · ${newIds.length} new` : ""}`
      : `${rows.length} cases`;
  const description =
    mode === "pending" && !fellBack
      ? "CoreHub referrals awaiting evaluation or an underwriter — latest fetch first"
      : rows.length === 100
        ? "Showing newest 100 — refine the search to narrow"
        : "Newest first";

  return (
    <>
      {fellBack && (
        <Alert>
          <Inbox />
          <AlertTitle>No CoreHub referrals pending action</AlertTitle>
          <AlertDescription>Nothing fetched from CoreHub is waiting on automation or review, so all cases are shown below.</AlertDescription>
        </Alert>
      )}
      <Card className="pb-0">
        <SectionLoaded />
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
          {(q || status) && (
            <CardAction>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/referrals">Clear filters</Link>
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CaseTable rows={rows} newIds={newIds} emptyText={mode === "filtered" ? "No cases match these filters." : "No referral cases yet."} />
      </Card>
    </>
  );
}
