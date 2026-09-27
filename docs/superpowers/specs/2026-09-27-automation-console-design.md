# Automation Console Design

Date: 2026-09-27
Status: Approved (brainstorming), pending implementation plan

## Problem

The CoreHub → OBV → decision pipeline exists only in the Playwright worker (`src/worker/run.ts`). It is triggered by CLI or a hardcoded GitHub Actions cron. The console has no way to fetch referrals, evaluate them, schedule runs, or see run history. The sidebar exposes eight pages, several of which are debug views of single pipeline steps. There is no profile page, no team/role management, and the pages currently render the legacy `OperationsShell` inside the new `(console)` layout.

## Goals

1. **Manual flow:** operator fetches referrals from CoreHub, selects cases, and evaluates them (OBV lookup + decision engine) from the UI, with live progress.
2. **Auto flow:** named schedules (minutes / hourly / daily / weekly / monthly, optional business-hours window) fetch and evaluate automatically.
3. **Slimmer information architecture:** role-filtered sidebar, pipeline debug views folded into case detail.
4. **Account layer:** profile, team and role administration.

## Non-goals

- Writing decisions back into CoreHub. The setting exists but is disabled (see Completion mode).
- Notifications (email, Slack, in-app bell).
- Per-user preferences stored in the database.
- Parallel job execution.

## Decisions

| Topic | Decision |
|---|---|
| Completion mode | Configurable per schedule: `in_app` (active) or `corehub_writeback` (stored, disabled until CoreHub selectors are mapped and a shadow period completes) |
| Worker hosting | Always-on worker service (container or fixed host) polling a Supabase job queue |
| Manual flow | Two-step: Fetch → cases land as `received` → select → Evaluate |
| Schedules | Multiple named schedules, builder UI, cron + timezone stored |
| Webhook intake | `/api/intake/referral` deleted |

## 1. Automation architecture

### Data model (new migration)

**`automation_jobs`**
- `id uuid pk`
- `type text` check in (`fetch`, `evaluate`)
- `status text` check in (`queued`, `running`, `succeeded`, `failed`, `cancelled`), default `queued`
- `params jsonb` — `{ case_ids?: uuid[], dry_run: boolean, then_evaluate?: boolean, completion_mode: text }`
- `requested_by uuid null` references `auth.users` (null for schedule-triggered jobs)
- `schedule_id uuid null` references `automation_schedules`
- `run_id uuid null` references `automation_runs`
- `progress jsonb` — `{ total, done, current_step }`
- `error text null`
- `heartbeat_at, started_at, finished_at, created_at timestamptz`

**`automation_schedules`**
- `id uuid pk`, `name text`
- `cron text`, `timezone text` default `Asia/Kolkata`
- `enabled boolean` default `false`
- `dry_run boolean` default `true`
- `completion_mode text` check in (`in_app`, `corehub_writeback`), default `in_app`
- `next_run_at, last_run_at timestamptz`
- `created_by uuid`, `created_at`, `updated_at`

The business-hours window is expressed in the cron expression itself (for example `*/15 9-18 * * 1-6`). The UI builder generates it; there are no separate window columns.

**`worker_heartbeats`**
- `worker_id text pk`, `last_seen_at timestamptz`, `version text`, `current_job_id uuid null`

**`automation_runs` change:** `trigger_source` check extended with `schedule` and `ui`.

**`claim_next_job(worker_id text)`** SQL function: selects the oldest `queued` job with `FOR UPDATE SKIP LOCKED`, sets it `running`, stamps `started_at` and `heartbeat_at`, returns it.

**RLS:** all authenticated users select; insert on `automation_jobs` for operator, underwriter, admin; insert/update/delete on `automation_schedules` for admin only. The worker uses the service role.

### Worker (`src/worker/`)

- Split `run.ts` into two reusable functions without rewriting their internals:
  - `fetchReferrals(ctx)` — scrape CoreHub, upsert new cases as `received`, return new case ids.
  - `evaluateCases(ctx, caseIds)` — OBV lookup, decision engine, status update per case, writing `progress` after each case.
- `run.ts` CLI keeps working by calling both in sequence.
- New `daemon.ts`:
  - Every 10 s: upsert heartbeat, call `claim_next_job`, execute, update job `heartbeat_at` during execution, finalize status.
  - `fetch` jobs with `then_evaluate: true` evaluate the fetched case ids in the same job.
  - Every 30 s scheduler tick: for each enabled schedule with `next_run_at <= now()`, enqueue a `fetch` job with `then_evaluate: true`, unless a job for that schedule is still `queued` or `running` (skip, log `schedule_skipped` audit event). Advance `next_run_at` using `cron-parser` in the schedule's timezone.
  - Stale recovery on each tick: a `running` job whose `heartbeat_at` is older than 5 minutes becomes `failed` with error `stale_heartbeat`; its cases in `processing` return to `received`.
- Jobs run serially; the CoreHub session is one browser context.
- New npm script: `worker:daemon`.

### Control plane (Next.js)

- `POST /api/jobs` — body `{ type: "fetch" }`, `{ type: "evaluate", case_ids }`, or `{ type: "evaluate", all_received: true }`. Operator, underwriter, admin. Rejects with 409 if the worker is offline (no heartbeat in 2 min).
- `POST /api/jobs/[id]/cancel` — only `queued` jobs; running jobs are not interrupted.
- `GET/POST /api/schedules`, `PATCH/DELETE /api/schedules/[id]` — admin. Server validates cron and computes initial `next_run_at`.
- Any request setting `completion_mode = corehub_writeback` is rejected unless env `COREHUB_WRITEBACK_ENABLED=true`.
- Live updates: Supabase Realtime subscriptions on `automation_jobs` and `referral_cases`.

