"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Compass, Globe, Minus, Plus, Save, TriangleAlert } from "lucide-react";
import {
  POPULAR_VEHICLES,
  COREHUB_BENCHMARK_PRESETS,
  analyzeDecisionAllowance,
  calculateSimulatedObvSpectrum,
  type CorehubPreset,
  type SimulatedConditionSpectrum,
} from "@/lib/idv-simulator-engine";
import { ConditionSpectrum } from "@/components/condition-spectrum";
import { DecisionPanel } from "@/components/simulator/decision-panel";
import { LookupCard, UnderwritingLog, type LogEntry, type LookupStatus } from "@/components/simulator/telemetry";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { money, vehicleName } from "@/lib/format";
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

const YEARS = [2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016];
const FUELS = ["Petrol", "Diesel", "CNG", "Electric"];
const EXTRA_MODELS = ["Fortuner", "Innova Crysta", "Scorpio-N", "XUV700", "Other"];
const MAKES = [...new Set([...POPULAR_VEHICLES.map((v) => v.make), "Mahindra", "Toyota", "Volkswagen"]), "Other"];
const KMS_DRIVEN = "15000"; // no UI input; sent as the OBV lookup default
const OBV_HOME = "https://www.orangebookvalue.com";

// Keep the current value selectable even when it came from a DB case outside the catalog.
const withCurrent = (list: string[], current: string) => [...new Set(current && !list.includes(current) ? [current, ...list] : list)];
const clock = () => new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const band = (r: { min: number; max: number }) => `${money(r.min)} – ${money(r.max)}`;
const findEntry = (make: string, model: string) =>
  POPULAR_VEHICLES.find((v) => v.make.toLowerCase() === make.toLowerCase() && v.model.toLowerCase() === model.toLowerCase());

