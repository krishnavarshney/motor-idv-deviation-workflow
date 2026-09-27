import { NextResponse } from "next/server";
import { requireAction } from "@/lib/api-auth";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAction("run_jobs");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const { data } = await supabase
    .from("automation_jobs")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "queued")
    .select("id");
  if (!data?.length) return NextResponse.json({ error: "Only queued jobs can be cancelled" }, { status: 409 });

  await supabase.from("audit_events").insert({
    event_type: "automation_job_cancelled",
    actor_type: "user",
    actor_id: user.id,
    severity: "info",
    payload: { jobId: id },
  });
  return NextResponse.json({ ok: true });
}
