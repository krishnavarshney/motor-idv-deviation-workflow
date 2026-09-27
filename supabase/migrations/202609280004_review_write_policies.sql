-- =============================================================================
-- Migration 202609280004: review outcomes writable only by underwriters/admins
--
-- Before: manual_reviews update used is_privileged_user() (includes operators)
-- and approval_decisions insert allowed any authenticated user, so operators
-- and auditors could write review outcomes directly through PostgREST,
-- bypassing /api/reviews (which requires the review role). approval_decisions
-- also had no update policy, so the review route's update of an existing
-- decision silently matched 0 rows.
--
-- The worker writes these tables with the service role (bypasses RLS).
-- Reads are unchanged. current_user_role() returns null for inactive users.
-- =============================================================================

-- manual_reviews: update restricted to review roles (insert/select unchanged)
drop policy if exists reviews_write on public.manual_reviews;
drop policy if exists reviews_update on public.manual_reviews;
create policy reviews_update on public.manual_reviews
  for update to authenticated
  using (public.current_user_role() in ('underwriter', 'admin'))
  with check (public.current_user_role() in ('underwriter', 'admin'));

-- approval_decisions: insert and update restricted to review roles
drop policy if exists decisions_write on public.approval_decisions;
drop policy if exists decisions_insert on public.approval_decisions;
create policy decisions_insert on public.approval_decisions
  for insert to authenticated
  with check (public.current_user_role() in ('underwriter', 'admin'));

drop policy if exists decisions_update on public.approval_decisions;
create policy decisions_update on public.approval_decisions
  for update to authenticated
  using (public.current_user_role() in ('underwriter', 'admin'))
  with check (public.current_user_role() in ('underwriter', 'admin'));
