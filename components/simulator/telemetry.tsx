"use client";

import type React from "react";
import { Ban, CheckCircle2, Circle, Info, TriangleAlert, XCircle } from "lucide-react";
import { AnimatedList } from "@/components/ui/animated-list";
import { AnimatedShinyText } from "@/components/ui/animated-shiny-text";
import { BorderBeam } from "@/components/ui/border-beam";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export interface LogEntry {
  id: string;
  time: string;
  level: "info" | "success" | "warn" | "error";
  message: string;
}

export type RunStatus = "idle" | "running" | "done" | "failed" | "cancelled";
export interface RunStep {
  key: string;
  label: string;
  status: "running" | "done" | "failed";
  detail?: string;
}

const STATUS_ICON = {
  done: <CheckCircle2 className="size-4 text-success" aria-label="Finished" />,
  failed: <XCircle className="size-4 text-destructive" aria-label="Failed" />,
  cancelled: <Ban className="size-4 text-muted-foreground" aria-label="Cancelled" />,
  idle: <Circle className="size-4 text-muted-foreground" aria-label="Idle" />,
};

export function RunBar({
  status,
  current,
  stepCount,
  elapsedMs,
  summary,
  actions,
}: {
  status: RunStatus;
  current: RunStep | null;
  stepCount: number;
  elapsedMs: number;
  summary: React.ReactNode;
  actions: React.ReactNode;
}) {
  const running = status === "running";

  return (
    <Card size="sm" className="sticky top-14 z-10 bg-background/80 backdrop-blur" aria-busy={running}>
      <div className="flex flex-col gap-3 px-(--card-spacing) sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex shrink-0">{running ? <Spinner className="text-info" /> : STATUS_ICON[status]}</span>
          <div className="relative h-5 min-w-0 flex-1 overflow-hidden" aria-live="polite">
            {/* Keyed remount replays a CSS enter animation per step; compositor-driven, so it can't stall like rAF. */}
            <div
              key={running ? `${stepCount}-${current?.key}-${current?.status}` : `idle-${status}`}
              className="truncate text-sm font-medium duration-200 animate-in fade-in slide-in-from-bottom-2"
            >
              {running ? (
                <AnimatedShinyText className="mx-0 max-w-none">{current?.label ?? "Starting lookup"}…</AnimatedShinyText>
              ) : (
                summary
              )}
            </div>
          </div>
          {(running || stepCount > 0) && (
            <span className="hidden shrink-0 font-mono text-xs text-muted-foreground tabular-nums sm:inline">
              Step {stepCount} · {(elapsedMs / 1000).toFixed(1)}s
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(running || stepCount > 0) && (
            <span className="font-mono text-xs text-muted-foreground tabular-nums sm:hidden">
              Step {stepCount} · {(elapsedMs / 1000).toFixed(1)}s
            </span>
          )}
          {actions}
        </div>
      </div>
      {running && <BorderBeam size={80} duration={4} colorFrom="var(--primary)" colorTo="var(--info)" />}
    </Card>
  );
}

const LEVEL = {
  info: { icon: Info, className: "text-info", label: "Info" },
  success: { icon: CheckCircle2, className: "text-success", label: "Pass" },
  warn: { icon: TriangleAlert, className: "text-warning", label: "Warn" },
  error: { icon: XCircle, className: "text-destructive", label: "Error" },
} as const;

export function PipelineLog({ logs }: { logs: LogEntry[] }) {
  return (
    <ScrollArea className="h-80 rounded-xl border">
      <AnimatedList delay={80} className="items-stretch gap-2 p-3">
        {logs.map((log) => {
          const { icon: Icon, className, label } = LEVEL[log.level];
          return (
            <div key={log.id} className="flex items-start gap-2 text-xs">
              <Icon className={cn("mt-0.5 size-3.5 shrink-0", className)} aria-label={label} />
              <span className="shrink-0 font-mono text-muted-foreground tabular-nums">{log.time}</span>
              <span className="min-w-0 break-words">{log.message}</span>
            </div>
          );
        })}
      </AnimatedList>
    </ScrollArea>
  );
}
