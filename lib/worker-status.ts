import type { SupabaseClient } from "@supabase/supabase-js";

export const WORKER_OFFLINE_AFTER_MS = 2 * 60_000;

export function isWorkerOnline(lastSeenAt: string | null | undefined, now = Date.now()): boolean {
  return !!lastSeenAt && now - new Date(lastSeenAt).getTime() < WORKER_OFFLINE_AFTER_MS;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getWorkerStatus(supabase: SupabaseClient<any, any, any>) {
  const { data } = await supabase
    .from("worker_heartbeats")
    .select("last_seen_at,current_job_id")
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    online: isWorkerOnline(data?.last_seen_at),
    lastSeenAt: (data?.last_seen_at as string | undefined) ?? null,
    currentJobId: (data?.current_job_id as string | undefined) ?? null,
  };
}
