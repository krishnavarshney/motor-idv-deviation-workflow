-- =============================================================================
-- Migration 010: profile privilege hardening
-- profiles_update_self allowed any user to set their own role (including admin).
-- =============================================================================

create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service role / SQL editor calls carry no end-user JWT.
  if auth.uid() is null then
    return new;
  end if;
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and public.current_user_role() is distinct from 'admin' then
    raise exception 'Only admins can change roles or account status' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- Deactivated users lose every RLS privilege that goes through these helpers.
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_privileged_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and is_active and role in ('operator', 'underwriter', 'admin')
  )
$$;

drop policy if exists profiles_admin_select on public.profiles;
create policy profiles_admin_select on public.profiles
  for select to authenticated using (public.current_user_role() = 'admin');

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
