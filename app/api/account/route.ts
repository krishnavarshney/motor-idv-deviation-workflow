import { NextResponse } from "next/server";
import { requireAction } from "@/lib/api-auth";

export async function PATCH(request: Request) {
  const auth = await requireAction("view");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const body = await request.json().catch(() => null);
  const fullName = typeof body?.full_name === "string" ? body.full_name.trim() : "";
  if (!fullName || fullName.length > 80) return NextResponse.json({ error: "Name must be 1–80 characters" }, { status: 400 });

  const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await supabase.from("audit_events").insert({
    event_type: "profile_updated",
    actor_type: "user",
    actor_id: user.id,
    severity: "info",
    payload: { fields: ["full_name"] },
  });
  return NextResponse.json({ ok: true });
}
