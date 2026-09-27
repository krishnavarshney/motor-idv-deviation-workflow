export type VehicleInput={make?:string|null;model?:string|null;variant?:string|null;fuel?:string|null;cc?:number|null};
export type VehicleCandidate={key:string;make:string;model:string;variant:string;fuel?:string|null;cc?:number|null};
export type VehicleMatch={candidate:VehicleCandidate;score:number;strategy:"deterministic"|"fuzzy";reasonCodes:string[]};

const aliases:Record<string,string>={marutisuzuki:"MARUTI SUZUKI",maruti:"MARUTI SUZUKI",tvs:"TVS",hyundai:"HYUNDAI",mahindra:"MAHINDRA",vw:"VOLKSWAGEN",volkswagen:"VOLKSWAGEN"};

export function normalizeVehicleText(value?:string|null){return (value??"").toUpperCase().replace(/[^A-Z0-9]+/g,"").trim()}
export function normalizeMake(value?:string|null){const n=normalizeVehicleText(value);return aliases[n]??n}
function tokenScore(a:string,b:string){if(!a||!b)return 0;if(a===b)return 1;if(a.includes(b)||b.includes(a))return Math.min(a.length,b.length)/Math.max(a.length,b.length);return 0}
export function resolveVehicle(input:VehicleInput,candidates:VehicleCandidate[],minConfidence=0.85):VehicleMatch|null{
 const make=normalizeMake(input.make),model=normalizeVehicleText(input.model),variant=normalizeVehicleText(input.variant),fuel=normalizeVehicleText(input.fuel);
 let best:VehicleMatch|null=null;
 for(const c of candidates){
  const cm=normalizeMake(c.make),cmo=normalizeVehicleText(c.model),cv=normalizeVehicleText(c.variant),cf=normalizeVehicleText(c.fuel);
  const exact=make===cm&&model===cmo&&variant===cv&&(!fuel||!cf||fuel===cf)&&(!input.cc||!c.cc||Math.abs(input.cc-c.cc)<=10);
  const score=exact?1:(tokenScore(make,cm)*.25+tokenScore(model,cmo)*.3+tokenScore(variant,cv)*.35+(fuel&&cf&&fuel===cf?.05:0)+(input.cc&&c.cc&&Math.abs(input.cc-c.cc)<=10?.05:0));
  if(!best||score>best.score)best={candidate:c,score,strategy:exact?"deterministic":"fuzzy",reasonCodes:exact?["EXACT_NORMALIZED_MATCH"]:["FUZZY_CANDIDATE_MATCH"]};
 }
 return best&&best.score>=minConfidence?best:null;
}