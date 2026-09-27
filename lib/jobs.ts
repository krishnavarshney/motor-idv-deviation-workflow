export const MAX_CASES_PER_JOB = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type JobRequest = { type: "fetch" } | { type: "evaluate"; case_ids: string[] } | { type: "evaluate"; all_received: true };

export function parseJobRequest(body: unknown): { ok: true; value: JobRequest } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (b.type === "fetch") return { ok: true, value: { type: "fetch" } };
  if (b.type !== "evaluate") return { ok: false, error: "type must be fetch or evaluate" };
  if (b.all_received === true) return { ok: true, value: { type: "evaluate", all_received: true } };
  if (!Array.isArray(b.case_ids) || !b.case_ids.every((x) => typeof x === "string" && UUID.test(x))) {
    return { ok: false, error: "case_ids must be an array of case UUIDs" };
  }
  const case_ids = [...new Set(b.case_ids as string[])];
  if (!case_ids.length || case_ids.length > MAX_CASES_PER_JOB) {
    return { ok: false, error: `Select between 1 and ${MAX_CASES_PER_JOB} cases` };
  }
  return { ok: true, value: { type: "evaluate", case_ids } };
}
