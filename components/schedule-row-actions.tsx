"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ScheduleDialog, type ScheduleValues } from "@/components/schedule-dialog";

export function ScheduleEnabledSwitch({ id, enabled, name }: { id: string; enabled: boolean; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function toggle(next: boolean) {
    setBusy(true);
    const r = await fetch(`/api/schedules/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return notify.error(d.error || "Unable to update schedule");
    notify.success(next ? `${name} enabled` : `${name} paused`);
    router.refresh();
  }
  return <Switch checked={enabled} disabled={busy} onCheckedChange={toggle} aria-label={`${enabled ? "Pause" : "Enable"} ${name}`} />;
}

export function ScheduleRowActions({ schedule }: { schedule: Required<ScheduleValues> }) {
  const router = useRouter();
  async function remove() {
    const r = await fetch(`/api/schedules/${schedule.id}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return notify.error(d.error || "Unable to delete schedule");
    notify.success("Schedule deleted");
    router.refresh();
  }
  return (
    <div className="flex justify-end gap-1">
      <ScheduleDialog
        initial={schedule}
        trigger={
          <Button size="icon" variant="ghost" aria-label={`Edit ${schedule.name}`}>
            <Pencil />
          </Button>
        }
      />
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="icon" variant="ghost" aria-label={`Delete ${schedule.name}`}>
            <Trash2 />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{schedule.name}”?</AlertDialogTitle>
            <AlertDialogDescription>Past runs stay in the history. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
