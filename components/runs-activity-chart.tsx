"use client";

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const config = {
  succeeded: { label: "Succeeded", color: "var(--success)" },
  failed: { label: "Failed", color: "var(--destructive)" },
  cancelled: { label: "Cancelled", color: "var(--chart-4)" },
} satisfies ChartConfig;

export type RunsDay = { day: string; succeeded: number; failed: number; cancelled: number };

export function RunsActivityChart({ data }: { data: RunsDay[] }) {
  return (
    <ChartContainer config={config} className="aspect-auto h-44 w-full">
      <BarChart data={data} margin={{ left: 0, right: 0, top: 4 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={20} />
        <ChartTooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="succeeded" stackId="a" fill="var(--color-succeeded)" animationDuration={600} />
        <Bar dataKey="failed" stackId="a" fill="var(--color-failed)" animationDuration={600} />
        <Bar dataKey="cancelled" stackId="a" fill="var(--color-cancelled)" radius={[3, 3, 0, 0]} animationDuration={600} />
      </BarChart>
    </ChartContainer>
  );
}
