import { NextResponse } from "next/server";
import { requireAction } from "@/lib/api-auth";
import { getWorkerStatus } from "@/lib/worker-status";
import { MAX_ACTIONS_PER_JOB } from "@/lib/corehub-actions";
import { enqueueCorehubActions } from "@/lib/corehub-enqueue";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST { case_ids } — a person confirms sending each case's console decision to CoreHub.
 * Returns { jobId, queued, dryRun, blocked: [{case_id, blocked}] }.
 */
export async function POST(request: Request) {
  const auth = await requireAction("review");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.case_ids) ? [...new Set(body.case_ids as unknown[])] : [];
  if (!ids.length || ids.length > MAX_ACTIONS_PER_JOB || !ids.every((x) => typeof x === "string" && UUID.test(x))) {
    return NextResponse.json({ error: `Select between 1 and ${MAX_ACTIONS_PER_JOB} cases` }, { status: 400 });
  }

  const worker = await getWorkerStatus(supabase);
  if (!worker.online) return NextResponse.json({ error: "Automation worker is offline" }, { status: 409 });

  const r = await enqueueCorehubActions(supabase, user.id, ids as string[]);
  if (!r.ok) return NextResponse.json({ error: r.error, blocked: r.blocked }, { status: r.status });
  return NextResponse.json({ jobId: r.jobId, queued: r.queued.length, dryRun: r.dryRun, blocked: r.blocked }, { status: 202 });
}
