"use client";

import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";

export type DurationPoint = { id: string; label: string; type: string; status: string; seconds: number; when: string };

const config = {
  succeeded: { label: "Succeeded", color: "var(--success)" },
  failed: { label: "Failed", color: "var(--destructive)" },
  cancelled: { label: "Cancelled", color: "var(--chart-4)" },
} satisfies ChartConfig;

/** One bar per finished job (oldest → newest): how long it ran, coloured by outcome. Click opens the job. */
export function JobDurationChart({ data }: { data: DurationPoint[] }) {
  const router = useRouter();
  const avg = data.length ? data.reduce((n, d) => n + d.seconds, 0) / data.length : 0;
  return (
    <ChartContainer config={config} className="aspect-auto h-48 w-full">
      <BarChart data={data} margin={{ left: 0, right: 8, top: 12 }} onClick={(s) => data[Number(s?.activeIndex)] && router.push(`/automation/jobs/${data[Number(s?.activeIndex)].id}`)}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} />
        <YAxis width={36} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}s`} />
        {avg > 0 && <ReferenceLine y={avg} stroke="var(--muted-foreground)" strokeDasharray="4 4" label={{ value: `avg ${avg.toFixed(0)}s`, position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 10 }} />}
        <ChartTooltip
          cursor={{ fill: "var(--muted)" }}
          content={({ active, payload }) => {
            const p = payload?.[0]?.payload as DurationPoint | undefined;
            if (!active || !p) return null;
            return (
              <div className="grid gap-0.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
                <span className="font-medium capitalize">
                  {p.type} · {p.status}
                </span>
                <span className="font-mono tabular-nums">{p.seconds}s</span>
                <span className="text-muted-foreground">{p.when}</span>
              </div>
            );
          }}
        />
        <Bar dataKey="seconds" radius={[3, 3, 0, 0]} className="cursor-pointer" animationDuration={600}>
          {data.map((d) => (
            <Cell key={d.id} fill={`var(--color-${d.status in config ? d.status : "cancelled"})`} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
