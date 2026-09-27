import { NextResponse } from "next/server";
import { requireAction } from "@/lib/api-auth";
import { ROLES, type Role } from "@/lib/authz";
import { isEmail } from "@/lib/team";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const auth = await requireAction("manage");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role: Role = ROLES.includes(body?.role) ? body.role : "operator";
  if (!isEmail(email)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: new URL("/account?welcome=1", request.url).toString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // handle_new_user() created the profile as operator; set the chosen role.
  let roleError: string | null = null;
  if (role !== "operator") {
    const { error: updateError } = await admin.from("profiles").update({ role }).eq("id", data.user.id);
    if (updateError) roleError = updateError.message;
  }

  await supabase.from("audit_events").insert({
    event_type: "team_member_invited",
    actor_type: "user",
    actor_id: user.id,
    severity: "info",
    payload: { invitedUserId: data.user.id, email, role: roleError ? "operator" : role },
  });

  if (roleError) {
    return NextResponse.json(
      { id: data.user.id, warning: "Invited, but the role could not be set — it is operator. Change it from the Team page." },
      { status: 207 },
    );
  }
  return NextResponse.json({ id: data.user.id }, { status: 201 });
}
