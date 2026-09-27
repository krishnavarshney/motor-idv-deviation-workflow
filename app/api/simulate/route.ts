import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
import {evaluateIdvDecision} from "@/domain/decision-engine";
import {loadDecisionConfig} from "@/server/idv-config";
export async function POST(request:Request){
 const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser();
 if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const body=await request.json(); const requested=Number(body.requestedIdv),obv=Number(body.obvIdv);
 if(!Number.isFinite(requested)||!Number.isFinite(obv))return NextResponse.json({error:"requestedIdv and obvIdv are required"},{status:400});
 const confidence=Number(body.confidence??0.96); const config=await loadDecisionConfig(supabase);
 const result=evaluateIdvDecision({requestedIdv:requested,fetchedIdv:obv,vehicleConfidence:confidence,providerStatus:"succeeded"},config);
 const externalCaseId=body.caseId || ("SIM-"+Date.now()); const idempotencyKey="simulation:"+externalCaseId;
 const {data:existing}=await supabase.from("referral_cases").select("id,external_case_id").eq("idempotency_key",idempotencyKey).maybeSingle();
 if(existing)return NextResponse.json({case:existing,result,replayed:true});
 const {data:caseRow,error:caseError}=await supabase.from("referral_cases").insert({external_case_id:externalCaseId,source_system:"controlled-simulator",idempotency_key:idempotencyKey,registration_number:body.registrationNumber??"SIM-TEST",make_raw:body.make??"Maruti Suzuki",model_raw:body.model??"Baleno",variant_raw:body.variant??"Zeta AMT",fuel_type_raw:body.fuel??"Petrol",cc_raw:String(body.cc??1197),requested_idv:requested,referral_status:result.decision==="auto_approved"?"approved":"manual_review",workflow_status:result.decision==="auto_approved"?"auto_approved":"queued_for_review",processed_at:new Date().toISOString()}).select().single();
 if(caseError)return NextResponse.json({error:caseError.message},{status:400});
 const {data:resolution}=await supabase.from("vehicle_resolutions").insert({case_id:caseRow.id,normalized_make:"MARUTI SUZUKI",normalized_model:"BALENO",normalized_variant:"ZETAAMT",normalized_fuel:"PETROL",normalized_cc:1197,candidate_source:"controlled-simulator",resolved_vehicle_key:"SIM-BALENO-ZETA-AMT",resolved_make:"Maruti Suzuki",resolved_model:"Baleno",resolved_variant:"Zeta AMT",confidence_score:confidence,match_strategy:"deterministic",match_reason_codes:["CONTROLLED_TEST"]}).select().single();
 const {data:idv}=await supabase.from("idv_checks").insert({case_id:caseRow.id,vehicle_resolution_id:resolution?.id,provider:"obv-simulator",provider_status:"succeeded",fetched_idv:obv,fetched_currency:"INR",fetched_at:new Date().toISOString(),lookup_latency_ms:15,raw_request:{mode:"controlled-test"},raw_response:{idv:obv}}).select().single();
 await supabase.from("approval_decisions").insert({case_id:caseRow.id,idv_check_id:idv?.id,decision:result.decision,decision_reason_code:result.reasonCode,decision_reason_details:{explanation:result.explanation},requested_idv:requested,fetched_idv:obv,absolute_delta:result.absoluteDelta,percentage_delta:result.percentageDelta,tolerance_mode:"absolute_or_percentage",tolerance_value:config.absoluteTolerance});
 if(result.decision==="manual_review")await supabase.from("manual_reviews").insert({case_id:caseRow.id,review_status:"queued",priority:3,review_reason:result.explanation,sla_due_at:new Date(Date.now()+config.reviewSlaMinutes*60000).toISOString()});
 await supabase.from("audit_events").insert({case_id:caseRow.id,event_type:"controlled_test_completed",actor_type:"user",actor_id:user.id,severity:"info",payload:{result,requestedIdv:requested,obvIdv:obv},correlation_id:caseRow.correlation_id});
 return NextResponse.json({case:caseRow,result});
}