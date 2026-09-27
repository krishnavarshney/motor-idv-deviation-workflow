# Automation Engine Implementation Plan (Plan A of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators fetch CoreHub referrals and evaluate them (OBV lookup + decision engine) from the console, and let admins define schedules that do both automatically, all executed by an always-on worker daemon that drains a Supabase job queue.

**Architecture:** The Next.js console never runs Playwright. It inserts rows into `automation_jobs`; a long-running Node daemon (`src/worker/daemon.ts`) claims jobs with `FOR UPDATE SKIP LOCKED`, runs the existing CoreHub/OBV browser pipeline (split into `fetchReferrals` and `evaluateCases`), writes progress back to the job row, and enqueues jobs for due `automation_schedules`. Pages refresh live through Supabase Realtime.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase (Postgres, RLS, Realtime, `@supabase/ssr`), Playwright, `cron-parser@5`, shadcn/ui (`radix-nova` style), `tsx` + `node:assert` tests.

**Spec:** `docs/superpowers/specs/2026-09-27-automation-console-design.md` (sections 1 and the Referrals / Runs / Schedules pages of section 2). Plan B (`2026-09-27-console-ia-and-accounts.md`) covers sidebar restructure, page deletions, Overview additions and the account layer.

## Global Constraints

- Completion mode values: `in_app` (active) and `corehub_writeback` (rejected unless env `COREHUB_WRITEBACK_ENABLED=true`).
- Default schedule timezone: `Asia/Kolkata`; displayed as `IST`.
- Worker is offline when its last heartbeat is older than **2 minutes**.
- A `running` job whose `heartbeat_at` is older than **5 minutes** is stale → `failed` with error `stale_heartbeat`, its `processing` cases go back to `received`.
- Daemon polls every **10 s**; jobs execute serially (one browser session).
- Schedules may not fire more often than every **5 minutes**.
- Max cases per evaluate job: **200**.
- Roles: `operator`, `underwriter`, `auditor`, `admin`. Run jobs: operator, underwriter, admin. Manage schedules: admin.
- Tests are plain `tsx` scripts using `node:assert` (see `tests/workflow.test.ts`); every new test file is appended to the `test` script in `package.json`.
- `npm run lint` is `tsc --noEmit`; it must pass after every task.
- Every commit message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Precondition

Uncommitted work already on the branch adds `src/worker/reconcile.ts`, `tests/reconcile.test.ts`, passes `conditions` to the decision engine in `src/worker/run.ts`, and removes the render-time approval from `app/(console)/referrals/[id]/page.tsx`. **That work must be committed before Task 1.** Check with `git status --short`; if those files are still modified/untracked, stop and ask the user to commit them. This plan reuses `reconcileConditionBands(supabase, decisionConfig, { dryRun, runId })` from that module.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/202609270009_automation_jobs.sql` | Jobs, schedules, heartbeats tables; `claim_next_job`; RLS; Realtime publication |
| `lib/schedule.ts` | Schedule builder spec ↔ cron, description, next run, input validation, completion-mode guard |
| `lib/authz.ts` | Role → action matrix (`can`) |
| `lib/jobs.ts` | Parse/validate `POST /api/jobs` bodies |
| `lib/worker-status.ts` | Online check + latest heartbeat query |
| `lib/api-auth.ts` | Server helpers: session profile, `requireAction` for route handlers |
| `src/worker/case-mapping.ts` | Pure mapping: OBV result → decision input, decision → case statuses, referral → new case row |
| `src/worker/pipeline.ts` | Browser session, `fetchReferrals`, `evaluateCases`, run bookkeeping |
| `src/worker/run.ts` | CLI: reconcile + fetch + evaluate new (rewritten on top of pipeline) |
| `src/worker/daemon-core.ts` | Pure-ish loop steps with injected deps: `processNextJob`, `scheduleTick`, `recoverStale` |
| `src/worker/daemon-store.ts` | Supabase implementation of daemon deps + `executeJob` |
| `src/worker/daemon.ts` | Daemon entry point (loop, heartbeats, signals) |
| `app/api/jobs/route.ts`, `app/api/jobs/[id]/cancel/route.ts` | Enqueue / cancel jobs |
| `app/api/schedules/route.ts`, `app/api/schedules/[id]/route.ts` | Schedule create / update / delete |
| `components/live-refresh.tsx` | Realtime subscription → `router.refresh()` |
| `components/worker-status-pill.tsx` | Header badge |
| `components/job-buttons.tsx` | Fetch / Evaluate / Cancel buttons |
| `components/job-progress.tsx` | Progress line for a job |
| `components/schedule-dialog.tsx`, `components/schedule-row-actions.tsx` | Schedule editor and row actions |
| `app/(console)/automation/page.tsx` | Runs page |
| `app/(console)/automation/jobs/[id]/page.tsx` | Job detail |
| `app/(console)/automation/schedules/page.tsx` | Schedules page |
| Modified: `components/case-table.tsx`, `components/status.tsx`, `components/nav.ts`, `components/app-sidebar.tsx`, `app/(console)/layout.tsx`, `app/(console)/referrals/page.tsx`, `app/(console)/referrals/[id]/page.tsx`, `src/worker/config.ts`, `package.json`, `.github/workflows/idv-worker.yml`, `.env.example`, `README.md` |
| Deleted: `app/api/intake/referral/route.ts` |

---

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/202609270009_automation_jobs.sql`

**Interfaces:**
- Produces tables `automation_jobs`, `automation_schedules`, `worker_heartbeats`; RPC `claim_next_job(p_worker_id text) returns setof automation_jobs`; `automation_runs.trigger_source` accepts `schedule` and `ui`.

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration 009: automation job queue, schedules and worker heartbeats
-- =============================================================================

create table if not exists public.automation_schedules (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 1 and 80),
  cron            text not null,
  timezone        text not null default 'Asia/Kolkata',
  enabled         boolean not null default false,
  dry_run         boolean not null default true,
  completion_mode text not null default 'in_app'
                    check (completion_mode in ('in_app', 'corehub_writeback')),
  next_run_at     timestamptz,
  last_run_at     timestamptz,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

drop trigger if exists automation_schedules_updated_at on public.automation_schedules;
create trigger automation_schedules_updated_at before update on public.automation_schedules
  for each row execute function public.set_updated_at();