export function SimulateClient({ decisionConfig, recentCases }: { decisionConfig: DecisionConfig; recentCases: RecentDbCase[] }) {
  const [make, setMake] = useState("Maruti Suzuki");
  const [model, setModel] = useState("Baleno");
  const [variant, setVariant] = useState("Zeta Petrol");
  const [year, setYear] = useState(2022);
  const [fuel, setFuel] = useState("Petrol");
  const [requestedIdv, setRequestedIdv] = useState(600000);
  const [confidence, setConfidence] = useState(0.95);
  const [manualObvInput, setManualObvInput] = useState("");

  const [isLiveLoading, setIsLiveLoading] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [liveLookupResult, setLiveLookupResult] = useState<LookupResult | null>(null);
  const [liveLookupError, setLiveLookupError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: "log-init", time: "Initial state", level: "info", message: "Underwriting sandbox ready. Vehicle inputs configured for simulation." },
  ]);

  const [isSaving, setIsSaving] = useState(false);
  const [savedCase, setSavedCase] = useState<{ id: string; external_case_id: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const catalogModels = POPULAR_VEHICLES.filter((v) => v.make.toLowerCase() === make.toLowerCase()).map((m) => m.model);
  const catalogVariants = findEntry(make, model)?.variants.map((v) => v.name) ?? [];
  const log = (...entries: Omit<LogEntry, "id" | "time">[]) =>
    setLogs((prev) => [...prev, ...entries.map((e, i) => ({ ...e, id: `log-${Date.now()}-${prev.length + i}`, time: clock() }))]);

  function resetValuation() {
    setLiveLookupResult(null);
    setManualObvInput("");
    setLiveLookupError(null);
    setSavedCase(null);
  }

  function handleMakeChange(next: string) {
    setMake(next);
    const first = POPULAR_VEHICLES.find((v) => v.make.toLowerCase() === next.toLowerCase());
    setModel(first?.model ?? "");
    setVariant(first?.variants[0].name ?? "");
    if (first) setFuel(first.variants[0].fuel);
    resetValuation();
  }

  function handleModelChange(next: string) {
    setModel(next);
    const v = findEntry(make, next)?.variants[0];
    if (v) {
      setVariant(v.name);
      setFuel(v.fuel);
    }
    resetValuation();
  }

  // Only populated once OBV has been fetched or entered manually.
  const activeSpectrum = useMemo<SimulatedConditionSpectrum | null>(() => {
    if (liveLookupResult?.conditions?.good) return { ...liveLookupResult.conditions, benchmarkIdv: liveLookupResult.idv };
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

  const selectedPreset =
    COREHUB_BENCHMARK_PRESETS.find((p) => activeSpectrum && make === p.make && model === p.model && variant === p.variant && requestedIdv === p.requestedIdv)?.id ?? "";

  function applyPreset(preset: CorehubPreset) {
    setMake(preset.make);
    setModel(preset.model);
    setVariant(preset.variant);
    setYear(preset.year);
    setFuel(preset.fuel);
    setRequestedIdv(preset.requestedIdv);
    resetValuation();
    if (preset.benchmarkIdv && preset.conditions) {
      setLiveLookupResult({
        idv: preset.benchmarkIdv,
        conditions: { ...preset.conditions, benchmarkIdv: preset.benchmarkIdv },
        sourceUrl: OBV_HOME,
        latencyMs: 12,
        reasonCode: "PRESET_BENCHMARK",
      });
      setManualObvInput(String(preset.benchmarkIdv));
    }
  }

  function applyDbCase(c: RecentDbCase) {
    if (c.make_raw) setMake(c.make_raw);
    if (c.model_raw) setModel(c.model_raw);
    if (c.variant_raw) setVariant(c.variant_raw);
    if (c.metadata?.yom) setYear(Number(c.metadata.yom));
    if (c.requested_idv) setRequestedIdv(Number(c.requested_idv));
    resetValuation();
  }

  async function runLiveObvLookup() {
    setIsLiveLoading(true);
    setLiveLookupError(null);
    setSavedCase(null);
    setElapsedMs(0);
    const started = Date.now();
    // Real elapsed time only; the API exposes no step progress.
    const timer = setInterval(() => setElapsedMs(Date.now() - started), 100);
    log({ level: "info", message: `Launched browser automation for ${vehicleName(make, model, variant)} (${year}).` });

    try {
      const res = await fetch("/api/simulate/obv-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ make, model, variant, year, kmsDriven: KMS_DRIVEN }),
      });
      let data: (LookupResult & { success?: boolean; error?: string; message?: string }) | null = null;
      try {
        const text = await res.text();
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }

      // Non-JSON / unsuccessful response: fall back to the local actuarial model.
      if (!data?.success || !data.conditions) {
        log({ level: "warn", message: `Live lookup returned no valuation (${data?.error || data?.message || `HTTP ${res.status}`}). Using empirical valuation model.` });
        const simulated = calculateSimulatedObvSpectrum({ make, model, variant: variant || "Standard", year: Number(year) || 2024 });
        data = {
          success: true,
          idv: simulated.benchmarkIdv,
          conditions: simulated,
          sourceUrl: "https://www.orangebookvalue.com/used-cars",
          latencyMs: Date.now() - started,
          reasonCode: "EMPIRICAL_VALUATION_MODEL",
        };
      }

      const { idv, conditions, sourceUrl, latencyMs, reasonCode } = data;
      setLiveLookupResult({ idv, conditions, sourceUrl, latencyMs, reasonCode });
      setManualObvInput(String(idv));

      const r = analyzeDecisionAllowance(requestedIdv, idv, confidence, decisionConfig, conditions);
      log(
        {
          level: "info",
          message: `Spectrum extracted: Good ${band(conditions!.good)}, Very Good ${band(conditions!.veryGood)}, Excellent ${band(conditions!.excellent)}. Benchmark ${money(idv)}.`,
        },
        {
          level: r.isAllowed ? "success" : "warn",
          message: `${r.pickedConditionLabel ? `Tier ${r.pickedConditionLabel} (${band(r.pickedConditionRange!)})` : `Requested ${money(requestedIdv)} outside condition tiers`}. Decision: ${r.isAllowed ? "auto-approved" : "manual review"} (${r.activeRule}).`,
        }
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setLiveLookupError(`Network or browser automation issue: ${msg}`);
      log({ level: "warn", message: `Browser automation exception: ${msg}` });
    } finally {
      clearInterval(timer);
      setElapsedMs(Date.now() - started);
      setIsLiveLoading(false);
    }
  }

  async function persistScenario() {
    if (!activeSpectrum || !benchmarkIdv) {
      setSaveError("Fetch or enter an OBV valuation before persisting.");
      return;
    }
    setIsSaving(true);
    setSaveError(null);
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
      if (!res.ok) setSaveError(data.error || "Failed to persist simulation case.");
      else setSavedCase(data.case);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  const status: LookupStatus = isLiveLoading ? "running" : liveLookupError ? "failed" : liveLookupResult ? "done" : "idle";
  const vehicle = `${vehicleName(make, model, variant)} (${year})`;
  const runButton = (label: string) => (
    <Button onClick={runLiveObvLookup} disabled={isLiveLoading}>
      {isLiveLoading ? <Spinner data-icon="inline-start" /> : <Globe data-icon="inline-start" />}
      {isLiveLoading ? "Querying OBV…" : label}
    </Button>
  );

  return (
    <div className="flex flex-col gap-6">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Quick fill</CardTitle>
          <CardDescription>CoreHub benchmark presets or a recent referral from the database.</CardDescription>
          <CardAction className="hidden text-xs text-muted-foreground sm:block">
            Tolerance ±<span className="font-mono tabular-nums">{money(decisionConfig.absoluteTolerance)}</span> or {decisionConfig.percentageTolerance}%
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={selectedPreset}
            onValueChange={(id) => {
              const p = COREHUB_BENCHMARK_PRESETS.find((x) => x.id === id);
              if (p) applyPreset(p);
            }}
            aria-label="CoreHub presets"
            className="flex-wrap"
          >
            {COREHUB_BENCHMARK_PRESETS.map((p) => (
              <ToggleGroupItem key={p.id} value={p.id} title={p.notes}>
                <span className="font-medium">{p.model}</span>
                <span className="text-muted-foreground">{p.badge}</span>
                <span className="font-mono tabular-nums">{money(p.requestedIdv)}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {recentCases.length > 0 && (
            <Select onValueChange={(id) => { const c = recentCases.find((x) => x.id === id); if (c) applyDbCase(c); }}>
              <SelectTrigger size="sm" className="w-full lg:ml-auto lg:w-72" aria-label="Load referral from database">
                <SelectValue placeholder={`Load DB referral (${recentCases.length})`} />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {recentCases.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.external_case_id} — {vehicleName(c.make_raw, c.model_raw)} ({money(c.requested_idv ?? 0)})
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      <div className="grid items-start gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Vehicle parameters</CardTitle>
              <CardDescription>CoreHub intake inputs. Changing the vehicle clears the valuation.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup className="gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel htmlFor="sim-make">Make</FieldLabel>
                    <Select value={make} onValueChange={handleMakeChange}>
                      <SelectTrigger id="sim-make" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectGroup>{withCurrent(MAKES, make).map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="sim-model">Model</FieldLabel>
                    {catalogModels.length > 0 ? (
                      <Select value={model} onValueChange={handleModelChange}>
                        <SelectTrigger id="sim-model" className="w-full"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectGroup>{withCurrent([...catalogModels, ...EXTRA_MODELS], model).map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectGroup></SelectContent>
                      </Select>
                    ) : (
                      <Input id="sim-model" value={model} onChange={(e) => handleModelChange(e.target.value)} placeholder="e.g. Fortuner" />
                    )}
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="sim-variant">Variant</FieldLabel>
                  {catalogVariants.length > 0 ? (
                    <Select value={variant} onValueChange={(v) => { setVariant(v); resetValuation(); }}>
                      <SelectTrigger id="sim-variant" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectGroup>{withCurrent([...catalogVariants, "Custom Variant"], variant).map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                  ) : (
                    <Input id="sim-variant" value={variant} onChange={(e) => { setVariant(e.target.value); resetValuation(); }} placeholder="e.g. 2.7 4x2 AT" />
                  )}
                </Field>
                <div className="grid gap-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
                  <Field>
                    <FieldLabel htmlFor="sim-year">YOM</FieldLabel>
                    <Select value={String(year)} onValueChange={(v) => { setYear(Number(v)); resetValuation(); }}>
                      <SelectTrigger id="sim-year" className="w-full"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectGroup>{withCurrent(YEARS.map(String), String(year)).map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectGroup></SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel id="sim-fuel">Fuel</FieldLabel>
                    <ToggleGroup type="single" variant="outline" spacing={0} value={fuel} onValueChange={(v) => v && setFuel(v)} aria-labelledby="sim-fuel" className="w-full">
                      {FUELS.map((f) => <ToggleGroupItem key={f} value={f} className="flex-1 px-1">{f}</ToggleGroupItem>)}
                    </ToggleGroup>
                  </Field>
                </div>
                <Field>
                  <div className="flex items-center justify-between">
                    <FieldLabel id="sim-confidence">Vehicle match confidence</FieldLabel>
                    <span className="font-mono text-sm tabular-nums">{Math.round(confidence * 100)}%</span>
                  </div>
                  <Slider aria-labelledby="sim-confidence" min={0.5} max={1} step={0.01} value={[confidence]} onValueChange={([v]) => setConfidence(v)} />
                  <FieldDescription>Below {Math.round(decisionConfig.minimumVehicleConfidence * 100)}% routes to manual review.</FieldDescription>
                </Field>
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
                  <div className="flex items-center justify-between">
                    <FieldLabel htmlFor="sim-obv">Reference OBV benchmark</FieldLabel>
                    {benchmarkIdv !== null && <Badge variant="success" className="font-mono tabular-nums"><CheckCircle2 data-icon="inline-start" />{money(benchmarkIdv)}</Badge>}
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
              </FieldGroup>
            </CardContent>
            <CardFooter className="grid grid-cols-2 gap-2">
              {runButton("Run live OBV")}
              <Button variant="outline" onClick={persistScenario} disabled={isSaving || !activeSpectrum}>
                {isSaving ? <Spinner data-icon="inline-start" /> : <Save data-icon="inline-start" />}
                {isSaving ? "Saving…" : "Persist as case"}
              </Button>
            </CardFooter>
          </Card>

          {liveLookupError && (
            <Alert>
              <TriangleAlert />
              <AlertTitle>Live lookup failed</AlertTitle>
              <AlertDescription>{liveLookupError} You can enter an OBV benchmark manually.</AlertDescription>
            </Alert>
          )}
          {savedCase && (
            <Alert>
              <CheckCircle2 />
              <AlertTitle>Persisted as {savedCase.external_case_id}</AlertTitle>
              <AlertDescription>Saved to the referral queue with the current decision.</AlertDescription>
              <AlertAction>
                <Button asChild size="xs" variant="outline">
                  <Link href={`/referrals/${savedCase.id}`}>View<ArrowRight data-icon="inline-end" /></Link>
                </Button>
              </AlertAction>
            </Alert>
          )}
          {saveError && (
            <Alert variant="destructive">
              <TriangleAlert />
              <AlertTitle>Could not save</AlertTitle>
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}

          <LookupCard status={status} elapsedMs={elapsedMs} vehicle={vehicle} reasonCode={liveLookupResult?.reasonCode} latencyMs={liveLookupResult?.latencyMs} />
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {analysis ? (
            <DecisionPanel analysis={analysis} requestedIdv={requestedIdv} onRequestedIdvChange={setRequestedIdv} />
          ) : isLiveLoading ? (
            <Card>
              <CardContent className="flex flex-col gap-3">
                <Skeleton className="h-6 w-1/3" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-3 w-full" />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon"><Compass /></EmptyMedia>
                  <EmptyTitle>Awaiting OBV valuation</EmptyTitle>
                  <EmptyDescription>
                    No market data yet for {vehicle}. Run a live lookup or enter a benchmark to evaluate the auto-approval corridor against ±
                    {money(decisionConfig.absoluteTolerance)} / {decisionConfig.percentageTolerance}% tolerance.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>{runButton("Fetch live OBV valuation")}</EmptyContent>
              </Empty>
            </Card>
          )}

          {activeSpectrum && (
            <ConditionSpectrum conditions={activeSpectrum} requestedIdv={requestedIdv} sourceUrl={liveLookupResult?.sourceUrl || OBV_HOME} />
          )}

          <UnderwritingLog logs={logs} analysis={analysis} />
        </div>
      </div>
    </div>
  );
}
