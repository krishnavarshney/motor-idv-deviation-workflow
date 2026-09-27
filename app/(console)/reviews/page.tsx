import Link from "next/link";
import { ChevronRight, ClipboardCheck, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DecisionBadge } from "@/components/status";
import { EmptyRow, PageHeader } from "@/components/console";
import { money, vehicleName } from "@/lib/format";
import { loadDecisionConfig } from "@/src/server/idv-config";

export const metadata = { title: "Manual review" };

export default async function Reviews() {
  const supabase = await createClient();
  const [{ data }, config] = await Promise.all([
    supabase
      .from("manual_reviews")
      .select("*, referral_cases(id,external_case_id,registration_number,make_raw,model_raw,variant_raw,requested_idv)")
      .neq("review_status", "completed")
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true }),
    loadDecisionConfig(supabase),
  ]);
  const rows = data ?? [];
  const slaMs = config.reviewSlaMinutes * 60_000;
  const now = Date.now();

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Manual review queue"
        description="Exceptions are fail-closed and require an explicit underwriter decision."
      />
      <Card className="pb-0">
        <CardHeader>
          <CardTitle>{rows.length} reviews waiting</CardTitle>
          <CardDescription>Oldest first within priority · SLA {Math.round(config.reviewSlaMinutes / 60)}h</CardDescription>
          <CardAction>
            <Badge variant="warning">
              <UserCheck data-icon="inline-start" />
              Human decision required
            </Badge>
          </CardAction>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Priority</TableHead>
              <TableHead>Case</TableHead>
              <TableHead>Vehicle</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>SLA</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="pr-4" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((x) => {
              const c = x.referral_cases;
              const left = (x.sla_due_at ? new Date(x.sla_due_at).getTime() : new Date(x.created_at).getTime() + slaMs) - now;
              const breached = left <= 0;
              return (
                <TableRow key={x.id}>
                  <TableCell className="pl-4">
                    <Badge variant={x.priority <= 2 ? "destructive" : "outline"} className="font-mono">
                      P{x.priority}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{c?.external_case_id}</div>
                    <div className="font-mono text-xs text-muted-foreground">{c?.registration_number || "No registration"}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{vehicleName(c?.make_raw, c?.model_raw, c?.variant_raw)}</div>
                    <div className="text-xs text-muted-foreground">
                      Requested <span className="font-mono tabular-nums">{money(c?.requested_idv)}</span>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-72 truncate text-muted-foreground" title={x.review_reason}>
                    {x.review_reason}
                  </TableCell>
                  <TableCell>
                    <Badge variant={breached ? "destructive" : left < slaMs / 4 ? "warning" : "secondary"} className="tabular-nums">
                      {breached ? "Breached " : ""}
                      {formatDuration(Math.abs(left))}
                      {breached ? " ago" : " left"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DecisionBadge status={x.review_status} />
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button size="sm" variant="outline" asChild>
                      <Link href={"/reviews/" + x.id}>
                        Review
                        <ChevronRight data-icon="inline-end" />
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
            {!rows.length && <EmptyRow colSpan={7} icon={ClipboardCheck} title="Queue clear" description="No pending exceptions." />}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

function formatDuration(ms: number) {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