create table if not exists public.automation_jobs (
  id            uuid primary key default gen_random_uuid(),
  type          text not null check (type in ('fetch', 'evaluate')),
  status        text not null default 'queued'
                  check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  params        jsonb not null default '{}'::jsonb,
  progress      jsonb not null default '{}'::jsonb,
  requested_by  uuid references auth.users(id),
  schedule_id   uuid references public.automation_schedules(id) on delete set null,
  run_id        uuid references public.automation_runs(id),
  worker_id     text,
  error         text,
  heartbeat_at  timestamptz,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists idx_automation_jobs_queue on public.automation_jobs (status, created_at);
create index if not exists idx_automation_jobs_schedule on public.automation_jobs (schedule_id, status);

create table if not exists public.worker_heartbeats (
  worker_id       text primary key,
  last_seen_at    timestamptz not null default now(),
  version         text,
  current_job_id  uuid references public.automation_jobs(id) on delete set null
);

-- Runs can now be triggered by schedules and the console
alter table public.automation_runs drop constraint if exists automation_runs_trigger_source_check;
alter table public.automation_runs add constraint automation_runs_trigger_source_check
  check (trigger_source in ('manual', 'cron', 'github_actions', 'schedule', 'ui'));

-- Atomic job claim for the worker (service role only)
create or replace function public.claim_next_job(p_worker_id text)
returns setof public.automation_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.automation_jobs j
     set status = 'running', started_at = now(), heartbeat_at = now(), worker_id = p_worker_id
   where j.id = (
     select id from public.automation_jobs
      where status = 'queued'
      order by created_at
      limit 1
      for update skip locked
   )
  returning j.*;
end;
$$;
revoke execute on function public.claim_next_job(text) from public, anon, authenticated;

-- RLS
alter table public.automation_schedules enable row level security;
alter table public.automation_jobs enable row level security;
alter table public.worker_heartbeats enable row level security;

drop policy if exists automation_schedules_select on public.automation_schedules;
create policy automation_schedules_select on public.automation_schedules
  for select to authenticated using (true);

drop policy if exists automation_schedules_admin on public.automation_schedules;
create policy automation_schedules_admin on public.automation_schedules
  for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

drop policy if exists automation_jobs_select on public.automation_jobs;
create policy automation_jobs_select on public.automation_jobs
  for select to authenticated using (true);

-- is_privileged_user() = operator, underwriter or admin
drop policy if exists automation_jobs_insert on public.automation_jobs;
create policy automation_jobs_insert on public.automation_jobs
  for insert to authenticated
  with check (public.is_privileged_user() and requested_by = auth.uid() and status = 'queued');

drop policy if exists automation_jobs_cancel on public.automation_jobs;
create policy automation_jobs_cancel on public.automation_jobs
  for update to authenticated
  using (public.is_privileged_user() and status = 'queued')
  with check (public.is_privileged_user() and status = 'cancelled');

drop policy if exists worker_heartbeats_select on public.worker_heartbeats;
create policy worker_heartbeats_select on public.worker_heartbeats
  for select to authenticated using (true);

-- Realtime: live progress on the console
do $$ begin
  alter publication supabase_realtime add table public.automation_jobs;
exception when duplicate_object then null; when undefined_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.referral_cases;
exception when duplicate_object then null; when undefined_object then null;
end $$;
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push` (if the project is linked) — otherwise paste the file into the Supabase SQL editor for the project and run it.
Expected: no errors. Running it a second time also succeeds (idempotent).

- [ ] **Step 3: Verify**

Run in the SQL editor:

```sql
insert into public.automation_jobs (type) values ('fetch');
select id, status from public.claim_next_job('verify');   -- one row, status running
select public.claim_next_job('verify');                    -- zero rows
delete from public.automation_jobs where worker_id = 'verify';
```

Expected: first claim returns the job as `running`, second returns nothing.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202609270009_automation_jobs.sql
git commit -m "feat(db): add automation job queue, schedules and worker heartbeats

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Schedule library

**Files:**
- Create: `lib/schedule.ts`
- Test: `tests/schedule.test.ts`
- Modify: `package.json` (dependency + test script)

**Interfaces:**
- Produces (all from `lib/schedule.ts`):
  - `type Weekday = 0|1|2|3|4|5|6` (0 = Sunday)
  - `type ScheduleSpec = { kind: "minutes"; every: number; days: Weekday[]; fromHour: number; toHour: number } | { kind: "hourly"; every: number; days: Weekday[]; fromHour: number; toHour: number } | { kind: "daily"; time: string; days: Weekday[] } | { kind: "monthly"; time: string; dayOfMonth: number }` — `toHour` is exclusive (9–19 means 09:00 until 18:59); `time` is `"HH:MM"`.
  - `type CompletionMode = "in_app" | "corehub_writeback"`
  - `DEFAULT_TIMEZONE = "Asia/Kolkata"`, `MINUTE_STEPS = [5, 10, 15, 20, 30]`, `HOUR_STEPS = [1, 2, 3, 4, 6, 12]`
  - `specToCron(spec: ScheduleSpec): string`
  - `cronToSpec(cron: string): ScheduleSpec | null` (null = not expressible in the builder → "advanced")
  - `describeSchedule(cron: string, timezone?: string): string`
  - `nextRunAt(cron: string, timezone: string, from: Date): Date`
  - `isValidCron(cron: string): boolean`
  - `completionModeAllowed(mode: string, env?: Record<string, string | undefined>): boolean`
  - `type ScheduleInput = { name: string; cron: string; timezone: string; enabled: boolean; dry_run: boolean; completion_mode: CompletionMode }`
  - `validateScheduleInput(body: unknown, opts?: { partial?: boolean; env?: Record<string, string | undefined> }): { ok: true; value: Partial<ScheduleInput> } | { ok: false; error: string }`

- [ ] **Step 1: Install cron-parser**

Run: `npm install cron-parser@^5`
Expected: `package.json` dependencies gain `"cron-parser": "^5.x"`.

- [ ] **Step 2: Write the failing test**

Create `tests/schedule.test.ts`:

```ts
import { strict as assert } from "node:assert";
import {
  completionModeAllowed,
  cronToSpec,
  describeSchedule,
  nextRunAt,
  specToCron,
  validateScheduleInput,
  type ScheduleSpec,
} from "../lib/schedule";

const ALL = [0, 1, 2, 3, 4, 5, 6] as const;

function main() {
  // Builder ↔ cron round trip
  const specs: ScheduleSpec[] = [
    { kind: "minutes", every: 15, days: [1, 2, 3, 4, 5, 6], fromHour: 9, toHour: 19 },
    { kind: "minutes", every: 10, days: [...ALL], fromHour: 0, toHour: 24 },
    { kind: "hourly", every: 2, days: [1, 2, 3, 4, 5], fromHour: 9, toHour: 19 },
    { kind: "hourly", every: 1, days: [...ALL], fromHour: 0, toHour: 24 },
    { kind: "daily", time: "23:00", days: [...ALL] },
    { kind: "daily", time: "08:30", days: [1, 3, 5] },
    { kind: "monthly", time: "10:30", dayOfMonth: 28 },
  ];
  for (const s of specs) assert.deepEqual(cronToSpec(specToCron(s)), s, `round trip ${specToCron(s)}`);

  assert.equal(specToCron(specs[0]), "*/15 9-18 * * 1,2,3,4,5,6");
  assert.equal(specToCron(specs[1]), "*/10 * * * *");
  assert.equal(specToCron(specs[2]), "0 9-18/2 * * 1,2,3,4,5");
  assert.equal(specToCron(specs[6]), "30 10 28 * *");
  assert.equal(specToCron({ kind: "daily", time: "08:30", days: [5, 1, 3, 3] }), "30 8 * * 1,3,5");

  // Not expressible in the builder → advanced
  assert.equal(cronToSpec("0 9 * * 1-5"), null);
  assert.equal(cronToSpec("0 9 * 1 *"), null);
  assert.equal(cronToSpec("nonsense"), null);

  // Human description
  assert.equal(describeSchedule("*/15 9-18 * * 1,2,3,4,5,6"), "Every 15 min, Mon–Sat 09:00–19:00 IST");
  assert.equal(describeSchedule("0 9-18/2 * * 1,2,3,4,5"), "Every 2 hours, Mon–Fri 09:00–19:00 IST");
  assert.equal(describeSchedule("0 */1 * * *"), "Every hour, every day IST");
  assert.equal(describeSchedule("0 23 * * *"), "Daily at 23:00 IST");
  assert.equal(describeSchedule("30 8 * * 1,3,5"), "Weekly on Mon, Wed, Fri at 08:30 IST");
  assert.equal(describeSchedule("30 10 28 * *"), "Monthly on day 28 at 10:30 IST");
  assert.equal(describeSchedule("0 9 * * 1-5"), "Custom (0 9 * * 1-5) IST");
  assert.equal(describeSchedule("0 9 * * *", "UTC"), "Daily at 09:00 UTC");

  // Next run in IST: Sunday 2026-09-27 17:30 IST → Monday 09:00 IST
  assert.equal(
    nextRunAt("*/15 9-18 * * 1,2,3,4,5,6", "Asia/Kolkata", new Date("2026-09-27T12:00:00Z")).toISOString(),
    "2026-09-28T03:30:00.000Z",
  );
  // Monthly on day 28, already past this month → next month
  assert.equal(
    nextRunAt("30 10 28 * *", "Asia/Kolkata", new Date("2026-09-29T00:00:00Z")).toISOString(),
    "2026-10-28T05:00:00.000Z",
  );

  // Validation
  const ok = validateScheduleInput({ name: " Business hours ", cron: "*/15 9-18 * * 1,2,3,4,5,6" });
  assert.deepEqual(ok, { ok: true, value: { name: "Business hours", cron: "*/15 9-18 * * 1,2,3,4,5,6", timezone: "Asia/Kolkata" } });
  assert.equal(validateScheduleInput({ name: "", cron: "0 9 * * *" }).ok, false);
  assert.equal(validateScheduleInput({ name: "x", cron: "bad" }).ok, false);
  assert.equal(validateScheduleInput({ name: "x", cron: "* * * * *" }).ok, false, "every minute is too frequent");
  assert.equal(validateScheduleInput({ name: "x", cron: "*/2 9-18 * * *" }).ok, false, "every 2 min is too frequent");
  assert.equal(validateScheduleInput({ name: "x", cron: "0 9 * * *", timezone: "Mars/Olympus" }).ok, false);
  assert.equal(validateScheduleInput({ name: "x", cron: "0 9 * * *", enabled: "yes" }).ok, false);
  assert.deepEqual(validateScheduleInput({ enabled: true }, { partial: true }), { ok: true, value: { enabled: true } });

  // Completion mode guard
  assert.equal(completionModeAllowed("in_app", {}), true);
  assert.equal(completionModeAllowed("corehub_writeback", {}), false);
  assert.equal(completionModeAllowed("corehub_writeback", { COREHUB_WRITEBACK_ENABLED: "true" }), true);
  assert.equal(validateScheduleInput({ name: "x", cron: "0 9 * * *", completion_mode: "corehub_writeback" }, { env: {} }).ok, false);
  assert.equal(
    validateScheduleInput({ name: "x", cron: "0 9 * * *", completion_mode: "corehub_writeback" }, { env: { COREHUB_WRITEBACK_ENABLED: "true" } }).ok,
    true,
  );

  console.log("schedule tests passed");
}

main();
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx tsx tests/schedule.test.ts`
Expected: FAIL — `Cannot find module '../lib/schedule'`.

- [ ] **Step 4: Implement `lib/schedule.ts`**

```ts
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx tests/schedule.test.ts`
Expected: `schedule tests passed`

- [ ] **Step 6: Add to test script and type-check**

In `package.json` append ` && tsx tests/schedule.test.ts` to the end of the `"test"` script string.
Run: `npm test && npm run lint`
Expected: all test files pass; `tsc` exits 0.

- [ ] **Step 7: Commit**

```bash
git add lib/schedule.ts tests/schedule.test.ts package.json package-lock.json
git commit -m "feat(schedule): cron builder, description, next-run and input validation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Authorization, job request parsing, worker status helpers

**Files:**
- Create: `lib/authz.ts`, `lib/jobs.ts`, `lib/worker-status.ts`, `lib/api-auth.ts`
- Test: `tests/console-rules.test.ts`
- Modify: `package.json` (test script)

**Interfaces:**
- Produces:
  - `lib/authz.ts`: `type Role = "operator"|"underwriter"|"auditor"|"admin"`, `type Action = "view"|"run_jobs"|"review"|"test_lookup"|"manage"|"audit"`, `can(role: string | null | undefined, action: Action): boolean`
  - `lib/jobs.ts`: `MAX_CASES_PER_JOB = 200`, `type JobRequest = { type: "fetch" } | { type: "evaluate"; case_ids: string[] } | { type: "evaluate"; all_received: true }`, `parseJobRequest(body: unknown): { ok: true; value: JobRequest } | { ok: false; error: string }`
  - `lib/worker-status.ts`: `WORKER_OFFLINE_AFTER_MS = 120_000`, `isWorkerOnline(lastSeenAt: string | null | undefined, now?: number): boolean`, `getWorkerStatus(supabase): Promise<{ online: boolean; lastSeenAt: string | null; currentJobId: string | null }>`
  - `lib/api-auth.ts`: `getSessionProfile(supabase): Promise<{ user: User; role: Role | null; fullName: string | null } | null>`, `requireAction(action: Action): Promise<{ ok: true; supabase; user: User; role: Role } | { ok: false; response: NextResponse }>`

- [ ] **Step 1: Write the failing test**

Create `tests/console-rules.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { can } from "../lib/authz";
import { MAX_CASES_PER_JOB, parseJobRequest } from "../lib/jobs";
import { isWorkerOnline } from "../lib/worker-status";

function main() {
  // Role matrix (spec section 3)
  assert.equal(can("operator", "run_jobs"), true);
  assert.equal(can("operator", "review"), false);
  assert.equal(can("operator", "manage"), false);
  assert.equal(can("underwriter", "review"), true);
  assert.equal(can("underwriter", "test_lookup"), true);
  assert.equal(can("underwriter", "audit"), false);
  assert.equal(can("auditor", "view"), true);
  assert.equal(can("auditor", "run_jobs"), false);
  assert.equal(can("auditor", "audit"), true);
  assert.equal(can("admin", "manage"), true);
  assert.equal(can(null, "view"), false);
  assert.equal(can("hacker", "view"), false);

  // Job requests
  const id = "3f1c2b9e-0000-4000-8000-000000000001";
  assert.deepEqual(parseJobRequest({ type: "fetch" }), { ok: true, value: { type: "fetch" } });
  assert.deepEqual(parseJobRequest({ type: "evaluate", all_received: true }), { ok: true, value: { type: "evaluate", all_received: true } });
  assert.deepEqual(parseJobRequest({ type: "evaluate", case_ids: [id, id] }), { ok: true, value: { type: "evaluate", case_ids: [id] } });
  assert.equal(parseJobRequest({ type: "evaluate", case_ids: [] }).ok, false);
  assert.equal(parseJobRequest({ type: "evaluate", case_ids: ["not-a-uuid"] }).ok, false);
  const tooMany = Array.from({ length: MAX_CASES_PER_JOB + 1 }, (_, i) => `3f1c2b9e-0000-4000-8000-${String(i).padStart(12, "0")}`);
  assert.equal(parseJobRequest({ type: "evaluate", case_ids: tooMany }).ok, false);
  assert.equal(parseJobRequest({ type: "delete" }).ok, false);
  assert.equal(parseJobRequest(null).ok, false);

  // Worker online window: 2 minutes
  const now = Date.parse("2026-09-27T12:00:00Z");
  assert.equal(isWorkerOnline("2026-09-27T11:59:00Z", now), true);
  assert.equal(isWorkerOnline("2026-09-27T11:57:59Z", now), false);
  assert.equal(isWorkerOnline(null, now), false);

  console.log("console rules tests passed");
}

main();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/console-rules.test.ts`
Expected: FAIL — `Cannot find module '../lib/authz'`.

- [ ] **Step 3: Implement `lib/authz.ts`**

```ts
export type Role = "operator" | "underwriter" | "auditor" | "admin";
export type Action = "view" | "run_jobs" | "review" | "test_lookup" | "manage" | "audit";

const MATRIX: Record<Action, readonly Role[]> = {
  view: ["operator", "underwriter", "auditor", "admin"],
  run_jobs: ["operator", "underwriter", "admin"],
  review: ["underwriter", "admin"],
  test_lookup: ["underwriter", "admin"],
  manage: ["admin"],
  audit: ["auditor", "admin"],
};

export function can(role: string | null | undefined, action: Action): boolean {
  return !!role && (MATRIX[action] as readonly string[]).includes(role);
}
```

- [ ] **Step 4: Implement `lib/jobs.ts`**

```ts
export const MAX_CASES_PER_JOB = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type JobRequest = { type: "fetch" } | { type: "evaluate"; case_ids: string[] } | { type: "evaluate"; all_received: true };

export function parseJobRequest(body: unknown): { ok: true; value: JobRequest } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (b.type === "fetch") return { ok: true, value: { type: "fetch" } };
  if (b.type !== "evaluate") return { ok: false, error: "type must be fetch or evaluate" };
  if (b.all_received === true) return { ok: true, value: { type: "evaluate", all_received: true } };
  if (!Array.isArray(b.case_ids) || !b.case_ids.every((x) => typeof x === "string" && UUID.test(x))) {
    return { ok: false, error: "case_ids must be an array of case UUIDs" };
  }
  const case_ids = [...new Set(b.case_ids as string[])];
  if (!case_ids.length || case_ids.length > MAX_CASES_PER_JOB) {
    return { ok: false, error: `Select between 1 and ${MAX_CASES_PER_JOB} cases` };
  }
  return { ok: true, value: { type: "evaluate", case_ids } };
}
```

- [ ] **Step 5: Implement `lib/worker-status.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export const WORKER_OFFLINE_AFTER_MS = 2 * 60_000;

export function isWorkerOnline(lastSeenAt: string | null | undefined, now = Date.now()): boolean {
  return !!lastSeenAt && now - new Date(lastSeenAt).getTime() < WORKER_OFFLINE_AFTER_MS;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getWorkerStatus(supabase: SupabaseClient<any, any, any>) {
  const { data } = await supabase
    .from("worker_heartbeats")
    .select("last_seen_at,current_job_id")
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    online: isWorkerOnline(data?.last_seen_at),
    lastSeenAt: (data?.last_seen_at as string | undefined) ?? null,
    currentJobId: (data?.current_job_id as string | undefined) ?? null,
  };
}
```

- [ ] **Step 6: Implement `lib/api-auth.ts`**

```ts
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { can, type Action, type Role } from "@/lib/authz";

type Db = Awaited<ReturnType<typeof createClient>>;

/** Current user and their role; role is null for inactive or profile-less users. */
export async function getSessionProfile(supabase: Db) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("role,is_active,full_name").eq("id", user.id).maybeSingle();
  return {
    user,
    role: (data?.is_active ? data.role : null) as Role | null,
    fullName: (data?.full_name as string | null) ?? null,
  };
}

export async function requireAction(
  action: Action,
): Promise<{ ok: true; supabase: Db; user: User; role: Role } | { ok: false; response: NextResponse }> {
  const supabase = await createClient();
  const profile = await getSessionProfile(supabase);
  if (!profile) return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!profile.role || !can(profile.role, action)) {
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, supabase, user: profile.user, role: profile.role };
}
```

- [ ] **Step 7: Run tests, add to script, type-check**

Append ` && tsx tests/console-rules.test.ts` to the `"test"` script.
Run: `npm test && npm run lint`
Expected: `console rules tests passed`; tsc exits 0.

- [ ] **Step 8: Commit**

```bash
git add lib/authz.ts lib/jobs.ts lib/worker-status.ts lib/api-auth.ts tests/console-rules.test.ts package.json
git commit -m "feat(console): role matrix, job request parsing and worker status helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Pure case mapping for the worker

**Files:**
- Create: `src/worker/case-mapping.ts`
- Test: `tests/case-mapping.test.ts`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: `CorehubReferral` (`src/worker/corehub-scraper.ts`), `ObvBrowserResult` (`src/worker/obv-lookup.ts`), `DecisionInput`, `DecisionType`, `ProviderStatus` (`src/domain/motor-idv.ts`).
- Produces:
  - `BROWSER_VEHICLE_CONFIDENCE = 0.9`
  - `providerStatusFor(obv: Pick<ObvBrowserResult, "success" | "reasonCode">): ProviderStatus`
  - `decisionInputFor(requestedIdv: number | null, obv: ObvBrowserResult): DecisionInput` — always passes `obv.conditions`
  - `caseStatusesFor(decision: DecisionType): { referral_status: "approved" | "manual_review"; workflow_status: "auto_approved" | "queued_for_review" }`
  - `newCaseRow(r: CorehubReferral, runId: string, dryRun: boolean)` — insert payload for `referral_cases` with `referral_status: "received"`, `workflow_status: "intake_pending"`

- [ ] **Step 1: Write the failing test**

Create `tests/case-mapping.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { evaluateIdvDecision } from "../src/domain/decision-engine";
import { caseStatusesFor, decisionInputFor, newCaseRow, providerStatusFor } from "../src/worker/case-mapping";
import type { ObvBrowserResult } from "../src/worker/obv-lookup";

const cfg = {
  absoluteTolerance: 5000,
  percentageTolerance: 2,
  minimumVehicleConfidence: 0.85,
  providerTimeoutSeconds: 4,
  retryCount: 2,
  reviewSlaMinutes: 240,
};

function obv(over: Partial<ObvBrowserResult> = {}): ObvBrowserResult {
  return { success: true, idv: 500000, sourceUrl: "https://obv.test/r/1", reasonCode: "SUCCESS", latencyMs: 10, evidence: [], ...over };
}

function main() {
  assert.equal(providerStatusFor({ success: true, reasonCode: "SUCCESS" }), "succeeded");
  assert.equal(providerStatusFor({ success: false, reasonCode: "TIMEOUT" }), "timeout");
  assert.equal(providerStatusFor({ success: false, reasonCode: "CAPTCHA_DETECTED" }), "unavailable");
  assert.equal(providerStatusFor({ success: false, reasonCode: "NO_RESULTS" }), "failed");

  // Requested IDV 8% above base valuation but inside the Very Good band → condition-band approval.
  const banded = obv({ conditions: { veryGood: { min: 520000, max: 560000, midpoint: 540000, raw: "5.2 - 5.6 Lakh" } } });
  const d = evaluateIdvDecision(decisionInputFor(540000, banded), cfg);
  assert.equal(d.decision, "auto_approved");
  assert.equal(d.reasonCode, "WITHIN_CONDITION_BAND");
  assert.equal(d.matchedCondition, "very_good");

  // Same request without bands → manual review.
  assert.equal(evaluateIdvDecision(decisionInputFor(540000, obv()), cfg).decision, "manual_review");

  assert.deepEqual(caseStatusesFor("auto_approved"), { referral_status: "approved", workflow_status: "auto_approved" });
  assert.deepEqual(caseStatusesFor("manual_review"), { referral_status: "manual_review", workflow_status: "queued_for_review" });

  const row = newCaseRow(
    { externalCaseId: "REF-9", registrationNumber: "MH01AB1234", make: "Maruti", model: "Baleno", variant: "Zeta", fuelType: "Petrol", cc: "1197", requestedIdv: 540000, rawValues: { a: "b" } },
    "run-1",
    true,
  );
  assert.equal(row.idempotency_key, "corehub:REF-9");
  assert.equal(row.referral_status, "received");
  assert.equal(row.workflow_status, "intake_pending");
  assert.equal(row.automation_run_id, "run-1");
  assert.deepEqual(row.metadata, { dry_run: true, raw_values: { a: "b" } });

  console.log("case mapping tests passed");
}

main();
```

If `CorehubReferral` has fields beyond those listed in `src/worker/corehub-scraper.ts:19-31`, add them to the object literal in the test with realistic values.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/case-mapping.test.ts`
Expected: FAIL — `Cannot find module '../src/worker/case-mapping'`.

- [ ] **Step 3: Implement `src/worker/case-mapping.ts`**

```ts
import type { CorehubReferral } from "./corehub-scraper";
import type { ObvBrowserResult } from "./obv-lookup";
import type { DecisionInput, DecisionType, ProviderStatus } from "../domain/motor-idv";

/** Vehicle identity extracted from the CoreHub table rather than matched: moderate confidence. */
export const BROWSER_VEHICLE_CONFIDENCE = 0.9;

export function providerStatusFor(obv: Pick<ObvBrowserResult, "success" | "reasonCode">): ProviderStatus {
  if (obv.success) return "succeeded";
  if (obv.reasonCode === "TIMEOUT") return "timeout";
  if (obv.reasonCode === "CAPTCHA_DETECTED") return "unavailable";
  return "failed";
}

export function decisionInputFor(requestedIdv: number | null, obv: ObvBrowserResult): DecisionInput {
  return {
    requestedIdv,
    fetchedIdv: obv.idv,
    vehicleConfidence: BROWSER_VEHICLE_CONFIDENCE,
    providerStatus: providerStatusFor(obv),
    conditions: obv.conditions ?? null,
  };
}

export function caseStatusesFor(decision: DecisionType) {
  return decision === "auto_approved"
    ? ({ referral_status: "approved", workflow_status: "auto_approved" } as const)
    : ({ referral_status: "manual_review", workflow_status: "queued_for_review" } as const);
}

export function newCaseRow(r: CorehubReferral, runId: string, dryRun: boolean) {
  return {
    external_case_id: r.externalCaseId,
    source_system: "corehub-browser",
    idempotency_key: `corehub:${r.externalCaseId}`,
    registration_number: r.registrationNumber ?? null,
    make_raw: r.make,
    model_raw: r.model,
    variant_raw: r.variant,
    fuel_type_raw: r.fuelType,
    cc_raw: r.cc,
    requested_idv: r.requestedIdv,
    referral_status: "received" as const,
    workflow_status: "intake_pending" as const,
    automation_run_id: runId,
    metadata: { dry_run: dryRun, raw_values: r.rawValues },
  };
}
```

- [ ] **Step 4: Run test, add to script, type-check**

Append ` && tsx tests/case-mapping.test.ts` to the `"test"` script.
Run: `npm test && npm run lint`
Expected: `case mapping tests passed`; tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/worker/case-mapping.ts tests/case-mapping.test.ts package.json
git commit -m "feat(worker): pure case mapping with condition bands passed to the engine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Split the worker pipeline into fetch and evaluate

**Files:**
- Create: `src/worker/pipeline.ts`
- Modify: `src/worker/run.ts` (rewrite on top of pipeline), `src/worker/config.ts:78` (triggerSource type)

**Interfaces:**
- Consumes: `case-mapping.ts` (Task 4), `reconcileConditionBands` (`src/worker/reconcile.ts`, precondition), `scrapeCorehub(page, context, config, runId)`, `lookupObvBrowser(page, {make, model, variant}, config, runId)`, `loadDecisionConfig(supabase)`, `evaluateIdvDecision`.
- Produces (from `src/worker/pipeline.ts`):
  - `interface Session { supabase: SupabaseClient; config: WorkerConfig; context: BrowserContext; decisionConfig: DecisionConfig; runId: string }`
  - `interface RunCounts { casesDiscovered: number; casesNew: number; casesProcessed: number; casesErrored: number; errors: string[] }`
  - `emptyCounts(): RunCounts`
  - `createRun(supabase, config: WorkerConfig): Promise<string>` (returns run id)
  - `finalizeRun(supabase, runId: string, dryRun: boolean, counts: RunCounts, failed: boolean): Promise<"completed" | "failed" | "dry_run_completed">`
  - `openSession(supabase, config: WorkerConfig, runId: string): Promise<{ session: Session; close: () => Promise<void> }>`
  - `fetchReferrals(s: Session): Promise<{ discovered: number; newCaseIds: string[] }>` — throws on CoreHub failure
  - `evaluateCases(s: Session, caseIds: string[], onProgress?: (done: number, total: number) => Promise<void>): Promise<{ casesProcessed: number; casesErrored: number; errors: string[] }>`
  - `runReconcile(s: Session): Promise<string | null>` — returns an error message or null
- `WorkerConfig["triggerSource"]` becomes `"manual" | "cron" | "github_actions" | "schedule" | "ui"`.

No unit test: this module is Playwright + Supabase glue; its pure parts are covered by Task 4. Verification is type-check plus a dry run.

- [ ] **Step 1: Widen triggerSource**

In `src/worker/config.ts` replace:

```ts
  triggerSource: "manual" | "cron" | "github_actions";
```

with:

```ts
  triggerSource: "manual" | "cron" | "github_actions" | "schedule" | "ui";
```

- [ ] **Step 2: Create `src/worker/pipeline.ts`**

```ts
/**
 * Reusable worker pipeline steps shared by the CLI (run.ts) and the daemon.
 * fetchReferrals: CoreHub → referral_cases (status received)
 * evaluateCases:  referral_cases → OBV → decision engine → decisions/reviews
 */

import { chromium, type BrowserContext, type Page } from "playwright";
import { existsSync } from "fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "./config";
import { scrapeCorehub } from "./corehub-scraper";
import { lookupObvBrowser, type ObvBrowserResult } from "./obv-lookup";
import { reconcileConditionBands } from "./reconcile";
import { BROWSER_VEHICLE_CONFIDENCE, caseStatusesFor, decisionInputFor, newCaseRow, providerStatusFor } from "./case-mapping";
import { evaluateIdvDecision } from "../domain/decision-engine";
import { loadDecisionConfig } from "../server/idv-config";
import type { DecisionConfig } from "../domain/motor-idv";

export interface Session {
  supabase: SupabaseClient;
  config: WorkerConfig;
  context: BrowserContext;
  decisionConfig: DecisionConfig;
  runId: string;
}

export interface RunCounts {
  casesDiscovered: number;
  casesNew: number;
  casesProcessed: number;
  casesErrored: number;
  errors: string[];
}

export const emptyCounts = (): RunCounts => ({ casesDiscovered: 0, casesNew: 0, casesProcessed: 0, casesErrored: 0, errors: [] });

export async function createRun(supabase: SupabaseClient, config: WorkerConfig): Promise<string> {
  const { data, error } = await supabase
    .from("automation_runs")
    .insert({ run_label: config.pollLabel, status: "running", dry_run: config.dryRun, trigger_source: config.triggerSource })
    .select("id")
    .single();
  if (error) throw new Error(`Failed to create automation run: ${error.message}`);
  return data.id as string;
}

export async function finalizeRun(supabase: SupabaseClient, runId: string, dryRun: boolean, c: RunCounts, failed: boolean) {
  const status =
    failed || (c.casesErrored > 0 && c.casesProcessed === 0) ? "failed" : dryRun ? "dry_run_completed" : "completed";
  await supabase
    .from("automation_runs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      cases_discovered: c.casesDiscovered,
      cases_new: c.casesNew,
      cases_processed: c.casesProcessed,
      cases_errored: c.casesErrored,
      error_summary: c.errors.length ? c.errors.join("; ") : null,
    })
    .eq("id", runId);
  return status as "completed" | "failed" | "dry_run_completed";
}

export async function openSession(supabase: SupabaseClient, config: WorkerConfig, runId: string) {
  const decisionConfig = await loadDecisionConfig(supabase);
  // Prefer the system Chrome, fall back to bundled Chromium.
  const browser = await chromium
    .launch({ channel: "chrome", headless: config.headless })
    .catch(() => chromium.launch({ headless: config.headless }));
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    ...(existsSync(config.sessionStoragePath) ? { storageState: config.sessionStoragePath } : {}),
  });
  const session: Session = { supabase, config, context, decisionConfig, runId };
  const close = async () => {
    await context.close().catch(() => {});
    await browser.close();
  };
  return { session, close };
}

/** Queued reviews re-checked against condition bands. Never throws. */
export async function runReconcile(s: Session): Promise<string | null> {
  try {
    const r = await reconcileConditionBands(s.supabase, s.decisionConfig, { dryRun: s.config.dryRun, runId: s.runId });
    console.log(`🔁 Reconciled ${r.checked} queued reviews, ${s.config.dryRun ? "would approve" : "approved"} ${r.approved}`);
    return null;
  } catch (err) {
    return `Reconciliation failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function fetchReferrals(s: Session): Promise<{ discovered: number; newCaseIds: string[] }> {
  const page = await s.context.newPage();
  try {
    const result = await scrapeCorehub(page, s.context, s.config, s.runId);
    if (!result.success) {
      const error = result.error ?? "CoreHub scrape failed";
      await s.supabase.from("audit_events").insert({
        event_type: "browser_worker_corehub_error",
        actor_type: "automation",
        severity: "error",
        payload: { error, runId: s.runId },
      });
      throw new Error(error);
    }
    if (!result.referrals.length) return { discovered: 0, newCaseIds: [] };

    // ON CONFLICT DO NOTHING: only genuinely new referrals come back.
    const { data, error } = await s.supabase
      .from("referral_cases")
      .upsert(result.referrals.map((r) => newCaseRow(r, s.runId, s.config.dryRun)), {
        onConflict: "external_case_id",
        ignoreDuplicates: true,
      })
      .select("id,correlation_id");
    if (error) throw new Error(`Failed to store referrals: ${error.message}`);

    const rows = data ?? [];
    if (rows.length) {
      await s.supabase.from("audit_events").insert(
        rows.map((r) => ({
          case_id: r.id,
          event_type: "referral_received",
          actor_type: "automation",
          severity: "info",
          payload: { source: "corehub-browser", runId: s.runId },
          correlation_id: r.correlation_id,
        })),
      );
    }
    console.log(`📊 CoreHub: ${result.referrals.length} referrals, ${rows.length} new`);
    return { discovered: result.referrals.length, newCaseIds: rows.map((r) => r.id as string) };
  } finally {
    await page.close();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function evaluateOne(s: Session, page: Page, c: any) {
  const dryRun = s.config.dryRun;
  await s.supabase
    .from("referral_cases")
    .update({ referral_status: "processing", workflow_status: "lookup_pending", last_error_message: null })
    .eq("id", c.id);

  const obv: ObvBrowserResult =
    c.make_raw && c.model_raw && c.variant_raw
      ? await lookupObvBrowser(page, { make: c.make_raw, model: c.model_raw, variant: c.variant_raw }, s.config, s.runId)
      : {
          success: false,
          idv: null,
          sourceUrl: null,
          reasonCode: "NO_RESULTS",
          latencyMs: 0,
          evidence: [],
          raw: { reason: "Missing make/model/variant from CoreHub" },
        };

  const requestedIdv = c.requested_idv == null ? null : Number(c.requested_idv);
  const decision = evaluateIdvDecision(decisionInputFor(requestedIdv, obv), s.decisionConfig);
  const now = new Date().toISOString();

  // Upserts on case_id so a re-evaluation replaces the previous evidence.
  const { data: resolution } = await s.supabase
    .from("vehicle_resolutions")
    .upsert(
      {
        case_id: c.id,
        normalized_make: c.make_raw?.toUpperCase() ?? null,
        normalized_model: c.model_raw?.toUpperCase() ?? null,
        normalized_variant: c.variant_raw?.toUpperCase() ?? null,
        normalized_fuel: c.fuel_type_raw?.toUpperCase() ?? null,
        normalized_cc: c.cc_raw ? Number(c.cc_raw) : null,
        candidate_source: "corehub-browser",
        resolved_vehicle_key: [c.make_raw, c.model_raw, c.variant_raw].filter(Boolean).join("-").toUpperCase().replace(/\s+/g, ""),
        resolved_make: c.make_raw,
        resolved_model: c.model_raw,
        resolved_variant: c.variant_raw,
        confidence_score: BROWSER_VEHICLE_CONFIDENCE,
        match_strategy: "browser_extraction",
        match_reason_codes: ["COREHUB_BROWSER_EXTRACT"],
      },
      { onConflict: "case_id" },
    )
    .select("id")
    .single();

  const { data: idvCheck } = await s.supabase
    .from("idv_checks")
    .upsert(
      {
        case_id: c.id,
        vehicle_resolution_id: resolution?.id ?? null,
        provider: "obv-browser",
        provider_status: providerStatusFor(obv),
        fetched_idv: obv.idv,
        fetched_currency: "INR",
        fetched_at: now,
        lookup_latency_ms: obv.latencyMs,
        raw_request: { make: c.make_raw, model: c.model_raw, variant: c.variant_raw, source_url: s.config.obvSearchUrl ?? null },
        raw_response: { idv: obv.idv, sourceUrl: obv.sourceUrl, reasonCode: obv.reasonCode, conditions: obv.conditions ?? null },
      },
      { onConflict: "case_id" },
    )
    .select("id")
    .single();

  await s.supabase.from("approval_decisions").upsert(
    {
      case_id: c.id,
      idv_check_id: idvCheck?.id ?? null,
      decision: decision.decision,
      decision_reason_code: decision.reasonCode,
      decision_reason_details: { explanation: decision.explanation, matchedCondition: decision.matchedCondition ?? null, dry_run: dryRun },
      requested_idv: requestedIdv,
      fetched_idv: obv.idv,
      absolute_delta: decision.absoluteDelta,
      percentage_delta: decision.percentageDelta,
      tolerance_mode: "absolute_or_percentage",
      tolerance_value: s.decisionConfig.absoluteTolerance,
      decided_by: null,
      decided_at: now,
    },
    { onConflict: "case_id" },
  );

  const { data: openReview } = await s.supabase
    .from("manual_reviews")
    .select("id")
    .eq("case_id", c.id)
    .neq("review_status", "completed")
    .limit(1)
    .maybeSingle();

  if (decision.decision === "manual_review" && !openReview) {
    await s.supabase.from("manual_reviews").insert({
      case_id: c.id,
      review_status: "queued",
      priority: 3,
      review_reason: decision.explanation,
      sla_due_at: new Date(Date.now() + s.decisionConfig.reviewSlaMinutes * 60_000).toISOString(),
    });
  }
  if (decision.decision === "auto_approved" && openReview) {
    await s.supabase
      .from("manual_reviews")
      .update({
        review_status: "completed",
        reviewer_decision: "auto_approved",
        reviewer_notes: "Superseded by automated re-evaluation",
        reviewed_at: now,
      })
      .eq("id", openReview.id);
  }

  const { error } = await s.supabase
    .from("referral_cases")
    .update({
      ...caseStatusesFor(decision.decision),
      processed_at: now,
      metadata: { ...(c.metadata ?? {}), dry_run: dryRun, obv_source_url: obv.sourceUrl, obv_reason_code: obv.reasonCode },
    })
    .eq("id", c.id);
  if (error) throw new Error(`Failed to update case: ${error.message}`);

  await s.supabase.from("audit_events").insert({
    case_id: c.id,
    event_type: dryRun ? "browser_worker_dry_run" : "browser_worker_processed",
    actor_type: "automation",
    severity: "info",
    payload: {
      decision: decision.decision,
      reasonCode: decision.reasonCode,
      matchedCondition: decision.matchedCondition ?? null,
      requestedIdv,
      fetchedIdv: obv.idv,
      obvSourceUrl: obv.sourceUrl,
      dryRun,
      runId: s.runId,
    },
    correlation_id: c.correlation_id,
  });
  console.log(`   ${c.external_case_id}: ${decision.decision} — ${decision.reasonCode}`);
}

export async function evaluateCases(
  s: Session,
  caseIds: string[],
  onProgress?: (done: number, total: number) => Promise<void>,
) {
  const counts = { casesProcessed: 0, casesErrored: 0, errors: [] as string[] };
  if (!caseIds.length) return counts;
  const { data: cases, error } = await s.supabase.from("referral_cases").select("*").in("id", caseIds);
  if (error) throw new Error(`Failed to load cases: ${error.message}`);

  const rows = cases ?? [];
  const page = await s.context.newPage();
  try {
    for (const [i, c] of rows.entries()) {
      try {
        await evaluateOne(s, page, c);
        counts.casesProcessed++;
      } catch (err) {
        counts.casesErrored++;
        const message = err instanceof Error ? err.message : String(err);
        counts.errors.push(`Error evaluating ${c.external_case_id}: ${message}`);
        await s.supabase
          .from("referral_cases")
          .update({ referral_status: "failed", workflow_status: "failed_retrying", last_error_message: message })
          .eq("id", c.id);
        await s.supabase.from("audit_events").insert({
          case_id: c.id,
          event_type: "browser_worker_case_error",
          actor_type: "automation",
          severity: "error",
          payload: { error: message, runId: s.runId },
          correlation_id: c.correlation_id,
        });
      }
      await onProgress?.(i + 1, rows.length);
    }
  } finally {
    await page.close();
  }
  return counts;
}
```

- [ ] **Step 3: Rewrite `src/worker/run.ts`**

Replace the whole file with:

```ts
/**
 * CLI worker run: reconcile queued reviews, fetch new CoreHub referrals, evaluate them.
 *
 * Usage:
 *   npx tsx src/worker/run.ts                           # dry-run by default
 *   AUTOMATION_DRY_RUN=false npx tsx src/worker/run.ts  # live mode
 *
 * The console uses the daemon (daemon.ts) instead; this stays for local and
 * emergency GitHub Actions runs.
 */

import { loadWorkerConfig, type WorkerConfig } from "./config";
import { getAdminClient } from "./supabase-admin";
import { createRun, emptyCounts, evaluateCases, fetchReferrals, finalizeRun, openSession, runReconcile } from "./pipeline";

export async function runWorker(configOverrides?: Partial<WorkerConfig>) {
  const started = Date.now();
  const config = loadWorkerConfig(configOverrides);
  const supabase = getAdminClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  const runId = await createRun(supabase, config);
  console.log(`🚀 IDV worker ${config.dryRun ? "DRY RUN" : "LIVE"} — run ${runId} (${config.triggerSource})`);

  const counts = emptyCounts();
  let failed = false;
  let close: (() => Promise<void>) | undefined;
  try {
    const opened = await openSession(supabase, config, runId);
    close = opened.close;
    const reconcileError = await runReconcile(opened.session);
    if (reconcileError) counts.errors.push(reconcileError);

    const fetched = await fetchReferrals(opened.session);
    counts.casesDiscovered = fetched.discovered;
    counts.casesNew = fetched.newCaseIds.length;
    const evaluated = await evaluateCases(opened.session, fetched.newCaseIds, async (done, total) => {
      console.log(`   ${done}/${total} evaluated`);
    });
    counts.casesProcessed = evaluated.casesProcessed;
    counts.casesErrored = evaluated.casesErrored;
    counts.errors.push(...evaluated.errors);
  } catch (err) {
    failed = true;
    counts.errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await close?.();
  }

  const status = await finalizeRun(supabase, runId, config.dryRun, counts, failed);
  const durationMs = Date.now() - started;
  console.log(
    `🏁 ${status} in ${(durationMs / 1000).toFixed(1)}s — discovered ${counts.casesDiscovered}, new ${counts.casesNew}, processed ${counts.casesProcessed}, errored ${counts.casesErrored}`,
  );
  counts.errors.forEach((e) => console.log(`   - ${e}`));
  return { runId, status, durationMs, ...counts };
}

const isDirectRun = process.argv[1]?.endsWith("run.ts") || process.argv[1]?.endsWith("run.js");

if (isDirectRun) {
  runWorker()
    .then((summary) => process.exit(summary.status === "failed" ? 1 : 0))
    .catch((err) => {
      console.error("💥 Worker crashed:", err);
      process.exit(1);
    });
}
```

Note: reconciliation now runs after the browser opens (it was before). It still does not depend on CoreHub succeeding.

- [ ] **Step 4: Type-check and run tests**

Run: `npm run lint && npm test`
Expected: tsc exits 0; all tests pass. If `tsc` reports that something imports a removed export from `run.ts` (e.g. `test-referral-obv.ts`), switch that import to the equivalent in `pipeline.ts`.

- [ ] **Step 5: Dry-run smoke test (needs `.env` with CoreHub + Supabase)**

Run: `npm run worker`
Expected: log lines `🚀 IDV worker DRY RUN`, `🔁 Reconciled …`, `📊 CoreHub: …`, and `🏁 dry_run_completed …` (or `failed` with the CoreHub error message if CoreHub is unreachable — that is acceptable; the run row must be finalized either way). Confirm in Supabase: newest `automation_runs` row has `finished_at` set. If `.env` is missing, skip and note it in the task report.

- [ ] **Step 6: Commit**

```bash
git add src/worker/pipeline.ts src/worker/run.ts src/worker/config.ts
git commit -m "refactor(worker): split pipeline into fetchReferrals and evaluateCases

Evaluation now reads cases from referral_cases, upserts evidence on case_id so
cases can be re-evaluated, and closes open reviews superseded by an approval.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Daemon core (queue, scheduler, stale recovery)

**Files:**
- Create: `src/worker/daemon-core.ts`
- Test: `tests/daemon.test.ts`
- Modify: `package.json` (test script)

**Interfaces:**
- Consumes: `nextRunAt`, `CompletionMode` from `lib/schedule.ts` (Task 2) via relative import `../../lib/schedule`.
- Produces (from `src/worker/daemon-core.ts`):
  - `STALE_AFTER_MS = 300_000`
  - `type JobType = "fetch" | "evaluate"`
  - `interface JobParams { dry_run: boolean; completion_mode: CompletionMode; then_evaluate?: boolean; case_ids?: string[]; all_received?: boolean }`
  - `interface Job { id: string; type: JobType; params: JobParams; schedule_id: string | null; requested_by: string | null }`
  - `type NewJob = Omit<Job, "id">`
  - `interface Schedule { id: string; cron: string; timezone: string; dry_run: boolean; completion_mode: CompletionMode }`
  - `interface StaleJob { id: string; caseIds: string[] }`
  - `interface ExecuteResult { runId: string; failed: boolean; error: string | null }`
  - `interface DaemonDeps { claimJob(): Promise<Job | null>; execute(job: Job): Promise<ExecuteResult>; finishJob(id: string, r: { status: "succeeded" | "failed"; runId: string | null; error: string | null }): Promise<void>; dueSchedules(now: Date): Promise<Schedule[]>; hasActiveJob(scheduleId: string): Promise<boolean>; enqueue(job: NewJob): Promise<void>; advanceSchedule(id: string, nextRun: Date, ranAt: Date | null): Promise<void>; logScheduleSkipped(id: string): Promise<void>; staleJobs(cutoff: Date): Promise<StaleJob[]>; failStaleJob(job: StaleJob): Promise<void> }`
  - `processNextJob(d: DaemonDeps): Promise<boolean>` (true if a job was claimed)
  - `scheduleTick(d: DaemonDeps, now: Date): Promise<number>` (jobs enqueued)
  - `recoverStale(d: DaemonDeps, now: Date): Promise<number>` (jobs failed)

- [ ] **Step 1: Write the failing test**

Create `tests/daemon.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { STALE_AFTER_MS, processNextJob, recoverStale, scheduleTick, type DaemonDeps, type Job } from "../src/worker/daemon-core";

type Calls = Record<string, unknown[][]>;

function fake(over: Partial<DaemonDeps> = {}) {
  const calls: Calls = {};
  const rec =
    (name: string) =>
    async (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
    };
  const deps: DaemonDeps = {
    claimJob: async () => null,
    execute: async () => ({ runId: "run-1", failed: false, error: null }),
    finishJob: rec("finishJob"),
    dueSchedules: async () => [],
    hasActiveJob: async () => false,
    enqueue: rec("enqueue"),
    advanceSchedule: rec("advanceSchedule"),
    logScheduleSkipped: rec("logScheduleSkipped"),
    staleJobs: async () => [],
    failStaleJob: rec("failStaleJob"),
    ...over,
  };
  return { deps, calls };
}

const job: Job = { id: "job-1", type: "fetch", params: { dry_run: true, completion_mode: "in_app" }, schedule_id: null, requested_by: "u1" };

async function main() {
  // Empty queue
  {
    const { deps, calls } = fake();
    assert.equal(await processNextJob(deps), false);
    assert.equal(calls.finishJob, undefined);
  }
  // Success
  {
    const { deps, calls } = fake({ claimJob: async () => job });
    assert.equal(await processNextJob(deps), true);
    assert.deepEqual(calls.finishJob, [["job-1", { status: "succeeded", runId: "run-1", error: null }]]);
  }
  // Execution reports failure
  {
    const { deps, calls } = fake({ claimJob: async () => job, execute: async () => ({ runId: "run-2", failed: true, error: "CoreHub login failed" }) });
    await processNextJob(deps);
    assert.deepEqual(calls.finishJob, [["job-1", { status: "failed", runId: "run-2", error: "CoreHub login failed" }]]);
  }
  // Execution throws
  {
    const { deps, calls } = fake({
      claimJob: async () => job,
      execute: async () => {
        throw new Error("browser crashed");
      },
    });
    await processNextJob(deps);
    assert.deepEqual(calls.finishJob, [["job-1", { status: "failed", runId: null, error: "browser crashed" }]]);
  }
  // Scheduler: one due, one due-but-still-active, one with a broken cron
  {
    const now = new Date("2026-09-28T04:00:00Z"); // Mon 09:30 IST
    const base = { timezone: "Asia/Kolkata", dry_run: true, completion_mode: "in_app" as const };
    const { deps, calls } = fake({
      dueSchedules: async () => [
        { id: "s-due", cron: "*/15 9-18 * * 1,2,3,4,5,6", ...base },
        { id: "s-busy", cron: "0 23 * * *", ...base },
        { id: "s-broken", cron: "not a cron", ...base },
      ],
      hasActiveJob: async (id) => id === "s-busy",
    });
    assert.equal(await scheduleTick(deps, now), 1);
    assert.deepEqual(calls.enqueue, [
      [{ type: "fetch", schedule_id: "s-due", requested_by: null, params: { dry_run: true, completion_mode: "in_app", then_evaluate: true } }],
    ]);
    assert.deepEqual(calls.logScheduleSkipped, [["s-busy"]]);
    const advanced = calls.advanceSchedule as [string, Date, Date | null][];
    assert.equal(advanced.length, 2, "broken schedule is not advanced");
    assert.equal(advanced[0][0], "s-due");
    assert.equal(advanced[0][1].toISOString(), "2026-09-28T04:15:00.000Z");
    assert.equal(advanced[0][2], now);
    assert.equal(advanced[1][0], "s-busy");
    assert.equal(advanced[1][2], null, "skipped schedule keeps last_run_at");
  }
  // Stale recovery uses a 5-minute cutoff
  {
    const now = new Date("2026-09-28T04:00:00Z");
    let cutoff: Date | null = null;
    const stale = { id: "job-9", caseIds: ["c1"] };
    const { deps, calls } = fake({
      staleJobs: async (c) => {
        cutoff = c;
        return [stale];
      },
    });
    assert.equal(await recoverStale(deps, now), 1);
    assert.equal(cutoff!.getTime(), now.getTime() - STALE_AFTER_MS);
    assert.deepEqual(calls.failStaleJob, [[stale]]);
  }

  console.log("daemon tests passed");
}

main();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/daemon.test.ts`
Expected: FAIL — `Cannot find module '../src/worker/daemon-core'`.

- [ ] **Step 3: Implement `src/worker/daemon-core.ts`**

```ts
/**
 * Daemon loop steps. All I/O goes through DaemonDeps so the logic is testable
 * without Supabase or a browser (see tests/daemon.test.ts).
 */

import { nextRunAt, type CompletionMode } from "../../lib/schedule";

export const STALE_AFTER_MS = 5 * 60_000;

export type JobType = "fetch" | "evaluate";

export interface JobParams {
  dry_run: boolean;
  completion_mode: CompletionMode;
  then_evaluate?: boolean;
  case_ids?: string[];
  all_received?: boolean;
}

export interface Job {
  id: string;
  type: JobType;
  params: JobParams;
  schedule_id: string | null;
  requested_by: string | null;
}

export type NewJob = Omit<Job, "id">;

export interface Schedule {
  id: string;
  cron: string;
  timezone: string;
  dry_run: boolean;
  completion_mode: CompletionMode;
}

export interface StaleJob {
  id: string;
  caseIds: string[];
}

export interface ExecuteResult {
  runId: string;
  failed: boolean;
  error: string | null;
}

export interface DaemonDeps {
  claimJob(): Promise<Job | null>;
  execute(job: Job): Promise<ExecuteResult>;
  finishJob(id: string, r: { status: "succeeded" | "failed"; runId: string | null; error: string | null }): Promise<void>;
  dueSchedules(now: Date): Promise<Schedule[]>;
  hasActiveJob(scheduleId: string): Promise<boolean>;
  enqueue(job: NewJob): Promise<void>;
  advanceSchedule(id: string, nextRun: Date, ranAt: Date | null): Promise<void>;
  logScheduleSkipped(id: string): Promise<void>;
  staleJobs(cutoff: Date): Promise<StaleJob[]>;
  failStaleJob(job: StaleJob): Promise<void>;
}

export async function processNextJob(d: DaemonDeps): Promise<boolean> {
  const job = await d.claimJob();
  if (!job) return false;
  try {
    const r = await d.execute(job);
    await d.finishJob(job.id, { status: r.failed ? "failed" : "succeeded", runId: r.runId, error: r.error });
  } catch (err) {
    await d.finishJob(job.id, { status: "failed", runId: null, error: err instanceof Error ? err.message : String(err) });
  }
  return true;
}

export async function scheduleTick(d: DaemonDeps, now: Date): Promise<number> {
  let enqueued = 0;
  for (const s of await d.dueSchedules(now)) {
    let next: Date;
    try {
      next = nextRunAt(s.cron, s.timezone, now);
    } catch (err) {
      console.error(`⚠ Schedule ${s.id} has an invalid cron "${s.cron}":`, err);
      continue;
    }
    // One run per schedule at a time: skip this slot if the previous one hasn't finished.
    if (await d.hasActiveJob(s.id)) {
      await d.logScheduleSkipped(s.id);
      await d.advanceSchedule(s.id, next, null);
      continue;
    }
    await d.enqueue({
      type: "fetch",
      schedule_id: s.id,
      requested_by: null,
      params: { dry_run: s.dry_run, completion_mode: s.completion_mode, then_evaluate: true },
    });
    await d.advanceSchedule(s.id, next, now);
    enqueued++;
  }
  return enqueued;
}

export async function recoverStale(d: DaemonDeps, now: Date): Promise<number> {
  const stale = await d.staleJobs(new Date(now.getTime() - STALE_AFTER_MS));
  for (const job of stale) await d.failStaleJob(job);
  return stale.length;
}
```

- [ ] **Step 4: Run test, add to script, type-check**

Append ` && tsx tests/daemon.test.ts` to the `"test"` script.
Run: `npm test && npm run lint`
Expected: `daemon tests passed`; tsc exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/worker/daemon-core.ts tests/daemon.test.ts package.json
git commit -m "feat(worker): daemon core for job queue, schedules and stale recovery

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Daemon store, job execution and entry point

**Files:**
- Create: `src/worker/daemon-store.ts`, `src/worker/daemon.ts`
- Modify: `package.json` (script `worker:daemon`), `README.md` (daemon section)

**Interfaces:**
- Consumes: `DaemonDeps`, `Job`, `ExecuteResult`, `processNextJob`, `scheduleTick`, `recoverStale` (Task 6); `createRun`, `emptyCounts`, `evaluateCases`, `fetchReferrals`, `finalizeRun`, `openSession`, `runReconcile` (Task 5); `claim_next_job` RPC (Task 1).
- Produces:
  - `createDaemonDeps(supabase: SupabaseClient, workerId: string, execute: DaemonDeps["execute"]): DaemonDeps`
  - `executeJob(supabase: SupabaseClient, job: Job): Promise<ExecuteResult>`
  - `automation_jobs.progress` shape written by the worker: `{ current_step: string; done: number; total: number; case_ids?: string[] }` — consumed by Tasks 10–12.
  - npm script `worker:daemon`.

- [ ] **Step 1: Create `src/worker/daemon-store.ts`**

```ts
/** Supabase-backed DaemonDeps and job execution. Service role only. */

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWorkerConfig } from "./config";
import type { DaemonDeps, ExecuteResult, Job } from "./daemon-core";
import { createRun, emptyCounts, evaluateCases, fetchReferrals, finalizeRun, openSession, runReconcile } from "./pipeline";

export function createDaemonDeps(supabase: SupabaseClient, workerId: string, execute: DaemonDeps["execute"]): DaemonDeps {
  return {
    async claimJob() {
      const { data, error } = await supabase.rpc("claim_next_job", { p_worker_id: workerId });
      if (error) throw new Error(`claim_next_job failed: ${error.message}`);
      return ((data as Job[] | null) ?? [])[0] ?? null;
    },
    execute,
    async finishJob(id, r) {
      await supabase
        .from("automation_jobs")
        .update({ status: r.status, run_id: r.runId, error: r.error, finished_at: new Date().toISOString() })
        .eq("id", id);
    },
    async dueSchedules(now) {
      const { data, error } = await supabase
        .from("automation_schedules")
        .select("id,cron,timezone,dry_run,completion_mode")
        .eq("enabled", true)
        .lte("next_run_at", now.toISOString());
      if (error) throw new Error(`Loading schedules failed: ${error.message}`);
      return data ?? [];
    },
    async hasActiveJob(scheduleId) {
      const { count } = await supabase
        .from("automation_jobs")
        .select("id", { count: "exact", head: true })
        .eq("schedule_id", scheduleId)
        .in("status", ["queued", "running"]);
      return (count ?? 0) > 0;
    },
    async enqueue(job) {
      const { error } = await supabase.from("automation_jobs").insert(job);
      if (error) throw new Error(`Enqueue failed: ${error.message}`);
    },
    async advanceSchedule(id, nextRun, ranAt) {
      await supabase
        .from("automation_schedules")
        .update({ next_run_at: nextRun.toISOString(), ...(ranAt ? { last_run_at: ranAt.toISOString() } : {}) })
        .eq("id", id);
    },
    async logScheduleSkipped(id) {
      await supabase.from("audit_events").insert({
        event_type: "schedule_skipped",
        actor_type: "automation",
        severity: "warning",
        payload: { scheduleId: id, reason: "previous run still active" },
      });
    },
    async staleJobs(cutoff) {
      const { data } = await supabase
        .from("automation_jobs")
        .select("id,params,progress")
        .eq("status", "running")
        .lt("heartbeat_at", cutoff.toISOString());
      return (data ?? []).map((j) => ({
        id: j.id as string,
        caseIds: [...new Set([...(j.params?.case_ids ?? []), ...(j.progress?.case_ids ?? [])])] as string[],
      }));
    },
    async failStaleJob(job) {
      await supabase
        .from("automation_jobs")
        .update({ status: "failed", error: "stale_heartbeat", finished_at: new Date().toISOString() })
        .eq("id", job.id);
      if (job.caseIds.length) {
        await supabase
          .from("referral_cases")
          .update({ referral_status: "received", workflow_status: "intake_pending" })
          .in("id", job.caseIds)
          .eq("referral_status", "processing");
      }
    },
  };
}

async function receivedCaseIds(supabase: SupabaseClient): Promise<string[]> {
  const { data } = await supabase
    .from("referral_cases")
    .select("id")
    .eq("referral_status", "received")
    .order("received_at")
    .limit(200);
  return (data ?? []).map((r) => r.id as string);
}

export async function executeJob(supabase: SupabaseClient, job: Job): Promise<ExecuteResult> {
  if (job.params.completion_mode !== "in_app") throw new Error("CoreHub write-back is not implemented");

  const config = loadWorkerConfig({ dryRun: job.params.dry_run, triggerSource: job.schedule_id ? "schedule" : "ui" });
  const runId = await createRun(supabase, config);
  await supabase.from("automation_jobs").update({ run_id: runId }).eq("id", job.id);

  const progress = async (p: { current_step: string; done: number; total: number; case_ids?: string[] }) => {
    await supabase.from("automation_jobs").update({ progress: p, heartbeat_at: new Date().toISOString() }).eq("id", job.id);
  };

  const counts = emptyCounts();
  let failed = false;
  let close: (() => Promise<void>) | undefined;
  try {
    const opened = await openSession(supabase, config, runId);
    close = opened.close;
    const s = opened.session;

    let caseIds: string[] = [];
    if (job.type === "fetch") {
      await progress({ current_step: "Fetching CoreHub referrals", done: 0, total: 0 });
      // Scheduled runs also re-check queued reviews against condition bands.
      if (job.schedule_id) {
        const reconcileError = await runReconcile(s);
        if (reconcileError) counts.errors.push(reconcileError);
      }
      const fetched = await fetchReferrals(s);
      counts.casesDiscovered = fetched.discovered;
      counts.casesNew = fetched.newCaseIds.length;
      if (job.params.then_evaluate) caseIds = fetched.newCaseIds;
      else await progress({ current_step: `Fetched ${fetched.newCaseIds.length} new referrals`, done: 0, total: 0, case_ids: fetched.newCaseIds });
    } else {
      caseIds = job.params.all_received ? await receivedCaseIds(supabase) : (job.params.case_ids ?? []);
    }

    if (caseIds.length) {
      await progress({ current_step: "Evaluating", done: 0, total: caseIds.length, case_ids: caseIds });
      const evaluated = await evaluateCases(s, caseIds, (done, total) =>
        progress({ current_step: "Evaluating", done, total, case_ids: caseIds }),
      );
      counts.casesProcessed = evaluated.casesProcessed;
      counts.casesErrored = evaluated.casesErrored;
      counts.errors.push(...evaluated.errors);
    } else if (job.params.then_evaluate || job.type === "evaluate") {
      await progress({ current_step: "No cases to evaluate", done: 0, total: 0, case_ids: [] });
    }
  } catch (err) {
    failed = true;
    counts.errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await close?.();
  }

  const status = await finalizeRun(supabase, runId, config.dryRun, counts, failed);
  return { runId, failed: status === "failed", error: counts.errors.join("; ") || null };
}
```

- [ ] **Step 2: Create `src/worker/daemon.ts`**

```ts
/**
 * Always-on worker daemon.
 *
 * Every 10 s: heartbeat → recover stale jobs → enqueue due schedules → run the
 * next queued job. Jobs run one at a time (one CoreHub browser session).
 *
 * Usage: npm run worker:daemon   (keep it running under a process manager)
 */

import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { loadWorkerConfig } from "./config";
import { getAdminClient } from "./supabase-admin";
import { processNextJob, recoverStale, scheduleTick, type DaemonDeps } from "./daemon-core";
import { createDaemonDeps, executeJob } from "./daemon-store";

const WORKER_ID = process.env.WORKER_ID || `${hostname()}-${process.pid}`;
const POLL_MS = 10_000;
const JOB_HEARTBEAT_MS = 30_000;

async function main() {
  const config = loadWorkerConfig();
  const supabase = getAdminClient(config.supabaseUrl, config.supabaseServiceRoleKey);
  let currentJobId: string | null = null;
  let stopping = false;

  const beat = async () => {
    await supabase.from("worker_heartbeats").upsert({
      worker_id: WORKER_ID,
      last_seen_at: new Date().toISOString(),
      version: process.env.npm_package_version ?? null,
      current_job_id: currentJobId,
    });
  };

  const execute: DaemonDeps["execute"] = async (job) => {
    currentJobId = job.id;
    await beat();
    console.log(`▶ Job ${job.id} (${job.type}${job.schedule_id ? ", scheduled" : ""})`);
    // Keep both heartbeats fresh during long OBV lookups.
    const timer = setInterval(async () => {
      await Promise.all([
        beat(),
        supabase.from("automation_jobs").update({ heartbeat_at: new Date().toISOString() }).eq("id", job.id),
      ]).catch((err) => console.error("heartbeat failed:", err));
    }, JOB_HEARTBEAT_MS);
    try {
      const result = await executeJob(supabase, job);
      console.log(`■ Job ${job.id} ${result.failed ? "failed" : "succeeded"}${result.error ? ` — ${result.error}` : ""}`);
      return result;
    } finally {
      clearInterval(timer);
      currentJobId = null;
    }
  };

  const deps = createDaemonDeps(supabase, WORKER_ID, execute);
  const stop = () => {
    console.log("Stopping after the current step…");
    stopping = true;
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);

  console.log(`🤖 IDV worker daemon ${WORKER_ID} started`);
  while (!stopping) {
    try {
      await beat();
      const now = new Date();
      const recovered = await recoverStale(deps, now);
      if (recovered) console.log(`♻ Recovered ${recovered} stale job(s)`);
      const enqueued = await scheduleTick(deps, now);
      if (enqueued) console.log(`⏰ Enqueued ${enqueued} scheduled job(s)`);
      if (await processNextJob(deps)) continue;
    } catch (err) {
      console.error("Daemon tick failed:", err);
    }
    await sleep(POLL_MS);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("💥 Daemon crashed:", err);
  process.exit(1);
});
```

- [ ] **Step 3: Add the npm script**

In `package.json` `scripts`, after `"worker:login"`, add:

```json
    "worker:daemon": "tsx --env-file=.env src/worker/daemon.ts",
```

- [ ] **Step 4: Document the daemon in README.md**

Under the existing `### Worker CLI commands` block in `README.md`, add:

````markdown
### Worker daemon (console-driven runs and schedules)

The console never runs a browser. It queues jobs in `automation_jobs`; the daemon
claims and executes them and fires enabled `automation_schedules`.

```bash
npm run worker:daemon
```

Run it on a host that can reach CoreHub and keep it alive with a process manager
(systemd, pm2, a container restart policy). Optional `WORKER_ID` names the worker;
it defaults to `<hostname>-<pid>`. The console shows the worker offline when no
heartbeat has arrived for 2 minutes.
````

- [ ] **Step 5: Type-check and test**

Run: `npm run lint && npm test`
Expected: tsc exits 0; all tests pass.

- [ ] **Step 6: Daemon smoke test (needs `.env`)**

Run `npm run worker:daemon` in one terminal. In the Supabase SQL editor:

```sql
select worker_id, last_seen_at from public.worker_heartbeats;  -- updated within 10 s
insert into public.automation_jobs (type, params) values ('fetch', '{"dry_run": true, "completion_mode": "in_app"}');
```

Expected: daemon logs `▶ Job … (fetch)` then `■ Job … succeeded` (or `failed — <CoreHub error>`); the job row ends `succeeded`/`failed` with `run_id` and `finished_at` set. Stop with Ctrl-C → `Stopping after the current step…`. If `.env` is missing, skip and note it in the task report.

- [ ] **Step 7: Commit**

```bash
git add src/worker/daemon-store.ts src/worker/daemon.ts package.json README.md
git commit -m "feat(worker): always-on daemon draining the automation job queue

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Jobs API and removals

**Files:**
- Create: `app/api/jobs/route.ts`, `app/api/jobs/[id]/cancel/route.ts`
- Delete: `app/api/intake/referral/route.ts`
- Modify: `.env.example` (remove `COREHUB_WEBHOOK_SECRET=`, add `COREHUB_WRITEBACK_ENABLED=false`), `.github/workflows/idv-worker.yml` (remove `schedule:`)

**Interfaces:**
- Consumes: `requireAction` (Task 3), `parseJobRequest` (Task 3), `getWorkerStatus` (Task 3).
- Produces:
  - `POST /api/jobs` body `{ type: "fetch" } | { type: "evaluate", case_ids: string[] } | { type: "evaluate", all_received: true }` → `202 { id }`; `400 { error }` invalid body; `401/403`; `409 { error }` worker offline or fetch already active.
  - `POST /api/jobs/:id/cancel` → `200 { ok: true }`; `409 { error }` if not queued.

- [ ] **Step 1: Create `app/api/jobs/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireAction } from "@/lib/api-auth";
import { parseJobRequest } from "@/lib/jobs";
import { getWorkerStatus } from "@/lib/worker-status";

export async function POST(request: Request) {
  const auth = await requireAction("run_jobs");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const parsed = parseJobRequest(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const req = parsed.value;

  const worker = await getWorkerStatus(supabase);
  if (!worker.online) return NextResponse.json({ error: "Automation worker is offline" }, { status: 409 });

  if (req.type === "fetch") {
    const { count } = await supabase
      .from("automation_jobs")
      .select("id", { count: "exact", head: true })
      .eq("type", "fetch")
      .in("status", ["queued", "running"]);
    if (count) return NextResponse.json({ error: "A CoreHub fetch is already queued or running" }, { status: 409 });
  }

  const params = {
    dry_run: process.env.AUTOMATION_DRY_RUN !== "false",
    completion_mode: "in_app",
    ...(req.type === "evaluate" ? ("all_received" in req ? { all_received: true } : { case_ids: req.case_ids }) : {}),
  };
  const { data, error } = await supabase
    .from("automation_jobs")
    .insert({ type: req.type, params, requested_by: user.id })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await supabase.from("audit_events").insert({
    event_type: "automation_job_requested",
    actor_type: "user",
    actor_id: user.id,
    severity: "info",
    payload: { jobId: data.id, type: req.type, params },
  });
  return NextResponse.json({ id: data.id }, { status: 202 });
}
```

- [ ] **Step 2: Create `app/api/jobs/[id]/cancel/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireAction } from "@/lib/api-auth";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAction("run_jobs");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const { data } = await supabase
    .from("automation_jobs")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "queued")
    .select("id");
  if (!data?.length) return NextResponse.json({ error: "Only queued jobs can be cancelled" }, { status: 409 });

  await supabase.from("audit_events").insert({
    event_type: "automation_job_cancelled",
    actor_type: "user",
    actor_id: user.id,
    severity: "info",
    payload: { jobId: id },
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Delete the webhook and its env var**

```bash
git rm app/api/intake/referral/route.ts
```

In `.env.example` delete the line `COREHUB_WEBHOOK_SECRET=` and add, next to the other automation settings:

```
# CoreHub write-back of decisions (not implemented yet — keep false)
COREHUB_WRITEBACK_ENABLED=false
```

- [ ] **Step 4: Remove the GitHub Actions cron**

In `.github/workflows/idv-worker.yml` delete these lines (keep `workflow_dispatch` and everything else):

```yaml
  schedule:
    # Run every 10 minutes during business hours IST (Mon-Sat)
    # 03:30 - 13:30 UTC = 09:00 - 19:00 IST
    - cron: '*/10 3-13 * * 1-6'
```

- [ ] **Step 5: Type-check and build**

Run: `npm run lint && npm test && npm run build`
Expected: all pass; build output lists `ƒ /api/jobs` and `ƒ /api/jobs/[id]/cancel` and no `/api/intake/referral`.

- [ ] **Step 6: Manual API check**

With `npm run dev` running and signed in as an operator, in the browser console:

```js
await (await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "fetch" }) })).json()
```

Expected: `{ error: "Automation worker is offline" }` (409) when the daemon is stopped; `{ id: "…" }` (202) when it is running; repeating immediately gives `A CoreHub fetch is already queued or running`.

- [ ] **Step 7: Commit**

```bash
git add app/api/jobs .env.example .github/workflows/idv-worker.yml
git commit -m "feat(api): enqueue and cancel automation jobs; drop webhook intake and Actions cron

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Schedules API

**Files:**
- Create: `app/api/schedules/route.ts`, `app/api/schedules/[id]/route.ts`

**Interfaces:**
- Consumes: `requireAction("manage")`, `validateScheduleInput`, `nextRunAt`, `DEFAULT_TIMEZONE` (Task 2).
- Produces:
  - `POST /api/schedules` body `{ name, cron, timezone?, enabled?, dry_run?, completion_mode? }` → `201 { id }`
  - `PATCH /api/schedules/:id` partial body → `200 { ok: true }`; recomputes `next_run_at` from now whenever `cron`, `timezone` or `enabled` is in the body
  - `DELETE /api/schedules/:id` → `200 { ok: true }`
  - All: `400 { error }` on validation, `403` for non-admins, `404` unknown id.

- [ ] **Step 1: Create `app/api/schedules/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireAction } from "@/lib/api-auth";
import { nextRunAt, validateScheduleInput } from "@/lib/schedule";

export async function POST(request: Request) {
  const auth = await requireAction("manage");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const v = validateScheduleInput(await request.json().catch(() => null));
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const input = v.value;

  const { data, error } = await supabase
    .from("automation_schedules")
    .insert({ ...input, next_run_at: nextRunAt(input.cron!, input.timezone!, new Date()).toISOString(), created_by: user.id })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await supabase.from("audit_events").insert({
    event_type: "schedule_created",
    actor_type: "user",
    actor_id: user.id,
    severity: "info",
    payload: { scheduleId: data.id, ...input },
  });
  return NextResponse.json({ id: data.id }, { status: 201 });
}
```

- [ ] **Step 2: Create `app/api/schedules/[id]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireAction } from "@/lib/api-auth";
import { nextRunAt, validateScheduleInput } from "@/lib/schedule";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const auth = await requireAction("manage");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const v = validateScheduleInput(await request.json().catch(() => null), { partial: true });
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
  const patch: Record<string, unknown> = { ...v.value };

  const { data: current } = await supabase.from("automation_schedules").select("cron,timezone").eq("id", id).maybeSingle();
  if (!current) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  // Re-anchor from now so enabling an old schedule doesn't fire a backlog slot immediately.
  if (v.value.cron !== undefined || v.value.timezone !== undefined || v.value.enabled !== undefined) {
    patch.next_run_at = nextRunAt(v.value.cron ?? current.cron, v.value.timezone ?? current.timezone, new Date()).toISOString();
  }

  const { error } = await supabase.from("automation_schedules").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await supabase.from("audit_events").insert({
    event_type: "schedule_updated",
    actor_type: "user",
    actor_id: user.id,
    severity: "info",
    payload: { scheduleId: id, ...v.value },
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const auth = await requireAction("manage");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const { data } = await supabase.from("automation_schedules").delete().eq("id", id).select("id,name");
  if (!data?.length) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

  await supabase.from("audit_events").insert({
    event_type: "schedule_deleted",
    actor_type: "user",
    actor_id: user.id,
    severity: "info",
    payload: { scheduleId: id, name: data[0].name },
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 3: Type-check and build**

Run: `npm run lint && npm run build`
Expected: both pass; build lists `/api/schedules` and `/api/schedules/[id]`.

- [ ] **Step 4: Manual API check (signed in as admin, browser console)**

```js
const r = await fetch("/api/schedules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Smoke", cron: "*/15 9-18 * * 1,2,3,4,5,6" }) }); console.log(r.status, await r.json());
```

Expected: `201 { id }`; the row exists with `enabled = false` and a future `next_run_at`. `PATCH` it with `{ "cron": "* * * * *" }` → `400` "cannot run more often than every 5 minutes". `DELETE` it → `200`. As a non-admin the POST returns `403`.

- [ ] **Step 5: Commit**

```bash
git add app/api/schedules
git commit -m "feat(api): admin schedule create, update and delete

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Shared console UI pieces and header status

**Files:**
- Create: `components/live-refresh.tsx`, `components/worker-status-pill.tsx`, `components/job-buttons.tsx`, `components/job-progress.tsx`
- Add via shadcn: `components/ui/checkbox.tsx`, `components/ui/switch.tsx`
- Modify: `app/(console)/layout.tsx`, `components/status.tsx` (job status tones), `components/nav.ts`, `components/app-sidebar.tsx`

**Interfaces:**
- Consumes: `isWorkerOnline`, `getWorkerStatus` (Task 3); `/api/jobs` and `/api/jobs/:id/cancel` (Task 8); progress shape (Task 7).
- Produces:
  - `<LiveRefresh tables={string[]} />` — refreshes the route (debounced 500 ms) on any change to the listed tables
  - `<WorkerStatusPill initialLastSeen={string | null} />`
  - `<FetchButton disabledReason={string | null} />`, `<EvaluateButton caseIds={string[]} all?={boolean} label={string} disabledReason?={string | null} onDone?={() => void} variant?={"default" | "outline"} />`, `<CancelJobButton jobId={string} />`
  - `<JobProgress progress={{ current_step?: string; done?: number; total?: number } | null} status={string} />`
  - `activeHref(pathname: string): string | undefined` in `components/nav.ts`
  - `DecisionBadge` renders `succeeded`/`completed` as success and `running`/`queued` as info.

- [ ] **Step 1: Add shadcn components**

Run: `npx shadcn@latest add checkbox switch`
Expected: `components/ui/checkbox.tsx` and `components/ui/switch.tsx` created; no other files overwritten (answer "no" if prompted to overwrite existing files).

- [ ] **Step 2: Create `components/live-refresh.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Re-renders the current server page when any listed table changes (Supabase Realtime). */
export function LiveRefresh({ tables }: { tables: string[] }) {
  const router = useRouter();
  const key = tables.join(",");

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase.channel("live:" + key);
    for (const table of key.split(",")) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
        clearTimeout(timer);
        timer = setTimeout(() => router.refresh(), 500);
      });
    }
    channel.subscribe();
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [key, router]);

  return null;
}
```

- [ ] **Step 3: Create `components/worker-status-pill.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Activity, CircleOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { createClient } from "@/lib/supabase/client";
import { isWorkerOnline } from "@/lib/worker-status";
import { dateTime } from "@/lib/format";

export function WorkerStatusPill({ initialLastSeen }: { initialLastSeen: string | null }) {
  const [lastSeen, setLastSeen] = useState(initialLastSeen);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const supabase = createClient();
    const timer = setInterval(async () => {
      const { data } = await supabase
        .from("worker_heartbeats")
        .select("last_seen_at")
        .order("last_seen_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setLastSeen(data?.last_seen_at ?? null);
      setNow(Date.now());
    }, 15_000);
    return () => clearInterval(timer);
  }, []);

  const online = isWorkerOnline(lastSeen, now);
  return (
    <Badge variant={online ? "success" : "destructive"} asChild>
      <Link href="/automation" title={lastSeen ? `Last heartbeat ${dateTime(lastSeen)}` : "No heartbeat received"}>
        {online ? <Activity data-icon="inline-start" /> : <CircleOff data-icon="inline-start" />}
        Worker {online ? "online" : "offline"}
      </Link>
    </Badge>
  );
}
```

- [ ] **Step 4: Create `components/job-buttons.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CloudDownload, Play, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

