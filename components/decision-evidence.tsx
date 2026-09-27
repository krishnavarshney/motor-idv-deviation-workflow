import { ArrowRight, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConditionSpectrum } from "@/components/condition-spectrum";
import { Stat } from "@/components/console";
import { ConfidenceMeter } from "@/components/status";
import { money } from "@/lib/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function DecisionEvidence({ decision, idv, requestedIdv, fallbackExplanation }: {
  decision: any;
  idv: any;
  requestedIdv: unknown;
  fallbackExplanation?: string;
}) {
  const raw = idv?.raw_response as any;
  const requested = decision?.requested_idv ?? requestedIdv;
  const explanation = decision?.decision_reason_details?.explanation ?? fallbackExplanation;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Decision evidence</CardTitle>
        <CardDescription>Requested IDV compared with the OrangeBookValue reference</CardDescription>
        <CardAction>
          <Badge variant="outline" className="font-mono">
            {decision?.decision_reason_code ?? "PENDING"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <Stat label="Requested IDV" value={<span className="font-mono">{money(requested)}</span>} />
          <ArrowRight className="mx-auto hidden size-4 text-muted-foreground sm:block" />
          <Stat label="OBV reference IDV" value={<span className="font-mono">{money(decision?.fetched_idv ?? idv?.fetched_idv)}</span>} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Absolute delta" value={<span className="font-mono text-base">{money(decision?.absolute_delta)}</span>} />
          <Stat
            label="Percentage delta"
            value={
              <span className="font-mono text-base">
                {decision?.percentage_delta == null ? "—" : Number(decision.percentage_delta).toFixed(2) + "%"}
              </span>
            }
          />
        </div>
        {explanation && (
          <Alert>
            <Info />
            <AlertTitle>Why this decision?</AlertTitle>
            <AlertDescription>{explanation}</AlertDescription>
          </Alert>
        )}
        <ConditionSpectrum conditions={raw?.conditions} requestedIdv={Number(requested ?? 0)} sourceUrl={raw?.sourceUrl} />
      </CardContent>
    </Card>
  );
}

export function VehicleCard({ resolution, fallback }: { resolution: any; fallback: any }) {
  const name = [resolution?.resolved_make, resolution?.resolved_model, resolution?.resolved_variant].filter(Boolean).join(" ") || "Unresolved";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Resolved vehicle</CardTitle>
        <CardDescription>Normalised identity used for the valuation lookup</CardDescription>
        <CardAction>
          <Badge variant="info">{resolution?.match_strategy ?? "unresolved"}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div>
          <div className="text-lg font-semibold tracking-tight">{name}</div>
          <div className="text-sm text-muted-foreground">
            {resolution?.normalized_fuel || fallback?.fuel_type_raw || "Fuel n/a"} · {resolution?.normalized_cc || fallback?.cc_raw || "CC n/a"} CC
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg bg-muted/50 px-3 py-2">
          <span className="text-xs text-muted-foreground">Match confidence</span>
          <ConfidenceMeter score={resolution?.confidence_score == null ? null : Number(resolution.confidence_score)} />
        </div>
      </CardContent>
    </Card>
  );
}
