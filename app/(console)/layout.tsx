import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/api-auth";
import { can } from "@/lib/authz";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { Card } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandMenu } from "@/components/command-menu";
import { WorkerStatusPill } from "@/components/worker-status-pill";
import { getWorkerStatus } from "@/lib/worker-status";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const profile = await getSessionProfile(supabase);
  if (!profile) redirect("/login");
  const { user, role, fullName } = profile;
  if (!can(role, "view")) {
    return (
      <div className="flex min-h-svh items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ShieldAlert />
              </EmptyMedia>
              <EmptyTitle>No access</EmptyTitle>
              <EmptyDescription>Your account is inactive or has no role yet. Ask an admin to grant you access.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <form action="/auth/signout" method="post">
                <Button type="submit" variant="outline">
                  Sign out
                </Button>
              </form>
            </EmptyContent>
          </Empty>
        </Card>
      </div>
    );
  }
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  const worker = await getWorkerStatus(supabase);
  const [{ count: received }, { count: myReviews }] = await Promise.all([
    supabase.from("referral_cases").select("id", { count: "exact", head: true }).eq("referral_status", "received"),
    can(role, "review")
      ? supabase
          .from("manual_reviews")
          .select("id", { count: "exact", head: true })
          .neq("review_status", "completed")
          .or(`assigned_to.is.null,assigned_to.eq.${user.id}`)
      : Promise.resolve({ count: 0 }),
  ]);
  const badges = { "/referrals": received ?? 0, "/reviews": myReviews ?? 0 };

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar userEmail={user.email ?? ""} fullName={fullName} role={role} badges={badges} />
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <CommandMenu role={role} />
          <div className="ml-auto flex items-center gap-2">
            <WorkerStatusPill initialLastSeen={worker.lastSeenAt} />
          </div>
        </header>
        <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
