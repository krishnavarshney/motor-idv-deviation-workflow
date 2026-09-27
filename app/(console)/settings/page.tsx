import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/console";
import { SettingsForm } from "@/components/settings-form";

export const metadata = { title: "Configuration" };

export default async function Settings() {
  const supabase = await createClient();
  const { data } = await supabase.from("config_settings").select("setting_key,setting_value").eq("is_active", true).order("setting_key");
  const initial = Object.fromEntries((data ?? []).map((x) => [x.setting_key, Number(x.setting_value)]));
  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Decision configuration"
        description="Changes are persisted in Supabase and recorded in the audit trail. Review with the underwriting owner before production use."
      />
      <SettingsForm initial={initial} />
    </>
  );
}
