import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import { AppSidebar } from "@/components/app-sidebar";
import { CommandMenu } from "@/components/command-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { WorkerStatusPill } from "@/components/worker-status-pill";
import { getWorkerStatus } from "@/lib/worker-status";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  const worker = await getWorkerStatus(supabase);

  return (
    <SidebarProvider defaultOpen={sidebarOpen}>
      <AppSidebar userEmail={user.email ?? ""} />
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <CommandMenu />
          <div className="ml-auto flex items-center gap-2">
            <WorkerStatusPill initialLastSeen={worker.lastSeenAt} />
            <ThemeToggle />
          </div>
        </header>
        <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
