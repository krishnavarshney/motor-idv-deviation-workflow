/**
 * CoreHub Scraper — Playwright browser automation for corehub.kiwiinsurance.com.
 *
 * Workflow:
 * 1. Try loading a saved browser session (cookies/localStorage)
 * 2. Navigate to Referral tab — if the session is valid we skip login entirely
 * 3. If the session is expired or missing, perform a fresh login
 * 4. Save the session after every successful authentication
 * 5. List pending 4W proposals referred for IDV limits (columns mapped by header text)
 * 6. openReferral: click a row, read the vehicle from the quote API response (read-only)
 */

import type { Page, BrowserContext } from "playwright";
import type { CorehubSelectors, WorkerConfig } from "./config";
import { captureEvidence, type EvidenceArtifact } from "./evidence";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

export interface CorehubReferral {
  /** Proposal ID, e.g. P000000062392 */
  externalCaseId: string;
  registrationNumber: string | null;
  /** Vehicle fields below are null until openReferral reads the quote */
  quoteId: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  fuelType: string | null;
  cc: string | null;
  requestedIdv: number | null;
  /** Year of manufacture */
  yom: number | null;
  /** Listing row text by column header, for audit */
  rawValues: Record<string, string>;
  /** quote.vehicle_details as CoreHub returned it, for audit */
  vehicleDetails: Record<string, unknown> | null;
}

export interface CorehubScrapeResult {
  success: boolean;
  referrals: CorehubReferral[];
  evidence: EvidenceArtifact[];
  sessionReused: boolean;
  error?: string;
}

// ─── Session Persistence ────────────────────────────────────────────────

/**
 * Load a previously saved Playwright storage state (cookies + localStorage).
 * Returns the parsed state object, or null if no valid state file exists.
 */
function loadSavedSession(
  path: string
): ReturnType<typeof JSON.parse> | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf-8");
    const state = JSON.parse(raw);
    // Basic sanity check — must have a cookies array
    if (!Array.isArray(state?.cookies)) return null;
    console.log(
      `📂 Loaded saved session from ${path} (${state.cookies.length} cookies)`
    );
    return state;
  } catch (err) {
    console.warn(`⚠ Could not load session from ${path}:`, err);
    return null;
  }
}

/**
 * Save the current browser context's storage state to disk.
 */
async function saveSession(
  context: BrowserContext,
  path: string
): Promise<void> {
  try {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await context.storageState({ path });
    console.log(`💾 Session saved to ${path}`);
  } catch (err) {
    console.warn(`⚠ Could not save session to ${path}:`, err);
  }
}

/**
 * Check whether the current page looks like an authenticated CoreHub page
 * (i.e. NOT a login/auth page).
 */
async function isAuthenticated(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes("login") || url.includes("auth") || url.includes("signin")) {
    return false;
  }
  // Extra check — look for common login form indicators
  try {
    const hasLoginForm = await page
      .locator('input[type="password"]')
      .isVisible({ timeout: 1500 })
      .catch(() => false);
    return !hasLoginForm;
  } catch {
    return true; // Assume authenticated if we can't tell
  }
}

// ─── Login ──────────────────────────────────────────────────────────────

/**
 * Perform a fresh login to CoreHub.
 * Returns true on success, false on failure.
 */
async function loginToCorehub(
  page: Page,
  config: WorkerConfig,
  runId: string,
  evidence: EvidenceArtifact[]
): Promise<boolean> {
  const { corehubBaseUrl, corehubUsername, corehubPassword, corehubSelectors } =
    config;

  try {
    console.log("🔐 Navigating to CoreHub login...");
    await page.goto(corehubBaseUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.navigationTimeoutMs,
    });
    evidence.push(await captureEvidence(page, "corehub_login_page", runId));

    if (!corehubUsername || !corehubPassword) {
      if (!config.headless) {
        console.log("\n═══════════════════════════════════════════════════════════════");
        console.log("⚠️ No CoreHub credentials in .env, but browser is visible!");
        console.log("👉 Please log in manually in the opened browser window.");
        console.log("⏳ Waiting up to 90s for you to complete login...");
        console.log("═══════════════════════════════════════════════════════════════\n");

        const start = Date.now();
        while (Date.now() - start < 90000) {
          await page.waitForTimeout(2000);
          if (await isAuthenticated(page)) {
            console.log("🎉 Detected successful manual login!");
            evidence.push(
              await captureEvidence(page, "corehub_manual_login_success", runId)
            );
            return true;
          }
        }
        console.error("❌ Timed out waiting for manual login in browser.");
        return false;
      }

      console.error("\n❌ No active CoreHub session found and no credentials configured.");
      console.error("👉 Run 'npm run worker:login' once to log in via browser and save your session.\n");
      return false;
    }

    // Fill login form
    await page.waitForSelector(corehubSelectors.loginUsername, {
      timeout: 10000,
    });
    await page.fill(corehubSelectors.loginUsername, corehubUsername);
    await page.fill(corehubSelectors.loginPassword, corehubPassword);

    evidence.push(
      await captureEvidence(page, "corehub_login_filled", runId)
    );

    // Submit
    await page.click(corehubSelectors.loginSubmit);

    // Wait for navigation after login
    await page.waitForLoadState("domcontentloaded", {
      timeout: config.navigationTimeoutMs,
    });

    // Basic success check — if we're still on a login page, it failed
    const url = page.url();
    const bodyText = await page
      .locator("body")
      .innerText()
      .catch(() => "");
    const loginFailed =
      url.includes("login") ||
      bodyText.toLowerCase().includes("invalid credentials") ||
      bodyText.toLowerCase().includes("incorrect password");

    if (loginFailed) {
      evidence.push(
        await captureEvidence(page, "corehub_login_failed", runId)
      );
      return false;
    }

    evidence.push(
      await captureEvidence(page, "corehub_login_success", runId)
    );
    console.log("✅ CoreHub login successful");
    return true;
  } catch (err) {
    console.error("❌ CoreHub login error:", err);
    evidence.push(
      await captureEvidence(page, "corehub_login_error", runId, {
        error: String(err),
      })
    );
    return false;
  }
}