async function post(url: string, body?: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Request failed");
  return d;
}

function useJobAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = async (url: string, body: unknown, success: string, onDone?: () => void) => {
    setBusy(true);
    try {
      await post(url, body);
      toast.success(success);
      onDone?.();
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** Disabled buttons can't show tooltips, so the reason is rendered as text beside the button. */
function Reason({ text }: { text: string | null | undefined }) {
  return text ? <span className="text-xs text-muted-foreground">{text}</span> : null;
}

export function FetchButton({ disabledReason }: { disabledReason: string | null }) {
  const { busy, run } = useJobAction();
  return (
    <div className="flex items-center gap-2">
      <Reason text={disabledReason} />
      <Button disabled={busy || !!disabledReason} onClick={() => run("/api/jobs", { type: "fetch" }, "Fetch from CoreHub queued")}>
        {busy ? <Spinner data-icon="inline-start" /> : <CloudDownload data-icon="inline-start" />}
        Fetch from CoreHub
      </Button>
    </div>
  );
}

export function EvaluateButton({
  caseIds,
  all = false,
  label,
  disabledReason,
  onDone,
  variant = "default",
}: {
  caseIds: string[];
  all?: boolean;
  label: string;
  disabledReason?: string | null;
  onDone?: () => void;
  variant?: "default" | "outline";
}) {
  const { busy, run } = useJobAction();
  const body = all ? { type: "evaluate", all_received: true } : { type: "evaluate", case_ids: caseIds };
  return (
    <div className="flex items-center gap-2">
      <Reason text={disabledReason} />
      <Button
        size="sm"
        variant={variant}
        disabled={busy || !!disabledReason || (!all && caseIds.length === 0)}
        onClick={() => run("/api/jobs", body, "Evaluation queued", onDone)}
      >
        {busy ? <Spinner data-icon="inline-start" /> : <Play data-icon="inline-start" />}
        {label}
      </Button>
    </div>
  );
}

export function CancelJobButton({ jobId }: { jobId: string }) {
  const { busy, run } = useJobAction();
  return (
    <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(`/api/jobs/${jobId}/cancel`, undefined, "Job cancelled")}>
      <X data-icon="inline-start" />
      Cancel
    </Button>
  );
}
```

- [ ] **Step 5: Create `components/job-progress.tsx`**

```tsx
import { Progress } from "@/components/ui/progress";

type JobProgressValue = { current_step?: string; done?: number; total?: number } | null;

export function JobProgress({ progress, status }: { progress: JobProgressValue; status: string }) {
  if (status === "queued") return <span className="text-sm text-muted-foreground">Waiting for worker…</span>;
  const done = progress?.done ?? 0;
  const total = progress?.total ?? 0;
  return (
    <div className="flex min-w-48 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-4 text-sm">
        <span>{progress?.current_step ?? "Starting"}</span>
        {total > 0 && (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {done}/{total} cases
          </span>
        )}
      </div>
      {total > 0 && <Progress value={(done / total) * 100} aria-label="Job progress" className="h-1.5" />}
    </div>
  );
}
```

- [ ] **Step 6: Job status tones in `components/status.tsx`**

In `tone()` add these two lines as the first statements after `const s = status.toLowerCase();`:

```ts
  if (s === "succeeded" || s === "completed" || s === "dry_run_completed") return "success";
  if (s === "running" || s === "queued") return "info";
```

- [ ] **Step 7: Nav entries and longest-match active state**

Replace `components/nav.ts` with:

```ts
import { Activity, Archive, Bot, CalendarClock, ClipboardCheck, FileClock, FlaskConical, LayoutDashboard, Settings, SlidersHorizontal } from "lucide-react";

export const NAV = [
  {
    label: "Operations",
    items: [
      { title: "Overview", href: "/", icon: LayoutDashboard },
      { title: "Referral queue", href: "/referrals", icon: Archive },
      { title: "Manual review", href: "/reviews", icon: ClipboardCheck },
    ],
  },
  {
    label: "Automation",
    items: [
      { title: "Runs", href: "/automation", icon: Bot },
      { title: "Schedules", href: "/automation/schedules", icon: CalendarClock },
    ],
  },
  {
    label: "Engine",
    items: [
      { title: "Vehicle resolution", href: "/vehicles", icon: SlidersHorizontal },
      { title: "Simulator", href: "/simulate", icon: FlaskConical },
    ],
  },
  {
    label: "Governance",
    items: [
      { title: "Audit trail", href: "/audit", icon: FileClock },
      { title: "System health", href: "/health", icon: Activity },
      { title: "Configuration", href: "/settings", icon: Settings },
    ],
  },
] as const;

/** Longest nav href matching the path, so /automation/schedules doesn't also light up /automation. */
export function activeHref(pathname: string): string | undefined {
  return NAV.flatMap((g) => g.items.map((i) => i.href as string))
    .filter((h) => (h === "/" ? pathname === "/" : pathname === h || pathname.startsWith(h + "/")))
    .sort((a, b) => b.length - a.length)[0];
}
```

In `components/app-sidebar.tsx`:
- change the import to `import { NAV, activeHref } from "@/components/nav";`
- replace `const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));` with `const active = activeHref(pathname);`
- replace `isActive={isActive(item.href)}` with `isActive={item.href === active}`

- [ ] **Step 8: Header pill in `app/(console)/layout.tsx`**

Add imports:

```tsx
import { WorkerStatusPill } from "@/components/worker-status-pill";
import { getWorkerStatus } from "@/lib/worker-status";
```

After the `sidebarOpen` line add:

```tsx
  const worker = await getWorkerStatus(supabase);
