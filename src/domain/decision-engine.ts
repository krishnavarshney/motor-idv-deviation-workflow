import type {DecisionConfig,DecisionInput,DecisionResult} from "./motor-idv";
export function evaluateIdvDecision(input: DecisionInput, config: DecisionConfig): DecisionResult {
  if (input.requestedIdv === null || input.vehicleConfidence === null) {
    return review("MISSING_REQUIRED_DATA", "Required vehicle data is missing.");
  }
  if (input.providerStatus !== "succeeded") {
    return review("PROVIDER_FAILURE", `Valuation provider returned ${input.providerStatus.replace("_", " ")}.`);
  }
  if (input.fetchedIdv === null) {
    return review("MISSING_REQUIRED_DATA", "Valuation data is missing.");
  }
  if (input.vehicleConfidence < config.minimumVehicleConfidence) {
    return review(
      "LOW_VEHICLE_CONFIDENCE",
      `Vehicle confidence ${(input.vehicleConfidence * 100).toFixed(1)}% is below the ${(config.minimumVehicleConfidence * 100).toFixed(1)}% threshold.`
    );
  }

  const absoluteDelta = Math.abs(input.requestedIdv - input.fetchedIdv);
  const percentageDelta = input.fetchedIdv === 0 ? null : (absoluteDelta / input.fetchedIdv) * 100;

  // Check condition bands first: if requested IDV lies within Good, Very Good, or Excellent bands -> Auto Approve
  if (input.conditions) {
    const c = input.conditions;
    if (c.veryGood && input.requestedIdv >= c.veryGood.min && input.requestedIdv <= c.veryGood.max) {
      return approve(
        "WITHIN_CONDITION_BAND",
        `Requested IDV of ₹${input.requestedIdv.toLocaleString("en-IN")} lies within the Very Good condition valuation band (₹${c.veryGood.min.toLocaleString("en-IN")} – ₹${c.veryGood.max.toLocaleString("en-IN")}) and is auto-approved.`,
        absoluteDelta,
        percentageDelta,
        "very_good"
      );
    }
    if (c.good && input.requestedIdv >= c.good.min && input.requestedIdv <= c.good.max) {
      return approve(
        "WITHIN_CONDITION_BAND",
        `Requested IDV of ₹${input.requestedIdv.toLocaleString("en-IN")} lies within the Good condition valuation band (₹${c.good.min.toLocaleString("en-IN")} – ₹${c.good.max.toLocaleString("en-IN")}) and is auto-approved.`,
        absoluteDelta,
        percentageDelta,
        "good"
      );
    }
    if (c.excellent && input.requestedIdv >= c.excellent.min && input.requestedIdv <= c.excellent.max) {
      return approve(
        "WITHIN_CONDITION_BAND",
        `Requested IDV of ₹${input.requestedIdv.toLocaleString("en-IN")} lies within the Excellent condition valuation band (₹${c.excellent.min.toLocaleString("en-IN")} – ₹${c.excellent.max.toLocaleString("en-IN")}) and is auto-approved.`,
        absoluteDelta,
        percentageDelta,
        "excellent"
      );
    }
  }

  // Exact IDV match
  if (absoluteDelta === 0) {
    return approve("EXACT_IDV_MATCH", "Requested IDV exactly matches the reference valuation.", 0, 0);
  }

  // Absolute tolerance check
  if (absoluteDelta <= config.absoluteTolerance) {
    return approve(
      "WITHIN_ABSOLUTE_TOLERANCE",
      `Difference of ₹${absoluteDelta.toLocaleString("en-IN")} is within the configured absolute tolerance.`,
      absoluteDelta,
      percentageDelta
    );
  }

  // Percentage tolerance check
  if (percentageDelta !== null && percentageDelta <= config.percentageTolerance) {
    return approve(
      "WITHIN_PERCENTAGE_TOLERANCE",
      `Difference of ${percentageDelta.toFixed(2)}% is within the configured percentage tolerance.`,
      absoluteDelta,
      percentageDelta
    );
  }

  return {
    decision: "manual_review",
    reasonCode: "TOLERANCE_EXCEEDED",
    explanation: "IDV difference exceeds both configured tolerances and condition valuation bands.",
    absoluteDelta,
    percentageDelta,
  };
}

function review(reasonCode: DecisionResult["reasonCode"], explanation: string): DecisionResult {
  return { decision: "manual_review", reasonCode, explanation, absoluteDelta: null, percentageDelta: null };
}

function approve(
  reasonCode: DecisionResult["reasonCode"],
  explanation: string,
  absoluteDelta: number,
  percentageDelta: number | null,
  matchedCondition?: import("./motor-idv").ConditionTierKey | null
): DecisionResult {
  return {
    decision: "auto_approved",
    reasonCode,
    explanation,
    absoluteDelta,
    percentageDelta,
    matchedCondition: matchedCondition ?? null,
  };
}