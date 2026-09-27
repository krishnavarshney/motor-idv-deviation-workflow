"use client";

import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const config = {
  approved: { label: "Approved", color: "var(--success)" },
  manual_review: { label: "Manual review", color: "var(--warning)" },
  failed: { label: "Failed / rejected", color: "var(--destructive)" },
  other: { label: "In flight", color: "var(--chart-2)" },
} satisfies ChartConfig;

export type IntakeDay = { day: string; approved: number; manual_review: number; failed: number; other: number };

export function IntakeChart({ data }: { data: IntakeDay[] }) {
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full">
      <BarChart data={data} margin={{ left: 0, right: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="approved" stackId="a" fill="var(--color-approved)" />
        <Bar dataKey="manual_review" stackId="a" fill="var(--color-manual_review)" />
        <Bar dataKey="failed" stackId="a" fill="var(--color-failed)" />
        <Bar dataKey="other" stackId="a" fill="var(--color-other)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
