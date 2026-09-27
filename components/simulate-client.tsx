"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronsUpDown, Compass, Globe, Minus, PencilLine, Plus, Save, Square } from "lucide-react";
import {
  COREHUB_BENCHMARK_PRESETS,
  analyzeDecisionAllowance,
  type CorehubPreset,
  type SimulatedConditionSpectrum,
} from "@/lib/idv-simulator-engine";
import { evaluateIdvDecision } from "@/src/domain/decision-engine";
import { ConditionSpectrum } from "@/components/condition-spectrum";
import { InfoTip, OutcomeChart, VerdictCard } from "@/components/simulator/decision-panel";
import { PipelineLog, RunBar, type LogEntry, type RunStatus, type RunStep } from "@/components/simulator/telemetry";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/motion/tabs";
import { StatefulButton, type ButtonState } from "@/components/motion/button/stateful";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { money, vehicleName } from "@/lib/format";
import { notify } from "@/lib/notify";
import type { DecisionConfig } from "@/src/domain/motor-idv";

interface RecentDbCase {
  id: string;
  external_case_id: string;
  make_raw: string | null;
  model_raw: string | null;
  variant_raw: string | null;
  requested_idv: number | null;
  referral_status: string;
  metadata?: { yom?: number | string };
}

type LookupResult = {
  idv: number;
  conditions?: SimulatedConditionSpectrum;
  sourceUrl?: string | null;
  latencyMs?: number;
  reasonCode?: string;
};
type StreamEvent =
  | ({ type: "step" } & RunStep)
  | ({ type: "result"; success: boolean } & LookupResult)
  | { type: "error"; error: string; reasonCode?: string };

const FUELS = ["Petrol", "Diesel", "CNG", "Electric"];
const KMS_DRIVEN = "15000"; // no UI input; sent as the OBV lookup default
const OBV_HOME = "https://www.orangebookvalue.com";
const SOURCE_LABEL: Record<string, string> = {
  SUCCESS: "Live OBV",
  EMPIRICAL_VALUATION_MODEL: "Empirical model (fallback)",
  PRESET_BENCHMARK: "Preset benchmark",
};

// Keep the current value selectable even when it came from a DB case outside the catalog.
const withCurrent = (list: string[], current: string) => [...new Set(current && !list.includes(current) ? [current, ...list] : list)];
const clock = () => new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const band = (r: { min: number; max: number }) => `${money(r.min)} – ${money(r.max)}`;