```

Replace:

```tsx
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
```

with:

```tsx
          <div className="ml-auto flex items-center gap-2">
            <WorkerStatusPill initialLastSeen={worker.lastSeenAt} />
            <ThemeToggle />
```

- [ ] **Step 9: Verify**

Run: `npm run lint && npm run build`
Expected: both pass.
Run the app (`npm run dev`), open `/`: header shows "Worker offline" (red) with the daemon stopped; start `npm run worker:daemon` and within ~15 s it flips to "Worker online" (green) without reload. Sidebar shows an Automation group; `/automation/schedules` highlights only "Schedules" (pages come in Tasks 12–13, a 404 is fine here).

- [ ] **Step 10: Commit**

```bash
git add components app/\(console\)/layout.tsx
git commit -m "feat(ui): worker status pill, live refresh, job buttons and automation nav

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Referrals — fetch, select, evaluate; case re-evaluate

**Files:**
- Modify: `components/case-table.tsx`, `app/(console)/referrals/page.tsx`, `app/(console)/referrals/[id]/page.tsx`

**Interfaces:**
- Consumes: `FetchButton`, `EvaluateButton`, `JobProgress`, `LiveRefresh` (Task 10); `getSessionProfile` (Task 3); `can` (Task 3); `getWorkerStatus` (Task 3); `Checkbox` (Task 10).
- Produces: `CaseTable` gains optional `selectable?: boolean` and `disabledReason?: string | null` props (client component). Existing call sites without these props render unchanged.

