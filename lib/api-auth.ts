import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { can, type Action, type Role } from "@/lib/authz";

type Db = Awaited<ReturnType<typeof createClient>>;

/** Current user and their role; role is null for inactive or profile-less users. */
export async function getSessionProfile(supabase: Db) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("role,is_active,full_name").eq("id", user.id).maybeSingle();
  return {
    user,
    role: (data?.is_active ? data.role : null) as Role | null,
    fullName: (data?.full_name as string | null) ?? null,
  };
}

export async function requireAction(
  action: Action,
): Promise<{ ok: true; supabase: Db; user: User; role: Role } | { ok: false; response: NextResponse }> {
  const supabase = await createClient();
  const profile = await getSessionProfile(supabase);
  if (!profile) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!profile.role || !can(profile.role, action)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, supabase, user: profile.user, role: profile.role };
}

/** Server-page guard: sign-in required, and a 404 (not a hint) for roles without access. */
export async function requirePageAction(action: Action) {
  const supabase = await createClient();
  const profile = await getSessionProfile(supabase);
  if (!profile) redirect("/login");
  if (!can(profile.role, action)) notFound();
  return { supabase, ...profile };
}
