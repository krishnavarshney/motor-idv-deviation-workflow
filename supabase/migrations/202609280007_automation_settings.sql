-- =============================================================================
-- Migration 202609280007: automation settings managed from the console
-- Replaces the AUTOMATION_DRY_RUN env var for CoreHub write-back. Starts safe:
-- rehearse mode, so nothing is submitted until an admin switches to live.
-- =============================================================================

insert into public.config_settings (setting_key, setting_value, description) values
  ('corehub_writeback_mode', '"rehearse"', 'rehearse = open the CoreHub dialog and cancel; live = submit Approve/Reject to CoreHub'),
  ('corehub_auto_send_reviews', 'true', 'Send an underwriter''s review decision to CoreHub as soon as it is recorded'),
  ('fetch_auto_evaluate', 'true', 'Evaluate referrals against OBV as soon as a CoreHub fetch brings them in')
on conflict (setting_key) do nothing;
