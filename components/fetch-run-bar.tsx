"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FetchButton } from "@/components/job-buttons";
import { RunBar, type RunStatus } from "@/components/simulator/telemetry";

type FetchJob = {
  id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  progress: { current_step?: string; done?: number; total?: number; step?: number; case_ids?: string[] } | null;
};

const RECENT_MS = 2 * 60_000;

/**
 * Live CoreHub fetch status in the same run bar the simulator uses. Data comes from the
 * automation_jobs row the worker updates at each checkpoint; the page re-renders on
 * Realtime changes (LiveRefresh), so this only derives display state and ticks the clock.
 */
export function FetchRunBar({ active, last, disabledReason }: { active: FetchJob | null; last: FetchJob | null; disabledReason: string | null | false }) {
  const [now, setNow] = useState(() => Date.now());
  const running = active?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, [running]);

  const job = active ?? last;
  const recent = !!last?.finished_at && now - new Date(last.finished_at).getTime() < RECENT_MS;
  const status: RunStatus = active
    ? "running"
    : last && recent
      ? last.status === "succeeded"
        ? "done"
        : last.status === "failed"
          ? "failed"
          : "cancelled"
      : "idle";

  const p = job?.progress ?? {};
  const label = active?.status === "queued" ? "Waiting for worker to pick up the fetch" : (p.current_step ?? "Starting fetch");
  const start = job?.started_at ? new Date(job.started_at).getTime() : null;
  const end = active ? now : last?.finished_at ? new Date(last.finished_at).getTime() : null;
  const elapsedMs = start && end ? Math.max(0, end - start) : 0;
  const newCount = last?.progress?.case_ids?.length ?? 0;

  const summary = !last ? (
    <span className="text-muted-foreground">No CoreHub fetch yet</span>
  ) : last.status === "failed" ? (
    <span className="text-destructive">Last fetch failed{last.error ? ` · ${last.error}` : ""}</span>
  ) : (
    <span>
      Last fetch {timeAgo(last.finished_at)} · <span className="font-mono tabular-nums">{newCount}</span> new referral{newCount === 1 ? "" : "s"}
    </span>
  );

  return (
    <RunBar
      status={status}
      current={active ? { key: `${active.status}-${p.step ?? 0}`, label, status: "running" } : null}
      stepCount={status === "idle" ? 0 : (p.step ?? 0)}
      elapsedMs={elapsedMs}
      summary={summary}
      actions={
        <>
          {job && (
            <Button asChild size="sm" variant="ghost">
              <Link href={`/automation/jobs/${job.id}`}>
                View job
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          )}
          {disabledReason !== false && <FetchButton disabledReason={active ? "Fetch in progress" : disabledReason} />}
        </>
      }
    />
  );
}

function timeAgo(iso: string | null) {
  if (!iso) return "";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}
