"use client";

import { useState } from "react";
import Link from "next/link";
import { Inbox, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DecisionBadge } from "@/components/status";
import { EmptyRow } from "@/components/console";
import { EvaluateButton } from "@/components/job-buttons";
import { dateTime, humanize, money, vehicleName } from "@/lib/format";

export function CaseTable({
  rows,
  emptyText = "Nothing matches yet.",
  selectable = false,
  disabledReason = null,
  newIds = [],
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[];
  emptyText?: string;
  selectable?: boolean;
  disabledReason?: string | null;
  /** Rows fetched by the latest CoreHub run; get a "New" badge. */
  newIds?: string[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ids: string[] = rows.map((r) => r.id);
  // Rows can disappear on live refresh; only submit ids still on screen.
  const chosen = ids.filter((id) => selected.has(id));
  const allOn = ids.length > 0 && chosen.length === ids.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      {selectable && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2">
          <span className="text-sm text-muted-foreground">{chosen.length} selected</span>
          <EvaluateButton
            caseIds={chosen}
            label={`Evaluate selected${chosen.length ? ` (${chosen.length})` : ""}`}
            disabledReason={disabledReason}
            onDone={() => setSelected(new Set())}
          />
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {selectable && (
              <TableHead className="w-10 pl-4">
                <Checkbox
                  checked={allOn}
                  onCheckedChange={(v) => setSelected(v ? new Set(ids) : new Set())}
                  aria-label="Select all cases"
                />
              </TableHead>
            )}
            <TableHead className={selectable ? undefined : "pl-4"}>Case</TableHead>
            <TableHead>Vehicle identity</TableHead>
            <TableHead className="text-right">Requested IDV</TableHead>
            <TableHead>Decision</TableHead>
            <TableHead className="hidden pr-4 2xl:table-cell">Workflow</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((x) => (
            <TableRow key={x.id} data-state={selected.has(x.id) ? "selected" : undefined}>
              {selectable && (
                <TableCell className="pl-4">
                  <Checkbox checked={selected.has(x.id)} onCheckedChange={() => toggle(x.id)} aria-label={`Select ${x.external_case_id}`} />
                </TableCell>
              )}
              <TableCell className={selectable ? undefined : "pl-4"}>
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
          {!rows.length && <EmptyRow colSpan={selectable ? 6 : 5} icon={Inbox} title="No referral cases" description={emptyText} />}
        </TableBody>
      </Table>
    </>
  );
}
