import {evaluateIdvDecision} from "@/domain/decision-engine";
import type {DecisionConfig,DecisionInput} from "@/domain/motor-idv";
import type {ObvConnector,ObvLookupInput} from "@/connectors/obv/types";
export type WorkflowResult={decision:ReturnType<typeof evaluateIdvDecision>;lookup?:Awaited<ReturnType<ObvConnector["lookup"]>>};
export async function runIdvWorkflow(input:{requestedIdv:number|null;vehicleConfidence:number|null;providerInput:ObvLookupInput;config:DecisionConfig;obv:ObvConnector}):Promise<WorkflowResult>{
 let lookup:Awaited<ReturnType<ObvConnector["lookup"]>>;
 try{lookup=await input.obv.lookup(input.providerInput)}catch{lookup={provider:"obv",success:false,currency:"INR",latencyMs:0,reasonCode:"PROVIDER_EXCEPTION"}}
 const decisionInput:DecisionInput={requestedIdv:input.requestedIdv,fetchedIdv:lookup.success&&Number.isFinite(lookup.idv)?lookup.idv??null:null,vehicleConfidence:input.vehicleConfidence,providerStatus:lookup.success?"succeeded":lookup.reasonCode==="TIMEOUT"?"timeout":lookup.reasonCode==="RATE_LIMITED"?"rate_limited":"unavailable"};
 return{lookup,decision:evaluateIdvDecision(decisionInput,input.config)}
}