/**
 * What CoreHub action a case is ready for — decided on the server from the case's console decision,
 * never taken from the client. Pure, so the console and the API agree (tests/corehub-actions.test.ts).
 */

export type CorehubActionKind = "approve" | "reject";
export type LatestAction = { status: string; action: string } | null;

export interface ActionCase {
  id: string;
  source_system: string;
  referral_status: string;
}

export type ActionPlan =
  | { case_id: string; action: CorehubActionKind; reason: string | null }
  | { case_id: string; blocked: string };

export const MAX_ACTIONS_PER_JOB = 50;
const REASON_MIN = 3;

/**
 * @param latest       most recent CoreHub action for the case, if any
 * @param rejectionNote the underwriter's notes on a rejected case — sent to CoreHub as the reason
 */
export function planCorehubAction(c: ActionCase, latest: LatestAction, rejectionNote: string | null): ActionPlan {
  const blocked = (why: string) => ({ case_id: c.id, blocked: why });
  if (c.source_system !== "corehub-browser") return blocked("Not a CoreHub referral");
  if (latest?.status === "succeeded") return blocked(`Already ${latest.action === "approve" ? "approved" : "rejected"} in CoreHub`);
  if (latest && ["queued", "running"].includes(latest.status)) return blocked("A CoreHub action is already in progress");
  if (c.referral_status === "approved") return { case_id: c.id, action: "approve", reason: null };
  if (c.referral_status === "rejected") {
    const note = rejectionNote?.trim() ?? "";
    return note.length >= REASON_MIN
      ? { case_id: c.id, action: "reject", reason: note }
      : blocked("Rejected without reviewer notes — CoreHub needs a reason");
  }
  return blocked(c.referral_status === "manual_review" ? "Waiting for an underwriter decision" : `Not decided yet (${c.referral_status})`);
}
