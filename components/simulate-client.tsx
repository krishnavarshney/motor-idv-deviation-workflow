"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import {
  Car,
  Calendar,
  Fuel,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Globe,
  Save,
  ShieldCheck,
  Plus,
  Minus,
  Sparkles,
  Info,
  Clock3,
  Compass,
  Zap,
  Activity,
  Terminal,
  Layers,
} from "lucide-react";
import {
  POPULAR_VEHICLES,
  COREHUB_BENCHMARK_PRESETS,
  analyzeDecisionAllowance,
  type CorehubPreset,
  type SimulatedConditionSpectrum,
  type DecisionAllowanceAnalysis,
} from "@/lib/idv-simulator-engine";
import { ConditionSpectrum } from "@/components/condition-spectrum";
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

interface SimulateClientProps {
  decisionConfig: DecisionConfig;
  recentCases: RecentDbCase[];
  userEmail: string;
}

export interface AutomationStep {
  id: number;
  label: string;
  description: string;
}

export const OBV_AUTOMATION_STEPS: AutomationStep[] = [
  { id: 1, label: "Initialize Headless Browser Engine", description: "Launching isolated Chromium process with stealth anti-detection flags" },
  { id: 2, label: "Connect to OrangeBookValue Portal", description: "Navigating to orangebookvalue.com live valuation interface" },
  { id: 3, label: "Input Vehicle Parameters", description: "Injecting Make, Model, Year of Manufacture & Variant specifications" },
  { id: 4, label: "Extract Multi-Tier Valuation Spectrum", description: "Scraping Good, Very Good, and Excellent market condition bands" },
  { id: 5, label: "Evaluate Underwriting Policy & Corridor", description: "Correlating requested IDV against bands for automated STP clearance" },
];

export interface LogEntry {
  id: string;
  time: string;
  level: "info" | "success" | "warn";
  message: string;
}

function formatINR(val: number): string {
  return "₹" + Math.round(val).toLocaleString("en-IN");
}

