import { Suspense } from "react";
import { requirePageAction } from "@/lib/api-auth";
import { PageHeader } from "@/components/console";
import { SettingsForm } from "@/components/settings-form";
import { AutomationSettingsForm } from "@/components/automation-settings-form";
import { SectionLoaded, SectionProgress } from "@/components/section-progress";
import { FormSkeleton } from "@/components/skeletons";
import { AUTOMATION_KEYS, loadAutomationSettings } from "@/lib/automation-settings";

export const metadata = { title: "Settings" };

type Db = Awaited<ReturnType<typeof requirePageAction>>["supabase"];

export default async function Settings() {
  const { supabase } = await requirePageAction("manage");
  return (
    <SectionProgress total={2}>
      <PageHeader
        eyebrow="Admin"
        title="Settings"
        description="Decision rules and CoreHub automation. Changes are saved in Supabase and recorded in the audit trail."
      />
      <Suspense fallback={<FormSkeleton />}>
        <Automation supabase={supabase} />
      </Suspense>
      <Suspense fallback={<FormSkeleton />}>
        <Rules supabase={supabase} />
      </Suspense>
    </SectionProgress>
  );
}

async function Automation({ supabase }: { supabase: Db }) {
  const settings = await loadAutomationSettings(supabase);
  return (
    <>
      <SectionLoaded />
      <AutomationSettingsForm initial={settings} />
    </>
  );
}

async function Rules({ supabase }: { supabase: Db }) {
  const { data } = await supabase.from("config_settings").select("setting_key,setting_value").eq("is_active", true).order("setting_key");
  const initial = Object.fromEntries(
    (data ?? [])
      .filter((x) => !(AUTOMATION_KEYS as readonly string[]).includes(x.setting_key) && Number.isFinite(Number(x.setting_value)))
      .map((x) => [x.setting_key, Number(x.setting_value)]),
  );
  return (
    <>
      <SectionLoaded />
      <SettingsForm initial={initial} />
    </>
  );
}
