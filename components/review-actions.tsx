"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Decision = "auto_approved" | "rejected";

export default function ReviewActions({ reviewId, caseId, completed }: { reviewId: string; caseId?: string; completed?: boolean }) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<Decision | null>(null);
  const [touched, setTouched] = useState(false);
  const invalid = notes.trim().length < 3;

  async function decide(decision: Decision) {
    setBusy(decision);
    const r = await fetch("/api/reviews/" + reviewId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, notes }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) return notify.error("Unable to complete review", { description: d.error });
    const verb = decision === "rejected" ? "reject" : "approve";
    const corehub = d.corehub as { queued: boolean; dryRun?: boolean; error?: string } | null;
    notify.success(decision === "rejected" ? "Case rejected" : "Case approved", {
      description: !corehub
        ? "Decision recorded in the audit trail."
        : corehub.queued
          ? corehub.dryRun
            ? `Queued a CoreHub rehearsal (dry run) — the worker will open the ${verb} dialog and cancel. You'll be notified.`
            : `Queued to ${verb} in CoreHub — the worker re-checks the referral first. You'll be notified when it's done.`
          : `Recorded, but not sent to CoreHub: ${corehub.error}`,
      href: caseId ? "/referrals/" + caseId + (corehub ? "?tab=corehub" : "") : undefined,
    });
    router.push("/reviews");
    router.refresh();
  }

  const confirm = (decision: Decision) => (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant={decision === "rejected" ? "outline" : "default"}
          className="flex-1"
          disabled={!!busy || completed}
          onClick={(e) => {
            setTouched(true);
            if (invalid) e.preventDefault();
          }}
        >
          {busy === decision ? <Spinner data-icon="inline-start" /> : decision === "rejected" ? <X data-icon="inline-start" /> : <Check data-icon="inline-start" />}
          {decision === "rejected" ? "Reject" : "Approve"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{decision === "rejected" ? "Reject this case?" : "Approve this case?"}</AlertDialogTitle>
          <AlertDialogDescription>
            This records a final underwriting decision under your account and appends it to the audit trail. It cannot be undone from
            the console.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={decision === "rejected" ? "destructive" : "default"} onClick={() => decide(decision)}>
            Confirm {decision === "rejected" ? "rejection" : "approval"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reviewer decision</CardTitle>
        <CardDescription>{completed ? "This review has been completed." : "Record the evidence supporting your decision."}</CardDescription>
      </CardHeader>
      <CardContent>
        <Field data-invalid={touched && invalid ? true : undefined}>
          <FieldLabel htmlFor="review-notes">Notes</FieldLabel>
          <Textarea
            id="review-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => setTouched(true)}
            rows={5}
            disabled={completed}
            aria-invalid={touched && invalid}
            placeholder="Explain the evidence supporting the decision…"
          />
          {touched && invalid ? <FieldError>Add reviewer notes before completing the case.</FieldError> : <FieldDescription>Required. Stored with the audit event.</FieldDescription>}
        </Field>
      </CardContent>
      <CardFooter className="gap-2 border-t pt-4">
        {confirm("auto_approved")}
        {confirm("rejected")}
      </CardFooter>
    </Card>
  );
}
