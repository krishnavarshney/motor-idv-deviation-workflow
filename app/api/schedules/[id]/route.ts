import { NextResponse } from "next/server";
import { requireAction } from "@/lib/api-auth";
import { nextRunAt, validateScheduleInput } from "@/lib/schedule";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const auth = await requireAction("manage");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const v = validateScheduleInput(await request.json().catch(() => null), { partial: true });
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const patch: Record<string, unknown> = { ...v.value };

  const { data: current } = await supabase.from("automation_schedules").select("cron,timezone").eq("id", id).maybeSingle();
  if (!current) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  // Re-anchor from now so enabling an old schedule doesn't fire a backlog slot immediately.
  if (v.value.cron !== undefined || v.value.timezone !== undefined || v.value.enabled !== undefined) {
    patch.next_run_at = nextRunAt(v.value.cron ?? current.cron, v.value.timezone ?? current.timezone, new Date()).toISOString();
  }

  const { error } = await supabase.from("automation_schedules").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await supabase.from("audit_events").insert({
    event_type: "schedule_updated",
    actor_type: "user",
    actor_id: user.id,
    severity: "info",
    payload: { scheduleId: id, ...v.value },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const auth = await requireAction("manage");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const { data } = await supabase.from("automation_schedules").delete().eq("id", id).select("id,name");
  if (!data?.length) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  await supabase.from("audit_events").insert({
    event_type: "schedule_deleted",
    actor_type: "user",
    actor_id: user.id,
    severity: "info",
    payload: { scheduleId: id, name: data[0].name },
  });
  return NextResponse.json({ ok: true });
}
