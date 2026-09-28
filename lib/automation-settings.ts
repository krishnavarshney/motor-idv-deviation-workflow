import type { SupabaseClient } from "@supabase/supabase-js";

export type WritebackMode = "rehearse" | "live";

export interface AutomationSettings {
  /** What the admin chose in Settings. */
  writebackMode: WritebackMode;
  /** Effective: true unless live mode is on and no env kill switch forces rehearsals. */
  dryRun: boolean;
  /** AUTOMATION_FORCE_DRY_RUN=true on the server overrides the setting (emergency stop). */
  forcedDryRun: boolean;
  autoSendReviews: boolean;
  fetchAutoEvaluate: boolean;
}

export const AUTOMATION_KEYS = ["corehub_writeback_mode", "corehub_auto_send_reviews", "fetch_auto_evaluate"] as const;

export function parseAutomationSettings(rows: { setting_key: string; setting_value: unknown }[], forceDryRun: boolean): AutomationSettings {
  const map = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
  const bool = (k: string, fallback: boolean) => (typeof map.get(k) === "boolean" ? (map.get(k) as boolean) : fallback);
  const writebackMode: WritebackMode = map.get("corehub_writeback_mode") === "live" ? "live" : "rehearse";
  return {
    writebackMode,
    dryRun: forceDryRun || writebackMode !== "live",
    forcedDryRun: forceDryRun,
    autoSendReviews: bool("corehub_auto_send_reviews", true),
    fetchAutoEvaluate: bool("fetch_auto_evaluate", true),
  };
}

export async function loadAutomationSettings(supabase: SupabaseClient): Promise<AutomationSettings> {
  const { data } = await supabase
    .from("config_settings")
    .select("setting_key,setting_value")
    .eq("is_active", true)
    .in("setting_key", [...AUTOMATION_KEYS]);
  return parseAutomationSettings(data ?? [], process.env.AUTOMATION_FORCE_DRY_RUN === "true");
}
