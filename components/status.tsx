import { CheckCircle2, CircleDashed, Clock, Loader, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { humanize } from "@/lib/format";

// Status never relies on colour alone: each tone carries its own icon.
const TONES = {
  success: CheckCircle2,
  warning: Clock,
  destructive: XCircle,
  info: Loader,
  secondary: CircleDashed,
} as const;

function tone(status: string): keyof typeof TONES {
  const s = status.toLowerCase();
  if (s === "succeeded" || s === "completed" || s === "dry_run_completed") return "success";
  if (s === "running" || s === "queued") return "info";
  if (s.includes("approved")) return "success";
  if (s.includes("review") || s.includes("pending")) return "warning";
  if (s.includes("failed") || s.includes("rejected") || s === "error") return "destructive";
  if (s.includes("processing")) return "info";
  return "secondary";
}

export function DecisionBadge({ status, className }: { status: string; className?: string }) {
  const t = tone(status);
  const Icon = TONES[t];
  return (
    <Badge variant={t} className={cn("capitalize", className)}>
      <Icon data-icon="inline-start" />
      {humanize(status)}
    </Badge>
  );
}

export function ConfidenceMeter({ score, threshold = 0.85 }: { score: number | null; threshold?: number }) {
  const pct = Math.max(0, Math.min(100, (score ?? 0) * 100));
  const ok = (score ?? 0) >= threshold;
  return (
    <div className="flex items-center gap-2">
      <Progress
        value={pct}
        aria-label="Match confidence"
        className={cn("h-1.5 w-20", ok ? "[&>*]:bg-success" : "[&>*]:bg-warning")}
      />
      <span className="font-mono text-xs tabular-nums text-muted-foreground">{score == null ? "—" : pct.toFixed(0) + "%"}</span>
    </div>
  );
}
