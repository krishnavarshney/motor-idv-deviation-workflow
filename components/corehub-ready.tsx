"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleSlash, Send, ShieldCheck, XCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Spinner } from "@/components/ui/spinner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { notify } from "@/lib/notify";
import { money } from "@/lib/format";

export interface ReadyCheck {
  label: string;
  ok: boolean | null;
  detail: string;
}

export interface ReadyRow {
  id: string;
  proposalId: string;
  vehicle: string;
  requestedIdv: number | null;
  obvIdv: number | null;
  band: string | null;
  reasonCode: string | null;
  decidedBy: "Automation" | "Underwriter";
  action: "approve" | "reject";
  reason: string | null;
  checks: ReadyCheck[];
  lastAttempt: { status: string; error: string | null } | null;
}

function Checks({ checks }: { checks: ReadyCheck[] }) {
  const failed = checks.filter((c) => c.ok === false);
  const passed = checks.filter((c) => c.ok === true).length;
  if (!checks.length) return <span className="text-xs text-muted-foreground">Not read</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={failed.length ? "warning" : "success"} className="cursor-help">
          {failed.length ? <AlertTriangle data-icon="inline-start" /> : <ShieldCheck data-icon="inline-start" />}
          {failed.length ? `${failed.length} to check` : `${passed}/${passed} match`}
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">
        <ul className="flex flex-col gap-1 text-xs">
          {checks.map((c) => (
            <li key={c.label}>
              {c.ok === false ? "✗" : c.ok ? "✓" : "•"} <span className="font-medium">{c.label}</span> — {c.detail}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}

function ActionBadge({ action }: { action: ReadyRow["action"] }) {
  return action === "approve" ? (
    <Badge variant="success">
      <CheckCircle2 data-icon="inline-start" />
      Approve
    </Badge>
  ) : (
    <Badge variant="destructive">
      <XCircle data-icon="inline-start" />
      Reject
    </Badge>
  );
}

/**
 * Cases whose console decision is ready to be carried out in CoreHub. Nothing is sent until a person
 * selects cases and confirms; the worker then re-checks each live referral before clicking.
 */
export function CorehubReady({ rows, dryRun, disabledReason }: { rows: ReadyRow[]; dryRun: boolean; disabledReason: string | null }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const chosen = rows.filter((r) => selected.has(r.id));
  const allOn = rows.length > 0 && chosen.length === rows.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const approvals = chosen.filter((r) => r.action === "approve").length;
  const rejections = chosen.length - approvals;

  const send = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/corehub-actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ case_ids: chosen.map((r) => r.id) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Request failed");
      const skipped = (d.blocked ?? []).length;
      notify.success(d.dryRun ? `Rehearsal queued for ${d.queued} case${d.queued === 1 ? "" : "s"}` : `${d.queued} CoreHub action${d.queued === 1 ? "" : "s"} queued`, {
        description: skipped ? `${skipped} skipped — see each case for why.` : "Follow progress on the Automation page.",
      });
      setSelected(new Set());
      setConfirming(false);
      router.push(`/automation/jobs/${d.jobId}`);
    } catch (err) {
      notify.error("Could not queue CoreHub actions", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  if (!rows.length) return null;
  return (
    <Card className="pb-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="size-4 text-muted-foreground" />
          {rows.length} ready for CoreHub
          <Badge variant={dryRun ? "secondary" : "warning"}>{dryRun ? "Dry run" : "Live"}</Badge>
        </CardTitle>
        <CardDescription>
          Decided in the console, still pending in CoreHub. Review the evidence, select cases and confirm — the worker re-checks each live
          referral before it clicks.
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          {disabledReason && <span className="text-xs text-muted-foreground">{disabledReason}</span>}
          <Button size="sm" disabled={!chosen.length || !!disabledReason} onClick={() => setConfirming(true)}>
            <Send data-icon="inline-start" />
            {dryRun ? "Rehearse" : "Send to CoreHub"}
            {chosen.length ? ` (${chosen.length})` : ""}
          </Button>
        </CardAction>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10 pl-4">
              <Checkbox checked={allOn} onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())} aria-label="Select all ready cases" />
            </TableHead>
            <TableHead>Proposal</TableHead>
            <TableHead>Vehicle</TableHead>
            <TableHead className="text-right">Requested / OBV</TableHead>
            <TableHead>Decision</TableHead>
            <TableHead>CoreHub evidence</TableHead>
            <TableHead className="pr-4">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined}>
              <TableCell className="pl-4">
                <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggle(r.id)} aria-label={`Select ${r.proposalId}`} />
              </TableCell>
              <TableCell>
                <Link href={`/referrals/${r.id}?tab=corehub`} className="font-mono font-medium hover:underline">
                  {r.proposalId}
                </Link>
                {r.lastAttempt && (
                  <div className="text-xs text-muted-foreground" title={r.lastAttempt.error ?? undefined}>
                    Last attempt: {r.lastAttempt.status}
                    {r.lastAttempt.error ? " — " + r.lastAttempt.error.slice(0, 60) : ""}
                  </div>
                )}
              </TableCell>
              <TableCell className="max-w-64 truncate" title={r.vehicle}>
                {r.vehicle}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                <div>{money(r.requestedIdv)}</div>
                <div className="text-xs text-muted-foreground">
                  {money(r.obvIdv)}
                  {r.band ? ` · ${r.band}` : ""}
                </div>
              </TableCell>
              <TableCell>
                <div className="text-sm">{r.decidedBy}</div>
                <div className="font-mono text-xs text-muted-foreground">{r.reasonCode ?? "—"}</div>
              </TableCell>
              <TableCell>
                <Checks checks={r.checks} />
              </TableCell>
              <TableCell className="pr-4">
                <ActionBadge action={r.action} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <AlertDialog open={confirming} onOpenChange={(o) => !busy && setConfirming(o)}>
        <AlertDialogContent className="sm:max-w-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dryRun ? "Rehearse" : "Send"} {chosen.length} decision{chosen.length === 1 ? "" : "s"} to CoreHub?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dryRun
                ? "Dry run: the worker opens each referral, runs the pre-checks and the confirmation dialog, then cancels. Nothing is submitted."
                : `This will ${[approvals && `approve ${approvals}`, rejections && `reject ${rejections}`].filter(Boolean).join(" and ")} in CoreHub and notify the agents. CoreHub cannot undo it.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto text-sm">
            {chosen.map((r) => (
              <li key={r.id} className="flex items-start justify-between gap-3 rounded-md border p-2">
                <div className="min-w-0">
                  <div className="font-mono font-medium">{r.proposalId}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {r.vehicle} · {money(r.requestedIdv)} vs OBV {money(r.obvIdv)}
                  </div>
                  {r.reason && <div className="mt-1 text-xs">Reason sent: “{r.reason}”</div>}
                  {r.checks.some((c) => c.ok === false) && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-warning">
                      <CircleSlash className="size-3" />
                      Evidence mismatch at fetch — the live re-check will stop it if still wrong
                    </div>
                  )}
                </div>
                <ActionBadge action={r.action} />
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void send();
              }}
              disabled={busy}
              variant={dryRun || !rejections ? "default" : "destructive"}
            >
              {busy && <Spinner data-icon="inline-start" />}
              {dryRun ? "Queue rehearsal" : "Yes, send to CoreHub"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/** Case-page button: send (or retry) this case's console decision to CoreHub after a confirmation. */
export function SendToCorehubButton({
  caseId,
  action,
  reason,
  dryRun,
  retry,
  disabledReason,
}: {
  caseId: string;
  action: "approve" | "reject";
  reason: string | null;
  dryRun: boolean;
  retry: boolean;
  disabledReason: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const verb = action === "approve" ? "Approve" : "Reject";
  const send = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/corehub-actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ case_ids: [caseId] }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Request failed");
      notify.success(d.dryRun ? "CoreHub rehearsal queued" : `Queued to ${action} in CoreHub`, { href: `/automation/jobs/${d.jobId}` });
      setOpen(false);
      router.push(`/automation/jobs/${d.jobId}`);
    } catch (err) {
      notify.error("Could not queue CoreHub action", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      {disabledReason && <span className="text-xs text-muted-foreground">{disabledReason}</span>}
      <Button size="sm" variant={action === "approve" ? "default" : "destructive"} disabled={!!disabledReason} onClick={() => setOpen(true)}>
        <Send data-icon="inline-start" />
        {retry ? "Retry" : dryRun ? "Rehearse" : verb} in CoreHub
      </Button>
      <AlertDialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dryRun ? `Rehearse "${verb}" in CoreHub?` : `${verb} this proposal in CoreHub?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dryRun
                ? `Dry run: the worker opens the referral, runs the live checks and the "${verb} proposal?" dialog, then cancels.`
                : `The worker re-checks the live referral, then clicks "Yes, ${verb}". CoreHub notifies the agent and cannot undo it.`}
              {reason ? ` Reason sent: “${reason}”.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={action === "reject" && !dryRun ? "destructive" : "default"}
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              {busy && <Spinner data-icon="inline-start" />}
              {dryRun ? "Queue rehearsal" : `Yes, ${verb.toLowerCase()} in CoreHub`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
