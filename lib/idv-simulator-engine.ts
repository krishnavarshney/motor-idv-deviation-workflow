/**
 * IDV Simulator Engine & Valuation Intelligence
 *
 * Provides:
 * 1. Realistic actuarial OBV depreciation models across vehicle makes, models, variants & YOM.
 * 2. 3-Tier Condition Spectrum calculation (Good, Very Good Benchmark, Excellent).
 * 3. Exact Underwriter Allowed IDV corridor computation (Min & Max auto-approvable IDVs).
 * 4. Preset CoreHub referral cases for fast one-click simulation.
 */

import type { ConditionRange } from "@/components/condition-spectrum";
import type { ConditionTierKey, DecisionConfig, DecisionReasonCode } from "@/src/domain/motor-idv";
import { evaluateIdvDecision } from "@/src/domain/decision-engine";

export interface VehicleCatalogEntry {
  make: string;
  model: string;
  variants: { name: string; exShowroom: number; fuel: string; cc: number }[];
}

export const POPULAR_VEHICLES: VehicleCatalogEntry[] = [
  {
    make: "Maruti Suzuki",
    model: "Baleno",
    variants: [
      { name: "Zeta Petrol", exShowroom: 840000, fuel: "Petrol", cc: 1197 },
      { name: "Alpha Petrol", exShowroom: 940000, fuel: "Petrol", cc: 1197 },
      { name: "Delta AMT", exShowroom: 800000, fuel: "Petrol", cc: 1197 },
      { name: "Sigma Petrol", exShowroom: 670000, fuel: "Petrol", cc: 1197 },
    ],
  },
  {
    make: "Maruti Suzuki",
    model: "Swift",
    variants: [
      { name: "VXI Petrol", exShowroom: 730000, fuel: "Petrol", cc: 1197 },
      { name: "ZXI+ Dual Tone", exShowroom: 900000, fuel: "Petrol", cc: 1197 },
      { name: "LXI Petrol", exShowroom: 650000, fuel: "Petrol", cc: 1197 },
      { name: "VXI CNG", exShowroom: 820000, fuel: "CNG", cc: 1197 },
    ],
  },
  {
    make: "Hyundai",
    model: "Creta",
    variants: [
      { name: "SX 1.5 Petrol", exShowroom: 1530000, fuel: "Petrol", cc: 1497 },
      { name: "SX(O) Diesel AT", exShowroom: 2000000, fuel: "Diesel", cc: 1493 },
      { name: "EX 1.5 Petrol", exShowroom: 1220000, fuel: "Petrol", cc: 1497 },
      { name: "S+ Knight Edition", exShowroom: 1400000, fuel: "Petrol", cc: 1497 },
    ],
  },
  {
    make: "Tata",
    model: "Nexon",
    variants: [
      { name: "Creative Plus Petrol", exShowroom: 1170000, fuel: "Petrol", cc: 1199 },
      { name: "Fearless Plus S Diesel", exShowroom: 1500000, fuel: "Diesel", cc: 1497 },
      { name: "Pure Petrol", exShowroom: 980000, fuel: "Petrol", cc: 1199 },
      { name: "Smart Plus Petrol", exShowroom: 890000, fuel: "Petrol", cc: 1199 },
    ],
  },
  {
    make: "Honda",
    model: "City",
    variants: [
      { name: "V CVT Petrol", exShowroom: 1360000, fuel: "Petrol", cc: 1498 },
      { name: "ZX CVT Petrol", exShowroom: 1610000, fuel: "Petrol", cc: 1498 },
      { name: "V MT Petrol", exShowroom: 1210000, fuel: "Petrol", cc: 1498 },
    ],
  },
  {
    make: "Mahindra",
    model: "Thar",
    variants: [
      { name: "LX 4-Str Hard Top Diesel", exShowroom: 1680000, fuel: "Diesel", cc: 2184 },
      { name: "AX Opt 4-Str Petrol", exShowroom: 1410000, fuel: "Petrol", cc: 1997 },
    ],
  },
  {
    make: "Mahindra",
    model: "Scorpio-N",
    variants: [
      { name: "Z8L Diesel AT", exShowroom: 2450000, fuel: "Diesel", cc: 2184 },
      { name: "Z8 Diesel MT", exShowroom: 2100000, fuel: "Diesel", cc: 2184 },
      { name: "Z4 Diesel MT", exShowroom: 1650000, fuel: "Diesel", cc: 2184 },
      { name: "LX 4-Str Hard Top Diesel", exShowroom: 2150000, fuel: "Diesel", cc: 2184 },
      { name: "Z2 Petrol MT", exShowroom: 1380000, fuel: "Petrol", cc: 1997 },
    ],
  },
  {
    make: "Kia",
    model: "Seltos",
    variants: [
      { name: "HTX 1.5 Petrol", exShowroom: 1520000, fuel: "Petrol", cc: 1497 },
      { name: "GTX Plus Turbo DCT", exShowroom: 2000000, fuel: "Petrol", cc: 1482 },
      { name: "HTK Plus Petrol", exShowroom: 1360000, fuel: "Petrol", cc: 1497 },
    ],
  },
];

