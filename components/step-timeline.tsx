"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type JobStep = { label: string; at: string };

const secs = (ms: number) => (ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

/** Checkpoints the worker reported, with offset from start and time spent in each. Ticks while running. */
export function StepTimeline({ steps, status, finishedAt }: { steps: JobStep[]; status: string; finishedAt: string | null }) {
  const running = status === "running";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [running]);

  if (!steps.length) {
    return <p className="text-sm text-muted-foreground">{status === "queued" ? "Waiting for the worker to pick this job up." : "No step history was recorded for this job."}</p>;
  }

  const t0 = new Date(steps[0].at).getTime();
  const end = running ? now : finishedAt ? new Date(finishedAt).getTime() : new Date(steps.at(-1)!.at).getTime();
  const spans = steps.map((s, i) => (i + 1 < steps.length ? new Date(steps[i + 1].at).getTime() : end) - new Date(s.at).getTime());
  const longest = Math.max(...spans, 1);

  return (
    <ol className="flex flex-col">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const state = last && running ? "running" : last && status === "failed" ? "failed" : "done";
        return (
          <li key={`${i}-${s.label}`} className="relative flex gap-3 pb-4 duration-300 animate-in fade-in slide-in-from-left-2 last:pb-0">
            {!last && <span aria-hidden className="absolute top-5 left-[7px] h-[calc(100%-1rem)] w-px bg-border" />}
            <span className="z-10 flex size-4 shrink-0 items-center justify-center bg-card pt-0.5">
              {state === "running" ? (
                <Spinner className="size-4 text-info" />
              ) : state === "failed" ? (
                <XCircle className="size-4 text-destructive" aria-label="Failed" />
              ) : status === "cancelled" && last ? (
                <Circle className="size-4 text-muted-foreground" aria-label="Cancelled" />
              ) : (
                <CheckCircle2 className="size-4 text-success" aria-label="Done" />
              )}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className={cn("text-sm", state === "running" && "font-medium")}>{s.label}</span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                  +{secs(new Date(s.at).getTime() - t0)} · {secs(spans[i])}
                </span>
              </div>
              {/* Relative time spent: makes the slow step obvious at a glance. */}
              <div className="h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn("h-full rounded-full transition-[width] duration-500", state === "failed" ? "bg-destructive" : state === "running" ? "bg-info" : "bg-foreground/30")}
                  style={{ width: `${Math.max(2, (spans[i] / longest) * 100)}%` }}
                />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
