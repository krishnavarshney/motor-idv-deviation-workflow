"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, Radio, ShieldAlert } from "lucide-react";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { notify } from "@/lib/notify";
import type { AutomationSettings, WritebackMode } from "@/lib/automation-settings";

async function save(body: Record<string, unknown>) {
  const r = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Request failed");
}

/** CoreHub automation: write-back mode and when things happen automatically. Each change saves on its own. */
export function AutomationSettingsForm({ initial }: { initial: AutomationSettings }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [confirmLive, setConfirmLive] = useState(false);
  const [busy, setBusy] = useState(false);

  const apply = async (patch: Partial<AutomationSettings>, body: Record<string, unknown>, done: string) => {
    const prev = s;
    setS({ ...s, ...patch });
    setBusy(true);
    try {
      await save(body);
      notify.success(done, { description: "Change recorded in the audit trail." });
      router.refresh();
    } catch (err) {
      setS(prev);
      notify.error("Unable to save", { description: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const setMode = (mode: WritebackMode) => {
    if (!mode || mode === s.writebackMode) return;
    if (mode === "live") return setConfirmLive(true);
    void apply({ writebackMode: "rehearse", dryRun: true }, { corehub_writeback_mode: "rehearse" }, "CoreHub write-back set to rehearse");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>CoreHub automation</CardTitle>
        <CardDescription>How the worker carries decisions out in CoreHub. Applies to actions queued after the change.</CardDescription>
        <CardAction>
          <Badge variant={s.dryRun ? "secondary" : "warning"}>
            {s.dryRun ? <FlaskConical data-icon="inline-start" /> : <Radio data-icon="inline-start" />}
            {s.dryRun ? "Rehearsing" : "Live"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {s.forcedDryRun && (
          <Alert>
            <ShieldAlert />
            <AlertTitle>Rehearsals forced by the server</AlertTitle>
            <AlertDescription>
              AUTOMATION_FORCE_DRY_RUN=true is set, so nothing is submitted to CoreHub whatever is chosen here. Remove it to go live.
            </AlertDescription>
          </Alert>
        )}
        <Field>
          <FieldLabel id="writeback-mode">Write-back mode</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={0}
            value={s.writebackMode}
            onValueChange={(v) => setMode(v as WritebackMode)}
            disabled={busy}
            aria-labelledby="writeback-mode"
            className="w-full sm:w-fit"
          >
            <ToggleGroupItem value="rehearse" className="flex-1 px-4">
              <FlaskConical data-icon="inline-start" />
              Rehearse
            </ToggleGroupItem>
            <ToggleGroupItem value="live" className="flex-1 px-4">
              <Radio data-icon="inline-start" />
              Live
            </ToggleGroupItem>
          </ToggleGroup>
          <FieldDescription>
            Rehearse opens CoreHub&apos;s Approve/Reject dialog, runs every check, then cancels. Live clicks &quot;Yes&quot; — CoreHub notifies
            the agent and cannot undo it.
          </FieldDescription>
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="auto-send">Send review decisions to CoreHub automatically</FieldLabel>
            <FieldDescription>When an underwriter approves or rejects a case, queue the matching CoreHub action straight away.</FieldDescription>
          </FieldContent>
          <Switch
            id="auto-send"
            checked={s.autoSendReviews}
            disabled={busy}
            onCheckedChange={(v) =>
              apply({ autoSendReviews: v }, { corehub_auto_send_reviews: v }, v ? "Review decisions go to CoreHub" : "Review decisions stay in the console")
            }
          />
        </Field>

        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="auto-evaluate">Evaluate after fetch</FieldLabel>
            <FieldDescription>Run the OBV valuation and decision rules on referrals as soon as a CoreHub fetch brings them in.</FieldDescription>
          </FieldContent>
          <Switch
            id="auto-evaluate"
            checked={s.fetchAutoEvaluate}
            disabled={busy}
            onCheckedChange={(v) => apply({ fetchAutoEvaluate: v }, { fetch_auto_evaluate: v }, v ? "Fetches now evaluate" : "Fetches only import")}
          />
        </Field>
      </CardContent>

      <AlertDialog open={confirmLive} onOpenChange={(o) => !busy && setConfirmLive(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch CoreHub write-back to live?</AlertDialogTitle>
            <AlertDialogDescription>
              From now on, confirmed decisions are submitted in CoreHub: the worker clicks &quot;Yes, Approve&quot; / &quot;Yes, Reject&quot;,
              CoreHub notifies the agent, and it cannot be undone. The worker still stops before clicking if the live referral no longer
              matches what was evaluated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep rehearsing</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                setConfirmLive(false);
                void apply(
                  { writebackMode: "live", dryRun: s.forcedDryRun },
                  { corehub_writeback_mode: "live", confirm_live: true },
                  "CoreHub write-back is live",
                );
              }}
            >
              Go live
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