export interface CorehubPreset {
  id: string;
  badge: string;
  externalCaseId: string;
  registrationNumber: string;
  make: string;
  model: string;
  variant: string;
  year: number;
  fuel: string;
  cc: number;
  requestedIdv: number;
  benchmarkIdv?: number;
  conditions?: {
    good: ConditionRange;
    veryGood: ConditionRange;
    excellent: ConditionRange;
  };
  notes: string;
}

export const COREHUB_BENCHMARK_PRESETS: CorehubPreset[] = [
  {
    id: "preset-baleno-zeta",
    badge: "Within Tolerance",
    externalCaseId: "CRH-2026-BLN-0891",
    registrationNumber: "MH02CB1234",
    make: "Maruti Suzuki",
    model: "Baleno",
    variant: "Zeta Petrol",
    year: 2022,
    fuel: "Petrol",
    cc: 1197,
    requestedIdv: 600000,
    benchmarkIdv: 614440,
    conditions: {
      good: { min: 570000, max: 600000, midpoint: 585000, raw: "₹5,70,000 - ₹6,00,000" },
      veryGood: { min: 596007, max: 632873, midpoint: 614440, raw: "₹5,96,007 - ₹6,32,873" },
      excellent: { min: 635000, max: 675000, midpoint: 655000, raw: "₹6,35,000 - ₹6,75,000" },
    },
    notes: "CoreHub live benchmark — requested IDV falls inside Very Good OBV band.",
  },
  {
    id: "preset-creta-sx",
    badge: "Boundary Test",
    externalCaseId: "CRH-2026-CRT-5120",
    registrationNumber: "DL01AB9876",
    make: "Hyundai",
    model: "Creta",
    variant: "SX 1.5 Petrol",
    year: 2023,
    fuel: "Petrol",
    cc: 1497,
    requestedIdv: 1190000,
    benchmarkIdv: 1150000,
    conditions: {
      good: { min: 1060000, max: 1120000, midpoint: 1090000, raw: "₹10,60,000 - ₹11,20,000" },
      veryGood: { min: 1120000, max: 1180000, midpoint: 1150000, raw: "₹11,20,000 - ₹11,80,000" },
      excellent: { min: 1185000, max: 1250000, midpoint: 1217500, raw: "₹11,85,000 - ₹12,50,000" },
    },
    notes: "Close to 3.5% tolerance threshold, tests boundary decisioning.",
  },
  {
    id: "preset-nexon-xz",
    badge: "Deviant / Review",
    externalCaseId: "CRH-2026-NXN-9941",
    registrationNumber: "KA05MK4412",
    make: "Tata",
    model: "Nexon",
    variant: "Creative Plus Petrol",
    year: 2021,
    fuel: "Petrol",
    cc: 1199,
    requestedIdv: 820000,
    benchmarkIdv: 720000,
    conditions: {
      good: { min: 660000, max: 700000, midpoint: 680000, raw: "₹6,60,000 - ₹7,00,000" },
      veryGood: { min: 700000, max: 740000, midpoint: 720000, raw: "₹7,00,000 - ₹7,40,000" },
      excellent: { min: 745000, max: 790000, midpoint: 767500, raw: "₹7,45,000 - ₹7,90,000" },
    },
    notes: "Exceeds tolerance by ~13% — triggers Manual Review recommendation.",
  },
  {
    id: "preset-swift-vxi",
    badge: "Under-Insured",
    externalCaseId: "CRH-2026-SWF-3321",
    registrationNumber: "HR26DT1120",
    make: "Maruti Suzuki",
    model: "Swift",
    variant: "VXI Petrol",
    year: 2022,
    fuel: "Petrol",
    cc: 1197,
    requestedIdv: 460000,
    benchmarkIdv: 540000,
    conditions: {
      good: { min: 495000, max: 525000, midpoint: 510000, raw: "₹4,95,000 - ₹5,25,000" },
      veryGood: { min: 525000, max: 555000, midpoint: 540000, raw: "₹5,25,000 - ₹5,55,000" },
      excellent: { min: 560000, max: 595000, midpoint: 577500, raw: "₹5,60,000 - ₹5,95,000" },
    },
    notes: "Requested below Good condition floor — under-insurance alert.",
  },
  {
    id: "preset-city-v",
    badge: "Exact Match",
    externalCaseId: "CRH-2026-CTY-7714",
    registrationNumber: "TN07BC8021",
    make: "Honda",
    model: "City",
    variant: "V CVT Petrol",
    year: 2020,
    fuel: "Petrol",
    cc: 1498,
    requestedIdv: 785000,
    benchmarkIdv: 785000,
    conditions: {
      good: { min: 720000, max: 760000, midpoint: 740000, raw: "₹7,20,000 - ₹7,60,000" },
      veryGood: { min: 765000, max: 805000, midpoint: 785000, raw: "₹7,65,000 - ₹8,05,000" },
      excellent: { min: 810000, max: 855000, midpoint: 832500, raw: "₹8,10,000 - ₹8,55,000" },
    },
    notes: "Near zero delta — verifies clean exact/instant auto-approval.",
  },
];