/** OBV's own make → model → year → variant catalog. null = not queried yet / loading; [] = unavailable. */
function useObvOptions(query: Record<string, string | number> | null) {
  const [options, setOptions] = useState<string[] | null>(null);
  const key = query ? new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)])).toString() : null;
  useEffect(() => {
    setOptions(null);
    if (key === null) return;
    const ctrl = new AbortController();
    fetch(`/api/obv/options?${key}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => setOptions(d.options ?? []))
      .catch(() => !ctrl.signal.aborted && setOptions([]));
    return () => ctrl.abort();
  }, [key]);
  return options;
}

/** Snap a value to OBV's exact spelling (CoreHub sends e.g. "VOLKSWAGEN"); auto-pick a sole option. */
function useCanonical(list: string[] | null, value: string, set: (v: string) => void) {
  useEffect(() => {
    if (!list?.length) return;
    const match = value ? list.find((o) => o.toLowerCase() === value.toLowerCase()) : list.length === 1 ? list[0] : undefined;
    if (match && match !== value) set(match);
  }, [list, value, set]);
}

export function SimulateClient({ decisionConfig, recentCases }: { decisionConfig: DecisionConfig; recentCases: RecentDbCase[] }) {
  const [make, setMake] = useState("Maruti Suzuki");
  const [model, setModel] = useState("Baleno");
  const [variant, setVariant] = useState("ZETA 1.2");
  const [year, setYear] = useState(2022);
  const [fuel, setFuel] = useState("Petrol");
  const [requestedIdv, setRequestedIdv] = useState(600000);
  const [confidence, setConfidence] = useState(0.95);
  const [manualObvInput, setManualObvInput] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [scenarioKey, setScenarioKey] = useState(0);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [runError, setRunError] = useState<string | null>(null);
  const [liveLookupResult, setLiveLookupResult] = useState<LookupResult | null>(null);
  const [rawResponse, setRawResponse] = useState<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: "log-init", time: clock(), level: "info", message: "Underwriting sandbox ready. Vehicle inputs configured for simulation." },
  ]);

  const [isSaving, setIsSaving] = useState(false);
  const [savedCase, setSavedCase] = useState<{ id: string; external_case_id: string } | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const obvMakes = useObvOptions({});
  const obvModels = useObvOptions(make ? { make } : null);
  const obvYears = useObvOptions(make && model ? { make, model } : null);
  const obvVariants = useObvOptions(make && model && year ? { make, model, year } : null);
  const setYearText = useCallback((v: string) => setYear(Number(v)), []);
  useCanonical(obvMakes, make, setMake);
  useCanonical(obvModels, model, setModel);
  useCanonical(obvYears, String(year), setYearText);
  useCanonical(obvVariants, variant, setVariant);
  // Live lookup only for an MMV OBV actually lists; an unknown name would value the wrong car or none.
  const offCatalog = (
    [
      ["make", make, obvMakes],
      ["model", model, obvModels],
      ["year", String(year), obvYears],
      ["variant", variant, obvVariants],
    ] as const
  ).filter(([, v, list]) => list?.length && !list.includes(v)).map(([k, v]) => `${k} "${v}"`);
  const mmvReady = obvVariants !== null && variant !== "" && offCatalog.length === 0;
  const log = (...entries: Omit<LogEntry, "id" | "time">[]) =>
    setLogs((prev) => [...prev, ...entries.map((e, i) => ({ ...e, id: `log-${Date.now()}-${prev.length + i}`, time: clock() }))]);

  function resetValuation() {
    setLiveLookupResult(null);
    setManualObvInput("");
    setRunError(null);
    setSavedCase(null);
    setSource(null);
  }

  function handleMakeChange(next: string) {
    setMake(next);
    setModel("");
    setVariant("");
    resetValuation();
  }

  function handleModelChange(next: string) {
    setModel(next);
    setVariant("");
    resetValuation();
  }

  // Only populated once OBV has been fetched or entered manually.
  const activeSpectrum = useMemo<SimulatedConditionSpectrum | null>(() => {
    // Live OBV can return a partial band set; only trust it when all three tiers are present.
    const c = liveLookupResult?.conditions;
    if (c?.good && c.veryGood && c.excellent) return { ...c, benchmarkIdv: liveLookupResult!.idv };
    const v = Number(manualObvInput);
    if (!Number.isFinite(v) || v <= 1000) return null;
    const range = (base: number, midpoint?: number) => {
      const min = Math.round(base * 0.97);
      const max = Math.round(base * 1.03);
      return { min, max, midpoint: midpoint ?? Math.round((min + max) / 2), raw: `₹${min.toLocaleString("en-IN")} - ₹${max.toLocaleString("en-IN")}` };
    };
    return { good: range(v * 0.92), veryGood: range(v, v), excellent: range(v * 1.07), benchmarkIdv: v };
  }, [liveLookupResult, manualObvInput]);

  const benchmarkIdv = activeSpectrum?.benchmarkIdv ?? null;
  const analysis = useMemo(
    () => (activeSpectrum && benchmarkIdv !== null ? analyzeDecisionAllowance(requestedIdv, benchmarkIdv, confidence, decisionConfig, activeSpectrum) : null),
    [requestedIdv, benchmarkIdv, confidence, decisionConfig, activeSpectrum]
  );
  const explanation = useMemo(
    () =>
      activeSpectrum && benchmarkIdv !== null
        ? evaluateIdvDecision(
            { requestedIdv, fetchedIdv: benchmarkIdv, vehicleConfidence: confidence, providerStatus: "succeeded", conditions: activeSpectrum },
            decisionConfig
          ).explanation
        : "",
    [requestedIdv, benchmarkIdv, confidence, decisionConfig, activeSpectrum]
  );

  function applyPreset(preset: CorehubPreset) {
    setScenarioKey((k) => k + 1);
    setMake(preset.make);
    setModel(preset.model);
    setVariant(preset.variant);
    setYear(preset.year);
    setFuel(preset.fuel);
    setRequestedIdv(preset.requestedIdv);
    resetValuation();
    setSource(preset.id);
    if (preset.benchmarkIdv && preset.conditions) {
      const result = {
        idv: preset.benchmarkIdv,
        conditions: { ...preset.conditions, benchmarkIdv: preset.benchmarkIdv },
        sourceUrl: OBV_HOME,
        latencyMs: 12,
        reasonCode: "PRESET_BENCHMARK",
      };
      setLiveLookupResult(result);
      setRawResponse(result);
      setManualObvInput(String(preset.benchmarkIdv));
    }
  }

  function applyDbCase(c: RecentDbCase) {
    setScenarioKey((k) => k + 1);
    if (c.make_raw) setMake(c.make_raw);
    if (c.model_raw) setModel(c.model_raw);
    if (c.variant_raw) setVariant(c.variant_raw);
    if (c.metadata?.yom) setYear(Number(c.metadata.yom));
    if (c.requested_idv) setRequestedIdv(Number(c.requested_idv));
    resetValuation();
    setSource(c.id);
  }

  async function runLiveObvLookup() {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunStatus("running");
    setSteps([]);
    setRunError(null);
    setSavedCase(null);
    setElapsedMs(0);
    const started = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - started), 100);
    const vehicle = `${vehicleName(make, model, variant)} (${year})`;
    log({ level: "info", message: `Started OBV lookup for ${vehicle}.` });

    try {
      const res = await fetch("/api/simulate/obv-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ make, model, variant, year, kmsDriven: KMS_DRIVEN }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      let result: LookupResult | null = null;
      const handle = (e: StreamEvent) => {
        if (e.type === "step") {
          setSteps((prev) => [...prev, e]);
          const level = e.status === "failed" ? "error" : e.key === "fallback" ? "warn" : e.status === "done" ? "success" : "info";
          log({ level, message: e.detail ? `${e.label} (${e.detail})` : e.label });
        } else if (e.type === "result") {
          setRawResponse(e);
          result = e;
        } else {
          setRawResponse(e);
          throw new Error(e.error);
        }
      };
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        buf += decoder.decode(value, { stream: !done });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        lines.filter((l) => l.trim()).forEach((l) => handle(JSON.parse(l)));
        if (done) break;
      }
      if (buf.trim()) handle(JSON.parse(buf));

      const final = result as LookupResult | null;
      if (!final?.conditions) throw new Error("Lookup ended without a valuation.");
      const { idv, conditions, sourceUrl, latencyMs, reasonCode } = final;
      setLiveLookupResult({ idv, conditions, sourceUrl, latencyMs, reasonCode });
      setManualObvInput(String(idv));
      setRunStatus("done");

      const complete = conditions.good && conditions.veryGood && conditions.excellent;
      const r = complete ? analyzeDecisionAllowance(requestedIdv, idv, confidence, decisionConfig, conditions) : null;
      if (r)
        log(
        {
          level: "info",
          message: `Spectrum: Good ${band(conditions.good)}, Very Good ${band(conditions.veryGood)}, Excellent ${band(conditions.excellent)}. Benchmark ${money(idv)}.`,
        },
        {
          level: r.isAllowed ? "success" : "warn",
          message: `${r.pickedConditionLabel ? `Tier ${r.pickedConditionLabel} (${band(r.pickedConditionRange!)})` : `Requested ${money(requestedIdv)} outside condition tiers`}. Decision: ${r.isAllowed ? "auto-approved" : "manual review"} (${r.activeRule}).`,
        }
      );
      const fallback = reasonCode === "EMPIRICAL_VALUATION_MODEL";
      (fallback ? notify.warning : notify.success)(fallback ? "OBV fallback used" : "Live OBV valuation fetched", {
        description: `${vehicle}: benchmark ${money(idv)} from ${fallback ? "the empirical valuation model — live lookup unavailable" : "OrangeBookValue"}.`,
      });
    } catch (err: unknown) {
      if (ctrl.signal.aborted) {
        setRunStatus("cancelled");
        log({ level: "warn", message: "Lookup cancelled by user." });
      } else {
        const msg = err instanceof Error ? err.message : String(err);
        setRunStatus("failed");
        setRunError(msg);
        log({ level: "error", message: `Lookup failed: ${msg}` });
        notify.error("OBV lookup failed", { description: `${msg}. Enter an OBV benchmark manually to continue.` });
      }
    } finally {
      clearInterval(timer);
      setElapsedMs(Date.now() - started);
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }

  async function persistScenario() {
    if (!activeSpectrum || !benchmarkIdv) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          make,
          model,
          variant,
          year,
          fuel,
          requestedIdv,
          obvIdv: benchmarkIdv,
          confidence,
          conditions: activeSpectrum,
          sourceUrl: liveLookupResult?.sourceUrl || OBV_HOME,
          provider: liveLookupResult ? "obv-live-browser" : "obv-manual-entry",
          latencyMs: liveLookupResult?.latencyMs ?? 18,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to persist simulation case.");
      setSavedCase(data.case);
      log({ level: "success", message: `Saved as case ${data.case.external_case_id}.` });
      notify.success(`Saved as ${data.case.external_case_id}`, {
        description: `${vehicleName(make, model, variant)} queued with decision ${data.result?.reasonCode ?? ""}.`.trim(),
        href: `/referrals/${data.case.id}`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log({ level: "error", message: `Save failed: ${msg}` });
      notify.error("Could not save case", { description: msg });
    } finally {
      setIsSaving(false);
    }
  }

  const running = runStatus === "running";
  const runFlash = useFlash(runStatus === "done" ? "success" : runStatus === "failed" ? "error" : null);
  const saveFlash = useFlash(savedCase?.id ?? null);
  const vehicle = `${vehicleName(make, model, variant)} (${year})`;
  const sourceLabel = liveLookupResult?.reasonCode ? (SOURCE_LABEL[liveLookupResult.reasonCode] ?? liveLookupResult.reasonCode) : benchmarkIdv ? "Manual benchmark" : null;
  const summary =
    runStatus === "failed" ? (
      <span className="text-destructive">Lookup failed — {runError}</span>
    ) : runStatus === "cancelled" ? (
      <span className="text-muted-foreground">Lookup cancelled · {vehicle}</span>
    ) : (
      <span>
        {vehicle} <span className="text-muted-foreground">· {sourceLabel ? `Valuation: ${sourceLabel}` : "Ready"}</span>
      </span>
    );
  const selectedPreset = COREHUB_BENCHMARK_PRESETS.find((p) => p.id === source);
  const selectedCase = recentCases.find((c) => c.id === source);
  // OBV-backed dropdown. list: undefined = parent not picked, null = loading, [] = catalogue unreachable (free text).
  const obvSelect = (id: string, value: string, list: string[] | null | undefined, onChange: (v: string) => void, placeholder: string, example: string) =>
    !list ? (
      <Select disabled>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={list === null ? "Loading…" : placeholder} />
        </SelectTrigger>
      </Select>
    ) : list.length > 0 ? (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full"><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent><SelectGroup>{withCurrent(list, value).map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
    ) : (
      <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder={example} />
    );
  const runButton = (label = "Run live OBV") => (
    <StatefulButton
      size="sm"
      state={running ? "loading" : (runFlash ?? "idle")}
      loadingText="Running…"
      successText="Valuation ready"
      errorText="Lookup failed"
      icon={<Globe className="size-4" />}
      onClick={runLiveObvLookup}
      disabled={running || !mmvReady}
    >
      {label}
    </StatefulButton>
  );

  return (
    <div className="flex flex-col gap-4">
      <RunBar
        status={runStatus}
        current={steps.at(-1) ?? null}
        stepCount={new Set(steps.map((s) => s.key)).size}
        elapsedMs={elapsedMs}
        summary={summary}
        actions={
          <>
            {running && (
              <Button size="sm" variant="outline" onClick={() => abortRef.current?.abort()} className="duration-200 animate-in fade-in zoom-in-95">
                <Square data-icon="inline-start" />
                Cancel
              </Button>
            )}
            {runButton()}
            <StatefulButton
              size="sm"
              variant="outline"
              state={isSaving ? "loading" : saveFlash ? "success" : ("idle" as ButtonState)}
              loadingText="Saving…"
              successText="Saved"
              icon={<Save className="size-4" />}
              onClick={persistScenario}
              disabled={isSaving || !activeSpectrum}
            >
              Save as case
            </StatefulButton>
            {savedCase && (
              <Button asChild size="sm" variant="ghost" className="duration-300 animate-in fade-in slide-in-from-left-2">
                <Link href={`/referrals/${savedCase.id}`}>
                  {savedCase.external_case_id}
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="grid items-start gap-4 xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="duration-500 animate-in fade-in blur-in-sm slide-in-from-bottom-2 fill-mode-backwards">
        <Card>
          <CardHeader>
            <CardTitle>Case input</CardTitle>
            <CardDescription>CoreHub intake inputs. Changing the vehicle clears the valuation.</CardDescription>
          </CardHeader>
          <CardContent key={scenarioKey} className={cn(scenarioKey > 0 && "duration-500 animate-in fade-in blur-in-sm")}>
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="sim-source">Load scenario</FieldLabel>
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button id="sim-source" variant="outline" role="combobox" aria-expanded={pickerOpen} className="w-full justify-between font-normal">
                      <span className="truncate">
                        {selectedPreset
                          ? `${selectedPreset.model} — ${selectedPreset.badge}`
                          : selectedCase
                            ? `${selectedCase.external_case_id} — ${vehicleName(selectedCase.make_raw, selectedCase.model_raw)}`
                            : "Preset or recent referral…"}
                      </span>
                      <ChevronsUpDown data-icon="inline-end" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
                    <Command>
                      <CommandInput placeholder="Search presets and referrals…" />
                      <CommandList>
                        <CommandEmpty>No match.</CommandEmpty>
                        <CommandGroup heading="Benchmark presets">
                          {COREHUB_BENCHMARK_PRESETS.map((p) => (
                            <CommandItem
                              key={p.id}
                              value={`${p.model} ${p.badge} ${p.externalCaseId}`}
                              data-checked={source === p.id}
                              onSelect={() => {
                                applyPreset(p);
                                setPickerOpen(false);
                              }}
                            >
                              <div className="flex min-w-0 flex-col">
                                <span className="truncate">
                                  {p.model} <span className="text-muted-foreground">· {p.badge}</span>
                                </span>
                                <span className="font-mono text-xs text-muted-foreground tabular-nums">{money(p.requestedIdv)}</span>
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                        {recentCases.length > 0 && (
                          <>
                            <CommandSeparator />
                            <CommandGroup heading="Recent referrals">
                              {recentCases.map((c) => (
                                <CommandItem
                                  key={c.id}
                                  value={`${c.external_case_id} ${vehicleName(c.make_raw, c.model_raw)}`}
                                  data-checked={source === c.id}
                                  onSelect={() => {
                                    applyDbCase(c);
                                    setPickerOpen(false);
                                  }}
                                >
                                  <div className="flex min-w-0 flex-col">
                                    <span className="truncate">{vehicleName(c.make_raw, c.model_raw, c.variant_raw)}</span>
                                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                                      {c.external_case_id} · {money(c.requested_idv ?? 0)}
                                    </span>
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
                {selectedPreset && <FieldDescription>{selectedPreset.notes}</FieldDescription>}
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="sim-make">Make</FieldLabel>
                  {obvSelect("sim-make", make, obvMakes, handleMakeChange, "Select make", "e.g. Volkswagen")}
                </Field>
                <Field>
                  <FieldLabel htmlFor="sim-model">Model</FieldLabel>
                  {obvSelect("sim-model", model, make ? obvModels : undefined, handleModelChange, make ? "Select model" : "Pick make first", "e.g. Tiguan")}
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="sim-variant">Variant</FieldLabel>
                {obvSelect("sim-variant", variant, make && model ? obvVariants : undefined, (v) => { setVariant(v); resetValuation(); }, model ? "Select variant" : "Pick model first", "e.g. Elegance 2.0 TSI DSG")}
                {offCatalog.length > 0 && (
                  <FieldDescription className="text-destructive">
                    Not in OBV catalogue: {offCatalog.join(", ")}. Pick a listed option to run a live lookup.
                  </FieldDescription>
                )}
              </Field>
              <div className="grid gap-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
                <Field>
                  <FieldLabel htmlFor="sim-year">YOM</FieldLabel>
                  {obvSelect("sim-year", String(year), make && model ? obvYears : undefined, (v) => { setYear(Number(v)); resetValuation(); }, "Year", "2024")}
                </Field>
                <Field>
                  <FieldLabel id="sim-fuel">Fuel</FieldLabel>
                  <ToggleGroup type="single" variant="outline" spacing={0} value={fuel} onValueChange={(v) => v && setFuel(v)} aria-labelledby="sim-fuel" className="w-full">
                    {FUELS.map((f) => <ToggleGroupItem key={f} value={f} className="flex-1 px-1">{f}</ToggleGroupItem>)}
                  </ToggleGroup>
                </Field>
              </div>

              <Field>
                <FieldLabel htmlFor="sim-requested">Requested IDV</FieldLabel>
                <InputGroup>
                  <InputGroupAddon><InputGroupText>₹</InputGroupText></InputGroupAddon>
                  <InputGroupInput
                    id="sim-requested"
                    type="number"
                    inputMode="numeric"
                    step={5000}
                    min={50000}
                    max={10000000}
                    value={requestedIdv}
                    onChange={(e) => setRequestedIdv(Number(e.target.value) || 0)}
                    className="font-mono tabular-nums"
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupButton aria-label="Decrease by ₹10,000" onClick={() => setRequestedIdv((p) => Math.max(10000, p - 10000))}>
                      <Minus data-icon="inline-start" />10k
                    </InputGroupButton>
                    <InputGroupButton aria-label="Increase by ₹10,000" onClick={() => setRequestedIdv((p) => p + 10000)}>
                      <Plus data-icon="inline-start" />10k
                    </InputGroupButton>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>Amount proposed at policy intake.</FieldDescription>
              </Field>

              <Field>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-0.5">
                    <FieldLabel id="sim-confidence">Vehicle match confidence</FieldLabel>
                    <InfoTip term="confidence threshold">
                      How sure the resolver is that the intake vehicle matches the OBV catalogue entry. Below the threshold, every case goes to manual review.
                    </InfoTip>
                  </div>
                  <span className="font-mono text-sm tabular-nums">{Math.round(confidence * 100)}%</span>
                </div>
                <Slider aria-labelledby="sim-confidence" min={0.5} max={1} step={0.01} value={[confidence]} onValueChange={([v]) => setConfidence(v)} />
                <FieldDescription>
                  Threshold <span className="font-mono tabular-nums">{Math.round(decisionConfig.minimumVehicleConfidence * 100)}%</span> —{" "}
                  {confidence < decisionConfig.minimumVehicleConfidence ? "below: routes to manual review." : "met."}
                </FieldDescription>
              </Field>

              <Field>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-0.5">
                    <FieldLabel htmlFor="sim-obv">OBV benchmark</FieldLabel>
                    <InfoTip term="condition band">
                      OBV prices a vehicle in Good, Very Good and Excellent condition bands. A requested IDV inside any band is auto-approved before tolerances are checked.
                    </InfoTip>
                  </div>
                  {benchmarkIdv !== null && <Badge variant="success" className="font-mono tabular-nums">{money(benchmarkIdv)}</Badge>}
                </div>
                <InputGroup>
                  <InputGroupAddon><InputGroupText>₹</InputGroupText></InputGroupAddon>
                  <InputGroupInput id="sim-obv" type="number" inputMode="numeric" placeholder="Optional — or run live lookup" value={manualObvInput} onChange={(e) => setManualObvInput(e.target.value)} className="font-mono tabular-nums" />
                  {manualObvInput && (
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton onClick={() => setManualObvInput("")}>Clear</InputGroupButton>
                    </InputGroupAddon>
                  )}
                </InputGroup>
                <FieldDescription>Manual entry derives Good / Very Good / Excellent bands at −8% / ±3% / +7%.</FieldDescription>
              </Field>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-0.5">
                  Absolute tolerance <span className="font-mono text-foreground tabular-nums">±{money(decisionConfig.absoluteTolerance)}</span>
                  <InfoTip term="absolute tolerance">Auto-approve when |requested − benchmark| is at most this rupee amount.</InfoTip>
                </span>
                <span className="flex items-center gap-0.5">
                  % tolerance <span className="font-mono text-foreground tabular-nums">{decisionConfig.percentageTolerance}%</span>
                  <InfoTip term="percentage tolerance">Auto-approve when the deviation is at most this share of the benchmark.</InfoTip>
                </span>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4 delay-100 duration-500 animate-in fade-in blur-in-sm slide-in-from-bottom-2 fill-mode-backwards">
          <div key={analysis && activeSpectrum ? "result" : running ? "loading" : "empty"} className="flex flex-col gap-4 duration-300 animate-in fade-in slide-in-from-bottom-1">
          {analysis && activeSpectrum ? (
            <>
              <VerdictCard analysis={analysis} explanation={explanation} />
              <OutcomeChart spectrum={activeSpectrum} requestedIdv={requestedIdv} confidence={confidence} config={decisionConfig} onPick={setRequestedIdv} />
            </>
          ) : running ? (
            <>
              <Card>
                <CardContent className="flex flex-col gap-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-7 w-48" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-16 w-full" />
                </CardContent>
              </Card>
              <Card>
                <CardContent className="flex flex-col gap-3">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-56 w-full" />
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon"><Compass /></EmptyMedia>
                  <EmptyTitle>Awaiting OBV valuation</EmptyTitle>
                  <EmptyDescription>
                    No market data yet for {vehicle}. Run a live lookup or enter a benchmark to see the decision and the outcome across requested IDVs.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent className="flex-row flex-wrap justify-center">
                  {runButton()}
                  <Button size="sm" variant="outline" onClick={() => document.getElementById("sim-obv")?.focus()}>
                    <PencilLine data-icon="inline-start" />
                    Enter benchmark
                  </Button>
                </EmptyContent>
              </Empty>
            </Card>
          )}
          </div>

          <Tabs defaultValue="spectrum" variant="segment">
            <TabsList className="w-full sm:w-fit">
              <TabsTrigger value="spectrum">Condition spectrum</TabsTrigger>
              <TabsTrigger value="log">Pipeline log</TabsTrigger>
              <TabsTrigger value="raw">Raw response</TabsTrigger>
            </TabsList>
            <TabsContent value="spectrum">
              {activeSpectrum ? (
                <ConditionSpectrum conditions={activeSpectrum} requestedIdv={requestedIdv} sourceUrl={liveLookupResult?.sourceUrl || OBV_HOME} />
              ) : (
                <p className="rounded-xl border p-4 text-muted-foreground">Condition bands appear once a valuation is available.</p>
              )}
            </TabsContent>
            <TabsContent value="log">
              <PipelineLog logs={logs} />
            </TabsContent>
            <TabsContent value="raw">
              <ScrollArea className="h-80 rounded-xl border">
                <pre className="p-3 font-mono text-xs break-all whitespace-pre-wrap">
                  {rawResponse ? JSON.stringify(rawResponse, null, 2) : "No OBV response yet."}
                </pre>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

/** Holds a transient value (e.g. a button's success state) for `ms`, then clears it. */
function useFlash<T>(value: T | null, ms = 1600) {
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    if (value == null) return;
    setV(value);
    const t = setTimeout(() => setV(null), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
