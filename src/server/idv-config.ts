import type {DecisionConfig} from "@/src/domain/motor-idv";
import type {SupabaseClient} from "@supabase/supabase-js";
export async function loadDecisionConfig(supabase:SupabaseClient):Promise<DecisionConfig>{
 const {data}=await supabase.from("config_settings").select("setting_key,setting_value").eq("is_active",true);
 const map=new Map((data??[]).map(x=>[x.setting_key,Number(x.setting_value)]));
 return {absoluteTolerance:map.get("idv_abs_tolerance")??5000,percentageTolerance:map.get("idv_pct_tolerance")??2,minimumVehicleConfidence:(map.get("vehicle_match_min_confidence")??85)/100,providerTimeoutSeconds:(map.get("obv_lookup_timeout_ms")??4000)/1000,retryCount:map.get("obv_max_retries")??2,reviewSlaMinutes:(map.get("manual_review_sla_hours")??4)*60};
}