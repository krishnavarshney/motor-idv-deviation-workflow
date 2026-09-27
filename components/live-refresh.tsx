"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Re-renders the current server page when any listed table changes (Supabase Realtime). */
export function LiveRefresh({ tables }: { tables: string[] }) {
  const router = useRouter();
  const key = tables.join(",");

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase.channel("live:" + key);
    for (const table of key.split(",")) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => router.refresh(), 500);
      });
    }
    channel.subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [key, router]);

  return null;
}
