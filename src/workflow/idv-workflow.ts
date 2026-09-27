import {evaluateIdvDecision} from "@/src/domain/decision-engine";
import type {DecisionConfig,DecisionInput} from "@/src/domain/motor-idv";
import type {ObvConnector,ObvLookupInput,ObvLookupResult} from "@/src/connectors/obv/types";
export type WorkflowResult={decision:ReturnType<typeof evaluateIdvDecision>;lookup?:ObvLookupResult;attempts:number};
export async function runIdvWorkflow(input:{requestedIdv:number|null;vehicleConfidence:number|null;providerInput:ObvLookupInput;config:DecisionConfig;obv:ObvConnector}):Promise<WorkflowResult>{
 let lookup:ObvLookupResult|undefined;let attempts=0;const maxAttempts=Math.max(1,input.config.retryCount+1);
 while(attempts<maxAttempts){attempts++;try{lookup=await input.obv.lookup(input.providerInput)}catch{lookup={provider:"obv",success:false,currency:"INR",latencyMs:0,reasonCode:"PROVIDER_EXCEPTION"}}if(lookup.success)break;if(!["TIMEOUT","NETWORK_ERROR","PROVIDER_ERROR","RATE_LIMITED","PROVIDER_EXCEPTION"].includes(lookup.reasonCode??""))break;if(attempts<maxAttempts)await new Promise(r=>setTimeout(r,Math.min(750*2**(attempts-1),2000)));}
 const status=lookup?.success?"succeeded":lookup?.reasonCode==="TIMEOUT"?"timeout":lookup?.reasonCode==="RATE_LIMITED"?"rate_limited":"unavailable";
 const decisionInput:DecisionInput={requestedIdv:input.requestedIdv,fetchedIdv:lookup?.success&&Number.isFinite(lookup.idv)?lookup.idv??null:null,vehicleConfidence:input.vehicleConfidence,providerStatus:status};
 return{lookup,attempts,decision:evaluateIdvDecision(decisionInput,input.config)}
}