// ─── Table Extraction ───────────────────────────────────────────────────

/** First plausible 4-digit year in the value ("2021", "12/2021", "Mfg 2021"), else null. */
export function parseYom(raw: string | null): number | null {
  const year = Number(raw?.match(/\b(19|20)\d{2}\b/)?.[0]);
  return year >= 1990 && year <= new Date().getFullYear() + 1 ? year : null;
}

/** Only referrals this worker handles: pending four-wheeler proposals referred for IDV limits. */
export function isIdvDeviationReferral(row: Record<string, string>): boolean {
  return (
    /^P\d+$/.test(row["proposal / endo id"] ?? "") &&
    /^4w$/i.test(row["product"] ?? "") &&
    /pending/i.test(row["status"] ?? "") &&
    /\bidv\b/i.test(row["reason of nstp"] ?? "")
  );
}

/**
 * Read the referral listing. Cells are keyed by lower-cased header text
 * ("reg number", "proposal / endo id", "product", "reason of nstp", "status", ...).
 */
async function scrapeReferralTable(
  page: Page,
  selectors: CorehubSelectors,
  runId: string,
  evidence: EvidenceArtifact[]
): Promise<CorehubReferral[]> {
  console.log("📋 Extracting referral rows...");

  try {
    await page.waitForSelector(selectors.tableRow, { timeout: 15000 });
  } catch {
    console.warn("⚠ No referral rows found — table may be empty or selector mismatch");
    evidence.push(await captureEvidence(page, "corehub_no_rows", runId));
    return [];
  }

  // ponytail: first page only (20 rows, newest first). Page through if the queue outgrows it.
  const rows = await page.evaluate((rowSel) => {
    const headers = Array.from(document.querySelectorAll("table thead th")).map((th) =>
      (th as HTMLElement).innerText.trim().toLowerCase()
    );
    return Array.from(document.querySelectorAll(rowSel)).map((tr) =>
      Object.fromEntries(
        Array.from(tr.querySelectorAll("td")).map((td, i) => [headers[i] ?? `col${i}`, (td as HTMLElement).innerText.trim()])
      )
    );
  }, selectors.tableRow);

  const referrals: CorehubReferral[] = rows.filter(isIdvDeviationReferral).map((row) => ({
    externalCaseId: row["proposal / endo id"],
    registrationNumber: row["reg number"] && row["reg number"] !== "-" ? row["reg number"] : null,
    quoteId: null,
    make: null,
    model: null,
    variant: null,
    fuelType: null,
    cc: null,
    requestedIdv: null,
    yom: null,
    rawValues: row,
    vehicleDetails: null,
  }));
  console.log(`📊 ${rows.length} rows listed, ${referrals.length} pending 4W IDV referrals`);

  evidence.push(
    await captureEvidence(page, "corehub_referrals_extracted", runId, {
      rowCount: rows.length,
      extractedCount: referrals.length,
    })
  );

  return referrals;
}

type Quote = { id?: string; proposal_id?: string; vehicle_details?: Record<string, unknown> };

/** The quote object in an API body, if it belongs to this proposal (tolerates a {data: ...} wrapper). */
export function findQuote(body: unknown, proposalId: string): Quote | null {
  const b = body as { data?: unknown; result?: unknown } | null;
  for (const c of [b, b?.data, b?.result] as (Quote | null | undefined)[]) {
    if (c?.vehicle_details && c.proposal_id === proposalId) return c;
  }
  return null;
}

