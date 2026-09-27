import Link from "next/link";
import { AlertCircle, AlertTriangle, FileClock, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyRow, PageHeader } from "@/components/console";
import { dateTime, humanize } from "@/lib/format";

export const metadata = { title: "Audit trail" };

const SEVERITIES = ["info", "warning", "error"] as const;
const SEVERITY = {
  error: { variant: "destructive", icon: AlertCircle },
  warning: { variant: "warning", icon: AlertTriangle },
  info: { variant: "secondary", icon: Info },
} as const;

export default async function Audit({ searchParams }: { searchParams: Promise<{ severity?: string }> }) {
  const sp = await searchParams;
  const severity = SEVERITIES.find((s) => s === sp.severity);
  const supabase = await createClient();
  let query = supabase.from("audit_events").select("*, referral_cases(id,external_case_id)").order("created_at", { ascending: false }).limit(200);
  if (severity) query = query.eq("severity", severity);
  const { data } = await query;
  const rows = data ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Audit trail"
        description="Append-only workflow evidence across intake, valuation, decisions and reviews."
      />
      <nav aria-label="Filter by severity" className="flex flex-wrap gap-1.5">
        {[undefined, ...SEVERITIES].map((s) => (
          <Button key={s ?? "all"} size="sm" variant={s === severity ? "secondary" : "ghost"} asChild className="capitalize">
            <Link href={s ? `/audit?severity=${s}` : "/audit"} aria-current={s === severity ? "page" : undefined}>
              {s ?? "All"}
            </Link>
          </Button>
        ))}
      </nav>
      <Card className="pb-0">
        <CardHeader>
          <CardTitle>{rows.length} events</CardTitle>
          <CardDescription>Newest first{rows.length === 200 ? " · showing latest 200" : ""}</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Time</TableHead>
              <TableHead>Case</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead className="pr-4">Severity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => {
              const sev = SEVERITY[e.severity as keyof typeof SEVERITY] ?? SEVERITY.info;
              return (
                <TableRow key={e.id}>
                  <TableCell className="pl-4 text-muted-foreground tabular-nums">{dateTime(e.created_at)}</TableCell>
                  <TableCell>
                    {e.referral_cases ? (
                      <Link href={"/referrals/" + e.referral_cases.id} className="font-mono font-medium hover:underline">
                        {e.referral_cases.external_case_id}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">System</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium capitalize">{humanize(e.event_type)}</div>
                    <div className="font-mono text-xs text-muted-foreground">{e.correlation_id || "No correlation ID"}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground capitalize">{e.actor_type}</TableCell>
                  <TableCell className="pr-4">
                    <Badge variant={sev.variant} className="capitalize">
                      <sev.icon data-icon="inline-start" />
                      {e.severity}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })}
            {!rows.length && <EmptyRow colSpan={5} icon={FileClock} title="No audit events" />}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
