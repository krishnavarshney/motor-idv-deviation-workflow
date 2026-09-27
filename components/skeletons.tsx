import { Card, CardAction, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionIndicator } from "@/components/section-progress";
import { cn } from "@/lib/utils";

/** Card-shaped fallback: same Card/CardHeader structure as the real section, live progress in the action slot. */
function CardShell({ description = true, className, children }: { description?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <Card aria-busy="true" className={className}>
      <CardHeader>
        <Skeleton className="h-5 w-40 max-w-full" />
        {description && <Skeleton className="my-0.5 h-4 w-72 max-w-full" />}
        <CardAction>
          <SectionIndicator />
        </CardAction>
      </CardHeader>
      {children}
    </Card>
  );
}

export function KpiRowSkeleton({ count = 4, foot = false }: { count?: number; foot?: boolean }) {
  return (
    <section aria-busy="true" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} size="sm">
          <CardHeader>
            <Skeleton className="my-0.5 h-4 w-24" />
            <CardAction>
              <Skeleton className="size-4" />
            </CardAction>
            <div className="flex h-8 items-center">{i === 0 ? <SectionIndicator /> : <Skeleton className="h-6 w-16" />}</div>
          </CardHeader>
          {foot && (
            <CardContent>
              <Skeleton className="h-3 w-32 max-w-full" />
            </CardContent>
          )}
        </Card>
      ))}
    </section>
  );
}

export function ChartSkeleton() {
  return (
    <CardShell>
      <CardContent>
        <Skeleton className="h-64 w-full" />
      </CardContent>
    </CardShell>
  );
}

/** `cols` = one width class per column, e.g. ["w-24", "w-40"]. */
export function TableSkeleton({ cols, rows = 8, description = true }: { cols: string[]; rows?: number; description?: boolean }) {
  const pad = (i: number) => cn(i === 0 && "pl-4", i === cols.length - 1 && "pr-4");
  return (
    <CardShell description={description} className="pb-0">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {cols.map((_, i) => (
              <TableHead key={i} className={pad(i)}>
                <Skeleton className="h-3 w-16" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }, (_, r) => (
            <TableRow key={r} className="hover:bg-transparent">
              {cols.map((w, i) => (
                <TableCell key={i} className={pad(i)}>
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className={cn("h-4", w)} />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </CardShell>
  );
}

export function DetailListSkeleton({ rows = 6, description = false }: { rows?: number; description?: boolean }) {
  return (
    <CardShell description={description}>
      <CardContent>
        <div className="flex flex-col divide-y">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center justify-between gap-4 py-2.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </CardContent>
    </CardShell>
  );
}

export function TimelineSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <CardShell description={false} className={className}>
      <CardContent>
        <div className="flex flex-col gap-4 border-l pl-4">
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-4 w-40 max-w-full" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
      </CardContent>
    </CardShell>
  );
}

export function EvidenceSkeleton() {
  return (
    <CardShell>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <Skeleton className="h-20" />
          <div className="hidden size-4 sm:block" />
          <Skeleton className="h-20" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-19" />
          <Skeleton className="h-19" />
        </div>
      </CardContent>
    </CardShell>
  );
}

export function VehicleSkeleton() {
  return (
    <CardShell>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-6 w-56 max-w-full" />
          <Skeleton className="h-4 w-36" />
        </div>
        <Skeleton className="h-10 rounded-lg" />
      </CardContent>
    </CardShell>
  );
}

export function FormSkeleton({ fields = 6 }: { fields?: number }) {
  return (
    <CardShell>
      <CardContent>
        <div className="grid gap-6 md:grid-cols-2">
          {Array.from({ length: fields }, (_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
          ))}
        </div>
      </CardContent>
      <CardFooter className="justify-end gap-2 border-t pt-4">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-36" />
      </CardFooter>
    </CardShell>
  );
}
