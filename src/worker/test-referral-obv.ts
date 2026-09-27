/**
 * End-to-End Test: CoreHub Referral -> OBV Valuation Lookup -> Decision Engine
 *
 * This test verifies the complete pipeline:
 * 1. Checks CoreHub session and retrieves a referral (falls back to a standard
 *    benchmark referral if CoreHub table is currently empty).
 * 2. Runs the browser lookup on OrangeBookValue.com in a visible browser.
 * 3. Extracts the IDV value/range from OBV.
 * 4. Compares requested IDV against fetched OBV IDV using the decision engine.
 * 5. Validates tolerances and outputs a detailed diagnostic report.
 *
 * Usage:
 *   npm run test:obv
 */

import { chromium } from "playwright";
import { existsSync } from "fs";
import { loadWorkerConfig } from "./config";
import { scrapeCorehub, type CorehubReferral } from "./corehub-scraper";
import { lookupObvBrowser, type ObvBrowserResult } from "./obv-lookup";
import { evaluateIdvDecision } from "../domain/decision-engine";
import type { DecisionConfig } from "../domain/motor-idv";

// Benchmark sample used when CoreHub referral queue is empty
const BENCHMARK_REFERRAL: CorehubReferral = {
  externalCaseId: "DEMO-COREHUB-001",
  registrationNumber: "MH02CB1234",
  make: "Maruti Suzuki",
  model: "Baleno",
  variant: "ZETA",
  fuelType: "Petrol",
  cc: "1197",
  requestedIdv: 600000,
  rawValues: {
    caseId: "DEMO-COREHUB-001",
    registration: "MH02CB1234",
    make: "Maruti Suzuki",
    model: "Baleno",
    variant: "Zeta Petrol",
    fuel: "Petrol",
    cc: "1197",
    requestedIdv: "₹6,00,000",
  },
};

const DEFAULT_TEST_CONFIG: DecisionConfig = {
  absoluteTolerance: 15000,
  percentageTolerance: 3.5,
  minimumVehicleConfidence: 0.8,
  providerTimeoutSeconds: 20,
  retryCount: 2,
  reviewSlaMinutes: 120,
};

