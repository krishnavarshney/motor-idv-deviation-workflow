import {NextResponse} from "next/server";
import {evaluateIdvDecision} from "@/src/domain/decision-engine";
import {loadDecisionConfig} from "@/src/server/idv-config";
import {requireAction} from "@/lib/api-auth";
export async function POST(request: Request) {
  const auth = await requireAction("test_lookup");
  if (!auth.ok) return auth.response;
  const supabase = auth.supabase;
  const user = auth.user;

  const body = await request.json();
  const requested = Number(body.requestedIdv);
  const obv = Number(body.obvIdv);

  if (!Number.isFinite(requested) || !Number.isFinite(obv)) {
    return NextResponse.json({ error: "requestedIdv and obvIdv are required" }, { status: 400 });
  }

  const confidence = Number(body.confidence ?? 0.96);
  const config = await loadDecisionConfig(supabase);
  const result = evaluateIdvDecision(
    {
      requestedIdv: requested,
      fetchedIdv: obv,
      vehicleConfidence: confidence,
      providerStatus: "succeeded",
      conditions: body.conditions ?? null,
    },
    config
  );

  const make = body.make || "Maruti Suzuki";
  const model = body.model || "Baleno";
  const variant = body.variant || "Zeta Petrol";
  const year = body.year || "2022";
  const fuel = body.fuel || "Petrol";
  const regNumber = body.registrationNumber || "SIM-" + Math.floor(1000 + Math.random() * 9000);

  const externalCaseId = body.caseId || ("SIM-" + Date.now());
  const idempotencyKey = "simulation:" + externalCaseId;

  const { data: existing } = await supabase
    .from("referral_cases")
    .select("id,external_case_id")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (existing) return NextResponse.json({ case: existing, result, replayed: true });

  const { data: caseRow, error: caseError } = await supabase
    .from("referral_cases")
    .insert({
      external_case_id: externalCaseId,
      source_system: "controlled-simulator",
      idempotency_key: idempotencyKey,
      registration_number: regNumber,
      make_raw: make,
      model_raw: model,
      variant_raw: variant,
      fuel_type_raw: fuel,
      cc_raw: String(body.cc ?? 1197),
      requested_idv: requested,
      metadata: {
        yom: year,
        simulated: true,
        source: body.simulationSource || "intelligent_decision_simulator",
      },
      referral_status: result.decision === "auto_approved" ? "approved" : "manual_review",
      workflow_status: result.decision === "auto_approved" ? "auto_approved" : "queued_for_review",
      processed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (caseError) return NextResponse.json({ error: caseError.message }, { status: 400 });

  const { data: resolution } = await supabase
    .from("vehicle_resolutions")
    .insert({
      case_id: caseRow.id,
      normalized_make: make.toUpperCase(),
      normalized_model: model.toUpperCase(),
      normalized_variant: variant.toUpperCase().replace(/\s+/g, ""),
      normalized_fuel: fuel.toUpperCase(),
      normalized_cc: body.cc ?? 1197,
      candidate_source: "controlled-simulator",
      resolved_vehicle_key: `SIM-${make.toUpperCase()}-${model.toUpperCase()}-${year}`,
      resolved_make: make,
      resolved_model: model,
      resolved_variant: variant,
      confidence_score: confidence,
      match_strategy: "deterministic",
      match_reason_codes: ["SIMULATOR_TEST"],
    })
    .select()
    .single();

  const rawResponse: Record<string, unknown> = {
    idv: obv,
    sourceUrl: body.sourceUrl || "https://www.orangebookvalue.com",
  };
  if (body.conditions) {
    rawResponse.conditions = body.conditions;
  }

  const { data: idv } = await supabase
    .from("idv_checks")
    .insert({
      case_id: caseRow.id,
      vehicle_resolution_id: resolution?.id,
      provider: body.provider || "obv-simulator",
      provider_status: "succeeded",
      fetched_idv: obv,
      fetched_currency: "INR",
      fetched_at: new Date().toISOString(),
      lookup_latency_ms: body.latencyMs ?? 15,
      raw_request: {
        mode: "controlled-test",
        make,
        model,
        variant,
        year,
      },
      raw_response: rawResponse,
    })
    .select()
    .single();

  console.log(
    `[IDV Simulation] Case ${externalCaseId} (${make} ${model} ${variant}): Requested IDV ₹${requested.toLocaleString("en-IN")}, OBV Benchmark ₹${obv.toLocaleString("en-IN")}. Result: ${result.decision.toUpperCase()} via ${result.reasonCode}${result.matchedCondition ? ` [Condition Picked: ${result.matchedCondition.toUpperCase()}]` : ""}.`
  );

  await supabase.from("approval_decisions").insert({
    case_id: caseRow.id,
    idv_check_id: idv?.id,
    decision: result.decision,
    decision_reason_code: result.reasonCode,
    decision_reason_details: {
      explanation: result.explanation,
      matchedCondition: result.matchedCondition ?? null,
    },
    requested_idv: requested,
    fetched_idv: obv,
    absolute_delta: result.absoluteDelta,
    percentage_delta: result.percentageDelta,
    tolerance_mode: result.reasonCode === "WITHIN_CONDITION_BAND" ? "condition_spectrum" : "absolute_or_percentage",
    tolerance_value: config.absoluteTolerance,
  });

  if (result.decision === "manual_review") {
    await supabase.from("manual_reviews").insert({
      case_id: caseRow.id,
      review_status: "queued",
      priority: 3,
      review_reason: result.explanation,
      sla_due_at: new Date(Date.now() + config.reviewSlaMinutes * 60000).toISOString(),
    });
  }

  await supabase.from("audit_events").insert({
    case_id: caseRow.id,
    event_type: "controlled_test_completed",
    actor_type: "user",
    actor_id: user.id,
    severity: "info",
    payload: {
      result,
      pickedCondition: result.matchedCondition ?? null,
      requestedIdv: requested,
      obvIdv: obv,
      make,
      model,
      variant,
      year,
    },
    correlation_id: caseRow.correlation_id,
  });

  return NextResponse.json({ case: caseRow, result });
}