/** Vehicle fields from a CoreHub quote's vehicle_details. */
export function vehicleFromQuote(quote: Quote): Pick<CorehubReferral, "quoteId" | "make" | "model" | "variant" | "fuelType" | "requestedIdv" | "yom" | "vehicleDetails"> {
  const v = quote.vehicle_details ?? {};
  const str = (k: string) => (v[k] == null || v[k] === "" ? null : String(v[k]));
  return {
    quoteId: quote.id ?? null,
    make: str("make"),
    model: str("model"),
    variant: str("variant"),
    fuelType: str("fuel_type"),
    requestedIdv: Number(v.idv_value) || null,
    yom: parseYom(str("manufacture_year")),
    vehicleDetails: v,
  };
}

/**
 * Open a referral from the listing (read-only) and fill its vehicle fields from the quote API
 * response the review page loads.
 */
export async function openReferral(page: Page, config: WorkerConfig, referral: CorehubReferral): Promise<CorehubReferral> {
  await page.goto(config.corehubReferralUrl, { waitUntil: "domcontentloaded", timeout: config.navigationTimeoutMs });
  const row = page.locator(config.corehubSelectors.tableRow).filter({ hasText: referral.externalCaseId }).first();
  await row.waitFor({ timeout: 15000 });

  const quoteResponse = page.waitForResponse(
    async (r) =>
      ["xhr", "fetch"].includes(r.request().resourceType()) &&
      !!findQuote(await r.json().catch(() => null), referral.externalCaseId),
    { timeout: config.navigationTimeoutMs }
  );
  await row.click();
  const quote = findQuote(await (await quoteResponse).json(), referral.externalCaseId)!;
  return { ...referral, ...vehicleFromQuote(quote) };
}

// ─── Main Entry ─────────────────────────────────────────────────────────

/**
 * Main entry: scrape CoreHub for referral data.
 *
 * Session strategy:
 * 1. If a saved session file exists, restore it into the browser context.
 * 2. Navigate directly to the Referral page.
 * 3. If we land on an authenticated page → session is still valid → skip login.
 * 4. If we land on login → session expired → perform fresh login → save session.
 */
export async function scrapeCorehub(
  page: Page,
  context: BrowserContext,
  config: WorkerConfig,
  runId: string,
  /** Optional progress hook, called at each real checkpoint (label is user-facing). */
  onStep?: (label: string) => void | Promise<void>
): Promise<CorehubScrapeResult> {
  const evidence: EvidenceArtifact[] = [];
  let sessionReused = false;
  // Progress reporting must never break the scrape.
  const step = async (label: string) => {
    try {
      await onStep?.(label);
    } catch {}
  };

  // ── Try using saved session ────────────────────────────────────
  const savedState = loadSavedSession(config.sessionStoragePath);

  if (savedState) {
    // Restore cookies into the running context
    try {
      await context.addCookies(savedState.cookies ?? []);
      console.log("🍪 Restored saved cookies into browser context");
    } catch (err) {
      console.warn("⚠ Could not restore cookies:", err);
    }
  }

  // Navigate to referral page — if session is valid we'll land there directly
  try {
    console.log("🔗 Navigating to Referral tab...");
    await step("Opening CoreHub referral tab");
    await page.goto(config.corehubReferralUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.navigationTimeoutMs,
    });
  } catch (err) {
    return {
      success: false,
      referrals: [],
      evidence,
      sessionReused: false,
      error: `Failed to navigate to CoreHub: ${err}`,
    };
  }

  // ── Check if session is still valid ────────────────────────────
  const alreadyAuthed = await isAuthenticated(page);

  if (alreadyAuthed) {
    console.log("✅ Saved session is valid — skipping login");
    await step("Reusing saved CoreHub session");
    sessionReused = true;
    evidence.push(
      await captureEvidence(page, "corehub_session_reused", runId)
    );
  } else {
    // Session expired or missing — do a fresh login
    console.log("🔄 Session expired or missing — performing fresh login");
    await step("Signing in to CoreHub");
    const loggedIn = await loginToCorehub(page, config, runId, evidence);

    if (!loggedIn) {
      return {
        success: false,
        referrals: [],
        evidence,
        sessionReused: false,
        error: "CoreHub login failed — check credentials or selectors",
      };
    }

    // Save the session for future runs
    await saveSession(context, config.sessionStoragePath);

    // Navigate to Referral tab after login
    try {
      await page.goto(config.corehubReferralUrl, {
        waitUntil: "domcontentloaded",
        timeout: config.navigationTimeoutMs,
      });
    } catch (err) {
      return {
        success: false,
        referrals: [],
        evidence,
        sessionReused: false,
        error: `Failed to navigate to Referral tab after login: ${err}`,
      };
    }
  }

  evidence.push(
    await captureEvidence(page, "corehub_referral_tab", runId)
  );

  // ── Extract referral rows ──────────────────────────────────────
  await step("Reading referral rows");
  const referrals = await scrapeReferralTable(
    page,
    config.corehubSelectors,
    runId,
    evidence
  );

  // Save session again after a successful scrape (refreshes any token timestamps)
  await saveSession(context, config.sessionStoragePath);

  return { success: true, referrals, evidence, sessionReused };
}
