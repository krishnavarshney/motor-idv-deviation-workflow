import { NextResponse } from "next/server";
import { requireAction } from "@/lib/api-auth";
import { nextRunAt, validateScheduleInput } from "@/lib/schedule";

export async function POST(request: Request) {
  const auth = await requireAction("manage");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const v = validateScheduleInput(await request.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const input = v.value;

  const { data, error } = await supabase
    .from("automation_schedules")
    .insert({ ...input, next_run_at: nextRunAt(input.cron!, input.timezone!, new Date()).toISOString(), created_by: user.id })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await supabase.from("audit_events").insert({
    event_type: "schedule_created",
    actor_type: "user",
    actor_id: user.id,
    severity: "info",
    payload: { scheduleId: data.id, ...input },
  });
  return NextResponse.json({ id: data.id }, { status: 201 });
}
