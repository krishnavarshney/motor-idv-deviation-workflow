import type { CSSProperties } from "react";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  CircleDot,
  ClipboardCheck,
  Cog,
  FlaskConical,
  Gauge,
  Inbox,
  RefreshCcw,
  Send,
  User,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DecisionBadge } from "@/components/status";
import { dateTime, humanize, money } from "@/lib/format";
import { cn } from "@/lib/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */
type AuditEvent = { id: string; event_type: string; actor_type: string; severity: string; created_at: string; payload?: any };

// Icon + tint per event family; unknown types fall back to a neutral dot.
const KIND: [RegExp, LucideIcon, string][] = [
  [/received/, Inbox, "bg-info/10 text-info"],
  [/review/, ClipboardCheck, "bg-warning/10 text-warning"],
  [/reconcile|band/, RefreshCcw, "bg-success/10 text-success"],
  [/worker|evaluat|decision|approv/, Gauge, "bg-foreground/5 text-foreground"],
  [/corehub|writeback|action/, Send, "bg-info/10 text-info"],
  [/test|simulat/, FlaskConical, "bg-foreground/5 text-foreground"],
  [/config|setting/, Cog, "bg-foreground/5 text-foreground"],
];
const ACTOR: Record<string, LucideIcon> = { user: User, automation: Bot, system: Cog };

function kind(e: AuditEvent): [LucideIcon, string] {
  if (e.severity === "error") return [AlertTriangle, "bg-destructive/10 text-destructive"];
  const k = KIND.find(([re]) => re.test(e.event_type));
  return k ? [k[1], k[2]] : [CircleDot, "bg-muted text-muted-foreground"];
}

function span(ms: number) {
  const m = Math.round(ms / 60_000);
  if (m < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`;
}
function ago(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  return ms < 60_000 ? "just now" : `${span(ms)} ago`;
}
function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

/** The facts worth reading without opening the raw payload. */
function Highlights({ p }: { p: any }) {
  if (!p || typeof p !== "object") return null;
  const chips: React.ReactNode[] = [];
  if (p.decision) chips.push(<DecisionBadge key="d" status={String(p.decision)} />);
  if (p.reasonCode) chips.push(<Badge key="r" variant="outline" className="font-mono">{p.reasonCode}</Badge>);
  if (p.matchedCondition) chips.push(<Badge key="m" variant="secondary" className="capitalize">{humanize(p.matchedCondition)} band</Badge>);
  if (p.dryRun) chips.push(<Badge key="dr" variant="secondary">Dry run</Badge>);
  const idv = p.requestedIdv != null || p.fetchedIdv != null;
  if (!chips.length && !idv && !p.notes && !p.explanation) return null;
  return (
    <div className="flex flex-col gap-2">
      {!!chips.length && <div className="flex flex-wrap gap-1.5">{chips}</div>}
      {idv && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {p.requestedIdv != null && (
            <span>
              Requested <span className="font-mono text-foreground tabular-nums">{money(p.requestedIdv)}</span>
            </span>
          )}
          {p.fetchedIdv != null && (
            <span>
              OBV <span className="font-mono text-foreground tabular-nums">{money(p.fetchedIdv)}</span>
            </span>
          )}
        </div>
      )}
      {(p.notes || p.explanation) && (
        <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground italic">{p.notes ?? p.explanation}</blockquote>
      )}
    </div>
  );
}

export function AuditTimeline({ events }: { events: AuditEvent[] }) {
  if (!events.length) return <p className="text-sm text-muted-foreground">No events recorded.</p>;

  const sorted = [...events].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const first = new Date(sorted.at(-1)!.created_at).getTime();
  const last = new Date(sorted[0].created_at).getTime();
  const actors = sorted.reduce<Record<string, number>>((m, e) => ((m[e.actor_type] = (m[e.actor_type] ?? 0) + 1), m), {});
  const groups = sorted.reduce<{ label: string; items: AuditEvent[] }[]>((g, e) => {
    const label = dayLabel(e.created_at);
    if (g.at(-1)?.label === label) g.at(-1)!.items.push(e);
    else g.push({ label, items: [e] });
    return g;
  }, []);
  let index = 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">
          {sorted.length} event{sorted.length === 1 ? "" : "s"}
        </span>
        <span className="text-muted-foreground">over {span(last - first)}</span>
        <span className="mx-1 h-4 w-px bg-border" />
        {Object.entries(actors).map(([a, n]) => {
          const Icon = ACTOR[a] ?? CircleDot;
          return (
            <Badge key={a} variant="secondary" className="capitalize">
              <Icon data-icon="inline-start" />
              {a} · {n}
            </Badge>
          );
        })}
      </div>

      {groups.map((g) => (
        <section key={g.label} className="flex flex-col gap-3">
          <h4 className="sticky top-14 z-[1] w-fit rounded-full border bg-background/90 px-2.5 py-0.5 text-xs font-medium text-muted-foreground backdrop-blur">
            {g.label}
          </h4>
          <ol className="relative flex flex-col">
            {/* Rail fades out toward the oldest event. */}
            <span aria-hidden className="absolute top-2 bottom-2 left-[15px] w-px bg-gradient-to-b from-border via-border to-transparent" />
            {g.items.map((e) => {
              const i = index++;
              const next = sorted[i + 1];
              const gap = next ? new Date(e.created_at).getTime() - new Date(next.created_at).getTime() : 0;
              const [Icon, tint] = kind(e);
              const Actor = ACTOR[e.actor_type] ?? CircleDot;
              const hasPayload = e.payload && Object.keys(e.payload).length > 0;
              return (
                <li
                  key={e.id}
                  className="relative flex gap-3 pb-5 duration-500 animate-in fade-in slide-in-from-left-2 fill-mode-backwards last:pb-0"
                  style={{ animationDelay: `${Math.min(i, 12) * 60}ms` } as CSSProperties}
                >
                  <span className={cn("relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-card", tint)}>
                    {i === 0 && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-current opacity-20" />}
                    <Icon className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/40">
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <span className="text-sm font-medium capitalize">{humanize(e.event_type)}</span>
                      <span className="text-xs text-muted-foreground tabular-nums" title={dateTime(e.created_at)}>
                        {ago(e.created_at)} · {new Date(e.created_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1 capitalize">
                        <Actor className="size-3" />
                        {e.actor_type}
                      </span>
                      {e.severity !== "info" && (
                        <Badge variant={e.severity === "error" ? "destructive" : "warning"} className="capitalize">
                          {e.severity}
                        </Badge>
                      )}
                    </div>
                    <Highlights p={e.payload} />
                    {hasPayload && (
                      <details className="group text-xs">
                        <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                          <ChevronDown className="size-3 transition-transform group-open:rotate-180" />
                          Details
                        </summary>
                        <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-[11px] break-all whitespace-pre-wrap duration-200 animate-in fade-in">
                          {JSON.stringify(e.payload, null, 2)}
                        </pre>
                      </details>
                    )}
                  </div>
                  {gap > 0 && (
                    <span className="absolute -bottom-0.5 left-9 z-10 translate-y-1/2 rounded-full border bg-background px-1.5 text-[10px] text-muted-foreground tabular-nums">
                      {span(gap)} earlier
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
