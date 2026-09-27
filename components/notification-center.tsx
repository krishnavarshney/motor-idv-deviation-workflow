"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { GooeyToaster } from "goey-toast";
import "goey-toast/styles.css";
import { AlertCircle, AlertTriangle, Bell, BellOff, CheckCircle2, CheckCheck, Info, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  clearNotifications,
  dismissNotification,
  loadNotifications,
  markAllRead,
  useNotifications,
  type NotificationKind,
} from "@/lib/notify";

const ICON: Record<NotificationKind, { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: "text-success" },
  error: { icon: AlertCircle, className: "text-destructive" },
  warning: { icon: AlertTriangle, className: "text-warning" },
  info: { icon: Info, className: "text-info" },
};

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(iso: string) {
  const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (s > -60) return "just now";
  if (s > -3600) return rtf.format(Math.round(s / 60), "minute");
  if (s > -86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

export function Toaster() {
  const { resolvedTheme } = useTheme();
  return <GooeyToaster position="bottom-right" theme={resolvedTheme === "dark" ? "dark" : "light"} closeButton="top-right" />;
}

export function NotificationCenter() {
  const { items, status } = useNotifications();
  const unread = items.filter((n) => !n.read_at).length;

  useEffect(() => {
    void loadNotifications();
  }, []);

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} className="relative">
              <Bell />
              {unread > 0 && (
                <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] leading-4 text-primary-foreground tabular-nums">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Notifications</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] gap-0 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <div className="text-sm font-semibold">Notifications</div>
            <div className="text-xs text-muted-foreground">{unread ? `${unread} unread` : "All caught up"}</div>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" disabled={!unread} onClick={() => void markAllRead()}>
              <CheckCheck data-icon="inline-start" />
              Read all
            </Button>
            <Button variant="ghost" size="sm" disabled={!items.length} onClick={() => void clearNotifications()}>
              <Trash2 data-icon="inline-start" />
              Clear
            </Button>
          </div>
        </div>
        {items.length ? (
          <div className="max-h-96 overflow-y-auto overscroll-contain">
            <ul className="flex flex-col divide-y">
              {items.map((n) => {
                const { icon: Icon, className } = ICON[n.kind];
                const body = (
                  <>
                    <div className="truncate text-sm font-medium">{n.title}</div>
                    {n.description && <div className="line-clamp-2 text-xs text-muted-foreground">{n.description}</div>}
                    <div className="text-[11px] text-muted-foreground">{ago(n.created_at)}</div>
                  </>
                );
                return (
                  <li key={n.id} className={cn("group relative flex gap-3 px-4 py-3", !n.read_at && "bg-primary/5")}>
                    <Icon className={cn("mt-0.5 size-4 shrink-0", className)} aria-label={n.kind} />
                    {n.href ? (
                      <Link href={n.href} className="flex min-w-0 flex-1 flex-col gap-0.5 hover:underline">
                        {body}
                      </Link>
                    ) : (
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">{body}</div>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Dismiss notification"
                      className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => void dismissNotification(n.id)}
                    >
                      <X />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <Empty className="py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BellOff />
              </EmptyMedia>
              <EmptyTitle>No notifications</EmptyTitle>
              <EmptyDescription>
                {status === "unavailable" ? "Notification history is unavailable — the notifications table may not be set up yet." : "Decisions, saves and lookups will appear here."}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </PopoverContent>
    </Popover>
  );
}
