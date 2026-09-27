-- Production hardening: decision tolerance semantics and covering indexes.
update public.config_settings
set setting_value='2'::jsonb
where setting_key='idv_pct_tolerance';

create index if not exists idx_approval_decisions_idv_check on public.approval_decisions(idv_check_id);
create index if not exists idx_approval_decisions_decided_by on public.approval_decisions(decided_by);
create index if not exists idx_audit_events_actor on public.audit_events(actor_id,created_at desc);
create index if not exists idx_config_settings_updated_by on public.config_settings(updated_by);
create index if not exists idx_idv_checks_resolution on public.idv_checks(vehicle_resolution_id);
create index if not exists idx_manual_reviews_assignee on public.manual_reviews(assigned_to,review_status);
create index if not exists idx_manual_reviews_case on public.manual_reviews(case_id);
