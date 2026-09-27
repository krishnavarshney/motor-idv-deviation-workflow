import Link from "next/link";
import { FlaskConical, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { CaseTable } from "@/components/case-table";
import { PageHeader } from "@/components/console";

export const metadata = { title: "Referral queue" };

const STATUSES = ["received", "processing", "approved", "manual_review", "rejected", "failed"] as const;

export default async function Referrals({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const p = await searchParams;
  const status = STATUSES.find((s) => s === p.status);
  // Strip PostgREST filter syntax so user input can't alter the .or() expression.
  const q = (p.q ?? "").replace(/[,()%*\\]/g, " ").trim();

  const supabase = await createClient();
  let query = supabase.from("referral_cases").select("*").order("received_at", { ascending: false }).limit(100);
  if (status) query = query.eq("referral_status", status);
  if (q) query = query.or(["external_case_id", "registration_number", "make_raw", "model_raw"].map((c) => `${c}.ilike.%${q}%`).join(","));
  const { data } = await query;
  const rows = data ?? [];

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
          {[undefined, ...STATUSES].map((s) => (
            <Button key={s ?? "all"} size="sm" variant={s === status ? "secondary" : "ghost"} asChild className="capitalize">
              <Link href={href(s)} aria-current={s === status ? "page" : undefined}>
                {s ? s.replaceAll("_", " ") : "All"}
              </Link>
            </Button>
          ))}
        </nav>
      </div>

      <Card className="pb-0">
        <CardHeader>
          <CardTitle>{rows.length} cases</CardTitle>
          <CardDescription>{rows.length === 100 ? "Showing newest 100 — refine the search to narrow" : "Newest first"}</CardDescription>
          {(q || status) && (
            <CardAction>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/referrals">Clear filters</Link>
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CaseTable rows={rows} emptyText="No cases match these filters." />
      </Card>
    </>
  );
}
