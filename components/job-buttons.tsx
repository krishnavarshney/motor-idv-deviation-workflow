"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CloudDownload, Play, X } from "lucide-react";
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

async function post(url: string, body?: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Request failed");
  return d;
}

function useJobAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  /** openJob: jump to the queued job's page so progress is visible right away. */
  const run = async (url: string, body: unknown, success: string, onDone?: () => void, openJob = false) => {
    setBusy(true);
    try {
      const d = await post(url, body);
      notify.success(success, openJob && d?.id ? { href: `/automation/jobs/${d.id}` } : undefined);
      onDone?.();
      if (openJob && d?.id) router.push(`/automation/jobs/${d.id}`);
      else router.refresh();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** Disabled buttons can't show tooltips, so the reason is rendered as text beside the button. */
function Reason({ text }: { text: string | null | undefined }) {
  return text ? <span className="text-xs text-muted-foreground">{text}</span> : null;
}

export function FetchButton({ disabledReason }: { disabledReason: string | null }) {
  const { busy, run } = useJobAction();
  return (
    <div className="flex items-center gap-2">
      <Reason text={disabledReason} />
      <Button disabled={busy || !!disabledReason} onClick={() => run("/api/jobs", { type: "fetch" }, "Fetch from CoreHub queued", undefined, true)}>
        {busy ? <Spinner data-icon="inline-start" /> : <CloudDownload data-icon="inline-start" />}
        Fetch from CoreHub
      </Button>
    </div>
  );
}

export function EvaluateButton({
  caseIds,
  all = false,
  label,
  disabledReason,
  onDone,
  variant = "default",
}: {
  caseIds: string[];
  all?: boolean;
  label: string;
  disabledReason?: string | null;
  onDone?: () => void;
  variant?: "default" | "outline";
}) {
  const { busy, run } = useJobAction();
  const body = all ? { type: "evaluate", all_received: true } : { type: "evaluate", case_ids: caseIds };
  return (
    <div className="flex items-center gap-2">
      <Reason text={disabledReason} />
      <Button
        size="sm"
        variant={variant}
        disabled={busy || !!disabledReason || (!all && caseIds.length === 0)}
        onClick={() => run("/api/jobs", body, "Evaluation queued", onDone, true)}
      >
        {busy ? <Spinner data-icon="inline-start" /> : <Play data-icon="inline-start" />}
        {label}
      </Button>
    </div>
  );
}

export function CancelJobButton({ jobId }: { jobId: string }) {
  const { busy, run } = useJobAction();
  return (
    <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(`/api/jobs/${jobId}/cancel`, undefined, "Job cancelled")}>
      <X data-icon="inline-start" />
      Cancel
    </Button>
  );
}