/**
 * Standard IRDAI & OBV age-based vehicle depreciation rate schedule.
 */
export function getDepreciationFactor(yom: number, currentYear = 2026): number {
  const age = Math.max(0, currentYear - yom);
  if (age <= 0.5) return 0.95; // 5% depreciation
  if (age <= 1) return 0.88;   // 12% depreciation
  if (age <= 2) return 0.82;   // 18% depreciation
  if (age <= 3) return 0.75;   // 25% depreciation
  if (age <= 4) return 0.68;   // 32% depreciation
  if (age <= 5) return 0.60;   // 40% depreciation
  if (age <= 6) return 0.52;   // 48% depreciation
  if (age <= 7) return 0.45;   // 55% depreciation
  const extraYears = age - 7;
  return Math.max(0.20, 0.45 - extraYears * 0.05);
}

/**
 * Estimate ex-showroom anchor if not in catalog.
 */
function estimateExShowroom(make: string, model: string, variant: string): number {
  const lower = `${make} ${model} ${variant}`.toLowerCase();
  for (const cat of POPULAR_VEHICLES) {
    if (lower.includes(cat.model.toLowerCase())) {
      const match = cat.variants.find((v) =>
        lower.includes(v.name.toLowerCase().split(" ")[0])
      );
      if (match) return match.exShowroom;
      return cat.variants[0].exShowroom;
    }
  }
  // Generic segment anchors
  if (lower.includes("suv") || lower.includes("thar") || lower.includes("scorpio") || lower.includes("xuv")) return 1600000;
  if (lower.includes("sedan") || lower.includes("city") || lower.includes("verna") || lower.includes("ciaz")) return 1300000;
  return 850000; // Average hatchback / sub-compact
}

export interface SimulatedConditionSpectrum {
  good: ConditionRange;
  veryGood: ConditionRange;
  excellent: ConditionRange;
  benchmarkIdv: number;
}

