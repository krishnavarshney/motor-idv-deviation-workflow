import { strict as assert } from "node:assert";
import { runIdvWorkflow } from "../src/workflow/idv-workflow";
import type { ObvConnector } from "../src/connectors/obv/types";

async function main() {
  const cfg = {
    absoluteTolerance: 5000,
    percentageTolerance: 2,
    minimumVehicleConfidence: 0.85,
    providerTimeoutSeconds: 4,
    retryCount: 2,
    reviewSlaMinutes: 240,
  };
  const providerInput = {
    make: "Maruti Suzuki",
    model: "Baleno",
    variant: "Zeta AMT",
    fuelType: "Petrol",
    cc: 1197,
  };
  const ok: ObvConnector = {
    lookup: async () => ({
      provider: "obv",
      success: true,
      currency: "INR",
      latencyMs: 20,
      idv: 500000,
    }),
  };
  const down: ObvConnector = {
    lookup: async () => ({
      provider: "obv",
      success: false,
      currency: "INR",
      latencyMs: 20,
      reasonCode: "PROVIDER_UNAVAILABLE",
    }),
  };

  const a = await runIdvWorkflow({
    requestedIdv: 500000,
    vehicleConfidence: 0.95,
    providerInput,
    config: cfg,
    obv: ok,
  });
  assert.equal(a.decision.decision, "auto_approved");

  const b = await runIdvWorkflow({
    requestedIdv: 500000,
    vehicleConfidence: 0.95,
    providerInput,
    config: cfg,
    obv: down,
  });
  assert.equal(b.decision.decision, "manual_review");
  assert.equal(b.attempts, 3);

  const flaky: ObvConnector = {
    lookup: async () => ({
      provider: "obv",
      success: false,
      currency: "INR",
      latencyMs: 1,
      reasonCode: "TIMEOUT",
    }),
  };
  const c = await runIdvWorkflow({
    requestedIdv: 500000,
    vehicleConfidence: 0.95,
    providerInput,
    config: cfg,
    obv: flaky,
  });
  assert.equal(c.decision.reasonCode, "PROVIDER_FAILURE");
  assert.equal(c.attempts, 3);
  console.log("workflow tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});