import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { OperationsShell } from "@/components/operations-shell";
import { loadDecisionConfig } from "@/src/server/idv-config";
import { SimulateClient } from "@/components/simulate-client";
import { FlaskConical, ShieldCheck, Sparkles } from "lucide-react";

export default async function SimulatePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Load live decision configuration
  const decisionConfig = await loadDecisionConfig(supabase);

  // Load recent real referral cases for quick testing
  const { data: recentCases } = await supabase
    .from("referral_cases")
    .select(
      "id, external_case_id, make_raw, model_raw, variant_raw, requested_idv, referral_status, metadata"
    )
    .order("created_at", { ascending: false })
    .limit(8);

  return (
    <OperationsShell userEmail={user.email ?? ""}>
      <main className="content">
        <div className="page-head">
          <div>
            <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <FlaskConical size={14} /> Underwriting Intelligence / Simulator
            </div>
            <h1 className="page-title">IDV Deviation & Allowance Simulator</h1>
            <div className="subtext">
              Simulate CoreHub referral inputs (Make, Model, Variant, YOM, Requested IDV), extract OBV condition spectrum ranges, and compute permissible auto-approval corridors.
            </div>
          </div>

          <div className="top-actions">
            <span className="badge badge-success">
              <ShieldCheck size={12} /> Live Policy Config Active
            </span>
            <span className="badge badge-info">
              <Sparkles size={12} /> 3-Tier Valuation Enabled
            </span>
          </div>
        </div>

        <SimulateClient
          decisionConfig={decisionConfig}
          recentCases={recentCases ?? []}
          userEmail={user.email ?? ""}
        />
      </main>
    </OperationsShell>
  );
}