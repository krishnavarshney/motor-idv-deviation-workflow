import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { TableCell, TableRow } from "@/components/ui/table";
import { NumberTicker } from "@/components/ui/number-ticker";
import { MagicCard } from "@/components/ui/magic-card";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow && <div className="text-xs font-medium tracking-wide text-primary uppercase">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function KpiCard({ label, value, foot, icon: Icon }: { label: string; value: number | string; foot?: string; icon: LucideIcon }) {
  return (
    <MagicCard className="rounded-xl">
      <Card size="sm" className="bg-transparent ring-0">
        <CardHeader>
          <CardDescription>{label}</CardDescription>
          <CardAction>
            <Icon className="size-4 text-muted-foreground" />
          </CardAction>
          <CardTitle className="text-2xl font-semibold tracking-tight tabular-nums">
            {typeof value === "number" ? value === 0 ? "0" : <NumberTicker value={value} /> : value}
          </CardTitle>
        </CardHeader>
        {foot && <CardContent className="text-xs text-muted-foreground">{foot}</CardContent>}
      </Card>
    </MagicCard>
  );
}

export function EmptyRow({
  colSpan,
  icon: Icon,
  title,
  description,
}: {
  colSpan: number;
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan}>
        <Empty className="py-10">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Icon />
            </EmptyMedia>
            <EmptyTitle>{title}</EmptyTitle>
            {description && <EmptyDescription>{description}</EmptyDescription>}
          </EmptyHeader>
        </Empty>
      </TableCell>
    </TableRow>
  );
}

export function DetailList({ items }: { items: [label: string, value: React.ReactNode][] }) {
  return (
    <dl className="flex flex-col divide-y text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-4 py-2.5">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right font-medium capitalize">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stat({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1 rounded-lg border bg-muted/40 p-4", className)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xl font-semibold tracking-tight tabular-nums">{value}</span>
    </div>
  );
}
