"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, CircleOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { isWorkerOnline } from "@/lib/worker-status";
import { dateTime } from "@/lib/format";

export function WorkerStatusPill({ initialLastSeen }: { initialLastSeen: string | null }) {
  const [lastSeen, setLastSeen] = useState(initialLastSeen);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const supabase = createClient();
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("worker_heartbeats")
        .select("last_seen_at")
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setLastSeen(data?.last_seen_at ?? null);
      setNow(Date.now());
    }, 15_000);
    return () => clearInterval(timer);
  }, []);

  const online = isWorkerOnline(lastSeen, now);
  return (
    <Badge variant={online ? "success" : "destructive"} asChild>
      <Link href="/automation" title={lastSeen ? `Last heartbeat ${dateTime(lastSeen)}` : "No heartbeat received"}>
        {online ? <Activity data-icon="inline-start" /> : <CircleOff data-icon="inline-start" />}
        Worker {online ? "online" : "offline"}
      </Link>
    </Badge>
  );
}
