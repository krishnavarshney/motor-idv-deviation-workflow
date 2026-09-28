import { CheckCircle2, CircleDot, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList } from "@/components/console";
import { DecisionBadge } from "@/components/status";
import { dateTime, money } from "@/lib/format";

/* eslint-disable @typescript-eslint/no-explicit-any */
type CheckRow = { key?: string; label: string; ok: boolean | null; detail: string };

export function CheckList({ checks }: { checks: CheckRow[] | null | undefined }) {
  if (!checks?.length) return <p className="text-sm text-muted-foreground">No checks recorded.</p>;
  return (
    <ul className="flex flex-col gap-2 text-sm">
      {checks.map((c) => {
        const Icon = c.ok === false ? XCircle : c.ok ? CheckCircle2 : CircleDot;
        return (
          <li key={c.key ?? c.label} className="flex gap-2">
            <Icon className={"mt-0.5 size-4 shrink-0 " + (c.ok === false ? "text-destructive" : c.ok ? "text-success" : "text-muted-foreground")} />
            <div>
              <div className="font-medium">{c.label}</div>
              <div className="text-xs text-muted-foreground">{c.detail}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value == null || (Array.isArray(value) && !value.length)) return null;
  return (
    <details className="rounded-md border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">{label}</summary>
      <pre className="max-h-96 overflow-auto border-t bg-muted/40 p-3 font-mono text-xs leading-relaxed">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function LogList({ log }: { log: { at: string; msg?: string; detail?: string; step?: string; data?: unknown }[] }) {
  return (
    <ol className="flex flex-col gap-2 border-l pl-4 text-sm">
      {log.map((l, i) => (
        <li key={i}>
          <div>{l.msg ?? l.detail}</div>
          <div className="text-xs text-muted-foreground">
            {new Date(l.at).toLocaleTimeString("en-IN")}
            {l.step ? ` · ${l.step}` : ""}
          </div>
          {l.data !== undefined && <JsonBlock label="Data" value={l.data} />}
        </li>
      ))}
    </ol>
  );
}

/** What CoreHub showed at fetch time, and every Approve/Reject attempt with its checks and log. */
export function CorehubEvidence({ caseRow, actions, sendButton }: { caseRow: any; actions: any[]; sendButton?: React.ReactNode }) {
  const ch = caseRow.metadata?.corehub;
  const review = ch?.review;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="self-start">
        <CardHeader>
          <CardTitle>CoreHub at fetch</CardTitle>
          <CardDescription>{ch?.fetched_at ? `Read ${dateTime(ch.fetched_at)}` : "Not read from the review page"}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {review && (
            <div>
              <div className="font-medium">{review.title ?? "—"}</div>
              <div className="text-sm text-muted-foreground">{review.subtitle ?? ""}</div>
            </div>
          )}
          <DetailList
            items={[
              ["Quote", <span key="q" className="font-mono">{caseRow.metadata?.quote_id ?? "—"}</span>],
              ["Quote status", ch?.quote_status ?? "—"],
              ["Requested IDV", <span key="i" className="font-mono">{money(caseRow.requested_idv)}</span>],
              ["CoreHub IDV range", ch?.idv_range ? `${money(ch.idv_range.min)} – ${money(ch.idv_range.max)}` : "—"],
              ...Object.entries((review?.fields ?? {}) as Record<string, string>)
                .filter(([k]) => k !== "IDV")
                .map(([k, v]) => [k, v] as [string, string]),
            ]}
          />
          <CheckList checks={ch?.checks} />
          <JsonBlock label="Quote vehicle_details (API)" value={caseRow.metadata?.vehicle_details} />
          {review?.url && (
            <a href={review.url} target="_blank" rel="noreferrer" className="w-fit text-sm underline underline-offset-4">
              Open in CoreHub
            </a>
          )}
        </CardContent>
      </Card>

      <Card className="self-start">
        <CardHeader>
          <CardTitle>CoreHub actions</CardTitle>
          <CardDescription>Each attempt re-checks the live referral before clicking.</CardDescription>
          {sendButton && <CardAction>{sendButton}</CardAction>}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!actions.length && <p className="text-sm text-muted-foreground">Nothing sent to CoreHub yet.</p>}
          {actions.map((a) => (
            <div key={a.id} className="flex flex-col gap-3 rounded-lg border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={a.action === "approve" ? "success" : "destructive"} className="capitalize">
                  {a.action}
                </Badge>
                <DecisionBadge status={a.status} />
                {a.dry_run && <Badge variant="secondary">Dry run</Badge>}
                <span className="ml-auto text-xs text-muted-foreground">{dateTime(a.created_at)}</span>
              </div>
              {a.reason && <p className="text-sm">Reason: “{a.reason}”</p>}
              {a.error && <p className="text-sm text-destructive">{a.error}</p>}
              <CheckList checks={a.checks} />
              {Array.isArray(a.log) && a.log.length > 0 && <LogList log={a.log} />}
              <JsonBlock label="CoreHub response" value={a.corehub_response} />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

/** Step-by-step OBV lookup log (catalog matching at each level, then the valuation). */
export function ObvLog({ log }: { log: any[] | null | undefined }) {
  if (!log?.length) return null;
  return (
    <Card className="self-start xl:col-span-2">
      <CardHeader>
        <CardTitle>Lookup log</CardTitle>
        <CardDescription>How the CoreHub vehicle was matched to OBV's catalogue and valued</CardDescription>
      </CardHeader>
      <CardContent>
        <LogList log={log} />
      </CardContent>
    </Card>
  );
}
