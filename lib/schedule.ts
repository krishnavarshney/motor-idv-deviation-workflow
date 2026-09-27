import { CronExpressionParser } from "cron-parser";

export const DEFAULT_TIMEZONE = "Asia/Kolkata";
export const MINUTE_STEPS = [5, 10, 15, 20, 30];
export const HOUR_STEPS = [1, 2, 3, 4, 6, 12];
const MIN_INTERVAL_MS = 5 * 60_000;

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday
export type CompletionMode = "in_app" | "corehub_writeback";

/** toHour is exclusive: fromHour 9, toHour 19 = 09:00 until 18:59. time is "HH:MM". */
export type ScheduleSpec =
  | { kind: "minutes"; every: number; days: Weekday[]; fromHour: number; toHour: number }
  | { kind: "hourly"; every: number; days: Weekday[]; fromHour: number; toHour: number }
  | { kind: "daily"; time: string; days: Weekday[] }
  | { kind: "monthly"; time: string; dayOfMonth: number };

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");

function daysField(days: Weekday[]) {
  const d = [...new Set(days)].sort((a, b) => a - b);
  return d.length === 7 ? "*" : d.join(",");
}

function hm(time: string) {
  const [h, m] = time.split(":").map(Number);
  return { h, m };
}

const fullDay = (from: number, to: number) => from === 0 && to === 24;

export function specToCron(s: ScheduleSpec): string {
  switch (s.kind) {
    case "minutes":
      return `*/${s.every} ${fullDay(s.fromHour, s.toHour) ? "*" : `${s.fromHour}-${s.toHour - 1}`} * * ${daysField(s.days)}`;
    case "hourly":
      return `0 ${fullDay(s.fromHour, s.toHour) ? "*" : `${s.fromHour}-${s.toHour - 1}`}/${s.every} * * ${daysField(s.days)}`;
    case "daily": {
      const { h, m } = hm(s.time);
      return `${m} ${h} * * ${daysField(s.days)}`;
    }
    case "monthly": {
      const { h, m } = hm(s.time);
      return `${m} ${h} ${s.dayOfMonth} * *`;
    }
  }
}

function parseDays(f: string): Weekday[] | null {
  if (f === "*") return [0, 1, 2, 3, 4, 5, 6];
  if (!/^[0-6](,[0-6])*$/.test(f)) return null;
  return f.split(",").map(Number) as Weekday[];
}

function parseHours(f: string): { fromHour: number; toHour: number } | null {
  if (f === "*") return { fromHour: 0, toHour: 24 };
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(f);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a <= b && b <= 23 ? { fromHour: a, toHour: b + 1 } : null;
}

/** Inverse of specToCron for the shapes it emits; anything else is "advanced". */
export function cronToSpec(cron: string): ScheduleSpec | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour, dom, mon, dow] = parts;
  if (mon !== "*") return null;
  const days = parseDays(dow);
  if (!days) return null;

  const everyMin = /^\*\/(\d+)$/.exec(min);
  if (everyMin && dom === "*") {
    const hrs = parseHours(hour);
    return hrs ? { kind: "minutes", every: Number(everyMin[1]), days, ...hrs } : null;
  }

  const everyHour = /^(?:\*|(\d{1,2})-(\d{1,2}))\/(\d+)$/.exec(hour);
  if (min === "0" && dom === "*" && everyHour) {
    const hrs = everyHour[1] === undefined ? { fromHour: 0, toHour: 24 } : { fromHour: Number(everyHour[1]), toHour: Number(everyHour[2]) + 1 };
    return { kind: "hourly", every: Number(everyHour[3]), days, ...hrs };
  }

  if (/^\d{1,2}$/.test(min) && /^\d{1,2}$/.test(hour)) {
    const time = `${pad(Number(hour))}:${pad(Number(min))}`;
    if (dom === "*") return { kind: "daily", time, days };
    if (/^\d{1,2}$/.test(dom) && dow === "*") return { kind: "monthly", time, dayOfMonth: Number(dom) };
  }
  return null;
}

function describeDays(days: Weekday[]) {
  const key = days.join(",");
  if (days.length === 7) return "every day";
  if (key === "1,2,3,4,5") return "Mon–Fri";
  if (key === "1,2,3,4,5,6") return "Mon–Sat";
  return days.map((d) => DAY_NAMES[d]).join(", ");
}

