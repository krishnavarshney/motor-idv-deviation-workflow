import type {ObvConnector,ObvLookupInput,ObvLookupResult} from "./types";
export class OfficialObvConnector implements ObvConnector{
 constructor(private readonly config:{baseUrl:string;apiToken:string;timeoutMs?:number}){}
 async lookup(input:ObvLookupInput):Promise<ObvLookupResult>{
  const started=Date.now();const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),this.config.timeoutMs??4000);
  try{
   const response=await fetch(`${this.config.baseUrl.replace(/\\/$/,"")}/vehicle/valuation`,{method:"POST",headers:{"content-type":"application/json","authorization":`Bearer ${this.config.apiToken}`},body:JSON.stringify(input),signal:controller.signal});
   const raw=await response.json().catch(()=>null);
   if(!response.ok)return{provider:"obv",success:false,currency:"INR",latencyMs:Date.now()-started,reasonCode:response.status===429?"RATE_LIMITED":"PROVIDER_ERROR",raw};
   return{provider:"obv",success:true,currency:"INR",latencyMs:Date.now()-started,idv:Number(raw?.idv),providerRequestId:raw?.request_id,vehicle:raw?.vehicle,raw};
  }catch(error){return{provider:"obv",success:false,currency:"INR",latencyMs:Date.now()-started,reasonCode:error instanceof DOMException&&error.name==="AbortError"?"TIMEOUT":"NETWORK_ERROR",raw:{message:String(error)}}}
  finally{clearTimeout(timeout)}
 }
}