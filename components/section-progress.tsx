"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

type Ctx = { loaded: number; total: number; add: (d: number) => void };
const SectionCtx = createContext<Ctx | null>(null);

/** Per-page counter of streamed sections. `total` = number of Suspense-wrapped sections on the page. */
export function SectionProgress({ total, children }: { total: number; children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(0);
  const add = useCallback((d: number) => setLoaded((n) => n + d), []);
  const value = useMemo(() => ({ loaded, total, add }), [loaded, total, add]);
  return <SectionCtx.Provider value={value}>{children}</SectionCtx.Provider>;
}

/** Rendered by each resolved section. +1 on mount, −1 on unmount, so StrictMode double-mounts net to 1. */
export function SectionLoaded() {
  const add = useContext(SectionCtx)?.add;
  useEffect(() => {
    if (!add) return;
    add(1);
    return () => add(-1);
  }, [add]);
  return null;
}

/** Live "Loaded 2 of 5 · 40%" readout. Hidden once every section has streamed in. */
export function SectionIndicator({ className }: { className?: string }) {
  const ctx = useContext(SectionCtx);
  if (!ctx || ctx.loaded >= ctx.total) return null;
  // % = sections actually streamed and mounted / total sections. No timers, no easing.
  const pct = Math.round((ctx.loaded / ctx.total) * 100);
  return (
    <div role="status" className={cn("flex w-36 max-w-full flex-col gap-1", className)}>
      <span className="truncate text-xs text-muted-foreground tabular-nums">
        Loaded {ctx.loaded} of {ctx.total} · {pct}%
      </span>
      <Progress value={pct} aria-label="Sections loaded" />
    </div>
  );
}
