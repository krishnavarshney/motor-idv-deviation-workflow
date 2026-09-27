import { NextResponse } from "next/server";
import { requireAction } from "@/lib/api-auth";
import type { Role } from "@/lib/authz";
import { parseTeamPatch, teamChangeError } from "@/lib/team";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAction("manage");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const parsed = parseTeamPatch(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const patch = parsed.value;

  const admin = createAdminClient();
  const [{ data: target }, { count: activeAdminCount }] = await Promise.all([
    admin.from("profiles").select("role,is_active").eq("id", id).maybeSingle(),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin").eq("is_active", true),
  ]);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const blocked = teamChangeError({
    actorId: user.id,
    targetId: id,
    target: target as { role: Role; is_active: boolean },
    patch,
    activeAdminCount: activeAdminCount ?? 0,
  });
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });

  const { error } = await admin.from("profiles").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Deactivation also blocks sign-in, not just RLS privileges.
  if (patch.is_active !== undefined) {
    await admin.auth.admin.updateUserById(id, { ban_duration: patch.is_active ? "none" : "876000h" });
  }

  await supabase.from("audit_events").insert({
    event_type: "team_member_updated",
    actor_type: "user",
    actor_id: user.id,
    severity: "info",
    payload: { userId: id, before: target, changes: patch },
  });
  return NextResponse.json({ ok: true });
}