- [ ] **Step 1: Make `CaseTable` selectable**

Replace `components/case-table.tsx` with:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DecisionBadge } from "@/components/status";
import { EmptyRow } from "@/components/console";
import { EvaluateButton } from "@/components/job-buttons";
import { dateTime, humanize, money, vehicleName } from "@/lib/format";

export function CaseTable({
  rows,
  emptyText = "Nothing matches yet.",
  selectable = false,
  disabledReason = null,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rows: any[];
  emptyText?: string;
  selectable?: boolean;
  disabledReason?: string | null;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ids: string[] = rows.map((r) => r.id);
  // Rows can disappear on live refresh; only submit ids still on screen.
  const chosen = ids.filter((id) => selected.has(id));
  const allOn = ids.length > 0 && chosen.length === ids.length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      {selectable && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2">
          <span className="text-sm text-muted-foreground">{chosen.length} selected</span>
          <EvaluateButton
            caseIds={chosen}
            label={`Evaluate selected${chosen.length ? ` (${chosen.length})` : ""}`}
            disabledReason={disabledReason}
            onDone={() => setSelected(new Set())}
          />
        </div>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {selectable && (
              <TableHead className="w-10 pl-4">
                <Checkbox
                  checked={allOn}
                  onCheckedChange={(v) => setSelected(v ? new Set(ids) : new Set())}
                  aria-label="Select all cases"
                />
              </TableHead>
            )}
            <TableHead className={selectable ? undefined : "pl-4"}>Case</TableHead>
            <TableHead>Vehicle identity</TableHead>
            <TableHead className="text-right">Requested IDV</TableHead>
            <TableHead>Decision</TableHead>
            <TableHead className="hidden pr-4 2xl:table-cell">Workflow</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((x) => (
            <TableRow key={x.id} data-state={selected.has(x.id) ? "selected" : undefined}>
              {selectable && (
                <TableCell className="pl-4">
                  <Checkbox checked={selected.has(x.id)} onCheckedChange={() => toggle(x.id)} aria-label={`Select ${x.external_case_id}`} />
                </TableCell>
              )}
              <TableCell className={selectable ? undefined : "pl-4"}>
                <Link href={"/referrals/" + x.id} className="font-medium hover:underline">
                  {x.external_case_id}
                </Link>
                <div className="text-xs text-muted-foreground">{dateTime(x.received_at)}</div>
              </TableCell>
              <TableCell>
                <div className="font-medium">{vehicleName(x.make_raw, x.model_raw, x.variant_raw)}</div>
                <div className="text-xs text-muted-foreground">
                  <span className="font-mono">{x.registration_number || "No registration"}</span> · {x.fuel_type_raw || "Fuel n/a"}
                </div>
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{money(x.requested_idv)}</TableCell>
              <TableCell>
                <DecisionBadge status={x.referral_status} />
              </TableCell>
              <TableCell className="hidden pr-4 text-muted-foreground capitalize 2xl:table-cell">{humanize(x.workflow_status)}</TableCell>
            </TableRow>
          ))}
          {!rows.length && <EmptyRow colSpan={selectable ? 6 : 5} icon={Inbox} title="No referral cases" description={emptyText} />}
        </TableBody>
      </Table>
    </>
  );
}
```

`EmptyRow` lives in `components/console.tsx`, which has no `"use client"` and uses no hooks, so importing it into a client component is fine.

- [ ] **Step 2: Referrals page — imports and data**

In `app/(console)/referrals/page.tsx`:

Replace the imports block's `FlaskConical` import line `import { FlaskConical, Search } from "lucide-react";` with:

```tsx
import { Bot, Search } from "lucide-react";
```

Add imports:

```tsx
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EvaluateButton, FetchButton } from "@/components/job-buttons";
import { JobProgress } from "@/components/job-progress";
import { LiveRefresh } from "@/components/live-refresh";
import { getSessionProfile } from "@/lib/api-auth";
import { can } from "@/lib/authz";
import { getWorkerStatus } from "@/lib/worker-status";
```

After `const STATUSES = …;` add:

```tsx
const LABELS: Partial<Record<(typeof STATUSES)[number], string>> = { processing: "Evaluating", approved: "Auto-approved" };
```

Replace:

```tsx
  const { data } = await query;
  const rows = data ?? [];
