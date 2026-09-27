"use client";

import type React from "react";
import { CheckCircle2, Crosshair, TriangleAlert, Zap } from "lucide-react";
import type { DecisionAllowanceAnalysis } from "@/lib/idv-simulator-engine";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { humanize, money } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DecisionPanel({
  analysis,
  requestedIdv,
  onRequestedIdvChange,
}: {
  analysis: DecisionAllowanceAnalysis;
  requestedIdv: number;
  onRequestedIdvChange: (value: number) => void;
}) {
  const a = analysis;
  const ok = a.isAllowed;

  // Scale for corridor bar + what-if slider: corridor ∪ requested, padded.
  const lo = Math.min(a.minAllowedIdv, requestedIdv);
  const hi = Math.max(a.maxAllowedIdv, requestedIdv);
  const margin = Math.max(40000, Math.round(Math.max(80000, hi - lo) * 0.25));
  const sliderMin = Math.max(0, Math.round(lo - margin));
  const sliderMax = Math.round(hi + margin);
  const pct = (v: number) => ((Math.max(sliderMin, Math.min(sliderMax, v)) - sliderMin) / Math.max(1, sliderMax - sliderMin)) * 100;
  const floorPct = pct(a.minAllowedIdv);
  const snapTarget = requestedIdv < a.minAllowedIdv ? a.minAllowedIdv : a.maxAllowedIdv;
  const snapInsideCorridor = requestedIdv < a.minAllowedIdv || requestedIdv > a.maxAllowedIdv;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardDescription>Underwriting decision</CardDescription>
          <CardTitle className={cn("flex items-center gap-2 text-lg font-semibold", ok ? "text-success" : "text-warning")}>
            {ok ? <CheckCircle2 className="size-5" /> : <TriangleAlert className="size-5" />}
            {ok ? "Auto-approved" : "Manual review required"}
          </CardTitle>
          <CardAction>
            <Badge variant={ok ? "success" : "warning"}>{humanize(a.activeRule)}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {a.pickedConditionRange && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/50 px-3 py-2">
              <div className="flex items-center gap-2">
                <Zap className="size-4 text-primary" />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">Tier matched: {a.pickedConditionLabel}</span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">
                    {money(a.pickedConditionRange.min)} – {money(a.pickedConditionRange.max)}
                  </span>
                </div>
              </div>
              {ok && <Badge variant="success">STP eligible</Badge>}
            </div>
          )}
          <p className="text-sm text-muted-foreground">{a.recommendation}</p>
          <dl className="grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-3">
            <Metric label="OBV benchmark" value={money(a.benchmarkIdv)} foot="Very Good midpoint" />
            <Metric
              label="Deviation"
              value={`${requestedIdv >= a.benchmarkIdv ? "+" : "−"}${money(a.absoluteDelta)}`}
              foot={`${a.percentageDelta.toFixed(2)}%`}
            />
            <Metric
              label="Policy tolerance"
              value={`±${money(a.effectiveToleranceInr)}`}
              foot={`max(${money(a.absoluteTolerance)}, ${a.percentageTolerance}%)`}
            />
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Auto-approval corridor</CardTitle>
          <CardDescription>Good → Excellent bands plus policy tolerance. Outcome still follows the decision rules above.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div
            className="relative mx-2 mt-8"
            style={
              {
                "--floor": `${floorPct}%`,
                "--span": `${Math.max(2, pct(a.maxAllowedIdv) - floorPct)}%`,
                "--bench": `${pct(a.benchmarkIdv)}%`,
                "--pin": `${Math.max(9, Math.min(91, pct(requestedIdv)))}%`,
              } as React.CSSProperties
            }
          >
            <div className="relative h-3 overflow-hidden rounded-full bg-destructive/15">
              <div className="absolute inset-y-0 left-(--floor) w-(--span) bg-success/60" />
            </div>
            <div
              className="absolute -inset-y-1.5 left-(--bench) w-0.5 -translate-x-1/2 rounded-full bg-foreground"
              title="OBV benchmark"
            />
            <div className="pointer-events-none absolute -top-8 left-(--pin) -translate-x-1/2 transition-[left] duration-150">
              <Badge variant={ok ? "success" : "destructive"} className="font-mono tabular-nums">
                <Crosshair data-icon="inline-start" />
                {money(requestedIdv)}
              </Badge>
            </div>
          </div>
          <div className="flex justify-between gap-2 text-xs">
            <Bound label="Floor" value={a.minAllowedIdv} />
            <Bound label="Benchmark" value={a.benchmarkIdv} className="items-center" />
            <Bound label="Ceiling" value={a.maxAllowedIdv} className="items-end" />
          </div>
        </CardContent>
        {!ok && snapInsideCorridor && (
          <CardFooter className="flex-wrap justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              Adjust IDV to <span className="font-mono font-medium text-foreground tabular-nums">{money(snapTarget)}</span> to enter the corridor.
            </span>
            <Button size="sm" onClick={() => onRequestedIdvChange(snapTarget)}>
              Snap to {requestedIdv < a.minAllowedIdv ? "floor" : "ceiling"}
            </Button>
          </CardFooter>
        )}
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>What-if sensitivity</CardTitle>
          <CardDescription>Drag to test requested IDVs against the live rules.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Slider
            aria-label="Requested IDV"
            min={sliderMin}
            max={sliderMax}
            step={1000}
            value={[Math.max(sliderMin, Math.min(sliderMax, requestedIdv))]}
            onValueChange={([v]) => onRequestedIdvChange(v)}
          />
          <div className="flex justify-between font-mono text-xs text-muted-foreground tabular-nums">
            <span>{money(sliderMin)}</span>
            <span className="font-medium text-foreground">{money(requestedIdv)}</span>
            <span>{money(sliderMax)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value, foot }: { label: string; value: string; foot: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-base font-semibold tabular-nums">{value}</dd>
      <dd className="text-xs text-muted-foreground">{foot}</dd>
    </div>
  );
}

function Bound({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className={cn("flex flex-col", className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono font-medium tabular-nums">{money(value)}</span>
    </div>
  );
}
