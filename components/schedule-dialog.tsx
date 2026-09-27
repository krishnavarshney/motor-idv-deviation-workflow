"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  DEFAULT_TIMEZONE,
  HOUR_STEPS,
  MINUTE_STEPS,
  cronToSpec,
  describeSchedule,
  isValidCron,
  nextRunAt,
  specToCron,
  type ScheduleSpec,
  type Weekday,
} from "@/lib/schedule";
import { dateTime } from "@/lib/format";

export type ScheduleValues = { id?: string; name: string; cron: string; timezone: string; dry_run: boolean };

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 25 }, (_, h) => h);
const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => i + 1); // 29–31 don't exist every month

function defaultsFor(kind: ScheduleSpec["kind"]): ScheduleSpec {
  switch (kind) {
    case "minutes":
      return { kind: "minutes", every: 15, days: [1, 2, 3, 4, 5, 6], fromHour: 9, toHour: 19 };
    case "hourly":
      return { kind: "hourly", every: 1, days: [1, 2, 3, 4, 5, 6], fromHour: 9, toHour: 19 };
    case "daily":
      return { kind: "daily", time: "09:00", days: [0, 1, 2, 3, 4, 5, 6] };
    case "monthly":
      return { kind: "monthly", time: "09:00", dayOfMonth: 1 };
  }
}

export function ScheduleDialog({ initial, trigger }: { initial?: ScheduleValues; trigger: React.ReactNode }) {
  const router = useRouter();
  const parsed = initial ? cronToSpec(initial.cron) : null;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [spec, setSpec] = useState<ScheduleSpec>(parsed ?? defaultsFor("minutes"));
  const [advanced, setAdvanced] = useState(!!initial && !parsed);
  const [rawCron, setRawCron] = useState(initial?.cron ?? specToCron(defaultsFor("minutes")));
  const [dryRun, setDryRun] = useState(initial?.dry_run ?? true);
  const [busy, setBusy] = useState(false);
  const timezone = initial?.timezone ?? DEFAULT_TIMEZONE;

  const update = (patch: Record<string, unknown>) => setSpec((s) => ({ ...s, ...patch }) as ScheduleSpec);
  const cron = advanced ? rawCron.trim() : specToCron(spec);
  const windowOk = !("fromHour" in spec) || spec.fromHour < spec.toHour;
  const daysOk = !("days" in spec) || spec.days.length > 0;
  const valid = name.trim().length > 0 && isValidCron(cron) && (advanced || (windowOk && daysOk));
  const next = useMemo(() => (isValidCron(cron) ? nextRunAt(cron, timezone, new Date()) : null), [cron, timezone]);

  async function save() {
    setBusy(true);
    const r = await fetch(initial?.id ? `/api/schedules/${initial.id}` : "/api/schedules", {
      method: initial?.id ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, cron, timezone, dry_run: dryRun }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast.error(d.error || "Unable to save schedule");
    toast.success(initial?.id ? "Schedule updated" : "Schedule created — enable it to start");
    setOpen(false);
    router.refresh();
  }

  const days = "days" in spec && (
    <Field>
      <FieldLabel>Days</FieldLabel>
      <ToggleGroup
        type="multiple"
        variant="outline"
        value={spec.days.map(String)}
        onValueChange={(v: string[]) => update({ days: v.map(Number).sort((a, b) => a - b) as Weekday[] })}
      >
        {DAY_LABELS.map((d, i) => (
          <ToggleGroupItem key={d} value={String(i)} aria-label={d}>
            {d}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  );

  const hoursWindow = "fromHour" in spec && (
    <div className="grid grid-cols-2 gap-3">
      <Field>
        <FieldLabel>From</FieldLabel>
        <Select value={String(spec.fromHour)} onValueChange={(v) => update({ fromHour: Number(v) })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HOURS.slice(0, 24).map((h) => (
              <SelectItem key={h} value={String(h)}>{`${String(h).padStart(2, "0")}:00`}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field>
        <FieldLabel>Until</FieldLabel>
        <Select value={String(spec.toHour)} onValueChange={(v) => update({ toHour: Number(v) })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HOURS.slice(1).map((h) => (
              <SelectItem key={h} value={String(h)}>{`${String(h).padStart(2, "0")}:00`}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial?.id ? "Edit schedule" : "New schedule"}</DialogTitle>
          <DialogDescription>Each run fetches new CoreHub referrals and evaluates them.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="schedule-name">Name</FieldLabel>
            <Input id="schedule-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Business hours" />
          </Field>

          <Field orientation="horizontal">
            <Switch id="schedule-advanced" checked={advanced} onCheckedChange={(v) => { setAdvanced(v); if (v) setRawCron(specToCron(spec)); }} />
            <FieldLabel htmlFor="schedule-advanced">Advanced (cron expression)</FieldLabel>
          </Field>

          {advanced ? (
            <Field>
              <FieldLabel htmlFor="schedule-cron">Cron</FieldLabel>
              <Input id="schedule-cron" className="font-mono" value={rawCron} onChange={(e) => setRawCron(e.target.value)} />
              <FieldDescription>Five fields: minute hour day-of-month month day-of-week, in {timezone}.</FieldDescription>
            </Field>
          ) : (
            <>
              <Field>
                <FieldLabel>Frequency</FieldLabel>
                <Select value={spec.kind} onValueChange={(v) => setSpec(defaultsFor(v as ScheduleSpec["kind"]))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes">Every few minutes</SelectItem>
                    <SelectItem value="hourly">Hourly</SelectItem>
                    <SelectItem value="daily">Daily / weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              {(spec.kind === "minutes" || spec.kind === "hourly") && (
                <Field>
                  <FieldLabel>Every</FieldLabel>
                  <Select value={String(spec.every)} onValueChange={(v) => update({ every: Number(v) })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(spec.kind === "minutes" ? MINUTE_STEPS : HOUR_STEPS).map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {spec.kind === "minutes" ? `${n} minutes` : n === 1 ? "1 hour" : `${n} hours`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {hoursWindow}
              {(spec.kind === "daily" || spec.kind === "monthly") && (
                <Field>
                  <FieldLabel htmlFor="schedule-time">Time</FieldLabel>
                  <Input id="schedule-time" type="time" value={spec.time} onChange={(e) => e.target.value && update({ time: e.target.value })} />
                </Field>
              )}
              {spec.kind === "monthly" && (
                <Field>
                  <FieldLabel>Day of month</FieldLabel>
                  <Select value={String(spec.dayOfMonth)} onValueChange={(v) => update({ dayOfMonth: Number(v) })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MONTH_DAYS.map((d) => (
                        <SelectItem key={d} value={String(d)}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {days}
              {!windowOk && <p className="text-sm text-destructive">“Until” must be later than “From”.</p>}
              {!daysOk && <p className="text-sm text-destructive">Pick at least one day.</p>}
            </>
          )}

          <Field orientation="horizontal">
            <Switch id="schedule-dry-run" checked={dryRun} onCheckedChange={setDryRun} />
            <FieldLabel htmlFor="schedule-dry-run">Dry run</FieldLabel>
          </Field>

          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <div className="font-medium">{isValidCron(cron) ? describeSchedule(cron, timezone) : "Invalid schedule"}</div>
            <div className="text-muted-foreground">Next run: {next ? dateTime(next.toISOString()) : "—"}</div>
            <div className="text-muted-foreground">Decisions are recorded in this app. CoreHub write-back: pending CoreHub mapping.</div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={!valid || busy} onClick={save}>
            {busy && <Spinner data-icon="inline-start" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