```

with:

```tsx
  const [{ data }, worker, profile, { data: activeJobs }] = await Promise.all([
    query,
    getWorkerStatus(supabase),
    getSessionProfile(supabase),
    supabase.from("automation_jobs").select("id,type,status,progress").in("status", ["queued", "running"]).order("created_at"),
  ]);
  const rows = data ?? [];
  const jobs = activeJobs ?? [];
  const canRun = can(profile?.role, "run_jobs");
  const offline = worker.online ? null : "Worker offline";
  const fetchReason = offline ?? (jobs.some((j) => j.type === "fetch") ? "Fetch already in progress" : null);
  const selectable = canRun && (status === "received" || status === "failed");
```

- [ ] **Step 3: Referrals page — header actions, chips, banner, table**

Replace the `actions={ … }` prop of `PageHeader` (the `Button` linking to `/simulate`) with:

```tsx
        actions={canRun ? <FetchButton disabledReason={fetchReason} /> : undefined}
```

Replace the chip label expression `{s ? s.replaceAll("_", " ") : "All"}` with:

```tsx
                {s ? (LABELS[s] ?? s.replaceAll("_", " ")) : "All"}
```

Immediately before `<Card className="pb-0">` insert:

```tsx
      <LiveRefresh tables={["referral_cases", "automation_jobs"]} />
      {jobs.length > 0 && (
        <Alert>
          <Bot />
          <AlertTitle>
            {jobs.length === 1 ? "Automation job in progress" : `${jobs.length} automation jobs in progress`}
          </AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <JobProgress progress={jobs[0].progress} status={jobs[0].status} />
            <Link href="/automation" className="w-fit text-sm underline underline-offset-4">
              View runs
            </Link>
          </AlertDescription>
        </Alert>
      )}
