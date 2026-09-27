"use client";

import { CheckCircle2, Circle, CircleDashed, Globe, Info, Terminal, TriangleAlert, XCircle } from "lucide-react";
import type { DecisionAllowanceAnalysis } from "@/lib/idv-simulator-engine";
import { AnimatedList } from "@/components/ui/animated-list";
import { Badge } from "@/components/ui/badge";
import { BorderBeam } from "@/components/ui/border-beam";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { humanize, money } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface LogEntry {
  id: string;
  time: string;
  level: "info" | "success" | "warn";
  message: string;
}

export type LookupStatus = "idle" | "running" | "done" | "failed";

// Descriptive only: the API reports no per-step progress, so every step shares the request's real status.
const PIPELINE = [
  "Launch headless browser",
  "Open OrangeBookValue",
  "Enter make, model, YOM & variant",
  "Extract Good / Very Good / Excellent bands",
  "Evaluate policy corridor",
];

export function LookupCard({
  status,
  elapsedMs,
  vehicle,
  reasonCode,
  latencyMs,
}: {
  status: LookupStatus;
  elapsedMs: number;
  vehicle: string;
  reasonCode?: string;
  latencyMs?: number;
}) {
  const StepIcon = { idle: Circle, running: CircleDashed, done: CheckCircle2, failed: XCircle }[status];
  return (
    <Card size="sm" className="relative" aria-busy={status === "running"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="size-4 text-muted-foreground" />
          Live OBV lookup
        </CardTitle>
        <CardDescription className="truncate">{vehicle}</CardDescription>
        <CardAction>
          {status === "running" ? (
            <Badge variant="info" className="font-mono tabular-nums">
              <Spinner data-icon="inline-start" />
              {(elapsedMs / 1000).toFixed(1)}s
            </Badge>
          ) : status === "done" ? (
            <Badge variant="success">
              <CheckCircle2 data-icon="inline-start" />
              {latencyMs != null ? `${latencyMs} ms` : "Done"}
            </Badge>
          ) : status === "failed" ? (
            <Badge variant="destructive">
              <XCircle data-icon="inline-start" />
              Failed
            </Badge>
          ) : (
            <Badge variant="outline">Idle</Badge>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <ol className="flex flex-col gap-1.5 text-sm">
          {PIPELINE.map((label) => (
            <li key={label} className={cn("flex items-center gap-2", status === "idle" && "text-muted-foreground")}>
              <StepIcon
                className={cn(
                  "size-3.5 shrink-0",
                  { idle: "text-muted-foreground", running: "text-info", done: "text-success", failed: "text-destructive" }[status]
                )}
              />
              {label}
            </li>
          ))}
        </ol>
        {status === "done" && reasonCode && (
          <p className="text-xs text-muted-foreground">
            Source: <span className="font-mono">{humanize(reasonCode)}</span>
          </p>
        )}
      </CardContent>
      {status === "running" && <BorderBeam size={80} duration={4} colorFrom="var(--primary)" colorTo="var(--info)" />}
    </Card>
  );
}

const LEVEL = {
  info: { icon: Info, className: "text-info", label: "Info" },
  success: { icon: CheckCircle2, className: "text-success", label: "Pass" },
  warn: { icon: TriangleAlert, className: "text-warning", label: "Warn" },
} as const;

export function UnderwritingLog({ logs, analysis }: { logs: LogEntry[]; analysis: DecisionAllowanceAnalysis | null }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Terminal className="size-4 text-muted-foreground" />
          Underwriting log
        </CardTitle>
        <CardDescription>Audit trace and condition tier evaluation, newest first.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {analysis && (
          <>
            <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
              <Badge variant={analysis.isAllowed ? "success" : "warning"}>
                {analysis.isAllowed ? <CheckCircle2 data-icon="inline-start" /> : <TriangleAlert data-icon="inline-start" />}
                {humanize(analysis.verdict)}
              </Badge>
              <span className="text-muted-foreground">
                {analysis.pickedConditionLabel ? `${analysis.pickedConditionLabel} · ` : ""}
                {humanize(analysis.activeRule)} · corridor {money(analysis.minAllowedIdv)} – {money(analysis.maxAllowedIdv)}
              </span>
            </div>
            <Separator />
          </>
        )}
        <ScrollArea className="h-56">
          <AnimatedList delay={120} className="items-stretch gap-2 pr-3">
            {logs.map((log) => {
              const { icon: Icon, className, label } = LEVEL[log.level];
              return (
                <div key={log.id} className="flex items-start gap-2 font-mono text-xs">
                  <Icon className={cn("mt-0.5 size-3.5 shrink-0", className)} aria-label={label} />
                  <span className="shrink-0 text-muted-foreground">{log.time}</span>
                  <span className="min-w-0 break-words">{log.message}</span>
                </div>
              );
            })}
          </AnimatedList>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
