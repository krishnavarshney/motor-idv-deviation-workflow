import Link from "next/link";
import { Inbox, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DecisionBadge } from "@/components/status";
import { EmptyRow } from "@/components/console";
import { dateTime, humanize, money, vehicleName } from "@/lib/format";

export function CaseTable({ rows, emptyText = "Nothing matches yet.", newIds = [] }: { rows: any[]; emptyText?: string; newIds?: string[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-4">Case</TableHead>
          <TableHead>Vehicle identity</TableHead>
          <TableHead className="text-right">Requested IDV</TableHead>
          <TableHead>Decision</TableHead>
          <TableHead className="hidden pr-4 2xl:table-cell">Workflow</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((x) => (
          <TableRow key={x.id}>
            <TableCell className="pl-4">
              <div className="flex items-center gap-2">
                <Link href={"/referrals/" + x.id} className="font-medium hover:underline">
                  {x.external_case_id}
                </Link>
                {newIds.includes(x.id) && (
                  <Badge variant="info">
                    <Sparkles data-icon="inline-start" />
                    New
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">{dateTime(x.received_at)}</div>
            </TableCell>
            <TableCell>
              <div className="font-medium">{vehicleName(x.make_raw, x.model_raw, x.variant_raw)}</div>
              <div className="text-xs text-muted-foreground">
                <span className="font-mono">{x.registration_number || "No registration"}</span> · {x.fuel_type_raw || "Fuel n/a"}
              </div>
            </TableCell>
            <TableCell className="text-right font-mono tabular-nums">{money(x.requested_idv)}</TableCell>
            <TableCell>
              <DecisionBadge status={x.referral_status} />
            </TableCell>
            <TableCell className="hidden pr-4 text-muted-foreground capitalize 2xl:table-cell">{humanize(x.workflow_status)}</TableCell>
          </TableRow>
        ))}
        {!rows.length && <EmptyRow colSpan={5} icon={Inbox} title="No referral cases" description={emptyText} />}
      </TableBody>
    </Table>
  );
}
