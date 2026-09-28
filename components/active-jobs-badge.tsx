"use client";

import { useEffect, useState } from "react";
import { SidebarMenuBadge } from "@/components/ui/sidebar";
import { createClient } from "@/lib/supabase/client";

/**
 * Live count of queued + running automation jobs, with a pulsing dot while anything runs.
 * Recounts on job inserts/status changes only (progress heartbeats are ignored), so it stays cheap.
 */
export function ActiveJobsBadge({ initial }: { initial: { queued: number; running: number } }) {
  const [counts, setCounts] = useState(initial);

  useEffect(() => {
    const supabase = createClient();
    const recount = async () => {
      const { data } = await supabase.from("automation_jobs").select("status").in("status", ["queued", "running"]);
      const rows = (data ?? []) as { status: string }[];
      setCounts({ queued: rows.filter((r) => r.status === "queued").length, running: rows.filter((r) => r.status === "running").length });
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel("sidebar:active-jobs")
      .on("postgres_changes", { event: "*", schema: "public", table: "automation_jobs" }, (p: { eventType: string; old: unknown; new: unknown }) => {
        const before = (p.old as { status?: string } | null)?.status;
        const after = (p.new as { status?: string } | null)?.status;
        if (p.eventType === "UPDATE" && before !== undefined && before === after) return;
        clearTimeout(timer);
        timer = setTimeout(recount, 300);
      })
      .subscribe();
    // Realtime UPDATE payloads may omit the old row; a slow poll keeps the badge honest either way.
    const poll = setInterval(recount, 15_000);
    return () => {
      clearTimeout(timer);
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, []);

  const total = counts.queued + counts.running;
  if (!total) return null;
  return (
    <SidebarMenuBadge
      className="gap-1.5"
      title={[counts.running && `${counts.running} running`, counts.queued && `${counts.queued} queued`].filter(Boolean).join(", ")}
    >
      <span className="relative flex size-2">
        {counts.running > 0 && <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />}
        <span className={"relative inline-flex size-2 rounded-full " + (counts.running ? "bg-success" : "bg-warning")} />
      </span>
      {total}
    </SidebarMenuBadge>
  );
}