```

Inside the `CardHeader`, before the `{(q || status) && (` block, insert:

```tsx
          {canRun && status === "received" && rows.length > 0 && (
            <CardAction>
              <EvaluateButton caseIds={[]} all label="Evaluate all received" variant="outline" disabledReason={offline} />
            </CardAction>
          )}
```

If a `CardAction` for "Clear filters" is also present, both render; that's intended.

Replace `<CaseTable rows={rows} emptyText="No cases match these filters." />` with:

```tsx
        <CaseTable rows={rows} emptyText="No cases match these filters." selectable={selectable} disabledReason={offline} />
```

- [ ] **Step 4: Case detail — Re-evaluate**

In `app/(console)/referrals/[id]/page.tsx` add imports:

```tsx
import { EvaluateButton } from "@/components/job-buttons";
import { LiveRefresh } from "@/components/live-refresh";
import { getSessionProfile } from "@/lib/api-auth";
import { can } from "@/lib/authz";
```

After `if (!caseRow) notFound();` add:

```tsx
  const profile = await getSessionProfile(supabase);
  const canReevaluate = can(profile?.role, "run_jobs") && caseRow.referral_status !== "processing";
```

Inside the `actions={<> … </>}` fragment, immediately before `<DecisionBadge status={caseRow.referral_status} …/>`, insert:

```tsx
              {canReevaluate && <EvaluateButton caseIds={[caseRow.id]} label="Re-evaluate" variant="outline" />}
```

Immediately after the opening `<>` of the returned JSX, insert:

```tsx
      <LiveRefresh tables={["referral_cases"]} />
```

- [ ] **Step 5: Verify**

Run: `npm run lint && npm run build`
Expected: pass.
Manual, with `npm run dev` + `npm run worker:daemon` (dry-run) and an operator login:
1. `/referrals` shows **Fetch from CoreHub**; chips read "Evaluating" and "Auto-approved".
2. Click Fetch → toast "Fetch from CoreHub queued", banner appears with progress, disappears when done; new cases appear under **Received** without reload.
3. On **Received**, tick two rows → "Evaluate selected (2)" → rows move to Evaluating then Auto-approved / Manual review live.
4. Stop the daemon; within ~2 min the buttons disable with "Worker offline".
5. Case detail shows **Re-evaluate**; clicking queues a job and the page updates when it finishes.
6. Signed in as an auditor: no Fetch/Evaluate buttons, no checkboxes.

- [ ] **Step 6: Commit**

```bash
git add components/case-table.tsx app/\(console\)/referrals
git commit -m "feat(referrals): fetch from CoreHub, select and evaluate cases, re-evaluate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Runs page and job detail

**Files:**
- Create: `app/(console)/automation/page.tsx`, `app/(console)/automation/jobs/[id]/page.tsx`

**Interfaces:**
- Consumes: `PageHeader`, `KpiCard`, `DetailList`, `EmptyRow` (`components/console.tsx`); `DecisionBadge`; `CaseTable`; `JobProgress`, `CancelJobButton`, `FetchButton`, `LiveRefresh` (Task 10); `getWorkerStatus`, `getSessionProfile`, `can`; `dateTime`, `humanize` (`lib/format.ts`).
- Produces: routes `/automation` and `/automation/jobs/[id]`.

- [ ] **Step 1: Create `app/(console)/automation/page.tsx`**

```tsx
import Link from "next/link";
import { AlertTriangle, Bot, CheckCircle2, History, Server } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyRow, KpiCard, PageHeader } from "@/components/console";
import { DecisionBadge } from "@/components/status";
import { CancelJobButton, FetchButton } from "@/components/job-buttons";
import { JobProgress } from "@/components/job-progress";
import { LiveRefresh } from "@/components/live-refresh";
import { getSessionProfile } from "@/lib/api-auth";
import { can } from "@/lib/authz";
import { getWorkerStatus } from "@/lib/worker-status";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Automation runs" };

function duration(start: string | null, end: string | null) {
  if (!start || !end) return "—";
  const s = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export default async function Runs() {
  const supabase = await createClient();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const [worker, profile, { data: jobs }, { count: failed24h }, { count: obvFailures24h }, { data: lastOk }] = await Promise.all([
    getWorkerStatus(supabase),
    getSessionProfile(supabase),
    supabase
      .from("automation_jobs")
      .select("*, automation_schedules(name), automation_runs(cases_discovered,cases_new,cases_processed,cases_errored,dry_run)")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("automation_jobs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", since),
    supabase.from("idv_checks").select("id", { count: "exact", head: true }).neq("provider_status", "succeeded").gte("fetched_at", since),
    supabase.from("automation_jobs").select("finished_at").eq("status", "succeeded").order("finished_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const rows = jobs ?? [];
  const active = rows.filter((j) => j.status === "queued" || j.status === "running");
  const canRun = can(profile?.role, "run_jobs");
  const fetchReason = !worker.online ? "Worker offline" : active.some((j) => j.type === "fetch") ? "Fetch already in progress" : null;

  return (
    <>
      <LiveRefresh tables={["automation_jobs"]} />
      <PageHeader
        eyebrow="Automation"
        title="Runs"
        description="Every CoreHub fetch and evaluation, whether started here or by a schedule."
        actions={canRun ? <FetchButton disabledReason={fetchReason} /> : undefined}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Worker"
          value={worker.online ? "Online" : "Offline"}
          foot={worker.lastSeenAt ? `Last heartbeat ${dateTime(worker.lastSeenAt)}` : "No heartbeat received"}
          icon={Server}
        />
        <KpiCard label="Last successful run" value={lastOk?.finished_at ? dateTime(lastOk.finished_at) : "—"} icon={CheckCircle2} />
        <KpiCard label="Failed jobs (24h)" value={failed24h ?? 0} icon={AlertTriangle} />
        <KpiCard label="OBV lookup failures (24h)" value={obvFailures24h ?? 0} icon={History} />
      </div>

      {active.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>In progress</CardTitle>
            <CardDescription>Jobs run one at a time in the order they were queued.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {active.map((j) => (
              <div key={j.id} className="flex flex-wrap items-center justify-between gap-4 py-3">
                <div className="flex items-center gap-3">
                  <DecisionBadge status={j.status} />
                  <Link href={`/automation/jobs/${j.id}`} className="font-medium capitalize hover:underline">
                    {j.type}
                  </Link>
                  <span className="text-xs text-muted-foreground">{j.automation_schedules?.name ?? "Manual"}</span>
                </div>
                <JobProgress progress={j.progress} status={j.status} />
                {j.status === "queued" && canRun && <CancelJobButton jobId={j.id} />}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="pb-0">
        <CardHeader>
          <CardTitle>History</CardTitle>
          <CardDescription>Latest 50 jobs</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Job</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">New / processed / errored</TableHead>
              <TableHead className="hidden md:table-cell">Duration</TableHead>
              <TableHead className="hidden pr-4 lg:table-cell">Queued</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((j) => {
              const run = j.automation_runs;
              return (
                <TableRow key={j.id}>
                  <TableCell className="pl-4">
                    <Link href={`/automation/jobs/${j.id}`} className="font-medium capitalize hover:underline">
                      {j.type}
                      {j.params?.then_evaluate ? " + evaluate" : ""}
                    </Link>
                    {j.params?.dry_run && <div className="text-xs text-muted-foreground">Dry run</div>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{j.automation_schedules?.name ?? (j.schedule_id ? "Deleted schedule" : "Manual")}</TableCell>
                  <TableCell>
                    <DecisionBadge status={j.status} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {run ? `${run.cases_new} / ${run.cases_processed} / ${run.cases_errored}` : "—"}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{duration(j.started_at, j.finished_at)}</TableCell>
                  <TableCell className="hidden pr-4 text-muted-foreground lg:table-cell">{dateTime(j.created_at)}</TableCell>
                </TableRow>
              );
            })}
            {!rows.length && <EmptyRow colSpan={6} icon={Bot} title="No runs yet" description="Fetch from CoreHub or enable a schedule to start." />}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
```

- [ ] **Step 2: Create `app/(console)/automation/jobs/[id]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList, PageHeader } from "@/components/console";
import { DecisionBadge } from "@/components/status";
import { CaseTable } from "@/components/case-table";
import { JobProgress } from "@/components/job-progress";
import { LiveRefresh } from "@/components/live-refresh";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Job detail" };

export default async function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: job } = await supabase
    .from("automation_jobs")
    .select("*, automation_schedules(name), automation_runs(*)")
    .eq("id", id)
    .maybeSingle();
  if (!job) notFound();

  const caseIds: string[] = job.progress?.case_ids ?? job.params?.case_ids ?? [];
  const { data: cases } = caseIds.length
    ? await supabase.from("referral_cases").select("*").in("id", caseIds).order("received_at", { ascending: false })
    : { data: [] };
  const run = job.automation_runs;
  const active = job.status === "queued" || job.status === "running";

  return (
    <>
      {active && <LiveRefresh tables={["automation_jobs", "referral_cases"]} />}
      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" asChild className="w-fit">
          <Link href="/automation">
            <ChevronLeft data-icon="inline-start" />
            Runs
          </Link>
        </Button>
        <PageHeader
          eyebrow="Automation job"
          title={<span className="capitalize">{job.type}{job.params?.then_evaluate ? " + evaluate" : ""}</span>}
          description={`${job.automation_schedules?.name ?? (job.schedule_id ? "Deleted schedule" : "Started manually")} · queued ${dateTime(job.created_at)}`}
          actions={<DecisionBadge status={job.status} className="h-7 px-3 text-sm" />}
        />
      </div>

      {job.error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Job reported errors</AlertTitle>
          <AlertDescription className="break-words">{job.error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Execution</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {active && <JobProgress progress={job.progress} status={job.status} />}
            <DetailList
              items={[
                ["Mode", job.params?.dry_run ? "Dry run" : "Live"],
                ["Completion", job.params?.completion_mode === "in_app" ? "In app" : "CoreHub write-back"],
                ["Worker", job.worker_id ?? "—"],
                ["Started", dateTime(job.started_at)],
                ["Finished", dateTime(job.finished_at)],
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Counts</CardTitle>
          </CardHeader>
          <CardContent>
            <DetailList
              items={[
                ["Discovered in CoreHub", run?.cases_discovered ?? "—"],
                ["New", run?.cases_new ?? "—"],
                ["Processed", run?.cases_processed ?? "—"],
                ["Errored", run?.cases_errored ?? "—"],
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="pb-0">
        <CardHeader>
          <CardTitle>{caseIds.length} cases</CardTitle>
        </CardHeader>
        <CaseTable rows={cases ?? []} emptyText="This job touched no cases." />
      </Card>
    </>
  );
}
```

If `Alert` has no `destructive` variant in `components/ui/alert.tsx`, drop the `variant` prop.

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build`
Expected: pass.
Manual: `/automation` shows 4 KPI tiles; queue a fetch → "In progress" card appears with live progress and a Cancel button while queued; after completion the job moves into History with counts; its detail page lists the cases it touched. Stop the daemon mid-job (Ctrl-C twice to kill) and restart it after 5 minutes → the job flips to `failed` with `stale_heartbeat` and its `processing` cases return to Received.

- [ ] **Step 4: Commit**

```bash
git add app/\(console\)/automation/page.tsx app/\(console\)/automation/jobs
git commit -m "feat(automation): runs page with live progress and job detail

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Schedules page

**Files:**
- Create: `components/schedule-dialog.tsx`, `components/schedule-row-actions.tsx`, `app/(console)/automation/schedules/page.tsx`

**Interfaces:**
- Consumes: `lib/schedule.ts` (Task 2) — `specToCron`, `cronToSpec`, `describeSchedule`, `isValidCron`, `nextRunAt`, `DEFAULT_TIMEZONE`, `MINUTE_STEPS`, `HOUR_STEPS`, `ScheduleSpec`, `Weekday`; `/api/schedules` (Task 9); `Switch` (Task 10).
- Produces: route `/automation/schedules`; `<ScheduleDialog initial?={ScheduleValues} trigger={ReactNode} />` where `ScheduleValues = { id?: string; name: string; cron: string; timezone: string; dry_run: boolean }`.

- [ ] **Step 1: Create `components/schedule-dialog.tsx`**

```tsx
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
```

If `Field` in `components/ui/field.tsx` does not accept `orientation="horizontal"`, use `<div className="flex items-center gap-2">` for those two rows instead.

- [ ] **Step 2: Create `components/schedule-row-actions.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
    if (!r.ok) return toast.error(d.error || "Unable to update schedule");
    toast.success(next ? `${name} enabled` : `${name} paused`);
    router.refresh();
  }
  return <Switch checked={enabled} disabled={busy} onCheckedChange={toggle} aria-label={`${enabled ? "Pause" : "Enable"} ${name}`} />;
}

export function ScheduleRowActions({ schedule }: { schedule: Required<ScheduleValues> }) {
  const router = useRouter();
  async function remove() {
    const r = await fetch(`/api/schedules/${schedule.id}`, { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return toast.error(d.error || "Unable to delete schedule");
    toast.success("Schedule deleted");
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
```

- [ ] **Step 3: Create `app/(console)/automation/schedules/page.tsx`**

```tsx
import { CalendarClock, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyRow, PageHeader } from "@/components/console";
import { DecisionBadge } from "@/components/status";
import { ScheduleDialog } from "@/components/schedule-dialog";
import { ScheduleEnabledSwitch, ScheduleRowActions } from "@/components/schedule-row-actions";
import { getSessionProfile } from "@/lib/api-auth";
import { can } from "@/lib/authz";
import { describeSchedule } from "@/lib/schedule";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Schedules" };

export default async function Schedules() {
  const supabase = await createClient();
  const [profile, { data: schedules }, { data: jobs }] = await Promise.all([
    getSessionProfile(supabase),
    supabase.from("automation_schedules").select("*").order("created_at"),
    supabase
      .from("automation_jobs")
      .select("schedule_id,status,finished_at")
      .not("schedule_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const isAdmin = can(profile?.role, "manage");
  const lastJob = new Map<string, { status: string; finished_at: string | null }>();
  for (const j of jobs ?? []) if (!lastJob.has(j.schedule_id)) lastJob.set(j.schedule_id, j);
  const rows = schedules ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Automation"
        title="Schedules"
        description="Scheduled runs fetch new CoreHub referrals and evaluate them. A slot is skipped if the previous run is still going."
        actions={
          isAdmin ? (
            <ScheduleDialog
              trigger={
                <Button>
                  <Plus data-icon="inline-start" />
                  New schedule
                </Button>
              }
            />
          ) : undefined
        }
      />

      <Card className="pb-0">
        <CardHeader>
          <CardTitle>{rows.length} schedules</CardTitle>
          <CardDescription>{isAdmin ? "New schedules start paused." : "Only admins can change schedules."}</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Enabled</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Cadence</TableHead>
              <TableHead className="hidden md:table-cell">Next run</TableHead>
              <TableHead className="hidden lg:table-cell">Last result</TableHead>
              {isAdmin && <TableHead className="pr-4 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => {
              const last = lastJob.get(s.id);
              return (
                <TableRow key={s.id}>
                  <TableCell className="pl-4">
                    {isAdmin ? <ScheduleEnabledSwitch id={s.id} enabled={s.enabled} name={s.name} /> : s.enabled ? "On" : "Paused"}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{s.name}</div>
                    {s.dry_run && <div className="text-xs text-muted-foreground">Dry run</div>}
                  </TableCell>
                  <TableCell>{describeSchedule(s.cron, s.timezone)}</TableCell>
                  <TableCell className="hidden md:table-cell">{s.enabled ? dateTime(s.next_run_at) : "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {last ? (
                      <div className="flex items-center gap-2">
                        <DecisionBadge status={last.status} />
                        <span className="text-xs text-muted-foreground">{dateTime(last.finished_at)}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Never run</span>
                    )}
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="pr-4">
                      <ScheduleRowActions schedule={{ id: s.id, name: s.name, cron: s.cron, timezone: s.timezone, dry_run: s.dry_run }} />
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
            {!rows.length && (
              <EmptyRow colSpan={isAdmin ? 6 : 5} icon={CalendarClock} title="No schedules" description="Create one to fetch and evaluate referrals automatically." />
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
```

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run build && npm test`
Expected: all pass.
Manual as admin, with the daemon running:
1. **New schedule** → default "Every 15 min, Mon–Sat 09:00–19:00 IST", next-run preview shown; Save → row appears paused.
2. Switch through Hourly / Daily-weekly / Monthly: preview updates; unticking all days disables Save.
3. Advanced → enter `* * * * *` → Save → toast "Schedules cannot run more often than every 5 minutes".
4. Create `*/5 * * * *` ("Every 5 min, every day IST"), enable it → within 5 minutes a job with that schedule's name appears on `/automation`; the row's Last result updates.
5. Edit and Delete work; delete asks for confirmation.
6. As an operator: no New button, no switches or actions; text "Only admins can change schedules."

Disable or delete the smoke-test schedule afterwards.

- [ ] **Step 5: Commit**

```bash
git add components/schedule-dialog.tsx components/schedule-row-actions.tsx app/\(console\)/automation/schedules
git commit -m "feat(automation): schedules page with cadence builder

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `npm run lint && npm test && npm run build` all pass.
- [ ] End to end in dry run: daemon online pill → Fetch → select → Evaluate → decisions visible on case detail with condition-band reason codes → Runs history shows the jobs → an enabled 5-minute schedule fires once and is visible in history.
- [ ] `git grep -n "COREHUB_WEBHOOK_SECRET\|intake/referral" -- ':!docs'` returns nothing.