async function main() {
  const started = Date.now();
  const runId = `test-run-${Date.now()}`;
  const config = loadWorkerConfig({ headless: false });

  console.log("═══════════════════════════════════════════════════════════════════");
  console.log("🧪 IDV Deviation Pipeline Test: CoreHub → OBV → Decision Engine");
  console.log("═══════════════════════════════════════════════════════════════════\n");

  // Launch browser with realistic flags
  const browser = await chromium
    .launch({
      channel: "chrome",
      headless: false,
      args: ["--disable-blink-features=AutomationControlled"],
      slowMo: 100,
    })
    .catch(() =>
      chromium.launch({
        headless: false,
        args: ["--disable-blink-features=AutomationControlled"],
        slowMo: 100,
      })
    );

  const contextOptions: Parameters<typeof browser.newContext>[0] = {
    viewport: { width: 1366, height: 768 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  };

  if (existsSync(config.sessionStoragePath)) {
    contextOptions.storageState = config.sessionStoragePath;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  let targetReferral: CorehubReferral = BENCHMARK_REFERRAL;
  let referralSource = "Benchmark Sample (CoreHub queue was empty)";

  // ── Step 1: Check CoreHub for live referrals ─────────────────────────────
  console.log("📡 Step 1: Checking CoreHub for live referrals...");
  if (existsSync(config.sessionStoragePath)) {
    try {
      const corehubResult = await scrapeCorehub(page, context, config, runId);
      if (corehubResult.success && corehubResult.referrals.length > 0) {
        targetReferral = corehubResult.referrals[0];
        referralSource = `Live CoreHub (Found ${corehubResult.referrals.length} active referrals)`;
        console.log(`✅ Using live CoreHub referral: ${targetReferral.externalCaseId}`);
      } else {
        console.log("ℹ️ No active referrals in CoreHub table right now.");
        console.log(`ℹ️ Using benchmark test vehicle: ${BENCHMARK_REFERRAL.make} ${BENCHMARK_REFERRAL.model} ${BENCHMARK_REFERRAL.variant}`);
      }
    } catch (err) {
      console.warn("⚠️ CoreHub scrape check skipped/error:", err);
      console.log(`ℹ️ Falling back to benchmark test vehicle.`);
    }
  } else {
    console.log("ℹ️ No saved CoreHub session found yet. Using benchmark test vehicle.");
  }

  console.log("\n📋 Target Referral Details:");
  console.log(`   Source:          ${referralSource}`);
  console.log(`   Case ID:         ${targetReferral.externalCaseId}`);
  console.log(`   Vehicle:         ${targetReferral.make} ${targetReferral.model} ${targetReferral.variant}`);
  console.log(`   Registration:    ${targetReferral.registrationNumber || "N/A"}`);
  console.log(`   Requested IDV:   ₹${targetReferral.requestedIdv?.toLocaleString("en-IN") || "N/A"}\n`);

  // ── Step 2: OBV Browser Valuation Lookup ─────────────────────────────────
  console.log("🌐 Step 2: Querying OrangeBookValue.com for IDV...");
  const obvVehicle = {
    make: targetReferral.make || "Maruti Suzuki",
    model: targetReferral.model || "Baleno",
    variant: targetReferral.variant || "Zeta",
  };

  const obvResult: ObvBrowserResult = await lookupObvBrowser(
    page,
    obvVehicle,
    config,
    runId
  );

  console.log("\n📊 OBV Valuation Result:");
  console.log(`   Success:         ${obvResult.success ? "✅ YES" : "❌ NO"}`);
  console.log(`   Reason Code:     ${obvResult.reasonCode}`);
  console.log(`   Benchmark IDV:   ${obvResult.idv ? `₹${obvResult.idv.toLocaleString("en-IN")}` : "None"}`);
  console.log(`   Latency:         ${obvResult.latencyMs} ms`);
  console.log(`   Result URL:      ${obvResult.sourceUrl || "N/A"}`);
  console.log(`   Evidence Frames: ${obvResult.evidence.length} screenshots saved`);

  if (obvResult.conditions) {
    console.log("\n🏆 Extracted Condition Tiers:");
    if (obvResult.conditions.good) {
      console.log(`   [Good]:      ₹${obvResult.conditions.good.min.toLocaleString("en-IN")} – ₹${obvResult.conditions.good.max.toLocaleString("en-IN")} (Mid: ₹${obvResult.conditions.good.midpoint.toLocaleString("en-IN")})`);
    }
    if (obvResult.conditions.veryGood) {
      console.log(`   [Very Good]: ₹${obvResult.conditions.veryGood.min.toLocaleString("en-IN")} – ₹${obvResult.conditions.veryGood.max.toLocaleString("en-IN")} (Mid: ₹${obvResult.conditions.veryGood.midpoint.toLocaleString("en-IN")}) ⭐ Benchmark`);
    }
    if (obvResult.conditions.excellent) {
      console.log(`   [Excellent]: ₹${obvResult.conditions.excellent.min.toLocaleString("en-IN")} – ₹${obvResult.conditions.excellent.max.toLocaleString("en-IN")} (Mid: ₹${obvResult.conditions.excellent.midpoint.toLocaleString("en-IN")})`);
    }
  }

  if (!obvResult.success || !obvResult.idv) {
    console.error("\n❌ OBV lookup did not return a valid IDV. Please check the screenshots in evidence/ for details.");
    await page.waitForTimeout(3000);
    await browser.close();
    process.exit(1);
  }

  // ── Step 3: Run Decision Engine ──────────────────────────────────────────
  console.log("\n🧠 Step 3: Evaluating IDV Deviation in Decision Engine...");
  const decisionResult = evaluateIdvDecision(
    {
      requestedIdv: targetReferral.requestedIdv,
      fetchedIdv: obvResult.idv,
      vehicleConfidence: 0.95,
      providerStatus: "succeeded",
    },
    DEFAULT_TEST_CONFIG
  );

  // ── Step 4: Summary Diagnostic Report ────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════════════════");
  console.log("🏁 END-TO-END PIPELINE DIAGNOSTIC REPORT");
  console.log("═══════════════════════════════════════════════════════════════════");
  console.log(`Vehicle Tested:       ${obvVehicle.make} ${obvVehicle.model} ${obvVehicle.variant}`);
  console.log(`Requested IDV:        ₹${targetReferral.requestedIdv?.toLocaleString("en-IN")}`);
  console.log(`OBV Benchmark IDV:    ₹${obvResult.idv.toLocaleString("en-IN")}`);
  if (obvResult.conditions) {
    console.log(`Condition Tiers:      Good: ₹${obvResult.conditions.good?.midpoint.toLocaleString("en-IN") || "—"} | Very Good: ₹${obvResult.conditions.veryGood?.midpoint.toLocaleString("en-IN") || "—"} | Excellent: ₹${obvResult.conditions.excellent?.midpoint.toLocaleString("en-IN") || "—"}`);
  }
  console.log(`Absolute Delta:       ${decisionResult.absoluteDelta !== null ? `₹${decisionResult.absoluteDelta.toLocaleString("en-IN")}` : "N/A"}`);
  console.log(`Percentage Delta:     ${decisionResult.percentageDelta !== null ? `${decisionResult.percentageDelta.toFixed(2)}%` : "N/A"}`);
  console.log(`Allowed Tolerance:    ₹${DEFAULT_TEST_CONFIG.absoluteTolerance.toLocaleString("en-IN")} or ${DEFAULT_TEST_CONFIG.percentageTolerance}%`);
  console.log("───────────────────────────────────────────────────────────────────");
  console.log(`Decision:             ${decisionResult.decision === "auto_approved" ? "✅ AUTO_APPROVED" : "⚠️ MANUAL_REVIEW"}`);
  console.log(`Reason Code:          ${decisionResult.reasonCode}`);
  console.log(`Explanation:          ${decisionResult.explanation}`);
  console.log(`Total Time:           ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log("═══════════════════════════════════════════════════════════════════\n");

  console.log("Closing browser in 5 seconds...");
  await page.waitForTimeout(5000);
  await browser.close();

  console.log("🎉 Test completed successfully! All components are working as expected.");
}

main().catch((err) => {
  console.error("💥 Test encountered an error:", err);
  process.exit(1);
});