/**
 * Calculate OBV 3-condition valuation ranges.
 */
export function calculateSimulatedObvSpectrum(params: {
  make: string;
  model: string;
  variant: string;
  year: number;
  currentYear?: number;
}): SimulatedConditionSpectrum {
  const exShowroom = estimateExShowroom(params.make, params.model, params.variant);
  const depFactor = getDepreciationFactor(params.year, params.currentYear ?? 2026);
  const baseline = Math.round(exShowroom * depFactor);

  // Very Good (Primary Benchmark): baseline ±3%
  const vgMin = Math.round(baseline * 0.97);
  const vgMax = Math.round(baseline * 1.03);
  const vgMid = Math.round((vgMin + vgMax) / 2);

  // Good: ~8% below Very Good (spread ±3%)
  const goodBase = Math.round(baseline * 0.92);
  const gMin = Math.round(goodBase * 0.97);
  const gMax = Math.round(goodBase * 1.03);
  const gMid = Math.round((gMin + gMax) / 2);

  // Excellent: ~7% above Very Good (spread ±3%)
  const excBase = Math.round(baseline * 1.07);
  const eMin = Math.round(excBase * 0.97);
  const eMax = Math.round(excBase * 1.03);
  const eMid = Math.round((eMin + eMax) / 2);

  return {
    good: {
      min: gMin,
      max: gMax,
      midpoint: gMid,
      raw: `₹${gMin.toLocaleString("en-IN")} - ₹${gMax.toLocaleString("en-IN")}`,
    },
    veryGood: {
      min: vgMin,
      max: vgMax,
      midpoint: vgMid,
      raw: `₹${vgMin.toLocaleString("en-IN")} - ₹${vgMax.toLocaleString("en-IN")}`,
    },
    excellent: {
      min: eMin,
      max: eMax,
      midpoint: eMid,
      raw: `₹${eMin.toLocaleString("en-IN")} - ₹${eMax.toLocaleString("en-IN")}`,
    },
    benchmarkIdv: vgMid,
  };
}

export interface DecisionAllowanceAnalysis {
  requestedIdv: number;
  benchmarkIdv: number;
  absoluteDelta: number;
  percentageDelta: number;
  absoluteTolerance: number;
  percentageTolerance: number;
  effectiveToleranceInr: number;
  minAllowedIdv: number;
  maxAllowedIdv: number;
  isAllowed: boolean;
  activeRule: DecisionReasonCode;
  verdict: "auto_approved" | "manual_review";
  tierAlignment: "Good" | "Very Good" | "Excellent" | "Below Market Floor" | "Above Market Ceiling";
  pickedCondition: ConditionTierKey | null;
  pickedConditionLabel: string | null;
  pickedConditionRange: { min: number; max: number; midpoint?: number } | null;
  recommendation: string;
  adjustmentRupeesNeeded: number;
  allowedCorridorSummary: string;
}

/**
 * Simulator view of an underwriting decision. The approve/review outcome and reason code
 * come from the production rules in `evaluateIdvDecision`; everything else here
 * (corridor, tier alignment, recommendation copy) is descriptive, for display only.
 */
