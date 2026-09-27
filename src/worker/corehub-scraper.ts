/**
 * CoreHub Scraper — Playwright browser automation for corehub.kiwiinsurance.com.
 *
 * Workflow:
 * 1. Try loading a saved browser session (cookies/localStorage)
 * 2. Navigate to Referral tab — if the session is valid we skip login entirely
 * 3. If the session is expired or missing, perform a fresh login
 * 4. Save the session after every successful authentication
 * 5. Extract referral rows using configurable selectors
 * 6. Return structured referral data
 */

import type { Page, BrowserContext } from "playwright";
import type { CorehubSelectors, WorkerConfig } from "./config";
import { captureEvidence, type EvidenceArtifact } from "./evidence";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

export interface CorehubReferral {
  /** Stable external case identifier from CoreHub */
  externalCaseId: string;
  registrationNumber: string | null;
  make: string | null;
  model: string | null;
  variant: string | null;
  fuelType: string | null;
  cc: string | null;
  requestedIdv: number | null;
  /** Raw text values before parsing, for audit */
  rawValues: Record<string, string>;
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

/**
 * Extract cell text from a row using the given selector.
 * Returns trimmed text or null.
 */
async function cellText(
  row: ReturnType<Page["locator"]>,
  selector: string
): Promise<string | null> {
  try {
    const el = row.locator(selector).first();
    const text = await el.innerText({ timeout: 2000 });
    return text?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Parse a string to a number, returning null if not valid.
 */
function parseIdv(raw: string | null): number | null {
  if (!raw) return null;
  // Remove currency symbols, commas, spaces
  const cleaned = raw.replace(/[₹,\s]/g, "");
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

/**
 * Scrape the CoreHub Referral tab for referral rows.
 */
async function scrapeReferralTable(
  page: Page,
  selectors: CorehubSelectors,
  runId: string,
  evidence: EvidenceArtifact[]
): Promise<CorehubReferral[]> {
  console.log("📋 Extracting referral rows...");

  // Wait for the table to appear
  try {
    await page.waitForSelector(selectors.tableRow, { timeout: 15000 });
  } catch {
    console.warn("⚠ No referral rows found — table may be empty or selector mismatch");
    evidence.push(
      await captureEvidence(page, "corehub_no_rows", runId)
    );
    return [];
  }

  const rows = page.locator(selectors.tableRow);
  const count = await rows.count();
  console.log(`📊 Found ${count} referral rows`);

  const referrals: CorehubReferral[] = [];

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);

    const rawCaseId = await cellText(row, selectors.caseId);
    if (!rawCaseId) continue; // Skip rows without a case ID

    const rawReg = await cellText(row, selectors.registration);
    const rawMake = await cellText(row, selectors.make);
    const rawModel = await cellText(row, selectors.model);
    const rawVariant = await cellText(row, selectors.variant);
    const rawFuel = await cellText(row, selectors.fuel);
    const rawCc = await cellText(row, selectors.cc);
    const rawIdv = await cellText(row, selectors.requestedIdv);

    referrals.push({
      externalCaseId: rawCaseId,
      registrationNumber: rawReg,
      make: rawMake,
      model: rawModel,
      variant: rawVariant,
      fuelType: rawFuel,
      cc: rawCc,
      requestedIdv: parseIdv(rawIdv),
      rawValues: {
        caseId: rawCaseId ?? "",
        registration: rawReg ?? "",
        make: rawMake ?? "",
        model: rawModel ?? "",
        variant: rawVariant ?? "",
        fuel: rawFuel ?? "",
        cc: rawCc ?? "",
        requestedIdv: rawIdv ?? "",
      },
    });
  }

  evidence.push(
    await captureEvidence(page, "corehub_referrals_extracted", runId, {
      rowCount: count,
      extractedCount: referrals.length,
    })
  );

  return referrals;
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
  runId: string
): Promise<CorehubScrapeResult> {
  const evidence: EvidenceArtifact[] = [];
  let sessionReused = false;

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
    sessionReused = true;
    evidence.push(
      await captureEvidence(page, "corehub_session_reused", runId)
    );
  } else {
    // Session expired or missing — do a fresh login
    console.log("🔄 Session expired or missing — performing fresh login");
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
