/**
 * Evidence capture utilities for the Playwright worker.
 * Screenshots and page metadata are captured at each significant step.
 */

import type { Page } from "playwright";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";

export interface EvidenceArtifact {
  step: string;
  url: string;
  timestamp: string;
  screenshotPath?: string;
  metadata?: Record<string, unknown>;
}

const EVIDENCE_DIR = join(
  process.cwd(),
  "evidence",
  new Date().toISOString().slice(0, 10)
);

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Capture a screenshot and return an evidence artifact object.
 */
export async function captureEvidence(
  page: Page,
  step: string,
  runId: string,
  extra?: Record<string, unknown>
): Promise<EvidenceArtifact> {
  const runDir = join(EVIDENCE_DIR, runId);
  ensureDir(runDir);

  const safeStep = step.replace(/[^a-z0-9_-]/gi, "_").slice(0, 60);
  const filename = `${safeStep}_${Date.now()}.png`;
  const screenshotPath = join(runDir, filename);

  try {
    await page.screenshot({ path: screenshotPath, fullPage: false });
  } catch (err) {
    console.warn(`⚠ Screenshot failed for step "${step}":`, err);
  }

  return {
    step,
    url: page.url(),
    timestamp: new Date().toISOString(),
    screenshotPath,
    metadata: extra,
  };
}

/**
 * Capture just the metadata without a screenshot (for lightweight logging).
 */
export function createEvidenceRecord(
  step: string,
  url: string,
  extra?: Record<string, unknown>
): EvidenceArtifact {
  return {
    step,
    url,
    timestamp: new Date().toISOString(),
    metadata: extra,
  };
}
