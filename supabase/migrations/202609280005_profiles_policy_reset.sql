-- =============================================================================
-- Migration 202609280005: reset profiles policies (fix 42P17 infinite recursion)
--
-- Production had a policy on public.profiles whose expression queries
-- public.profiles under RLS, so every read of a user's own profile failed with
-- "infinite recursion detected in policy for relation profiles". The console
-- then saw no role and showed "No access". Migration 007 only dropped the
-- policy names it knew about, so an unknown recursive policy survived.
--
-- Drop every policy on profiles, whatever its name, and recreate only the
-- intended set. None of them query profiles directly; the admin policies go
-- through current_user_role(), a SECURITY DEFINER function owned by the table
-- owner (postgres), which bypasses RLS and so cannot recurse.
-- =============================================================================

do $$
declare
  p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
  loop
    execute format('drop policy %I on public.profiles', p.policyname);
  end loop;
end $$;

-- Everyone reads and updates their own row (role/is_active changes are
-- blocked for non-admins by the profiles_guard_privileges trigger).
create policy profiles_self on public.profiles
  for select to authenticated
  using (id = auth.uid());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- Admins read and update everyone.
create policy profiles_admin_select on public.profiles
  for select to authenticated
  using (public.current_user_role() = 'admin');

create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
