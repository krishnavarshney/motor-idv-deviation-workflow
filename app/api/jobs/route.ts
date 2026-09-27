import { NextResponse } from "next/server";
import { requireAction } from "@/lib/api-auth";
import { parseJobRequest } from "@/lib/jobs";
import { createAdminClient } from "@/lib/supabase/admin";
import { getWorkerStatus } from "@/lib/worker-status";

export async function POST(request: Request) {
  const auth = await requireAction("run_jobs");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const parsed = parseJobRequest(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const req = parsed.value;

  const worker = await getWorkerStatus(supabase);
  if (!worker.online) return NextResponse.json({ error: "Automation worker is offline" }, { status: 409 });

  if (req.type === "fetch") {
    const { count } = await supabase
      .from("automation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("type", "fetch")
      .in("status", ["queued", "running"]);
    if (count) return NextResponse.json({ error: "A CoreHub fetch is already queued or running" }, { status: 409 });
  }

  const params = {
    dry_run: process.env.AUTOMATION_DRY_RUN !== "false",
    completion_mode: "in_app",
    ...(req.type === "evaluate" ? ("all_received" in req ? { all_received: true } : { case_ids: req.case_ids }) : {}),
  };
  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "Automation is not configured" }, { status: 500 });
  }
  const { data, error } = await admin
    .from("automation_jobs")
    .insert({ type: req.type, params, requested_by: user.id })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await supabase.from("audit_events").insert({
    event_type: "automation_job_requested",
    actor_type: "user",
    actor_id: user.id,
    severity: "info",
    payload: { jobId: data.id, type: req.type, params },
  });
  return NextResponse.json({ id: data.id }, { status: 202 });
}
