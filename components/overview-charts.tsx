"use client";

import { Area, AreaChart, CartesianGrid, Cell, Label, Pie, PieChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

export type MixSlice = { key: "auto" | "underwriter" | "review" | "failed"; value: number };

const mixConfig = {
  auto: { label: "Auto-approved", color: "var(--success)" },
  underwriter: { label: "Underwriter decided", color: "var(--info)" },
  review: { label: "Awaiting review", color: "var(--warning)" },
  failed: { label: "Failed", color: "var(--destructive)" },
} satisfies ChartConfig;

/** Share of cases by how they were (or will be) decided. */
export function DecisionDonut({ data }: { data: MixSlice[] }) {
  const total = data.reduce((n, d) => n + d.value, 0);
  const auto = data.find((d) => d.key === "auto")?.value ?? 0;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <ChartContainer config={mixConfig} className="aspect-square h-44 shrink-0">
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent nameKey="key" hideLabel />} />
          <Pie data={total ? data : [{ key: "none", value: 1 }]} dataKey="value" nameKey="key" innerRadius={52} outerRadius={78} strokeWidth={2} animationDuration={700}>
            {(total ? data : [{ key: "none" }]).map((d) => (
              <Cell key={d.key} fill={d.key === "none" ? "var(--muted)" : `var(--color-${d.key})`} />
            ))}
            <Label
              content={({ viewBox }) =>
                viewBox && "cx" in viewBox ? (
                  <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                    <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-2xl font-semibold">
                      {total ? `${Math.round((auto / total) * 100)}%` : "—"}
                    </tspan>
                    <tspan x={viewBox.cx} y={(viewBox.cy ?? 0) + 18} className="fill-muted-foreground text-xs">
                      straight-through
                    </tspan>
                  </text>
                ) : null
              }
            />
          </Pie>
        </PieChart>
      </ChartContainer>
      <ul className="flex w-full flex-col gap-2 text-sm">
        {data.map((d) => (
          <li key={d.key} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <span className="size-2.5 rounded-sm" style={{ background: mixConfig[d.key].color }} />
              {mixConfig[d.key].label}
            </span>
            <span className="font-mono tabular-nums">
              {d.value}
              <span className="ml-1.5 text-xs text-muted-foreground">{total ? `${Math.round((d.value / total) * 100)}%` : ""}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type RateDay = { day: string; rate: number | null; cases: number };

const rateConfig = { rate: { label: "Auto-approval rate", color: "var(--success)" } } satisfies ChartConfig;

/** Daily share of received cases that went straight through without an underwriter. */
export function AutoRateTrend({ data }: { data: RateDay[] }) {
  return (
    <ChartContainer config={rateConfig} className="aspect-auto h-44 w-full">
      <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
        <defs>
          <linearGradient id="rateFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-rate)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-rate)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} minTickGap={24} />
        <YAxis hide domain={[0, 100]} />
        <ChartTooltip
          cursor={{ stroke: "var(--border)" }}
          content={<ChartTooltipContent formatter={(v, _n, item) => `${v}% of ${(item.payload as RateDay).cases} cases`} />}
        />
        <Area dataKey="rate" type="monotone" stroke="var(--color-rate)" strokeWidth={2} fill="url(#rateFill)" connectNulls animationDuration={800} />
      </AreaChart>
    </ChartContainer>
  );
}
