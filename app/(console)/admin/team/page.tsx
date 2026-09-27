import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/console";
import { InviteDialog, TeamTable, type Member } from "@/components/team-table";
import { requirePageAction } from "@/lib/api-auth";
import type { Role } from "@/lib/authz";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Team" };

export default async function Team() {
  const { user } = await requirePageAction("manage");
  const admin = createAdminClient();
  const [{ data: users }, { data: profiles }] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 200 }),
    admin.from("profiles").select("id,full_name,role,is_active"),
  ]);
  const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]));
  const members: Member[] = (users?.users ?? [])
    .map((u) => {
      const p = byId.get(u.id);
      return {
        id: u.id,
        name: (p?.full_name as string | null) ?? null,
        email: u.email ?? "",
        role: ((p?.role as Role | undefined) ?? "operator") as Role,
        is_active: (p?.is_active as boolean | undefined) ?? false,
        last_sign_in_at: u.last_sign_in_at ?? null,
      };
    })
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));

  return (
    <>
      <PageHeader eyebrow="Admin" title="Team" description="Who can use the console and what they can do." />
      <Card className="pb-0">
        <CardHeader>
          <CardTitle>{members.length} members</CardTitle>
          <CardDescription>Operators run fetches and evaluations; underwriters also review; auditors read the audit log; admins manage everything.</CardDescription>
          <CardAction>
            <InviteDialog />
          </CardAction>
        </CardHeader>
        <TeamTable members={members} currentUserId={user.id} />
      </Card>
    </>
  );
}