### Removals

- `.github/workflows/idv-worker.yml`: remove the `schedule:` trigger; keep `workflow_dispatch` as emergency fallback.
- Delete `app/api/intake/referral/route.ts` and `COREHUB_WEBHOOK_SECRET` references.

### Failure handling

- OBV timeout or ambiguous result → case to `manual_review` (existing decision-engine rule).
- CoreHub login failure, CAPTCHA or MFA → job `failed`, error shown on Runs page and as a banner on Referrals.
- Worker offline over 2 minutes → red status pill in the header; Fetch and Evaluate buttons disabled with the reason as tooltip.

## 2. Information architecture

### Sidebar

```
WORKSPACE
  Overview          /                      all
  Referrals         /referrals             all           badge: received count
  Review queue      /reviews               underwriter+  badge: my open reviews
AUTOMATION
  Runs              /automation            all
  Schedules         /automation/schedules  admin edit, others read-only
ADMIN
  Decision rules    /admin/rules           admin
  Team              /admin/team            admin
  Audit log         /audit                 admin, auditor
```

Nav items are filtered by role from `profiles.role`.

### Moves and deletions

- `/vehicles` deleted; content becomes the Vehicle match tab on case detail.
- `/health` deleted; worker heartbeat, CoreHub/OBV failure rate and last successful run move to the Runs page header.
- `/simulate` deleted; `simulate-client.tsx` reused inside a "Test lookup" sheet on the Runs page (underwriter, admin).
- `/settings` moves to `/admin/rules` with the same form.
- Every kept page is rebuilt on shadcn components; `operations-shell.tsx` is deleted once unused.

### Pages

- **Overview:** worker status, next scheduled run, today's funnel (fetched → auto-approved / manual review / failed), intake chart, "needs attention" list (reviews near or past SLA, failed jobs).
- **Referrals:** toolbar with **Fetch from CoreHub**. Status tabs: Received, Evaluating, Auto-approved, Manual review, Failed. Checkbox selection with **Evaluate selected** and **Evaluate all received**. Rows update live.
- **Case detail** `/referrals/[id]`: tabs Summary (condition spectrum, decision, reason code), Vehicle match, OBV evidence (screenshot, source URL, raw tiers), Timeline (case audit events). Action: **Re-evaluate**.
- **Runs** `/automation`: live job card (progress such as `7/12 cases`, current step), history table (trigger, requester or schedule, counts, duration, dry-run flag), run detail with its cases and errors. Cancel queued jobs. Test lookup sheet.
- **Schedules** `/automation/schedules`: list with enabled toggle, cadence in words ("Every 15 min, Mon–Sat 09:00–19:00 IST"), next run, last result. Create/edit dialog: frequency builder (every N minutes, hourly, daily, weekly with days, monthly with day of month; time or time range), advanced cron toggle, dry-run toggle, completion mode (writeback option disabled, labelled "Pending CoreHub mapping").

### Header

Sidebar trigger, ⌘K command menu (adds "Fetch now" and "Go to case…"), worker status pill.

## 3. Account layer

### User menu (sidebar footer)

Avatar, full name, role badge → Profile, Theme (light / dark / system), Sign out. The theme toggle is removed from the header.

### Profile `/account`

- Full name editable (`profiles.full_name`); email and role read-only.
- Change password via Supabase `auth.updateUser`.
- My activity: last 20 `audit_events` where `actor_id` is the current user.

### Team `/admin/team`

- Table: name, email, role, active, last sign-in.
- Invite by email: server route using service role `auth.admin.inviteUserByEmail`; new users default to `operator`.
- Change role; deactivate or reactivate (`profiles.is_active`). Each change writes an `audit_events` row.
- Server-side guards: an admin cannot demote or deactivate themself; the last active admin cannot be removed.

### Role matrix

| Action | operator | underwriter | auditor | admin |
|---|---|---|---|---|
| View referrals, runs | ✓ | ✓ | ✓ | ✓ |
| Fetch, evaluate | ✓ | ✓ | — | ✓ |
| Review decisions | — | ✓ | — | ✓ |
| Test lookup | — | ✓ | — | ✓ |
| Schedules, rules, team | — | — | — | ✓ |
| Audit log | — | — | ✓ | ✓ |

Enforced in the nav filter (UX only), in API route checks, and in RLS on new tables.

## 4. Testing

- Unit: schedule builder ↔ cron round trip and human-readable description; `next_run_at` computation in IST including month-end dates; scheduler skip-if-active logic; stale-job recovery.
- Worker: daemon loop with a fake executor covering claim → run → heartbeat → finalize, and the failure path resetting cases to `received`.
- API: role gates for `/api/jobs`, `/api/schedules` and team routes; last-admin guard; writeback rejection without the env flag.
- Existing decision-engine tests stay unchanged.
- Manual verification: run the app and daemon in dry-run, fetch and evaluate from the UI with live progress, create a schedule and confirm it fires.

## Implementation order

1. Migration + worker split + daemon (automation works headless).
2. Jobs and schedules API.
3. Referrals, Runs, Schedules pages; header status pill.
4. IA cleanup: sidebar, case detail tabs, page deletions, shadcn rebuild of kept pages.
5. Account layer: profile, team, user menu.
