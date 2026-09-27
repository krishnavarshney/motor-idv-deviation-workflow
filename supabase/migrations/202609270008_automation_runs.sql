-- =============================================================================
-- Migration 008: Add automation_runs table for worker execution tracking
-- =============================================================================

create table if not exists public.automation_runs (
  id              uuid primary key default gen_random_uuid(),
  run_label       text not null default 'idv-deviation-check',
  status          text not null default 'running'
                    check (status in ('running', 'completed', 'failed', 'dry_run_completed')),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  cases_discovered integer not null default 0,
  cases_new        integer not null default 0,
  cases_processed  integer not null default 0,
  cases_errored    integer not null default 0,
  dry_run         boolean not null default true,
  trigger_source  text not null default 'manual'
                    check (trigger_source in ('manual', 'cron', 'github_actions')),
  error_summary   text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

alter table public.automation_runs enable row level security;

-- Authenticated users can view runs
drop policy if exists automation_runs_select on public.automation_runs;
create policy automation_runs_select on public.automation_runs
  for select to authenticated using (true);

-- Only privileged users can insert (or service role bypasses RLS entirely)
drop policy if exists automation_runs_insert on public.automation_runs;
create policy automation_runs_insert on public.automation_runs
  for insert to authenticated
  with check (public.is_privileged_user());

drop policy if exists automation_runs_update on public.automation_runs;
create policy automation_runs_update on public.automation_runs
  for update to authenticated
  using (public.is_privileged_user())
  with check (public.is_privileged_user());

-- Index for dashboard queries
create index if not exists idx_automation_runs_started
  on public.automation_runs (started_at desc);

create index if not exists idx_automation_runs_status
  on public.automation_runs (status, started_at desc);

-- Add run_id to referral_cases so we can trace which worker run created each case
alter table public.referral_cases
  add column if not exists automation_run_id uuid references public.automation_runs(id);

create index if not exists idx_referral_cases_run
  on public.referral_cases (automation_run_id);
