import Link from "next/link";
import { Inbox } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DecisionBadge } from "@/components/status";
import { EmptyRow } from "@/components/console";
import { dateTime, humanize, money, vehicleName } from "@/lib/format";

export function CaseTable({ rows, emptyText = "Nothing matches yet." }: { rows: any[]; emptyText?: string }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-4">Case</TableHead>
          <TableHead>Vehicle identity</TableHead>
          <TableHead className="text-right">Requested IDV</TableHead>
          <TableHead>Decision</TableHead>
          <TableHead className="pr-4">Workflow</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((x) => (
          <TableRow key={x.id}>
            <TableCell className="pl-4">
              <Link href={"/referrals/" + x.id} className="font-medium hover:underline">
                {x.external_case_id}
              </Link>
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
            <TableCell className="pr-4 text-muted-foreground capitalize">{humanize(x.workflow_status)}</TableCell>
          </TableRow>
        ))}
        {!rows.length && <EmptyRow colSpan={5} icon={Inbox} title="No referral cases" description={emptyText} />}
      </TableBody>
    </Table>
  );
}
