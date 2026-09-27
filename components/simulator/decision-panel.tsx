"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { animate, useReducedMotion } from "motion/react";
import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceLine, XAxis, YAxis } from "recharts";
import { CheckCircle2, Info, TriangleAlert } from "lucide-react";
import type { DecisionAllowanceAnalysis, SimulatedConditionSpectrum } from "@/lib/idv-simulator-engine";
import { evaluateIdvDecision } from "@/src/domain/decision-engine";
import type { DecisionConfig } from "@/src/domain/motor-idv";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DigitSwap } from "@/components/motion/digit-swap";
import { MagicCard } from "@/components/ui/magic-card";

/** Info icon with a tooltip, placed next to a policy term. */
export function InfoTip({ term, children }: { term: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label={`About ${term}`} className="text-muted-foreground">
          <Info />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  );
}

/** Rolling digits that enter from above when the value rises and below when it falls. */
export function Rolling({ value, text, className }: { value: number; text: string; className?: string }) {
  const prev = useRef(value);
  const direction = value >= prev.current ? "up" : "down";
  useEffect(() => {
    prev.current = value;
  }, [value]);
  return <DigitSwap value={text} direction={direction} className={cn("font-mono tabular-nums", className)} />;
}

/** Tween a number toward its target (used to glide the chart marker). */
function useTweened(target: number) {
  const reduce = useReducedMotion();
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (reduce) {
      from.current = target;
      setV(target);
      return;
    }
    const c = animate(from.current, target, { duration: 0.35, ease: [0.16, 1, 0.3, 1], onUpdate: (x) => ((from.current = x), setV(x)) });
    return () => c.stop();
  }, [target, reduce]);
  return v;
}

export function VerdictCard({ analysis, explanation }: { analysis: DecisionAllowanceAnalysis; explanation: string }) {
  const a = analysis;
  const ok = a.isAllowed;
  const signed = a.requestedIdv >= a.benchmarkIdv ? "+" : "−";
  return (
    <MagicCard className="rounded-xl">
      <Card className="bg-transparent ring-0">
        <CardHeader>
          <CardDescription>Underwriting decision</CardDescription>
          <CardTitle
            key={`${ok}-${a.activeRule}`}
            className={cn(
              "flex items-center gap-2 text-xl font-semibold duration-300 animate-in fade-in zoom-in-95 blur-in-sm",
              ok ? "text-success" : "text-warning",
            )}
          >
            {ok ? <CheckCircle2 className="size-6" /> : <TriangleAlert className="size-6" />}
            {ok ? "Auto-approve" : "Manual review"}
          </CardTitle>
          <CardAction className="flex flex-col items-end gap-1">
            <Badge key={a.activeRule} variant="outline" className="font-mono duration-300 animate-in fade-in slide-in-from-right-2">
              {a.activeRule}
            </Badge>
            {a.pickedConditionLabel && <Badge variant="secondary">{a.pickedConditionLabel}</Badge>}
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p key={explanation} className="text-sm text-muted-foreground duration-300 animate-in fade-in">
            {explanation}
          </p>
          <dl className="grid grid-cols-1 gap-3 rounded-lg border p-3 sm:grid-cols-3">
            <Metric
              label="OBV benchmark"
              tip="Very Good condition midpoint from OBV. Manual entry uses the value you typed."
              value={<Rolling value={a.benchmarkIdv} text={money(a.benchmarkIdv)} />}
              foot="Very Good midpoint"
            />
            <Metric
              label="Deviation"
              tip="|Requested − benchmark|, and that gap as a % of the benchmark."
              value={<Rolling value={a.requestedIdv - a.benchmarkIdv} text={`${signed}${money(a.absoluteDelta)}`} />}
              foot={`${a.percentageDelta.toFixed(2)}% of benchmark`}
            />
            <Metric
              label="Policy tolerance"
              tip={`Approve if deviation ≤ ${money(a.absoluteTolerance)} or ≤ ${a.percentageTolerance}% of benchmark, whichever is wider. Condition bands are checked first.`}
              value={<Rolling value={a.effectiveToleranceInr} text={`±${money(a.effectiveToleranceInr)}`} />}
              foot={`max(${money(a.absoluteTolerance)}, ${a.percentageTolerance}%)`}
            />
          </dl>
        </CardContent>
      </Card>
    </MagicCard>
  );
}

function Metric({ label, tip, value, foot }: { label: string; tip: string; value: ReactNode; foot: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="flex items-center gap-0.5 text-xs text-muted-foreground">
        {label}
        <InfoTip term={label}>{tip}</InfoTip>
      </dt>
      <dd className="font-mono text-base font-semibold tabular-nums">{value}</dd>
      <dd key={foot} className="text-xs text-muted-foreground duration-300 animate-in fade-in">
        {foot}
      </dd>
    </div>
  );
}

const chartConfig = {
  approve: { label: "Auto-approve", color: "var(--success)" },
  review: { label: "Manual review", color: "var(--warning)" },
} satisfies ChartConfig;

const TIERS = [
  ["good", "Good"],
  ["veryGood", "Very Good"],
  ["excellent", "Excellent"],
] as const;

const lakh = (v: number) => `${(v / 100000).toFixed(1)}L`;

type Point = { idv: number; approve: number; review: number; reason: string };

