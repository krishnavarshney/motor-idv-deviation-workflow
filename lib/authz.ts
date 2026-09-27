export type Role = "operator" | "underwriter" | "auditor" | "admin";
export type Action = "view" | "run_jobs" | "review" | "test_lookup" | "manage" | "audit";

const MATRIX: Record<Action, readonly Role[]> = {
  view: ["operator", "underwriter", "auditor", "admin"],
  run_jobs: ["operator", "underwriter", "admin"],
  review: ["underwriter", "admin"],
  test_lookup: ["underwriter", "admin"],
  manage: ["admin"],
  audit: ["auditor", "admin"],
};

export function can(role: string | null | undefined, action: Action): boolean {
  return !!role && (MATRIX[action] as readonly string[]).includes(role);
}