export function SimulateClient({
  decisionConfig,
  recentCases,
  userEmail: _userEmail,
}: SimulateClientProps) {
  // Vehicle Inputs
  const [make, setMake] = useState("Maruti Suzuki");
  const [model, setModel] = useState("Baleno");
  const [variant, setVariant] = useState("Zeta Petrol");
  const [year, setYear] = useState(2022);
  const [fuel, setFuel] = useState("Petrol");
  const [kmsDriven, setKmsDriven] = useState("15000");
  const [requestedIdv, setRequestedIdv] = useState(600000);
  const [confidence, setConfidence] = useState(0.95);

  // Manual OBV reference input (optional fallback)
  const [manualObvInput, setManualObvInput] = useState<string>("");

  // Live lookup & fetched valuation state (NULL when new car is entered)
  const [isLiveLoading, setIsLiveLoading] = useState(false);
  const [liveLookupResult, setLiveLookupResult] = useState<{
    idv: number;
    conditions?: SimulatedConditionSpectrum;
    sourceUrl?: string | null;
    latencyMs?: number;
    reasonCode?: string;
  } | null>(null);
  const [liveLookupError, setLiveLookupError] = useState<string | null>(null);

  // Live Automation Steps State
  const [activeStepId, setActiveStepId] = useState<number>(1);
  const [liveProgressPct, setLiveProgressPct] = useState<number>(0);
  const [elapsedMs, setElapsedMs] = useState<number>(0);

  // Underwriter Execution & Condition Log Stream
  const [underwritingLogs, setUnderwritingLogs] = useState<LogEntry[]>([
    {
      id: "log-init",
      time: "Initial State",
      level: "info",
      message: "Underwriting Sandbox ready. Vehicle inputs configured for simulation.",
    },
  ]);

  // Persistence state
  const [isSaving, setIsSaving] = useState(false);
  const [savedCase, setSavedCase] = useState<{ id: string; external_case_id: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Distinct makes for dropdown
  const distinctMakes = useMemo(() => {
    const set = new Set(POPULAR_VEHICLES.map((v) => v.make));
    set.add("Mahindra");
    set.add("Toyota");
    set.add("Volkswagen");
    return Array.from(set);
  }, []);

  // Available models based on chosen make
  const availableModels = useMemo(() => {
    const matching = POPULAR_VEHICLES.filter(
      (v) => v.make.toLowerCase() === make.toLowerCase()
    );
    return matching.map((m) => m.model);
  }, [make]);

  // Current catalog entry for selected make + model
  const currentCatalogEntry = useMemo(() => {
    return POPULAR_VEHICLES.find(
      (v) =>
        v.make.toLowerCase() === make.toLowerCase() &&
        v.model.toLowerCase() === model.toLowerCase()
    );
  }, [make, model]);

  const availableVariants = useMemo(() => {
    if (!currentCatalogEntry) return [];
    return currentCatalogEntry.variants.map((v) => v.name);
  }, [currentCatalogEntry]);

  // Handle Make change -> Resets fetched valuation
  function handleMakeChange(newMake: string) {
    setMake(newMake);
    const matching = POPULAR_VEHICLES.filter(
      (v) => v.make.toLowerCase() === newMake.toLowerCase()
    );
    if (matching.length > 0) {
      const first = matching[0];
      setModel(first.model);
      setVariant(first.variants[0].name);
      setFuel(first.variants[0].fuel);
    } else {
      setModel("");
      setVariant("");
    }
    setLiveLookupResult(null);
    setManualObvInput("");
    setLiveLookupError(null);
    setSavedCase(null);
  }

  // Handle Model change -> Resets fetched valuation
  function handleModelChange(newModel: string) {
    setModel(newModel);
    const entry = POPULAR_VEHICLES.find(
      (v) =>
        v.make.toLowerCase() === make.toLowerCase() &&
        v.model.toLowerCase() === newModel.toLowerCase()
    );
    if (entry && entry.variants.length > 0) {
      setVariant(entry.variants[0].name);
      setFuel(entry.variants[0].fuel);
    }
    setLiveLookupResult(null);
    setManualObvInput("");
    setLiveLookupError(null);
    setSavedCase(null);
  }

  // Handle Variant change -> Resets fetched valuation
  function handleVariantChange(newVariant: string) {
    setVariant(newVariant);
    setLiveLookupResult(null);
    setManualObvInput("");
    setLiveLookupError(null);
    setSavedCase(null);
  }

  // Handle Year change -> Resets fetched valuation
  function handleYearChange(newYear: number) {
    setYear(newYear);
    setLiveLookupResult(null);
    setManualObvInput("");
    setLiveLookupError(null);
    setSavedCase(null);
  }

  // Active Spectrum: only populated if OBV has been explicitly fetched or manually entered
  const activeSpectrum: SimulatedConditionSpectrum | null = useMemo(() => {
    if (liveLookupResult && liveLookupResult.conditions?.good) {
      return {
        good: liveLookupResult.conditions.good,
        veryGood: liveLookupResult.conditions.veryGood,
        excellent: liveLookupResult.conditions.excellent,
        benchmarkIdv: liveLookupResult.idv,
      };
    }
    const manualVal = Number(manualObvInput);
    if (Number.isFinite(manualVal) && manualVal > 1000) {
      const gMin = Math.round(manualVal * 0.92 * 0.97);
      const gMax = Math.round(manualVal * 0.92 * 1.03);
      const vgMin = Math.round(manualVal * 0.97);
      const vgMax = Math.round(manualVal * 1.03);
      const eMin = Math.round(manualVal * 1.07 * 0.97);
      const eMax = Math.round(manualVal * 1.07 * 1.03);
      return {
        good: { min: gMin, max: gMax, midpoint: Math.round((gMin + gMax) / 2), raw: `₹${gMin.toLocaleString("en-IN")} - ₹${gMax.toLocaleString("en-IN")}` },
        veryGood: { min: vgMin, max: vgMax, midpoint: manualVal, raw: `₹${vgMin.toLocaleString("en-IN")} - ₹${vgMax.toLocaleString("en-IN")}` },
        excellent: { min: eMin, max: eMax, midpoint: Math.round((eMin + eMax) / 2), raw: `₹${eMin.toLocaleString("en-IN")} - ₹${eMax.toLocaleString("en-IN")}` },
        benchmarkIdv: manualVal,
      };
    }
    return null;
  }, [liveLookupResult, manualObvInput]);

  const isObvFetched = activeSpectrum !== null;
  const activeBenchmarkIdv = activeSpectrum?.benchmarkIdv ?? null;

  // Decision & Allowance Analysis (only computed if OBV is fetched)
  const allowanceAnalysis: DecisionAllowanceAnalysis | null = useMemo(() => {
    if (!activeSpectrum || activeBenchmarkIdv === null) return null;
    return analyzeDecisionAllowance(
      requestedIdv,
      activeBenchmarkIdv,
      decisionConfig,
      activeSpectrum
    );
  }, [requestedIdv, activeBenchmarkIdv, decisionConfig, activeSpectrum]);

  // Quick Load Preset
  function applyPreset(preset: CorehubPreset) {
    setMake(preset.make);
    setModel(preset.model);
    setVariant(preset.variant);
    setYear(preset.year);
    setFuel(preset.fuel);
    setRequestedIdv(preset.requestedIdv);
    if (preset.benchmarkIdv && preset.conditions) {
      setLiveLookupResult({
        idv: preset.benchmarkIdv,
        conditions: {
          ...preset.conditions,
          benchmarkIdv: preset.benchmarkIdv,
        },
        sourceUrl: "https://www.orangebookvalue.com",
        latencyMs: 12,
        reasonCode: "PRESET_BENCHMARK",
      });
      setManualObvInput(String(preset.benchmarkIdv));
    } else {
      setLiveLookupResult(null);
      setManualObvInput("");
    }
    setLiveLookupError(null);
    setSavedCase(null);
  }

  // Quick Load Recent DB Case
  function applyDbCase(caseItem: RecentDbCase) {
    if (caseItem.make_raw) setMake(caseItem.make_raw);
    if (caseItem.model_raw) setModel(caseItem.model_raw);
    if (caseItem.variant_raw) setVariant(caseItem.variant_raw);
    if (caseItem.metadata?.yom) setYear(Number(caseItem.metadata.yom));
    if (caseItem.requested_idv) setRequestedIdv(Number(caseItem.requested_idv));
    setLiveLookupResult(null);
    setManualObvInput("");
    setLiveLookupError(null);
    setSavedCase(null);
  }

  // Run Live OBV Browser Scraper with progressive steps & condition logging
  async function runLiveObvLookup() {
    setIsLiveLoading(true);
    setLiveLookupError(null);
    setSavedCase(null);
    setActiveStepId(1);
    setLiveProgressPct(15);
    setElapsedMs(0);

    const startTime = Date.now();
    const nowTimeStr = () =>
      new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    setUnderwritingLogs((prev) => [
      ...prev,
      {
        id: `log-${Date.now()}-start`,
        time: nowTimeStr(),
        level: "info",
        message: `Launched browser automation for ${make} ${model} ${variant ? `· ${variant}` : ""} (${year}). Spawning Playwright session...`,
      },
    ]);

    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      setElapsedMs(elapsed);
      if (elapsed < 1800) {
        setActiveStepId(1);
        setLiveProgressPct(25);
      } else if (elapsed < 4800) {
        setActiveStepId(2);
        setLiveProgressPct(45);
      } else if (elapsed < 8500) {
        setActiveStepId(3);
        setLiveProgressPct(70);
      } else if (elapsed < 12500) {
        setActiveStepId(4);
        setLiveProgressPct(88);
      } else {
        setActiveStepId(5);
        setLiveProgressPct(95);
      }
    }, 150);

    try {
      const res = await fetch("/api/simulate/obv-live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          make,
          model,
          variant,
          year,
          kmsDriven,
        }),
      });

      const data = await res.json();
      clearInterval(timer);
      setElapsedMs(Date.now() - startTime);

      if (!res.ok || !data.success) {
        setActiveStepId(4);
        setLiveLookupError(
          data.message || data.error || "Could not query OrangeBookValue live. You can enter an estimated OBV benchmark manually."
        );
        setUnderwritingLogs((prev) => [
          ...prev,
          {
            id: `log-${Date.now()}-err`,
            time: nowTimeStr(),
            level: "warn",
            message: `OBV browser query unsuccessful: ${data.message || data.error || "Fallback to manual benchmark input."}`,
          },
        ]);
      } else {
        setActiveStepId(5);
        setLiveProgressPct(100);

        setLiveLookupResult({
          idv: data.idv,
          conditions: data.conditions,
          sourceUrl: data.sourceUrl,
          latencyMs: data.latencyMs,
          reasonCode: data.reasonCode,
        });
        setManualObvInput(String(data.idv));

        // Evaluate and log which condition is picked
        if (data.conditions) {
          const evalResult = analyzeDecisionAllowance(requestedIdv, data.idv, decisionConfig, data.conditions);
          setUnderwritingLogs((prev) => [
            ...prev,
            {
              id: `log-${Date.now()}-spectrum`,
              time: nowTimeStr(),
              level: "info",
              message: `Valuation Spectrum extracted: Good (${formatINR(data.conditions.good.min)} – ${formatINR(data.conditions.good.max)}), Very Good (${formatINR(data.conditions.veryGood.min)} – ${formatINR(data.conditions.veryGood.max)}), Excellent (${formatINR(data.conditions.excellent.min)} – ${formatINR(data.conditions.excellent.max)}). Benchmark: ${formatINR(data.idv)}.`,
            },
            {
              id: `log-${Date.now()}-picked`,
              time: nowTimeStr(),
              level: evalResult.isAllowed ? "success" : "warn",
              message: evalResult.pickedCondition
                ? `Condition Picked: [${evalResult.pickedConditionLabel?.toUpperCase()}] (Range: ${formatINR(evalResult.pickedConditionRange?.min ?? 0)} – ${formatINR(evalResult.pickedConditionRange?.max ?? 0)}). Decision: ALLOWED — AUTO APPROVED (Rule: ${evalResult.activeRule}).`
                : `Requested IDV ${formatINR(requestedIdv)} is outside condition tiers. Decision: ${evalResult.verdict.toUpperCase()} (Rule: ${evalResult.activeRule}).`,
            },
          ]);
        }
      }
    } catch (err: unknown) {
      clearInterval(timer);
      const msg = err instanceof Error ? err.message : String(err);
      setLiveLookupError(`Network or browser automation issue: ${msg}`);
      setUnderwritingLogs((prev) => [
        ...prev,
        {
          id: `log-${Date.now()}-exc`,
          time: nowTimeStr(),
          level: "warn",
          message: `Browser automation exception: ${msg}`,
        },
      ]);
    } finally {
      clearInterval(timer);
      setIsLiveLoading(false);
    }
  }

  // Persist current scenario to Supabase as an audited simulation case
  async function persistScenario() {
    if (!isObvFetched || !activeBenchmarkIdv) {
      setSaveError("Please fetch or enter an OBV valuation before persisting.");
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
          obvIdv: activeBenchmarkIdv,
          confidence,
          conditions: activeSpectrum,
          sourceUrl: liveLookupResult?.sourceUrl || "https://www.orangebookvalue.com",
          provider: liveLookupResult ? "obv-live-browser" : "obv-manual-entry",
          latencyMs: liveLookupResult?.latencyMs ?? 18,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || "Failed to persist simulation case.");
      } else {
        setSavedCase(data.case);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSaveError(msg);
    } finally {
      setIsSaving(false);
    }
  }

  // Micro adjustments
  function adjustRequestedIdv(delta: number) {
    setRequestedIdv((prev) => Math.max(10000, prev + delta));
  }

  // Boundary calculations (only when OBV is fetched)
  const minVal = allowanceAnalysis
    ? Math.min(allowanceAnalysis.minAllowedIdv, requestedIdv)
    : requestedIdv * 0.8;
  const maxVal = allowanceAnalysis
    ? Math.max(allowanceAnalysis.maxAllowedIdv, requestedIdv)
    : requestedIdv * 1.2;
  const span = Math.max(80000, maxVal - minVal);
  const margin = Math.max(40000, Math.round(span * 0.25));

  const sliderMin = Math.max(0, Math.round(minVal - margin));
  const sliderMax = Math.round(maxVal + margin);

  const corridorRange = Math.max(1, sliderMax - sliderMin);
  const getPercent = (val: number) => {
    const clamped = Math.max(sliderMin, Math.min(sliderMax, val));
    return ((clamped - sliderMin) / corridorRange) * 100;
  };

  const floorPct = allowanceAnalysis ? getPercent(allowanceAnalysis.minAllowedIdv) : 0;
  const ceilingPct = allowanceAnalysis ? getPercent(allowanceAnalysis.maxAllowedIdv) : 100;
  const benchmarkPct = activeBenchmarkIdv ? getPercent(activeBenchmarkIdv) : 50;
  const rawPinPct = getPercent(requestedIdv);

  // Boundary clamp between 9% and 91% to prevent text overflow at edges
  const visualPinPct = Math.max(9, Math.min(91, rawPinPct));

  return (
    <div style={{ display: "grid", gap: 20 }}>
      {/* ── TOP PRESET BAR: CoreHub Cases ── */}
      <section
        style={{
          background: "linear-gradient(135deg, #0b1324 0%, #1e293b 100%)",
          borderRadius: 14,
          padding: "16px 20px",
          color: "#f8fafc",
          boxShadow: "0 4px 14px rgba(0,0,0,0.12)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                background: "rgba(15, 118, 110, 0.35)",
                border: "1px solid #14b8a6",
                color: "#2dd4bf",
                padding: "3px 8px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <ShieldCheck size={13} />
              CoreHub Intake
            </span>
            <span style={{ fontSize: 14, fontWeight: 650 }}>
              Quick Fill from CoreHub Referral Queue
            </span>
          </div>

          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            Underwriting Tolerances: ±{formatINR(decisionConfig.absoluteTolerance)} or {decisionConfig.percentageTolerance}%
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {COREHUB_BENCHMARK_PRESETS.map((p) => {
            const isSelected =
              make === p.make &&
              model === p.model &&
              variant === p.variant &&
              requestedIdv === p.requestedIdv &&
              isObvFetched;

            return (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p)}
                style={{
                  background: isSelected
                    ? "#0f766e"
                    : "rgba(255, 255, 255, 0.08)",
                  border: isSelected
                    ? "1px solid #2dd4bf"
                    : "1px solid rgba(255, 255, 255, 0.14)",
                  color: "#f8fafc",
                  borderRadius: 8,
                  padding: "6px 12px",
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                <Car size={13} style={{ opacity: 0.85 }} />
                <span>
                  <strong>{p.model}</strong> {p.variant} ({p.year})
                </span>
                <span
                  style={{
                    background: isSelected
                      ? "#115e59"
                      : "rgba(255, 255, 255, 0.15)",
                    padding: "1px 6px",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  {formatINR(p.requestedIdv)}
                </span>
              </button>
            );
          })}

          {recentCases && recentCases.length > 0 && (
            <select
              aria-label="Load active referral from database"
              onChange={(e) => {
                const found = recentCases.find((c) => c.id === e.target.value);
                if (found) applyDbCase(found);
              }}
              style={{
                background: "rgba(255, 255, 255, 0.08)",
                border: "1px solid rgba(255, 255, 255, 0.2)",
                color: "#e2e8f0",
                borderRadius: 8,
                padding: "6px 10px",
                fontSize: 12,
                cursor: "pointer",
              }}
              defaultValue=""
            >
              <option value="" disabled style={{ background: "#1e293b", color: "#94a3b8" }}>
                Load from DB Referrals ({recentCases.length} available)
              </option>
              {recentCases.map((c) => (
                <option key={c.id} value={c.id} style={{ background: "#1e293b", color: "#f8fafc" }}>
                  {c.external_case_id} — {c.make_raw} {c.model_raw} ({formatINR(c.requested_idv ?? 0)})
                </option>
              ))}
            </select>
          )}
        </div>
      </section>

      {/* ── MAIN 2-COLUMN WORKBENCH ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          gap: 20,
          alignItems: "start",
        }}
      >
        {/* ── LEFT: Vehicle Identity & Parameters Form ── */}
        <section className="panel">
          <div className="panel-head">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Sliders size={16} color="#0f766e" />
              <div className="panel-title">Vehicle Parameters (CoreHub Intake)</div>
            </div>
            <span className="badge badge-info">Interactive Inputs</span>
          </div>

          <div style={{ padding: 20, display: "grid", gap: 14 }}>
            {/* Make & Model */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 600 }}>
                <span>Manufacturer / Make</span>
                <select
                  value={make}
                  onChange={(e) => handleMakeChange(e.target.value)}
                  style={{
                    height: 38,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "0 10px",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  {distinctMakes.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  <option value="Other">Other / Custom</option>
                </select>
              </label>

              <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 600 }}>
                <span>Model</span>
                {availableModels.length > 0 ? (
                  <select
                    value={model}
                    onChange={(e) => handleModelChange(e.target.value)}
                    style={{
                      height: 38,
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "0 10px",
                      background: "#fff",
                      cursor: "pointer",
                    }}
                  >
                    {availableModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    <option value="Fortuner">Fortuner</option>
                    <option value="Innova Crysta">Innova Crysta</option>
                    <option value="Scorpio-N">Scorpio-N</option>
                    <option value="XUV700">XUV700</option>
                    <option value="Other">Other / Custom</option>
                  </select>
                ) : (
                  <input
                    value={model}
                    onChange={(e) => handleModelChange(e.target.value)}
                    placeholder="e.g. Fortuner, Creta"
                    style={{
                      height: 38,
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      padding: "0 10px",
                    }}
                  />
                )}
              </label>
            </div>

            {/* Variant */}
            <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 600 }}>
              <span>Trim / Variant</span>
              {availableVariants.length > 0 ? (
                <select
                  value={variant}
                  onChange={(e) => handleVariantChange(e.target.value)}
                  style={{
                    height: 38,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "0 10px",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  {availableVariants.map((vr) => (
                    <option key={vr} value={vr}>
                      {vr}
                    </option>
                  ))}
                  <option value="Custom Variant">Custom Variant</option>
                </select>
              ) : (
                <input
                  value={variant}
                  onChange={(e) => handleVariantChange(e.target.value)}
                  placeholder="e.g. 2.7 4x2 AT, Zeta Petrol"
                  style={{
                    height: 38,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "0 10px",
                  }}
                />
              )}
            </label>

            {/* YOM & Fuel */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 600 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Calendar size={13} color="#64748b" /> Year of Manufacture (YOM)
                </span>
                <select
                  value={year}
                  onChange={(e) => handleYearChange(Number(e.target.value))}
                  style={{
                    height: 38,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "0 10px",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  {[2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016].map(
                    (y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    )
                  )}
                </select>
              </label>

              <label style={{ display: "grid", gap: 5, fontSize: 12, fontWeight: 600 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Fuel size={13} color="#64748b" /> Fuel Type
                </span>
                <select
                  value={fuel}
                  onChange={(e) => setFuel(e.target.value)}
                  style={{
                    height: 38,
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "0 10px",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  <option value="Petrol">Petrol</option>
                  <option value="Diesel">Diesel</option>
                  <option value="CNG">CNG</option>
                  <option value="Electric">Electric</option>
                </select>
              </label>
            </div>

            {/* Requested IDV Input with quick adjustment buttons */}
            <div
              style={{
                background: "#f8fafc",
                border: "1.5px solid #cbd5e1",
                borderRadius: 10,
                padding: "14px 16px",
                display: "grid",
                gap: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <label
                  htmlFor="requested-idv-input"
                  style={{ fontSize: 12, fontWeight: 700, color: "#1e293b" }}
                >
                  Requested IDV from Referral Case
                </label>
                <span
                  style={{
                    fontSize: 17,
                    fontWeight: 800,
                    color: "#0f766e",
                  }}
                >
                  {formatINR(requestedIdv)}
                </span>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  id="requested-idv-input"
                  type="number"
                  step="5000"
                  min="50000"
                  max="10000000"
                  value={requestedIdv}
                  onChange={(e) => setRequestedIdv(Number(e.target.value) || 0)}
                  style={{
                    flex: 1,
                    height: 42,
                    fontSize: 16,
                    fontWeight: 600,
                    border: "1px solid #94a3b8",
                    borderRadius: 8,
                    padding: "0 12px",
                    background: "#fff",
                  }}
                />

                {/* Micro Adjust Stepper Buttons */}
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => adjustRequestedIdv(-10000)}
                    title="Decrease by ₹10,000"
                    className="btn"
                    style={{ height: 42, padding: "0 8px", fontSize: 11, cursor: "pointer" }}
                  >
                    <Minus size={11} /> 10k
                  </button>
                  <button
                    type="button"
                    onClick={() => adjustRequestedIdv(10000)}
                    title="Increase by ₹10,000"
                    className="btn"
                    style={{ height: 42, padding: "0 8px", fontSize: 11, cursor: "pointer" }}
                  >
                    <Plus size={11} /> 10k
                  </button>
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>
                Amount proposed during policy intake. Test how adjustments affect auto-approval.
              </div>
            </div>

            {/* Optional Manual OBV Input */}
            <div
              style={{
                background: "#f1f5f9",
                border: "1px dashed #cbd5e1",
                borderRadius: 8,
                padding: "10px 14px",
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, fontWeight: 650, color: "#334155" }}>
                  Reference OBV Benchmark (Optional)
                </span>
                {isObvFetched && (
                  <span style={{ fontSize: 11, color: "#166534", fontWeight: 600 }}>
                    Active: {formatINR(activeBenchmarkIdv!)}
                  </span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="number"
                  placeholder="e.g. 2800000 (or click Run Live OBV)"
                  value={manualObvInput}
                  onChange={(e) => setManualObvInput(e.target.value)}
                  style={{
                    flex: 1,
                    height: 36,
                    fontSize: 13,
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: "0 10px",
                    background: "#fff",
                  }}
                />
                {manualObvInput && (
                  <button
                    type="button"
                    onClick={() => setManualObvInput("")}
                    className="btn"
                    style={{ height: 36, fontSize: 11, cursor: "pointer" }}
                  >
                    Clear
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: "#64748b" }}>
                Type an estimated OBV benchmark or click below to scrape real-time market data from OrangeBookValue.
              </div>
            </div>

            {/* Action Bar: Live Lookup & Persist */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                marginTop: 6,
                paddingTop: 12,
                borderTop: "1px solid var(--border)",
              }}
            >
              <button
                type="button"
                onClick={runLiveObvLookup}
                disabled={isLiveLoading}
                className="btn btn-primary"
                style={{
                  flex: 1,
                  justifyContent: "center",
                  cursor: isLiveLoading ? "not-allowed" : "pointer",
                }}
              >
                {isLiveLoading ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" />
                    Querying OrangeBookValue…
                  </>
                ) : (
                  <>
                    <Globe size={14} />
                    Run Live OBV via Browser
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={persistScenario}
                disabled={isSaving || !isObvFetched}
                className="btn"
                style={{
                  flex: 1,
                  justifyContent: "center",
                  cursor: isSaving || !isObvFetched ? "not-allowed" : "pointer",
                  opacity: !isObvFetched ? 0.6 : 1,
                }}
              >
                {isSaving ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" /> Saving…
                  </>
                ) : (
                  <>
                    <Save size={14} /> Persist as Case
                  </>
                )}
              </button>
            </div>

            {liveLookupError && (
              <div
                style={{
                  fontSize: 12,
                  color: "#b45309",
                  background: "#fffbeb",
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid #fde68a",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Info size={14} />
                <span>{liveLookupError}</span>
              </div>
            )}

            {savedCase && (
              <div
                style={{
                  fontSize: 12,
                  color: "#15803d",
                  background: "#f0fdf4",
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid #bbf7d0",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <CheckCircle2 size={15} color="#15803d" />
                  Persisted to database as Case <strong>{savedCase.external_case_id}</strong>
                </span>
                <Link
                  href={`/referrals/${savedCase.id}`}
                  style={{
                    color: "#15803d",
                    fontWeight: 700,
                    textDecoration: "underline",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  View Case <ArrowRight size={13} />
                </Link>
              </div>
            )}

            {saveError && (
              <div className="badge badge-danger" style={{ padding: "8px 12px" }}>
                Error saving: {saveError}
              </div>
            )}
          </div>
        </section>

        {/* ── RIGHT: Intelligent Decisioning & Allowance Analysis ── */}
        <div style={{ display: "grid", gap: 16 }}>
          {/* CASE 1: LIVE OBV AUTOMATION IN PROGRESS */}
          {isLiveLoading ? (
            <section
              style={{
                background: "#ffffff",
                border: "2px solid #3b82f6",
                borderRadius: 12,
                padding: "22px 20px",
                boxShadow: "0 4px 20px rgba(59, 130, 246, 0.12)",
                display: "grid",
                gap: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                  gap: 10,
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ position: "relative", display: "flex", height: 10, width: 10 }}>
                      <span
                        style={{
                          position: "absolute",
                          height: "100%",
                          width: "100%",
                          borderRadius: "50%",
                          background: "#3b82f6",
                          opacity: 0.75,
                          animation: "ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite",
                        }}
                      />
                      <span
                        style={{
                          position: "relative",
                          borderRadius: "50%",
                          height: 10,
                          width: 10,
                          background: "#2563eb",
                        }}
                      />
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        textTransform: "uppercase",
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        color: "#2563eb",
                      }}
                    >
                      Live Automation In Progress
                    </span>
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
                    Fetching Live OBV Valuation
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                    Querying real-time market tiers for <strong>{make} {model} {variant} ({year})</strong>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    background: "#eff6ff",
                    border: "1px solid #bfdbfe",
                    padding: "6px 12px",
                    borderRadius: 999,
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#1d4ed8",
                  }}
                >
                  <Clock3 size={14} className="animate-spin" />
                  <span>{(elapsedMs / 1000).toFixed(1)}s elapsed</span>
                </div>
              </div>

              {/* Progress Bar */}
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                    fontWeight: 650,
                    color: "#475569",
                    marginBottom: 6,
                  }}
                >
                  <span>OBV Extraction Pipeline</span>
                  <span>{Math.round(liveProgressPct)}% complete</span>
                </div>
                <div style={{ height: 8, background: "#e2e8f0", borderRadius: 999, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      width: `${liveProgressPct}%`,
                      background: "linear-gradient(90deg, #3b82f6, #6366f1, #10b981)",
                      transition: "width 0.3s ease",
                      borderRadius: 999,
                    }}
                  />
                </div>
              </div>

              {/* Step Items List */}
              <div style={{ display: "grid", gap: 8 }}>
                {OBV_AUTOMATION_STEPS.map((step) => {
                  const isDone = activeStepId > step.id;
                  const isCurrent = activeStepId === step.id;

                  return (
                    <div
                      key={step.id}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                        padding: "10px 12px",
                        borderRadius: 8,
                        background: isCurrent ? "#eff6ff" : isDone ? "#f8fafc" : "#fafafa",
                        border: `1px solid ${isCurrent ? "#93c5fd" : isDone ? "#e2e8f0" : "#f1f5f9"}`,
                        transition: "all 0.2s ease",
                      }}
                    >
                      <div style={{ marginTop: 2 }}>
                        {isDone ? (
                          <CheckCircle2 size={18} color="#16a34a" />
                        ) : isCurrent ? (
                          <RefreshCw size={18} color="#2563eb" className="animate-spin" />
                        ) : (
                          <div
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: "50%",
                              border: "2px solid #cbd5e1",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 10,
                              fontWeight: 700,
                              color: "#94a3b8",
                            }}
                          >
                            {step.id}
                          </div>
                        )}
                      </div>

                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div
                            style={{
                              fontSize: 13,
                              fontWeight: isCurrent ? 700 : 600,
                              color: isCurrent ? "#1e40af" : isDone ? "#1e293b" : "#64748b",
                            }}
                          >
                            Step {step.id}: {step.label}
                          </div>
                          {isCurrent && (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: "#2563eb",
                                background: "#dbeafe",
                                padding: "2px 6px",
                                borderRadius: 4,
                              }}
                            >
                              IN PROGRESS
                            </span>
                          )}
                          {isDone && (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                color: "#16a34a",
                                background: "#dcfce7",
                                padding: "2px 6px",
                                borderRadius: 4,
                              }}
                            >
                              COMPLETED
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: isCurrent ? "#2563eb" : "#64748b", marginTop: 2 }}>
                          {step.description}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : !isObvFetched ? (
            /* CASE 2: OBV NOT FETCHED YET */
            <section
              style={{
                background: "#ffffff",
                border: "1.5px solid #cbd5e1",
                borderRadius: 12,
                padding: "24px 20px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.03)",
                display: "grid",
                gap: 16,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      fontWeight: 700,
                      letterSpacing: "0.06em",
                      color: "#64748b",
                    }}
                  >
                    Underwriting Decision Verdict
                  </div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 800,
                      color: "#334155",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginTop: 4,
                    }}
                  >
                    <Clock3 size={22} color="#64748b" />
                    <span>Awaiting OBV Valuation</span>
                  </div>
                </div>

                <span
                  style={{
                    fontSize: 11,
                    padding: "3px 8px",
                    borderRadius: 999,
                    fontWeight: 650,
                    background: "#f1f5f9",
                    color: "#475569",
                  }}
                >
                  Valuation Not Fetched
                </span>
              </div>

              <div
                style={{
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: "16px",
                  fontSize: 13,
                  color: "#475569",
                  lineHeight: 1.5,
                }}
              >
                <div style={{ fontWeight: 650, color: "#1e293b", marginBottom: 4 }}>
                  Vehicle specified: {make} {model} {variant ? `· ${variant}` : ""} ({year})
                </div>
                <div>
                  OBV market data has not been retrieved for this vehicle yet. Click{" "}
                  <strong>Run Live OBV via Browser</strong> to fetch real-time market tiers and evaluate automated underwriting allowance corridors.
                </div>

                <div style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    onClick={runLiveObvLookup}
                    disabled={isLiveLoading}
                    className="btn btn-primary"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                  >
                    <Globe size={14} />
                    {isLiveLoading ? "Fetching OrangeBookValue…" : "Fetch Live OBV Valuation"}
                  </button>
                </div>
              </div>

              {/* Metrics grid in placeholder state */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: 10,
                  background: "#f8fafc",
                  padding: "12px",
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                }}
              >
                <div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>OBV Benchmark</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#94a3b8" }}>
                    —
                  </div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>Not fetched</div>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>Deviation Delta</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#94a3b8" }}>
                    —
                  </div>
                  <div style={{ fontSize: 10, color: "#94a3b8" }}>Pending valuation</div>
                </div>

                <div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>Policy Tolerance</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "#2563eb" }}>
                    ±{formatINR(decisionConfig.absoluteTolerance)}
                  </div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>
                    or {decisionConfig.percentageTolerance}% max
                  </div>
                </div>
              </div>
            </section>
          ) : (
            /* CASE 3: OBV FETCHED -> FULL DECISION & ALLOWANCE CORRIDOR */
            <>
              {/* 1. Primary Verdict Card */}
              <section
                style={{
                  background: "#fff",
                  border: `2px solid ${
                    allowanceAnalysis!.isAllowed ? "#22c55e" : "#f59e0b"
                  }`,
                  borderRadius: 12,
                  padding: "18px 20px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    marginBottom: 10,
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontSize: 11,
                        textTransform: "uppercase",
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        color: allowanceAnalysis!.isAllowed ? "#15803d" : "#b45309",
                      }}
                    >
                      Underwriting Decision Verdict
                    </div>
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 800,
                        color: allowanceAnalysis!.isAllowed ? "#15803d" : "#b45309",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 2,
                      }}
                    >
                      {allowanceAnalysis!.isAllowed ? (
                        <>
                          <CheckCircle2 size={24} />
                          <span>ALLOWED — AUTO APPROVED</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle size={24} />
                          <span>MANUAL REVIEW REQUIRED</span>
                        </>
                      )}
                    </div>
                  </div>

                  <span
                    style={{
                      fontSize: 12,
                      padding: "4px 10px",
                      borderRadius: 999,
                      fontWeight: 700,
                      background: allowanceAnalysis!.isAllowed ? "#dcfce7" : "#fef3c7",
                      color: allowanceAnalysis!.isAllowed ? "#166534" : "#92400e",
                    }}
                  >
                    Rule: {allowanceAnalysis!.activeRule.replaceAll("_", " ")}
                  </span>
                </div>

                {/* Picked Condition Banner */}
                {allowanceAnalysis!.pickedCondition && (
                  <div
                    style={{
                      marginTop: 8,
                      marginBottom: 12,
                      padding: "9px 13px",
                      borderRadius: 8,
                      background: "#ecfdf5",
                      border: "1.5px solid #86efac",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 8,
                      boxShadow: "0 1px 3px rgba(16, 185, 129, 0.08)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Zap size={16} color="#15803d" />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#166534" }}>
                          Condition Tier Picked: {allowanceAnalysis!.pickedConditionLabel}
                        </div>
                        {allowanceAnalysis!.pickedConditionRange && (
                          <div style={{ fontSize: 11, color: "#15803d" }}>
                            Valuation Range: {formatINR(allowanceAnalysis!.pickedConditionRange.min)} – {formatINR(allowanceAnalysis!.pickedConditionRange.max)}
                          </div>
                        )}
                      </div>
                    </div>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        background: "#16a34a",
                        color: "#fff",
                        padding: "3px 8px",
                        borderRadius: 999,
                        letterSpacing: "0.04em",
                      }}
                    >
                      STP Auto-Approved
                    </span>
                  </div>
                )}

                <p style={{ fontSize: 13, color: "#334155", lineHeight: 1.5, margin: "0 0 14px" }}>
                  {allowanceAnalysis!.recommendation}
                </p>

                {/* Metrics Breakdown Grid */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: 10,
                    background: "#f8fafc",
                    padding: "12px",
                    borderRadius: 8,
                    border: "1px solid #e2e8f0",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>OBV Benchmark</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                      {formatINR(activeBenchmarkIdv!)}
                    </div>
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>Very Good midpoint</div>
                  </div>

                  <div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>Deviation Delta</div>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 700,
                        color: allowanceAnalysis!.isAllowed ? "#166534" : "#b91c1c",
                      }}
                    >
                      {requestedIdv >= activeBenchmarkIdv! ? "+" : "-"}
                      {formatINR(allowanceAnalysis!.absoluteDelta)}
                    </div>
                    <div style={{ fontSize: 10, color: "#64748b" }}>
                      ({allowanceAnalysis!.percentageDelta.toFixed(2)}%)
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>Policy Tolerance</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#2563eb" }}>
                      ±{formatINR(allowanceAnalysis!.effectiveToleranceInr)}
                    </div>
                    <div style={{ fontSize: 10, color: "#64748b" }}>
                      Max(₹15k, {decisionConfig.percentageTolerance}%)
                    </div>
                  </div>
                </div>
              </section>

              {/* 2. Visual "Which IDVs Will Be Allowed?" Corridor Bar */}
              <section className="panel" style={{ padding: "18px 20px" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                    Auto-Approval Allowance Corridor
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      background: "#e0f2fe",
                      color: "#0369a1",
                      padding: "2px 8px",
                      borderRadius: 6,
                    }}
                  >
                    Permissible Underwriting Window
                  </span>
                </div>

                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 20 }}>
                  Any requested IDV falling within the highlighted green corridor is cleared for automated straight-through processing.
                </div>

                {/* Interactive Visual Corridor Bar with Padding & Overflow Safety */}
                <div style={{ position: "relative", margin: "34px 8px 36px" }}>
                  {/* Background Multi-Zone Track */}
                  <div
                    style={{
                      height: 16,
                      borderRadius: 999,
                      background: "#fee2e2",
                      position: "relative",
                      overflow: "hidden",
                      boxShadow: "inset 0 1px 2px rgba(0,0,0,0.1)",
                    }}
                  >
                    {/* Allowed Green Corridor */}
                    <div
                      style={{
                        position: "absolute",
                        left: `${floorPct}%`,
                        width: `${Math.max(2, ceilingPct - floorPct)}%`,
                        height: "100%",
                        background: "linear-gradient(90deg, #4ade80, #16a34a, #4ade80)",
                        boxShadow: "0 0 10px rgba(34, 197, 94, 0.4)",
                      }}
                    />
                  </div>

                  {/* Benchmark marker line */}
                  <div
                    style={{
                      position: "absolute",
                      left: `${benchmarkPct}%`,
                      top: -6,
                      bottom: -6,
                      width: 3,
                      background: "#312e81",
                      transform: "translateX(-50%)",
                      borderRadius: 2,
                      zIndex: 2,
                    }}
                    title="OBV Benchmark Midpoint"
                  />

                  {/* Requested IDV Pointer Pin with Visual Clamping */}
                  <div
                    style={{
                      position: "absolute",
                      left: `${visualPinPct}%`,
                      top: -30,
                      transform: "translateX(-50%)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      zIndex: 5,
                      transition: "left 0.15s ease",
                      pointerEvents: "none",
                    }}
                  >
                    <div
                      style={{
                        background: allowanceAnalysis!.isAllowed ? "#166534" : "#b91c1c",
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 700,
                        padding: "3px 8px",
                        borderRadius: 5,
                        whiteSpace: "nowrap",
                        boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <span>Requested</span>
                      <span>{formatINR(requestedIdv)}</span>
                    </div>
                    <div
                      style={{
                        width: 0,
                        height: 0,
                        borderLeft: "5px solid transparent",
                        borderRight: "5px solid transparent",
                        borderTop: `6px solid ${
                          allowanceAnalysis!.isAllowed ? "#166534" : "#b91c1c"
                        }`,
                      }}
                    />
                  </div>

                  {/* Labels below track */}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 11,
                      fontWeight: 600,
                      marginTop: 10,
                    }}
                  >
                    <div style={{ color: "#b91c1c" }}>
                      <div style={{ fontSize: 10, color: "#64748b" }}>Floor Limit</div>
                      <strong>{formatINR(allowanceAnalysis!.minAllowedIdv)}</strong>
                    </div>

                    <div style={{ color: "#312e81", textAlign: "center" }}>
                      <div style={{ fontSize: 10, color: "#64748b" }}>Benchmark</div>
                      <strong>{formatINR(activeBenchmarkIdv!)}</strong>
                    </div>

                    <div style={{ color: "#b91c1c", textAlign: "right" }}>
                      <div style={{ fontSize: 10, color: "#64748b" }}>Ceiling Limit</div>
                      <strong>{formatINR(allowanceAnalysis!.maxAllowedIdv)}</strong>
                    </div>
                  </div>
                </div>

                {/* Quick Snap Action */}
                {!allowanceAnalysis!.isAllowed && (
                  <div
                    style={{
                      marginTop: 14,
                      padding: "10px 14px",
                      background: "#fffbeb",
                      borderRadius: 8,
                      border: "1px solid #fde68a",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    <div style={{ fontSize: 12, color: "#92400e" }}>
                      Adjust IDV to <strong>{formatINR(allowanceAnalysis!.maxAllowedIdv)}</strong> to qualify for straight-through approval.
                    </div>
                    <button
                      type="button"
                      onClick={() => setRequestedIdv(allowanceAnalysis!.maxAllowedIdv)}
                      className="btn btn-primary"
                      style={{ height: 28, fontSize: 11, padding: "0 10px", cursor: "pointer" }}
                    >
                      Snap to Ceiling
                    </button>
                  </div>
                )}
              </section>

              {/* 3. Interactive Real-Time Sensitivity Slider */}
              <section className="panel" style={{ padding: "16px 20px" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                    What-If Sensitivity Testing
                  </div>
                  <span style={{ fontSize: 12, color: "#64748b" }}>
                    Drag slider to explore underwriting decisions in real time
                  </span>
                </div>

                <input
                  type="range"
                  min={sliderMin}
                  max={sliderMax}
                  step="1000"
                  value={requestedIdv}
                  onChange={(e) => setRequestedIdv(Number(e.target.value))}
                  style={{
                    width: "100%",
                    height: 32,
                    cursor: "pointer",
                    accentColor: allowanceAnalysis!.isAllowed ? "#166534" : "#b91c1c",
                  }}
                />

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 11,
                    color: "#64748b",
                  }}
                >
                  <span>Min test: {formatINR(sliderMin)}</span>
                  <span style={{ fontWeight: 700, color: "#0f172a", fontSize: 12 }}>
                    Current: {formatINR(requestedIdv)}
                  </span>
                  <span>Max test: {formatINR(sliderMax)}</span>
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {/* ── BOTTOM: OBV 3-Condition Tiers Evidence ── */}
      <section>
        {isObvFetched ? (
          <ConditionSpectrum
            conditions={activeSpectrum}
            requestedIdv={requestedIdv}
            sourceUrl={liveLookupResult?.sourceUrl || "https://www.orangebookvalue.com"}
          />
        ) : (
          <div
            style={{
              background: "#ffffff",
              border: "1px dashed #cbd5e1",
              borderRadius: 12,
              padding: "24px 20px",
              textAlign: "center",
              boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
            }}
          >
            <div style={{ display: "inline-flex", padding: 10, borderRadius: "50%", background: "#f1f5f9", marginBottom: 8 }}>
              <Compass size={22} color="#64748b" />
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1e293b" }}>
              OBV Condition Spectrum Evidence (Good · Very Good · Excellent)
            </div>
            <div style={{ fontSize: 12, color: "#64748b", maxWidth: 520, margin: "6px auto 14px" }}>
              Market valuation data has not been retrieved for <strong>{make} {model} ({year})</strong> yet. Run live OBV lookup to extract and compare the 3 insurable condition tiers.
            </div>
            <button
              type="button"
              onClick={runLiveObvLookup}
              disabled={isLiveLoading}
              className="btn btn-primary"
              style={{ display: "inline-flex", alignItems: "center", gap: 6, margin: "auto", cursor: "pointer" }}
            >
              <Globe size={14} />
              {isLiveLoading ? "Fetching OrangeBookValue…" : "Fetch Live OBV Valuation via Browser"}
            </button>
          </div>
        )}
      </section>

      {/* ── REAL-TIME UNDERWRITING & CONDITION DECISION LOG STREAM ── */}
      <section
        style={{
          background: "#0f172a",
          border: "1px solid #1e293b",
          borderRadius: 12,
          padding: "16px 20px",
          color: "#e2e8f0",
          boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
            borderBottom: "1px solid #334155",
            paddingBottom: 10,
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Terminal size={16} color="#38bdf8" />
            <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.02em", color: "#f8fafc" }}>
              Underwriting Telemetry & Condition Decision Log
            </span>
          </div>
          <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
            Audit trace & condition tier evaluation
          </span>
        </div>

        <div
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontSize: 12,
            lineHeight: 1.6,
            maxHeight: 180,
            overflowY: "auto",
            display: "grid",
            gap: 6,
          }}
        >
          {underwritingLogs.map((log) => (
            <div key={log.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ color: "#64748b", whiteSpace: "nowrap" }}>[{log.time}]</span>
              <span
                style={{
                  color:
                    log.level === "success"
                      ? "#4ade80"
                      : log.level === "warn"
                      ? "#fbbf24"
                      : "#38bdf8",
                  fontWeight: log.level === "success" ? 700 : 500,
                }}
              >
                {log.message}
              </span>
            </div>
          ))}
          {allowanceAnalysis && (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                borderTop: "1px dashed #334155",
                paddingTop: 6,
                marginTop: 4,
              }}
            >
              <span style={{ color: "#64748b", whiteSpace: "nowrap" }}>[ACTIVE VERDICT]</span>
              <span style={{ color: allowanceAnalysis.isAllowed ? "#4ade80" : "#f87171", fontWeight: 700 }}>
                {allowanceAnalysis.pickedCondition ? (
                  <>
                    Condition Picked: [{allowanceAnalysis.pickedConditionLabel?.toUpperCase()}] • Status:{" "}
                    {allowanceAnalysis.verdict.toUpperCase()} (Rule: {allowanceAnalysis.activeRule}) • Allowed Corridor:{" "}
                    {formatINR(allowanceAnalysis.minAllowedIdv)} to {formatINR(allowanceAnalysis.maxAllowedIdv)}
                  </>
                ) : (
                  <>
                    Status: {allowanceAnalysis.verdict.toUpperCase()} (Rule: {allowanceAnalysis.activeRule}) • Allowed
                    Corridor: {formatINR(allowanceAnalysis.minAllowedIdv)} to {formatINR(allowanceAnalysis.maxAllowedIdv)}
                  </>
                )}
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
