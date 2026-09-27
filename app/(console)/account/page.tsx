import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList, PageHeader } from "@/components/console";
import { NameForm, PasswordForm } from "@/components/account-forms";
import { getSessionProfile } from "@/lib/api-auth";
import { dateTime, humanize } from "@/lib/format";

export const metadata = { title: "Profile" };

export default async function Account({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  const supabase = await createClient();
  const profile = await getSessionProfile(supabase);
  if (!profile) redirect("/login");
  const { data: events } = await supabase
    .from("audit_events")
    .select("id,event_type,created_at,case_id")
    .eq("actor_id", profile.user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <>
      <PageHeader eyebrow="Account" title="Profile" description="Your name, password and recent activity." />

      {welcome && (
        <Alert>
          <KeyRound />
          <AlertTitle>Welcome</AlertTitle>
          <AlertDescription>Set a password below to finish setting up your account.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>Your role is managed by an admin.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <DetailList
              items={[
                ["Email", <span key="e" className="normal-case">{profile.user.email}</span>],
                ["Role", profile.role ?? "No access"],
                ["Last sign-in", dateTime(profile.user.last_sign_in_at)],
              ]}
            />
            <NameForm initial={profile.fullName ?? ""} />
          </CardContent>
        </Card>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Password</CardTitle>
          </CardHeader>
          <CardContent>
            <PasswordForm />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>My activity</CardTitle>
          <CardDescription>Your last 20 recorded actions</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y text-sm">
            {(events ?? []).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-4 py-2">
                <span className="capitalize">{humanize(e.event_type)}</span>
                <span className="text-xs text-muted-foreground">{dateTime(e.created_at)}</span>
              </li>
            ))}
            {!events?.length && <li className="py-2 text-muted-foreground">No activity yet.</li>}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
