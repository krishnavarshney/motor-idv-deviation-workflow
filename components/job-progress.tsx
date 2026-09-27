import { Progress } from "@/components/ui/progress";

type JobProgressValue = { current_step?: string; done?: number; total?: number } | null;

export function JobProgress({ progress, status }: { progress: JobProgressValue; status: string }) {
  if (status === "queued") return <span className="text-sm text-muted-foreground">Waiting for worker…</span>;
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  return (
    <div className="flex min-w-48 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-4 text-sm">
        <span>{progress?.current_step ?? "Starting"}</span>
        {total > 0 && (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {done}/{total} cases
          </span>
        )}
      </div>
      {total > 0 && <Progress value={(done / total) * 100} aria-label="Job progress" className="h-1.5" />}
    </div>
  );
}
