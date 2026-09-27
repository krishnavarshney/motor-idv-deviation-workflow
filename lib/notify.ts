"use client";

import { useSyncExternalStore } from "react";
import { gooeyToast } from "goey-toast";
import { createClient } from "@/lib/supabase/client";

export type NotificationKind = "info" | "success" | "warning" | "error";
export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  description: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
}

const LIMIT = 50;
let items: AppNotification[] = [];
type Status = "idle" | "loading" | "ready" | "unavailable";
let status: Status = "idle";
const listeners = new Set<() => void>();
let snapshot: { items: AppNotification[]; status: Status } = { items, status };

function emit() {
  snapshot = { items, status };
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useNotifications() {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

const db = () => createClient().from("notifications");

export async function loadNotifications() {
  if (status === "loading") return;
  status = "loading";
  emit();
  const { data, error } = await db().select("*").order("created_at", { ascending: false }).limit(LIMIT);
  // Table missing (migration not applied) or RLS failure: toasts still work, centre shows an empty state.
  status = error ? "unavailable" : "ready";
  items = error ? items : (data as AppNotification[]);
  emit();
}

async function record(kind: NotificationKind, title: string, description?: string, href?: string) {
  const temp: AppNotification = {
    id: "local-" + crypto.randomUUID(),
    kind,
    title,
    description: description ?? null,
    href: href ?? null,
    read_at: null,
    created_at: new Date().toISOString(),
  };
  items = [temp, ...items].slice(0, LIMIT);
  emit();
  const { data } = await db().insert({ kind, title, description: temp.description, href: temp.href }).select().single();
  if (data) {
    items = items.map((n) => (n.id === temp.id ? (data as AppNotification) : n));
    emit();
  }
}

export async function dismissNotification(id: string) {
  items = items.filter((n) => n.id !== id);
  emit();
  if (!id.startsWith("local-")) await db().delete().eq("id", id);
}

export async function clearNotifications() {
  const ids = items.map((n) => n.id).filter((id) => !id.startsWith("local-"));
  items = [];
  emit();
  if (ids.length) await db().delete().in("id", ids);
}

export async function markAllRead() {
  const now = new Date().toISOString();
  const ids = items.filter((n) => !n.read_at && !n.id.startsWith("local-")).map((n) => n.id);
  items = items.map((n) => (n.read_at ? n : { ...n, read_at: now }));
  emit();
  if (ids.length) await db().update({ read_at: now }).in("id", ids);
}

type Opts = { description?: string; href?: string };
const push = (kind: NotificationKind) => (title: string, opts: Opts = {}) => {
  gooeyToast[kind](title, { description: opts.description });
  void record(kind, title, opts.description, opts.href);
};

/** Show a toast and keep it in the notification centre. */
export const notify = { info: push("info"), success: push("success"), warning: push("warning"), error: push("error") };
