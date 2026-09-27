import { CheckCircle2, ExternalLink, Target } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { money } from "@/lib/format";

export interface ConditionRange {
  min: number;
  max: number;
  midpoint: number;
  raw: string;
}

export interface ConditionSpectrumProps {
  conditions?: { good?: ConditionRange; veryGood?: ConditionRange; excellent?: ConditionRange } | null;
  requestedIdv?: number | null;
  sourceUrl?: string | null;
}

const TIERS = [
  { key: "good", label: "Good", bar: "bg-chart-2/50" },
  { key: "veryGood", label: "Very Good", bar: "bg-primary/60", benchmark: true },
  { key: "excellent", label: "Excellent", bar: "bg-success/60" },
] as const;

export function ConditionSpectrum({ conditions, requestedIdv, sourceUrl }: ConditionSpectrumProps) {
  const tiers = TIERS.flatMap((t) => (conditions?.[t.key] ? [{ ...t, data: conditions[t.key]! }] : []));
  if (!tiers.length) return null;

  const req = requestedIdv && requestedIdv > 0 ? requestedIdv : null;
  // Same precedence as the decision engine: Very Good, then Good, then Excellent.
  const matched = req
    ? (["veryGood", "good", "excellent"] as const).find((k) => {
        const r = conditions?.[k];
        return r && req >= r.min && req <= r.max;
      })
    : undefined;
  const matchedTier = tiers.find((t) => t.key === matched);

  // Scale the track to cover every band plus the requested value, with 4% padding.
  const lo = Math.min(...tiers.map((t) => t.data.min), req ?? Infinity);
  const hi = Math.max(...tiers.map((t) => t.data.max), req ?? -Infinity);
  const pad = (hi - lo) * 0.04 || 1;
  const pos = (v: number) => ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 100;

  return (
    <section aria-label="OBV condition spectrum" className="flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            OBV condition spectrum
            <Badge variant="secondary">{tiers.length}-tier valuation</Badge>
          </h3>
          <p className="text-xs text-muted-foreground">Market valuation ranges by vehicle condition from OrangeBookValue</p>
        </div>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            View on OBV <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      {matchedTier && req && (
        <Alert className="border-success/30 bg-success/5 text-success">
          <CheckCircle2 />
          <AlertTitle>Within {matchedTier.label} condition band</AlertTitle>
          <AlertDescription>
            Requested IDV <strong className="font-mono">{money(req)}</strong> falls inside the {matchedTier.label} range and qualifies
            under the condition-band policy.
          </AlertDescription>
        </Alert>
      )}

      <div className="relative h-10 pt-4" role="img" aria-label={`Requested IDV ${req ? money(req) : "not set"} against condition bands`}>
        <div className="relative h-3 rounded-full bg-muted">
          {tiers.map((t) => (
            <Tooltip key={t.key}>
              <TooltipTrigger asChild>
                <div
                  className={cn("absolute inset-y-0 rounded-full mix-blend-multiply dark:mix-blend-screen", t.bar)}
                  style={{ left: pos(t.data.min) + "%", width: pos(t.data.max) - pos(t.data.min) + "%" }}
                />
              </TooltipTrigger>
              <TooltipContent>
                {t.label}: {money(t.data.min)} – {money(t.data.max)}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        {req && (
          <div className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: pos(req) + "%" }}>
            <Target className="size-3.5 text-foreground" />
            <div className="h-5 w-0.5 rounded-full bg-foreground" />
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {tiers.map((t) => {
          const selected = t.key === matched;
          return (
            <div key={t.key} className={cn("flex flex-col gap-2 rounded-lg border p-3", selected && "border-success ring-3 ring-success/15")}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs font-semibold">
                  <span className={cn("size-2 rounded-full", t.bar)} />
                  {t.label}
                </span>
                {selected ? (
                  <Badge variant="success">
                    <CheckCircle2 data-icon="inline-start" />
                    Match
                  </Badge>
                ) : "benchmark" in t ? (
                  <Badge variant="outline">Benchmark</Badge>
                ) : null}
              </div>
              <div className="font-mono text-sm font-semibold tabular-nums">
                {money(t.data.min)} – {money(t.data.max)}
              </div>
              <div className="flex justify-between border-t pt-2 text-xs text-muted-foreground">
                <span>Midpoint</span>
                <span className="font-mono tabular-nums text-foreground">{money(t.data.midpoint)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
