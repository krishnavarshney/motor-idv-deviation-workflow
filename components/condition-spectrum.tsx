"use client";

import React from "react";
import { CheckCircle2, Zap } from "lucide-react";

export interface ConditionRange {
  min: number;
  max: number;
  midpoint: number;
  raw: string;
}

export interface ConditionSpectrumProps {
  conditions?: {
    good?: ConditionRange;
    veryGood?: ConditionRange;
    excellent?: ConditionRange;
  } | null;
  requestedIdv?: number | null;
  sourceUrl?: string | null;
}

function formatINR(amount: number): string {
  return "₹" + amount.toLocaleString("en-IN");
}

export function ConditionSpectrum({
  conditions,
  requestedIdv,
  sourceUrl,
}: ConditionSpectrumProps) {
  if (!conditions || (!conditions.good && !conditions.veryGood && !conditions.excellent)) {
    return null;
  }

  const tiers = [
    {
      key: "good" as const,
      label: "Good Condition",
      badgeColor: "#0284c7",
      bgColor: "#f0f9ff",
      borderColor: "#bae6fd",
      dotColor: "#38bdf8",
      data: conditions.good,
    },
    {
      key: "veryGood" as const,
      label: "Very Good Condition",
      isBenchmark: true,
      badgeColor: "#6366f1",
      bgColor: "#eef2ff",
      borderColor: "#c7d2fe",
      dotColor: "#818cf8",
      data: conditions.veryGood,
    },
    {
      key: "excellent" as const,
      label: "Excellent Condition",
      badgeColor: "#059669",
      bgColor: "#ecfdf5",
      borderColor: "#a7f3d0",
      dotColor: "#34d399",
      data: conditions.excellent,
    },
  ];

  // Determine where requestedIdv sits
  let matchingTier: string | null = null;
  if (requestedIdv && requestedIdv > 0) {
    if (
      conditions.excellent &&
      requestedIdv >= conditions.excellent.min &&
      requestedIdv <= conditions.excellent.max
    ) {
      matchingTier = "Excellent Condition";
    } else if (
      conditions.veryGood &&
      requestedIdv >= conditions.veryGood.min &&
      requestedIdv <= conditions.veryGood.max
    ) {
      matchingTier = "Very Good Condition";
    } else if (
      conditions.good &&
      requestedIdv >= conditions.good.min &&
      requestedIdv <= conditions.good.max
    ) {
      matchingTier = "Good Condition";
    }
  }

  return (
    <div
      style={{
        marginTop: 20,
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: "18px 20px",
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#0f172a",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span>OBV Condition Spectrum Evidence</span>
            <span
              style={{
                fontSize: 11,
                padding: "2px 8px",
                background: "#f1f5f9",
                borderRadius: 999,
                fontWeight: 600,
                color: "#475569",
              }}
            >
              3-Tier Valuation
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            Extracted from OrangeBookValue.com market data across condition tiers
          </div>
        </div>

        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              fontSize: 12,
              color: "#2563eb",
              textDecoration: "none",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontWeight: 500,
            }}
          >
            View on OBV ↗
          </a>
        )}
      </div>

      {matchingTier && (
        <div
          style={{
            marginBottom: 14,
            padding: "9px 14px",
            background: "#ecfdf5",
            border: "1.5px solid #86efac",
            borderRadius: 8,
            fontSize: 12,
            color: "#065f46",
            display: "flex",
            alignItems: "center",
            gap: 8,
            boxShadow: "0 1px 3px rgba(16, 185, 129, 0.1)",
          }}
        >
          <CheckCircle2 size={16} color="#15803d" />
          <span>
            Requested IDV <strong>{formatINR(requestedIdv!)}</strong> matches the{" "}
            <strong>{matchingTier}</strong> market valuation bracket. Automatically eligible for straight-through approval.
          </span>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        {tiers.map((t) => {
          if (!t.data) return null;
          const isSelected = matchingTier === t.label;

          return (
            <div
              key={t.key}
              style={{
                background: t.bgColor,
                border: isSelected ? "2px solid #16a34a" : `1.5px solid ${t.borderColor}`,
                borderRadius: 10,
                padding: "14px 16px",
                position: "relative",
                transition: "all 0.2s ease",
                boxShadow: isSelected ? "0 0 0 3px rgba(22, 163, 74, 0.2)" : "none",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 8,
                  flexWrap: "wrap",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    color: isSelected ? "#15803d" : t.badgeColor,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: isSelected ? "#16a34a" : t.dotColor,
                      display: "inline-block",
                    }}
                  />
                  {t.label}
                </div>

                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  {isSelected && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        background: "#dcfce7",
                        color: "#15803d",
                        padding: "2px 7px",
                        borderRadius: 4,
                        border: "1px solid #86efac",
                        display: "flex",
                        alignItems: "center",
                        gap: 3,
                      }}
                    >
                      <Zap size={10} /> Auto-Approved
                    </span>
                  )}
                  {t.isBenchmark && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        background: "#e0e7ff",
                        color: "#4338ca",
                        padding: "2px 6px",
                        borderRadius: 4,
                      }}
                    >
                      Benchmark
                    </span>
                  )}
                </div>
              </div>

              <div style={{ marginTop: 6 }}>
                <div style={{ fontSize: 11, color: "#64748b" }}>Valuation Range</div>
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: "#0f172a",
                    marginTop: 2,
                  }}
                >
                  {formatINR(t.data.min)} – {formatINR(t.data.max)}
                </div>
              </div>

              <div
                style={{
                  marginTop: 8,
                  paddingTop: 8,
                  borderTop: `1px solid ${t.borderColor}`,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 11,
                }}
              >
                <span style={{ color: "#64748b" }}>Midpoint:</span>
                <span style={{ fontWeight: 700, color: "#1e293b" }}>
                  {formatINR(t.data.midpoint)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
