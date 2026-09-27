import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/console";
import { SettingsForm } from "@/components/settings-form";
import { SectionLoaded, SectionProgress } from "@/components/section-progress";
import { FormSkeleton } from "@/components/skeletons";

export const metadata = { title: "Configuration" };

export default function Settings() {
  return (
    <SectionProgress total={1}>
      <PageHeader
        eyebrow="Governance"
        title="Decision configuration"
        description="Changes are persisted in Supabase and recorded in the audit trail. Review with the underwriting owner before production use."
      />
      <Suspense fallback={<FormSkeleton />}>
        <Rules />
      </Suspense>
    </SectionProgress>
  );
}

async function Rules() {
  const supabase = await createClient();
  const { data } = await supabase.from("config_settings").select("setting_key,setting_value").eq("is_active", true).order("setting_key");
  const initial = Object.fromEntries((data ?? []).map((x) => [x.setting_key, Number(x.setting_value)]));
  return (
    <>
      <SectionLoaded />
      <SettingsForm initial={initial} />
    </>
  );
}
