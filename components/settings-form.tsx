"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { StatefulButton, type ButtonState } from "@/components/motion/button/stateful";

const META: Record<string, { label: string; unit: string; hint: string; prefix?: boolean }> = {
  idv_abs_tolerance: { label: "Absolute IDV tolerance", unit: "₹", prefix: true, hint: "Approve when |requested − OBV| is within this amount." },
  idv_pct_tolerance: { label: "Percentage IDV tolerance", unit: "%", hint: "Approve when the delta is within this share of the OBV value." },
  vehicle_match_min_confidence: { label: "Minimum vehicle confidence", unit: "%", hint: "Below this, the case always routes to manual review." },
  obv_lookup_timeout_ms: { label: "OBV lookup timeout", unit: "ms", hint: "Browser/provider timeout per lookup." },
  obv_max_retries: { label: "Maximum transient retries", unit: "×", hint: "Retries before failing closed to manual review." },
  manual_review_sla_hours: { label: "Manual review SLA", unit: "h", hint: "Target time for an underwriter decision." },
};

export function SettingsForm({ initial }: { initial: Record<string, number> }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ButtonState>("idle");
  const dirty = Object.keys(v).some((k) => v[k] !== initial[k]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const r = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    setResult(r.ok ? "success" : "error");
    setTimeout(() => setResult("idle"), 1600);
    if (!r.ok) return notify.error("Unable to save configuration", { description: d.error });
    notify.success("Configuration saved", { description: "Change recorded in the audit trail.", href: "/settings" });
    router.refresh();
  }

  return (
    <form onSubmit={submit}>
      <Card>
        <CardHeader>
          <CardTitle>Decision rules</CardTitle>
          <CardDescription>Admin role required. Applies to the next worker run and simulator.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-6 md:grid-cols-2">
            {Object.entries(v).map(([key, value]) => {
              const m = META[key] ?? { label: key.replaceAll("_", " "), unit: "", hint: "" };
              return (
                <Field key={key}>
                  <FieldLabel htmlFor={key}>{m.label}</FieldLabel>
                  <InputGroup>
                    {m.prefix && (
                      <InputGroupAddon>
                        <InputGroupText>{m.unit}</InputGroupText>
                      </InputGroupAddon>
                    )}
                    <InputGroupInput
                      id={key}
                      type="number"
                      step="any"
                      min={0}
                      className="font-mono tabular-nums"
                      value={value}
                      onChange={(e) => setV({ ...v, [key]: Number(e.target.value) })}
                    />
                    {!m.prefix && m.unit && (
                      <InputGroupAddon align="inline-end">
                        <InputGroupText>{m.unit}</InputGroupText>
                      </InputGroupAddon>
                    )}
                  </InputGroup>
                  {m.hint && <FieldDescription>{m.hint}</FieldDescription>}
                </Field>
              );
            })}
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" disabled={!dirty || saving} onClick={() => setV(initial)}>
            Reset
          </Button>
          <StatefulButton
            type="submit"
            size="sm"
            state={saving ? "loading" : result}
            loadingText="Saving…"
            successText="Saved"
            errorText="Not saved"
            disabled={(!dirty && result === "idle") || saving}
          >
            Save configuration
          </StatefulButton>
        </CardFooter>
      </Card>
    </form>
  );
}
