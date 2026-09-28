-- =============================================================================
-- Migration 202609280006: CoreHub write-back
-- A person confirms an Approve/Reject in the console; the worker opens the
-- referral in CoreHub, re-checks it against what was evaluated, and clicks
-- the matching button. Every attempt keeps its checks and a JSON log.
-- =============================================================================

alter table public.automation_jobs drop constraint if exists automation_jobs_type_check;
alter table public.automation_jobs add constraint automation_jobs_type_check
  check (type in ('fetch', 'evaluate', 'corehub_action'));

create table if not exists public.corehub_actions (
  id               uuid primary key default gen_random_uuid(),
  case_id          uuid not null references public.referral_cases(id) on delete cascade,
  action           text not null check (action in ('approve', 'reject')),
  reason           text,
  -- Dry run opens the CoreHub dialog and cancels it: status 'rehearsed', nothing submitted.
  dry_run          boolean not null default true,
  status           text not null default 'queued'
                     check (status in ('queued', 'running', 'succeeded', 'rehearsed', 'failed')),
  requested_by     uuid references auth.users(id),
  job_id           uuid references public.automation_jobs(id) on delete set null,
  checks           jsonb not null default '[]'::jsonb,
  log              jsonb not null default '[]'::jsonb,
  corehub_response jsonb,
  error            text,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  constraint corehub_actions_reject_reason check (action <> 'reject' or char_length(coalesce(reason, '')) >= 3)
);

create index if not exists idx_corehub_actions_case on public.corehub_actions (case_id, created_at desc);
-- One attempt in flight per case, and a case is submitted to CoreHub at most once.
create unique index if not exists uniq_corehub_actions_active on public.corehub_actions (case_id)
  where status in ('queued', 'running');
create unique index if not exists uniq_corehub_actions_submitted on public.corehub_actions (case_id)
  where status = 'succeeded';

-- Reads for everyone signed in; writes are server-only (API role check + service role, like automation_jobs).
alter table public.corehub_actions enable row level security;
drop policy if exists corehub_actions_select on public.corehub_actions;
create policy corehub_actions_select on public.corehub_actions
  for select to authenticated using (true);

do $$ begin
  alter publication supabase_realtime add table public.corehub_actions;
exception when duplicate_object then null; when undefined_object then null;
end $$;
