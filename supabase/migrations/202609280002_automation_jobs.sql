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
