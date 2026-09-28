/**
 * CoreHub Scraper — Playwright browser automation for corehub.kiwiinsurance.com.
 *
 * Workflow:
 * 1. Try loading a saved browser session (cookies/localStorage)
 * 2. Navigate to Referral tab — if the session is valid we skip login entirely
 * 3. If the session is expired or missing, perform a fresh login
 * 4. Save the session after every successful authentication
 * 5. List pending 4W proposals referred for IDV limits across every listing page
 *    (columns mapped by header text; quote IDs picked up from the listing API)
 * 6. openReferral: open the review page, read the quote API response and the page fields (read-only)
 * 7. performCorehubAction: Approve/Reject on the review page — only for a person-confirmed action
 */

import type { Page, BrowserContext } from "playwright";
import type { CorehubSelectors, WorkerConfig } from "./config";
import type { QuoteSnapshot, ReviewPage } from "./corehub-checks";
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
  quoteStatus: string | null;
  /** CoreHub's own allowed IDV range for this vehicle (quote.idv.min/max) */
  idvRange: { min: number; max: number } | null;
  /** Fields as the review page renders them */
  review: ReviewPage | null;
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
const MAX_LISTING_PAGES = 50;

async function scrapeReferralTable(
  page: Page,
  selectors: CorehubSelectors,
  runId: string,
  evidence: EvidenceArtifact[],
  onPage?: (pageNo: number, rowsSoFar: number) => void
): Promise<CorehubReferral[]> {
  console.log("📋 Extracting referral rows...");

  try {
    await page.waitForSelector(selectors.tableRow, { timeout: 15000 });
  } catch {
    console.warn("⚠ No referral rows found — table may be empty or selector mismatch");
    evidence.push(await captureEvidence(page, "corehub_no_rows", runId));
    return [];
  }

  const readRows = () =>
    page.evaluate((rowSel) => {
      const headers = Array.from(document.querySelectorAll("table thead th")).map((th) =>
        (th as HTMLElement).innerText.trim().toLowerCase()
      );
      return Array.from(document.querySelectorAll(rowSel)).map((tr) =>
        Object.fromEntries(
          Array.from(tr.querySelectorAll("td")).map((td, i) => [headers[i] ?? `col${i}`, (td as HTMLElement).innerText.trim()])
        )
      );
    }, selectors.tableRow);

  // Walk every page: click Next until it is disabled or a page brings no new proposals.
  const byId = new Map<string, Record<string, string>>();
  for (let pageNo = 1; pageNo <= MAX_LISTING_PAGES; pageNo++) {
    const pageRows = await readRows();
    const before = byId.size;
    for (const r of pageRows) byId.set(r["proposal / endo id"] ?? `row-${byId.size}`, r);
    onPage?.(pageNo, byId.size);
    if (byId.size === before && pageNo > 1) break;

    const next = page.locator("button, a").filter({ hasText: /^\s*next\s*$/i }).first();
    const canNext =
      (await next.count()) > 0 &&
      (await next.isEnabled().catch(() => false)) &&
      (await next.getAttribute("aria-disabled")) !== "true";
    if (!canNext) break;
    const firstId = pageRows[0]?.["proposal / endo id"];
    await next.click();
    // The table re-renders in place; wait until the first row changes.
    await page
      .waitForFunction(
        ([sel, id]) => {
          const cell = document.querySelector(sel as string)?.querySelector("td:nth-child(2)");
          return !!cell && (cell as HTMLElement).innerText.trim() !== id;
        },
        [selectors.tableRow, firstId ?? ""],
        { timeout: 10000 }
      )
      .catch(() => {});
  }
  const rows = [...byId.values()];

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
    quoteStatus: null,
    idvRange: null,
    review: null,
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

type Quote = {
  id?: string;
  proposal_id?: string;
  quote_status?: string;
  vehicle_details?: Record<string, unknown>;
  idv?: { min?: number; max?: number };
};

/**
 * The quote object for this proposal anywhere in an API body. CoreHub's review page gets it from
 * POST /api/v1/motor/quote/resume as `data.quote_info`; searching a few levels deep keeps this
 * working if the wrapper moves.
 */
export function findQuote(body: unknown, proposalId: string, depth = 0): Quote | null {
  if (!body || typeof body !== "object" || depth > 4) return null;
  const c = body as Quote;
  if (c.vehicle_details && c.proposal_id === proposalId) return c;
  for (const v of Object.values(body as Record<string, unknown>)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const found = findQuote(v, proposalId, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Proposal → quote IDs found anywhere in a JSON body: any object holding a proposal ID (P…) and a
 * quote ID (Q…). The listing API's shape isn't documented, so this walks it instead of guessing keys.
 */
export function quoteIdsFromBody(body: unknown, out = new Map<string, string>()): Map<string, string> {
  if (Array.isArray(body)) body.forEach((b) => quoteIdsFromBody(b, out));
  else if (body && typeof body === "object") {
    const values = Object.values(body as Record<string, unknown>);
    const p = values.find((v) => typeof v === "string" && /^P\d{6,}$/.test(v)) as string | undefined;
    const q = values.find((v) => typeof v === "string" && /^Q\d{6,}$/.test(v)) as string | undefined;
    if (p && q && !out.has(p)) out.set(p, q);
    values.forEach((v) => typeof v === "object" && quoteIdsFromBody(v, out));
  }
  return out;
}

/** Vehicle fields from a CoreHub quote. */
export function vehicleFromQuote(quote: Quote): Omit<QuoteSnapshot, "review"> & { vehicleDetails: Record<string, unknown> } {
  const v = quote.vehicle_details ?? {};
  const str = (k: string) => (v[k] == null || v[k] === "" ? null : String(v[k]));
  const min = Number(quote.idv?.min);
  const max = Number(quote.idv?.max);
  return {
    quoteId: quote.id ?? null,
    quoteStatus: quote.quote_status ?? null,
    make: str("make"),
    model: str("model"),
    variant: str("variant"),
    fuelType: str("fuel_type"),
    requestedIdv: Number(v.idv_value) || null,
    yom: parseYom(str("manufacture_year")),
    idvRange: min > 0 && max > 0 ? { min, max } : null,
    vehicleDetails: v,
  };
}

export const reviewUrl = (config: WorkerConfig, quoteId: string, proposalId: string) =>
  `${config.corehubBaseUrl.replace(/\/$/, "")}/proposals/${encodeURIComponent(quoteId)}/${encodeURIComponent(proposalId)}/review`;

/** Header and label/value rows as the review page renders them. */
async function readReviewPage(page: Page): Promise<ReviewPage> {
  await page.locator("[role=row]").filter({ hasText: /^\s*IDV/ }).first().waitFor({ timeout: 10000 });
  return page.evaluate(() => {
    const titleEl = document.querySelector('[data-variant="label-0"]') as HTMLElement | null;
    const fields: Record<string, string> = {};
    for (const row of Array.from(document.querySelectorAll("[role=row]"))) {
      const cells = Array.from(row.children).map((c) => (c as HTMLElement).innerText.trim());
      if (cells.length === 2 && cells[0] && !(cells[0] in fields)) fields[cells[0]] = cells[1];
    }
    return {
      url: location.href,
      title: titleEl?.innerText.trim() ?? null,
      subtitle: (titleEl?.parentElement?.querySelector("p") as HTMLElement | null)?.innerText.trim() ?? null,
      fields,
    };
  });
}

/**
 * Open a referral's review page (read-only) and fill its vehicle fields from the quote API response,
 * plus the fields the page itself shows. Goes straight to the review URL when the quote ID is known,
 * otherwise clicks the row on the first listing page.
 */
export async function openReferral(page: Page, config: WorkerConfig, referral: CorehubReferral): Promise<CorehubReferral> {
  // The review page loads the quote ~10-15s in (POST /api/v1/motor/quote/resume), so allow extra time.
  const quoteTimeout = Math.max(config.navigationTimeoutMs, 45000);
  const quoteResponse = page.waitForResponse(
    async (r) =>
      ["xhr", "fetch"].includes(r.request().resourceType()) &&
      !!findQuote(await r.json().catch(() => null), referral.externalCaseId),
    { timeout: quoteTimeout }
  );
  quoteResponse.catch(() => {}); // surfaced below; don't leak an unhandled rejection if navigation throws first

  if (referral.quoteId) {
    await page.goto(reviewUrl(config, referral.quoteId, referral.externalCaseId), {
      waitUntil: "domcontentloaded",
      timeout: config.navigationTimeoutMs,
    });
  } else {
    await page.goto(config.corehubReferralUrl, { waitUntil: "domcontentloaded", timeout: config.navigationTimeoutMs });
    const row = page.locator(config.corehubSelectors.tableRow).filter({ hasText: referral.externalCaseId }).first();
    await row.waitFor({ timeout: 15000 });
    await row.click();
  }
  // Fallback: the review page also prints the quote JSON in a <pre> block.
  const quote =
    (await quoteResponse.then(async (r) => findQuote(await r.json(), referral.externalCaseId)).catch(() => null)) ??
    (await page
      .locator("pre")
      .filter({ hasText: referral.externalCaseId })
      .first()
      .textContent({ timeout: 5000 })
      .then((t) => findQuote(JSON.parse(t ?? ""), referral.externalCaseId))
      .catch(() => null));
  if (!quote) throw new Error(`Quote for ${referral.externalCaseId} not found in the review page's API responses or page JSON`);
  const review = await readReviewPage(page).catch(() => null);
  return { ...referral, ...vehicleFromQuote(quote), review };
}

export interface ActionLogLine {
  at: string;
  msg: string;
  data?: unknown;
}

export interface ActionOutcome {
  outcome: "submitted" | "rehearsed";
  write: { method: string; url: string; status: number; body: unknown } | null;
}

/**
 * Approve or Reject the referral open on its review page. Dry run opens the confirmation dialog
 * and cancels it. Live submits and waits for CoreHub's write request; a non-2xx response throws.
 * CoreHub cannot undo this — callers run it only for an action a person confirmed.
 */
export async function performCorehubAction(
  page: Page,
  config: WorkerConfig,
  a: { action: "approve" | "reject"; reason: string | null; dryRun: boolean },
  log: (msg: string, data?: unknown) => void
): Promise<ActionOutcome> {
  const label = a.action === "approve" ? "Approve" : "Reject";
  // The page renders a second, hidden action bar; click only the visible button.
  await page.getByRole("button", { name: label, exact: true }).filter({ visible: true }).first().click();
  // Scope everything to the "<Label> proposal?" dialog so no other button on the page can be hit.
  const heading = page.getByRole("heading", { name: `${label} proposal?`, exact: true });
  await heading.waitFor({ timeout: 10000 });
  const dialog = page
    .locator("div")
    .filter({ has: heading })
    .filter({ has: page.getByRole("button", { name: `Yes, ${label}`, exact: true }) })
    .last(); // innermost match
  const confirm = dialog.getByRole("button", { name: `Yes, ${label}`, exact: true });
  const prompt = await dialog.locator("p").first().innerText().catch(() => "");
  log(`Opened "${label} proposal?" dialog`, { prompt });

  if (a.action === "reject") {
    const reason = (a.reason ?? "").trim();
    if (reason.length < 3) throw new Error("Rejection reason is empty");
    await dialog.locator('textarea[placeholder^="Type a comment"]').fill(reason);
    // "Yes, Reject" stays disabled until CoreHub sees a comment.
    await page.waitForFunction((el) => !(el as HTMLButtonElement).disabled, await confirm.elementHandle(), { timeout: 5000 });
    log("Entered rejection reason", { reason });
  }

  if (a.dryRun) {
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    log(`Dry run: cancelled at "Yes, ${label}" — nothing submitted`);
    return { outcome: "rehearsed", write: null };
  }

  // Accept writes to any host on CoreHub's domain (the API may not live on corehub.*).
  const site = new URL(config.corehubBaseUrl).hostname.split(".").slice(-2).join(".");
  const write = page.waitForResponse(
    (r) => r.request().method() !== "GET" && ["xhr", "fetch"].includes(r.request().resourceType()) && new URL(r.url()).hostname.endsWith(site),
    { timeout: config.navigationTimeoutMs }
  );
  await confirm.click();
  log(`Clicked "Yes, ${label}"`);
  const res = await write;
  const text = await res.text().catch(() => "");
  let body: unknown = text.slice(0, 4000);
  try {
    body = JSON.parse(text);
  } catch {}
  const out = { method: res.request().method(), url: res.url(), status: res.status(), body };
  log(`CoreHub responded ${out.status} to ${out.method} ${new URL(out.url).pathname}`, body);
  if (!res.ok()) throw Object.assign(new Error(`CoreHub rejected the ${a.action}: HTTP ${out.status}`), { write: out });
  return { outcome: "submitted", write: out };
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

  // The listing API carries quote IDs the table doesn't show; keep them for direct review-page URLs.
  const quoteIds = new Map<string, string>();
  const onResponse = async (r: import("playwright").Response) => {
    if (!["xhr", "fetch"].includes(r.request().resourceType())) return;
    const body = await r.json().catch(() => null);
    if (body) quoteIdsFromBody(body, quoteIds);
  };
  page.on("response", onResponse);

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
  const listed = await scrapeReferralTable(page, config.corehubSelectors, runId, evidence, (n, total) => {
    if (n > 1) void step(`Reading referral rows · page ${n} (${total} rows)`);
  });
  page.off("response", onResponse);
  const referrals = listed.map((r) => ({ ...r, quoteId: quoteIds.get(r.externalCaseId) ?? null }));

  // Save session again after a successful scrape (refreshes any token timestamps)
  await saveSession(context, config.sessionStoragePath);

  return { success: true, referrals, evidence, sessionReused };
}
