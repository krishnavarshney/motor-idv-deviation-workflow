export type ReferralStatus="received"|"processing"|"approved"|"manual_review"|"rejected"|"failed";
export type WorkflowStatus="intake_pending"|"resolving_vehicle"|"lookup_pending"|"comparison_pending"|"auto_approved"|"queued_for_review"|"completed"|"failed_retrying"|"failed_terminal";
export type ProviderStatus="pending"|"succeeded"|"failed"|"timeout"|"rate_limited"|"unavailable";
export type DecisionType="auto_approved"|"manual_review"|"rejected"|"pending";
export type ReviewStatus="queued"|"assigned"|"in_review"|"completed"|"escalated";
export type Priority="critical"|"high"|"medium"|"low";
export interface ReferralCase{id:string;externalCaseId:string;sourceSystem:string;registrationNumber:string|null;makeRaw:string|null;modelRaw:string|null;variantRaw:string|null;fuelTypeRaw:string|null;ccRaw:string|null;requestedIdv:number|null;referralStatus:ReferralStatus;workflowStatus:WorkflowStatus;receivedAt:string;processedAt:string|null;correlationId:string;priority:Priority;owner:string|null;channel:string;state:string}
export interface ConditionRangeInput { min: number; max: number; midpoint?: number; raw?: string; }
export type ConditionTierKey = "good" | "very_good" | "excellent";
export type DecisionReasonCode="EXACT_IDV_MATCH"|"WITHIN_ABSOLUTE_TOLERANCE"|"WITHIN_PERCENTAGE_TOLERANCE"|"WITHIN_CONDITION_BAND"|"MISSING_REQUIRED_DATA"|"LOW_VEHICLE_CONFIDENCE"|"PROVIDER_FAILURE"|"TOLERANCE_EXCEEDED";
export interface DecisionConfig{absoluteTolerance:number;percentageTolerance:number;minimumVehicleConfidence:number;providerTimeoutSeconds:number;retryCount:number;reviewSlaMinutes:number}
export interface DecisionInput{requestedIdv:number|null;fetchedIdv:number|null;vehicleConfidence:number|null;providerStatus:ProviderStatus;conditions?:{good?:ConditionRangeInput;veryGood?:ConditionRangeInput;excellent?:ConditionRangeInput}|null}
export interface DecisionResult{decision:DecisionType;reasonCode:DecisionReasonCode;explanation:string;absoluteDelta:number|null;percentageDelta:number|null;matchedCondition?:ConditionTierKey|null}