export function OutcomeChart({
  spectrum,
  requestedIdv,
  confidence,
  config,
  onPick,
}: {
  spectrum: SimulatedConditionSpectrum;
  requestedIdv: number;
  confidence: number;
  config: DecisionConfig;
  onPick: (idv: number) => void;
}) {
  const bench = spectrum.benchmarkIdv;
  const bandMin = Math.min(...TIERS.map(([k]) => spectrum[k].min));
  const bandMax = Math.max(...TIERS.map(([k]) => spectrum[k].max));
  const lo = Math.max(0, Math.round(Math.min(bandMin * 0.85, requestedIdv * 0.98)));
  const hi = Math.round(Math.max(bandMax * 1.15, requestedIdv * 1.02));

  const marker = useTweened(requestedIdv);
  const [ripple, setRipple] = useState<{ x: number; y: number; id: number } | null>(null);

  const data = useMemo<Point[]>(() => {
    const tol = Math.max(config.absoluteTolerance, Math.round(bench * (config.percentageTolerance / 100)));
    // ~120 even samples plus every rule edge, so step transitions land exactly on band/tolerance limits.
    const xs = new Set<number>(Array.from({ length: 121 }, (_, i) => Math.round(lo + ((hi - lo) * i) / 120)));
    for (const [k] of TIERS) [spectrum[k].min, spectrum[k].max, spectrum[k].max + 1].forEach((x) => xs.add(x));
    [bench - tol - 1, bench - tol, bench + tol, bench + tol + 1].forEach((x) => xs.add(x));
    return [...xs]
      .filter((x) => x >= lo && x <= hi)
      .sort((x, y) => x - y)
      .map((idv) => {
        const r = evaluateIdvDecision(
          { requestedIdv: idv, fetchedIdv: bench, vehicleConfidence: confidence, providerStatus: "succeeded", conditions: spectrum },
          config,
        );
        const ok = r.decision === "auto_approved";
        return { idv, approve: ok ? 1 : 0, review: ok ? 0 : 1, reason: r.reasonCode };
      });
  }, [spectrum, bench, confidence, config, lo, hi]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outcome by requested IDV</CardTitle>
        <CardDescription>Each point runs the live decision rules. Click the chart to set the requested IDV.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {ripple && (
            <span
              key={ripple.id}
              aria-hidden
              className="pointer-events-none absolute z-10 size-8 -translate-1/2 rounded-full border-2 border-foreground/60 animate-out fade-out zoom-out-150 duration-500 fill-mode-forwards"
              style={{ left: ripple.x, top: ripple.y }}
            />
          )}
          <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full cursor-crosshair">
            <AreaChart
              data={data}
              margin={{ top: 18, right: 8, left: 8, bottom: 0 }}
              onClick={(s) => {
                const p = data[Number(s?.activeIndex)];
                if (!p) return;
                const pos = s as unknown as { chartX?: number; chartY?: number };
                if (pos.chartX != null && pos.chartY != null) setRipple({ x: pos.chartX, y: pos.chartY, id: Date.now() });
                onPick(Math.round(p.idv / 1000) * 1000);
              }}
            >
              <CartesianGrid vertical={false} />
              <XAxis dataKey="idv" type="number" domain={[lo, hi]} tickFormatter={lakh} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis hide domain={[0, 1.15]} />
              {TIERS.map(([k, label]) => (
                <ReferenceArea
                  key={k}
                  x1={spectrum[k].min}
                  x2={spectrum[k].max}
                  fill="var(--foreground)"
                  fillOpacity={0.05}
                  label={{ value: label, position: "insideTop", fill: "var(--muted-foreground)", fontSize: 10 }}
                />
              ))}
              <Area
                dataKey="approve"
                type="stepAfter"
                stroke="var(--color-approve)"
                fill="var(--color-approve)"
                fillOpacity={0.35}
                animationDuration={500}
                animationEasing="ease-out"
              />
              <Area
                dataKey="review"
                type="stepAfter"
                stroke="var(--color-review)"
                fill="var(--color-review)"
                fillOpacity={0.2}
                animationDuration={500}
                animationEasing="ease-out"
              />
              <ReferenceLine
                x={bench}
                stroke="var(--foreground)"
                strokeDasharray="4 4"
                label={{ value: "Benchmark", position: "top", fill: "var(--foreground)", fontSize: 10 }}
              />
              <ReferenceLine
                x={marker}
                stroke="var(--primary)"
                strokeWidth={2}
                ifOverflow="extendDomain"
                label={{ value: "Requested", position: "insideBottomRight", fill: "var(--primary)", fontSize: 10 }}
              />
              <ChartTooltip
                cursor={{ stroke: "var(--foreground)", strokeOpacity: 0.35, strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  const p = payload?.[0]?.payload as Point | undefined;
                  if (!active || !p) return null;
                  return (
                    <div className="grid gap-1 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
                      <span className="font-mono font-medium tabular-nums">{money(p.idv)}</span>
                      <span className={cn("flex items-center gap-1", p.approve ? "text-success" : "text-warning")}>
                        {p.approve ? <CheckCircle2 className="size-3" /> : <TriangleAlert className="size-3" />}
                        {p.approve ? "Auto-approve" : "Manual review"}
                      </span>
                      <span className="font-mono text-muted-foreground">{p.reason}</span>
                    </div>
                  );
                }}
              />
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        </div>
      </CardContent>
    </Card>
  );
}
