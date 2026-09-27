import type {ObvConnector,ObvLookupInput,ObvLookupResult} from "./types";
export class OfficialObvConnector implements ObvConnector{
 constructor(private readonly config:{baseUrl:string;apiToken:string;endpointPath?:string;timeoutMs?:number}){}
 async lookup(input:ObvLookupInput):Promise<ObvLookupResult>{
  if(!this.config.baseUrl||!this.config.apiToken||!this.config.endpointPath)return{provider:"obv",success:false,currency:"INR",latencyMs:0,reasonCode:"PROVIDER_NOT_CONFIGURED"};
  const started=Date.now();const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),this.config.timeoutMs??4000);
  try{
   const response=await fetch(new URL(this.config.endpointPath,this.config.baseUrl).toString(),{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${this.config.apiToken}`},body:JSON.stringify(input),signal:controller.signal});
   const raw=await response.json().catch(()=>null);
   if(!response.ok)return{provider:"obv",success:false,currency:"INR",latencyMs:Date.now()-started,reasonCode:response.status===429?"RATE_LIMITED":"PROVIDER_ERROR",raw};
   const idv=Number(raw?.idv??raw?.data?.idv??raw?.valuation?.idv);
   if(!Number.isFinite(idv))return{provider:"obv",success:false,currency:"INR",latencyMs:Date.now()-started,reasonCode:"INVALID_PROVIDER_RESPONSE",raw};
   return{provider:"obv",success:true,currency:"INR",latencyMs:Date.now()-started,idv,providerRequestId:raw?.request_id??raw?.data?.request_id,vehicle:raw?.vehicle??raw?.data?.vehicle,raw};
  }catch(error){return{provider:"obv",success:false,currency:"INR",latencyMs:Date.now()-started,reasonCode:error instanceof DOMException&&error.name==="AbortError"?"TIMEOUT":"NETWORK_ERROR",raw:{message:String(error)}}}
  finally{clearTimeout(timeout)}
 }
}