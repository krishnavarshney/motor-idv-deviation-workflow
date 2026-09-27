import { ShieldCheck, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { loadDecisionConfig } from "@/src/server/idv-config";
import { SimulateClient } from "@/components/simulate-client";
import { PageHeader } from "@/components/console";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Simulator" };

export default async function SimulatePage() {
  const supabase = await createClient();
  const [decisionConfig, { data: recentCases }] = await Promise.all([
    loadDecisionConfig(supabase),
    supabase
      .from("referral_cases")
      .select("id, external_case_id, make_raw, model_raw, variant_raw, requested_idv, referral_status, metadata")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Underwriting intelligence"
        title="IDV deviation simulator"
        description="Simulate CoreHub referral inputs, extract the OBV condition spectrum and test requested IDVs against the live auto-approval rules."
        actions={
          <>
            <Badge variant="success">
              <ShieldCheck data-icon="inline-start" />
              Live policy config
            </Badge>
            <Badge variant="info">
              <Sparkles data-icon="inline-start" />
              3-tier valuation
            </Badge>
          </>
        }
      />
      <SimulateClient decisionConfig={decisionConfig} recentCases={recentCases ?? []} />
    </>
  );
}