const describeWindow = (from: number, to: number) => (fullDay(from, to) ? "" : ` ${pad(from)}:00–${pad(to)}:00`);

export function describeSchedule(cron: string, timezone = DEFAULT_TIMEZONE): string {
  const tz = timezone === DEFAULT_TIMEZONE ? "IST" : timezone;
  const s = cronToSpec(cron);
  if (!s) return `Custom (${cron.trim()}) ${tz}`;
  switch (s.kind) {
    case "minutes":
      return `Every ${s.every} min, ${describeDays(s.days)}${describeWindow(s.fromHour, s.toHour)} ${tz}`;
    case "hourly":
      return `Every ${s.every === 1 ? "hour" : `${s.every} hours`}, ${describeDays(s.days)}${describeWindow(s.fromHour, s.toHour)} ${tz}`;
    case "daily":
      return s.days.length === 7 ? `Daily at ${s.time} ${tz}` : `Weekly on ${describeDays(s.days)} at ${s.time} ${tz}`;
    case "monthly":
      return `Monthly on day ${s.dayOfMonth} at ${s.time} ${tz}`;
  }
}

export function nextRunAt(cron: string, timezone: string, from: Date): Date {
  return CronExpressionParser.parse(cron, { currentDate: from, tz: timezone }).next().toDate();
}

export function isValidCron(cron: string): boolean {
  if (cron.trim().split(/\s+/).length !== 5) return false;
  try {
    CronExpressionParser.parse(cron);
    return true;
  } catch {
    return false;
  }
}

function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** True when any of the next three gaps is shorter than 5 minutes. */
function tooFrequent(cron: string) {
  const it = CronExpressionParser.parse(cron, { currentDate: new Date() });
  let prev = it.next().toDate().getTime();
  for (let i = 0; i < 3; i++) {
    const next = it.next().toDate().getTime();
    if (next - prev < MIN_INTERVAL_MS) return true;
    prev = next;
  }
  return false;
}

export function completionModeAllowed(mode: string, env: Record<string, string | undefined> = process.env): boolean {
  return mode === "in_app" || (mode === "corehub_writeback" && env.COREHUB_WRITEBACK_ENABLED === "true");
}

export type ScheduleInput = {
  name: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  dry_run: boolean;
  completion_mode: CompletionMode;
};

type Validated = { ok: true; value: Partial<ScheduleInput> } | { ok: false; error: string };

export function validateScheduleInput(
  body: unknown,
  opts: { partial?: boolean; env?: Record<string, string | undefined> } = {},
): Validated {
  const partial = opts.partial ?? false;
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const has = (k: string) => b[k] !== undefined;
  const fail = (error: string): Validated => ({ ok: false, error });
  const out: Partial<ScheduleInput> = {};

  if (has("name") || !partial) {
    const name = typeof b.name === "string" ? b.name.trim() : "";
    if (!name || name.length > 80) return fail("Name must be 1–80 characters");
    out.name = name;
  }
  if (has("cron") || !partial) {
    const cron = typeof b.cron === "string" ? b.cron.trim() : "";
    if (!isValidCron(cron)) return fail("Invalid cron expression");
    if (tooFrequent(cron)) return fail("Schedules cannot run more often than every 5 minutes");
    out.cron = cron;
  }
  if (has("timezone")) {
    if (typeof b.timezone !== "string" || !isValidTimezone(b.timezone)) return fail("Invalid timezone");
    out.timezone = b.timezone;
  } else if (!partial) {
    out.timezone = DEFAULT_TIMEZONE;
  }
  for (const k of ["enabled", "dry_run"] as const) {
    if (!has(k)) continue;
    if (typeof b[k] !== "boolean") return fail(`${k} must be true or false`);
    out[k] = b[k] as boolean;
  }
  if (has("completion_mode")) {
    const mode = b.completion_mode;
    if (mode !== "in_app" && mode !== "corehub_writeback") return fail("Invalid completion_mode");
    if (!completionModeAllowed(mode, opts.env)) return fail("CoreHub write-back is not enabled");
    out.completion_mode = mode;
  }
  return { ok: true, value: out };
}