export function analyzeDecisionAllowance(
  requestedIdv: number,
  benchmarkIdv: number,
  vehicleConfidence: number,
  config: DecisionConfig,
  conditions?: SimulatedConditionSpectrum
): DecisionAllowanceAnalysis {
  const result = evaluateIdvDecision(
    { requestedIdv, fetchedIdv: benchmarkIdv, vehicleConfidence, providerStatus: "succeeded", conditions },
    config
  );
  const isAllowed = result.decision === "auto_approved";

  const absDelta = Math.abs(requestedIdv - benchmarkIdv);
  const pctDelta = benchmarkIdv > 0 ? (absDelta / benchmarkIdv) * 100 : 0;

  // Tolerance buffer around benchmark
  const pctTolRupees = Math.round(benchmarkIdv * (config.percentageTolerance / 100));
  const effectiveToleranceInr = Math.max(config.absoluteTolerance, pctTolRupees);

  // Descriptive corridor: the Good -> Excellent spectrum PLUS policy tolerance
  const conditionFloor = conditions ? conditions.good.min : benchmarkIdv - effectiveToleranceInr;
  const conditionCeiling = conditions ? conditions.excellent.max : benchmarkIdv + effectiveToleranceInr;

  const minAllowedIdv = Math.min(conditionFloor, Math.max(0, benchmarkIdv - effectiveToleranceInr));
  const maxAllowedIdv = Math.max(conditionCeiling, benchmarkIdv + effectiveToleranceInr);

  const tiers = conditions
    ? ([
        ["very_good", "Very Good", conditions.veryGood],
        ["good", "Good", conditions.good],
        ["excellent", "Excellent", conditions.excellent],
      ] as const)
    : [];
  const picked = tiers.find(([, , r]) => requestedIdv >= r.min && requestedIdv <= r.max);
  const tierAlignment: DecisionAllowanceAnalysis["tierAlignment"] = picked
    ? picked[1]
    : !conditions
      ? "Very Good"
      : requestedIdv < conditions.good.min
        ? "Below Market Floor"
        : "Above Market Ceiling";

  let adjustmentRupeesNeeded = 0;
  if (!isAllowed) {
    if (requestedIdv > maxAllowedIdv) adjustmentRupeesNeeded = requestedIdv - maxAllowedIdv;
    else if (requestedIdv < minAllowedIdv) adjustmentRupeesNeeded = minAllowedIdv - requestedIdv;
  }

  const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  let recommendation: string;
  if (isAllowed) {
    recommendation =
      result.reasonCode === "WITHIN_CONDITION_BAND"
        ? `Requested IDV of ${inr(requestedIdv)} lies directly within the ${tierAlignment} Condition market valuation band. Eligible for straight-through processing (STP) auto-approval under market condition spectrum policy.`
        : `Requested IDV of ${inr(requestedIdv)} is within allowable underwriting bounds (±${inr(effectiveToleranceInr)} / ${config.percentageTolerance}%). Eligible for straight-through processing (STP) auto-approval.`;
  } else if (result.reasonCode !== "TOLERANCE_EXCEEDED") {
    recommendation = `${result.explanation} Manual underwriter review required.`;
  } else if (requestedIdv > maxAllowedIdv) {
    recommendation = `Requested IDV is ${inr(adjustmentRupeesNeeded)} above the auto-approval ceiling (${inr(maxAllowedIdv)}). Exceeds the Excellent condition band. Manual underwriter review required, or adjust IDV down to ${inr(maxAllowedIdv)} to auto-approve.`;
  } else if (requestedIdv < minAllowedIdv) {
    recommendation = `Requested IDV is ${inr(adjustmentRupeesNeeded)} below the auto-approval floor (${inr(minAllowedIdv)}). Below the Good condition band. Risk of under-insurance. Manual underwriter review required, or adjust IDV up to ${inr(minAllowedIdv)} to auto-approve.`;
  } else {
    recommendation = `${result.explanation} Requested IDV falls between condition bands and outside tolerance. Manual underwriter review required.`;
  }

  return {
    requestedIdv,
    benchmarkIdv,
    absoluteDelta: absDelta,
    percentageDelta: pctDelta,
    absoluteTolerance: config.absoluteTolerance,
    percentageTolerance: config.percentageTolerance,
    effectiveToleranceInr,
    minAllowedIdv,
    maxAllowedIdv,
    isAllowed,
    activeRule: result.reasonCode,
    verdict: isAllowed ? "auto_approved" : "manual_review",
    tierAlignment,
    pickedCondition: picked?.[0] ?? null,
    pickedConditionLabel: picked ? `${picked[1]} Condition` : null,
    pickedConditionRange: picked?.[2] ?? null,
    recommendation,
    adjustmentRupeesNeeded,
    allowedCorridorSummary: `Allowed Auto-Approval Window: ${inr(minAllowedIdv)} to ${inr(maxAllowedIdv)} (Good to Excellent Bands + Tolerance Buffer)`,
  };
}
