import { Car } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfidenceMeter } from "@/components/status";
import { EmptyRow, PageHeader } from "@/components/console";
import { loadDecisionConfig } from "@/src/server/idv-config";

export const metadata = { title: "Vehicle resolution" };

export default async function Vehicles() {
  const supabase = await createClient();
  const [{ data }, config] = await Promise.all([
    supabase
      .from("vehicle_resolutions")
      .select("*, referral_cases(external_case_id,registration_number,make_raw,model_raw,variant_raw)")
      .order("created_at", { ascending: false })
      .limit(200),
    loadDecisionConfig(supabase),
  ]);
  const rows = data ?? [];
  const threshold = config.minimumVehicleConfidence;
  const below = rows.filter((x) => x.confidence_score != null && Number(x.confidence_score) < threshold).length;

  return (
    <>
      <PageHeader
        eyebrow="Engine"
        title="Vehicle resolution"
        description="Inspect normalisation, match strategy and confidence for each resolved vehicle."
      />
      <Card className="pb-0">
        <CardHeader>
          <CardTitle>Recent resolutions</CardTitle>
          <CardDescription>
            {rows.length} records · {below} below the {(threshold * 100).toFixed(0)}% confidence threshold
          </CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Case</TableHead>
              <TableHead>Raw input</TableHead>
              <TableHead>Resolved vehicle</TableHead>
              <TableHead>Strategy</TableHead>
              <TableHead className="pr-4">Confidence</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((x) => {
              const c = x.referral_cases;
              return (
                <TableRow key={x.id}>
                  <TableCell className="pl-4">
                    <div className="font-medium">{c?.external_case_id ?? "—"}</div>
                    <div className="font-mono text-xs text-muted-foreground">{c?.registration_number ?? "No registration"}</div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{[c?.make_raw, c?.model_raw, c?.variant_raw].filter(Boolean).join(" ") || "—"}</TableCell>
                  <TableCell>
                    <div className="font-medium">{[x.resolved_make, x.resolved_model, x.resolved_variant].filter(Boolean).join(" ") || "Unresolved"}</div>
                    <div className="text-xs text-muted-foreground">
                      {x.normalized_fuel || "Fuel n/a"} · {x.normalized_cc || "CC n/a"} CC
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="info">{x.candidate_source}</Badge>
                    <div className="mt-1 text-xs text-muted-foreground">{x.match_strategy || "—"}</div>
                  </TableCell>
                  <TableCell className="pr-4">
                    <ConfidenceMeter score={x.confidence_score == null ? null : Number(x.confidence_score)} threshold={threshold} />
                  </TableCell>
                </TableRow>
              );
            })}
            {!rows.length && <EmptyRow colSpan={5} icon={Car} title="No vehicle resolutions yet" />}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
