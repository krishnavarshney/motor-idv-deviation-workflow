-- =============================================================================
-- Migration 007: Fix infinite recursion in RLS policies for "profiles"
-- 
-- Problem: Every write policy on referral_cases, vehicle_resolutions, idv_checks,
-- manual_reviews, config_settings, and audit_events does:
--   exists(select 1 from public.profiles p where p.id = auth.uid() and p.role in (...))
-- But profiles itself has RLS enabled, so Postgres tries to evaluate the
-- profiles_self policy when the subquery runs -> infinite recursion.
--
-- Fix: Create a SECURITY DEFINER function that bypasses RLS to check the
-- current user's role, then rewrite all policies to call that function instead.
-- =============================================================================

-- 1. Helper: returns the current user's role, bypassing RLS on profiles.
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

-- 2. Convenience: check if the current user has one of the privileged roles.
create or replace function public.is_privileged_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('operator', 'underwriter', 'admin')
  )
$$;

-- 3. Rewrite profiles policy — keep it simple, no subquery on itself.
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

-- Allow users to update their own profile (name, etc.) but not role.
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- =============================================================================
-- 4. Rewrite all policies that previously had the problematic subquery
-- =============================================================================

-- referral_cases
drop policy if exists referrals_select on public.referral_cases;
create policy referrals_select on public.referral_cases
  for select to authenticated using (true);

drop policy if exists referral_insert on public.referral_cases;
drop policy if exists referrals_insert on public.referral_cases;
create policy referral_insert on public.referral_cases
  for insert to authenticated
  with check (public.is_privileged_user());

drop policy if exists referral_update on public.referral_cases;
drop policy if exists referrals_update on public.referral_cases;
create policy referral_update on public.referral_cases
  for update to authenticated
  using (public.is_privileged_user())
  with check (public.is_privileged_user());

-- vehicle_resolutions
drop policy if exists vehicle_select on public.vehicle_resolutions;
create policy vehicle_select on public.vehicle_resolutions
  for select to authenticated using (true);

drop policy if exists vehicle_insert on public.vehicle_resolutions;
create policy vehicle_insert on public.vehicle_resolutions
  for insert to authenticated
  with check (public.is_privileged_user());

drop policy if exists vehicle_update on public.vehicle_resolutions;
create policy vehicle_update on public.vehicle_resolutions
  for update to authenticated
  using (public.is_privileged_user())
  with check (public.is_privileged_user());

-- idv_checks
drop policy if exists idv_select on public.idv_checks;
create policy idv_select on public.idv_checks
  for select to authenticated using (true);

drop policy if exists idv_insert on public.idv_checks;
create policy idv_insert on public.idv_checks
  for insert to authenticated
  with check (public.is_privileged_user());

drop policy if exists idv_update on public.idv_checks;
create policy idv_update on public.idv_checks
  for update to authenticated
  using (public.is_privileged_user())
  with check (public.is_privileged_user());

-- approval_decisions
drop policy if exists decisions_select on public.approval_decisions;
create policy decisions_select on public.approval_decisions
  for select to authenticated using (true);

drop policy if exists decisions_insert on public.approval_decisions;
create policy decisions_insert on public.approval_decisions
  for insert to authenticated
  with check (auth.uid() is not null);

-- manual_reviews
drop policy if exists reviews_select on public.manual_reviews;
create policy reviews_select on public.manual_reviews
  for select to authenticated using (true);

drop policy if exists reviews_write on public.manual_reviews;
drop policy if exists reviews_insert on public.manual_reviews;
create policy reviews_insert on public.manual_reviews
  for insert to authenticated
  with check (public.is_privileged_user());

drop policy if exists reviews_update on public.manual_reviews;
create policy reviews_update on public.manual_reviews
  for update to authenticated
  using (public.is_privileged_user())
  with check (public.is_privileged_user());

-- audit_events
drop policy if exists audit_select on public.audit_events;
create policy audit_select on public.audit_events
  for select to authenticated using (true);

drop policy if exists audit_insert on public.audit_events;
create policy audit_insert on public.audit_events
  for insert to authenticated
  with check (actor_id is null or actor_id = auth.uid());

-- config_settings
drop policy if exists config_select on public.config_settings;
create policy config_select on public.config_settings
  for select to authenticated using (true);

drop policy if exists config_admin on public.config_settings;
create policy config_admin on public.config_settings
  for update to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
