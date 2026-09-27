/**
 * OrangeBookValue Browser Lookup — Playwright automation for OBV website.
 *
 * Workflow:
 * 1. Open OrangeBookValue.com
 * 2. Fill in make / model / variant
 * 3. Submit search
 * 4. Extract the displayed IDV valuation
 * 5. Return structured result with evidence
 *
 * Handles: no results, ambiguous results, timeouts, CAPTCHA detection.
 */

import type { Page } from "playwright";
import type { ObvSelectors, WorkerConfig } from "./config";
import { captureEvidence, type EvidenceArtifact } from "./evidence";

export interface ConditionRange {
  min: number;
  max: number;
  midpoint: number;
  raw: string;
}

export interface ObvBrowserResult {
  success: boolean;
  /** The primary benchmark IDV (Very Good or Good midpoint) */
  idv: number | null;
  /** Valuations for the 3 insurable condition tiers: good, veryGood, excellent */
  conditions?: {
    good?: ConditionRange;
    veryGood?: ConditionRange;
    excellent?: ConditionRange;
  };
  /** The URL of the result page (evidence) */
  sourceUrl: string | null;
  /** Structured reason when lookup fails */
  reasonCode:
    | "SUCCESS"
    | "NO_RESULTS"
    | "AMBIGUOUS_RESULTS"
    | "CAPTCHA_DETECTED"
    | "TIMEOUT"
    | "SELECTOR_MISMATCH"
    | "PARSE_ERROR"
    | "NAVIGATION_ERROR"
    | "UNKNOWN_ERROR";
  latencyMs: number;
  evidence: EvidenceArtifact[];
  raw?: unknown;
}

/**
 * Detect if the page is showing a CAPTCHA or bot-detection challenge.
 */
async function detectCaptcha(page: Page): Promise<boolean> {
  try {
    const bodyText = await page.locator("body").innerText({ timeout: 2000 });
    const lower = bodyText.toLowerCase();
    return (
      lower.includes("captcha") ||
      lower.includes("verify you are human") ||
      lower.includes("robot") ||
      lower.includes("challenge")
    );
  } catch {
    return false;
  }
}

/**
 * Parse IDV from a displayed text string.
 * Handles formats like:
 *   "₹5,96,007 - ₹6,32,873 *" -> returns midpoint ₹6,14,440
 *   "₹5,52,996 *" -> returns ₹5,52,996
 *   "496000" -> returns 496000
 */
export function parseObvIdv(raw: string | null): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[₹,]/g, "");
  const numbers = cleaned
    .match(/\b\d{4,8}\b/g)
    ?.map(Number)
    .filter((n) => Number.isFinite(n) && n > 1000);

  if (!numbers || numbers.length === 0) {
    const fallbackMatch = cleaned.match(/(\d+\.?\d*)/);
    if (!fallbackMatch) return null;
    const num = Number(fallbackMatch[1]);
    return Number.isFinite(num) && num > 1000 ? num : null;
  }

  if (numbers.length >= 2) {
    // If range returned (e.g. min - max), return the midpoint
    return Math.round((numbers[0] + numbers[1]) / 2);
  }
  return numbers[0];
}

/**
 * Select a value in a dropdown or fill an input.
 * For <select> elements, smartly searches through option text using substring,
 * token, and fuzzy matching, then waits for dependent dropdowns to populate.
 */
async function fillField(
  page: Page,
  selector: string,
  value: string
): Promise<boolean> {
  try {
    const element = page.locator(selector).first();
    await element.waitFor({ timeout: 6000 });

    const tagName = await element.evaluate((el) => el.tagName.toLowerCase());

    if (tagName === "select") {
      // Wait for options to be populated if needed
      await page
        .waitForFunction(
          (sel) => {
            const el = document.querySelector(sel);
            return el && el.querySelectorAll("option").length > 1;
          },
          selector,
          { timeout: 6000 }
        )
        .catch(() => {});

      const targetValLower = value.toLowerCase().trim();
      const optionValueToSelect = await page.evaluate(
        ({ sel, target }) => {
          const select = document.querySelector(sel) as HTMLSelectElement | null;
          if (!select) return null;
          const options = Array.from(select.options);
          // 1. Exact text match
          const exact = options.find(
            (o) => o.text.trim().toLowerCase() === target
          );
          if (exact) return exact.value;
          // 2. Substring match
          const substr = options.find((o) =>
            o.text.toLowerCase().includes(target)
          );
          if (substr) return substr.value;
          // 3. Reversed substring match (target contains option text)
          const rev = options.find(
            (o) => o.text.trim().length > 2 && target.includes(o.text.trim().toLowerCase())
          );
          if (rev) return rev.value;
          // 4. Token match (e.g. "Zeta", "Baleno", "Petrol")
          const tokens = target.split(/\s+/).filter((t: string) => t.length > 2);
          const tokenMatch = options.find((o) =>
            tokens.some((tok: string) => o.text.toLowerCase().includes(tok))
          );
          if (tokenMatch) return tokenMatch.value;
          // 5. Fallback: select 2nd option if placeholder is 1st
          return options.length > 1 ? options[1].value : null;
        },
        { sel: selector, target: targetValLower }
      );

      if (optionValueToSelect !== null) {
        await element.selectOption(optionValueToSelect);
        await page.waitForTimeout(800);
        return true;
      }
      return false;
    } else {
      await element.click();
      await element.fill("");
      await element.fill(value);
      await page.waitForTimeout(600);
      try {
        const suggestion = page
          .locator(".autocomplete-item, .suggestion, .dropdown-item, li[role='option']")
          .first();
        if (await suggestion.isVisible({ timeout: 1000 }).catch(() => false)) {
          await suggestion.click();
        }
      } catch {}
      return true;
    }
  } catch (err) {
    console.warn(`⚠ Could not fill field "${selector}" with value "${value}":`, err);
    return false;
  }
}

/**
 * Perform an OBV website lookup for a given vehicle.
 */
export async function lookupObvBrowser(
  page: Page,
  vehicle: {
    make: string;
    model: string;
    variant: string;
    year?: string | number;
    kmsDriven?: string | number;
  },
  config: WorkerConfig,
  runId: string
): Promise<ObvBrowserResult> {
  const evidence: EvidenceArtifact[] = [];
  const started = Date.now();
  const selectors = config.obvSelectors;

  try {
    // Step 1: Navigate to OBV
    console.log(`🔍 OBV lookup: ${vehicle.make} ${vehicle.model} ${vehicle.variant} (${vehicle.year ?? "2022"})`);
    await page.goto(config.obvSearchUrl, {
      waitUntil: "domcontentloaded",
      timeout: config.navigationTimeoutMs,
    });
    evidence.push(await captureEvidence(page, "obv_home", runId));

    // Step 2: Check for CAPTCHA
    if (await detectCaptcha(page)) {
      evidence.push(
        await captureEvidence(page, "obv_captcha_detected", runId)
      );
      return {
        success: false,
        idv: null,
        sourceUrl: page.url(),
        reasonCode: "CAPTCHA_DETECTED",
        latencyMs: Date.now() - started,
        evidence,
      };
    }

    // Step 3: Fill in vehicle details
    // Optional Category selection (e.g. Car)
    const hasCategory = await page
      .locator("select[name='category']")
      .isVisible({ timeout: 1500 })
      .catch(() => false);
    if (hasCategory) {
      await fillField(page, "select[name='category']", "Car");
      await page.waitForTimeout(800);
    }

    const makeFilled = await fillField(page, selectors.makeInput, vehicle.make);
    if (!makeFilled) {
      evidence.push(
        await captureEvidence(page, "obv_make_selector_fail", runId)
      );
      return {
        success: false,
        idv: null,
        sourceUrl: page.url(),
        reasonCode: "SELECTOR_MISMATCH",
        latencyMs: Date.now() - started,
        evidence,
        raw: { failedField: "make", selector: selectors.makeInput },
      };
    }

    // Wait for model dropdown to populate after make selection
    await page.waitForTimeout(1000);

    const modelFilled = await fillField(
      page,
      selectors.modelInput,
      vehicle.model
    );
    if (!modelFilled) {
      evidence.push(
        await captureEvidence(page, "obv_model_selector_fail", runId)
      );
      return {
        success: false,
        idv: null,
        sourceUrl: page.url(),
        reasonCode: "SELECTOR_MISMATCH",
        latencyMs: Date.now() - started,
        evidence,
        raw: { failedField: "model", selector: selectors.modelInput },
      };
    }

    await page.waitForTimeout(1000);

    // Optional Year dropdown (populated dynamically on OBV)
    const hasYear = await page
      .locator("select[name='year']")
      .isVisible({ timeout: 1500 })
      .catch(() => false);
    if (hasYear) {
      const yearToUse = vehicle.year ? String(vehicle.year) : "2022";
      await fillField(page, "select[name='year']", yearToUse);
      await page.waitForTimeout(800);
    }

    const variantFilled = await fillField(
      page,
      selectors.variantInput,
      vehicle.variant
    );
    if (!variantFilled) {
      evidence.push(
        await captureEvidence(page, "obv_variant_selector_fail", runId)
      );
      return {
        success: false,
        idv: null,
        sourceUrl: page.url(),
        reasonCode: "SELECTOR_MISMATCH",
        latencyMs: Date.now() - started,
        evidence,
        raw: { failedField: "variant", selector: selectors.variantInput },
      };
    }

    // Optional Kms driven
    const kmsInput = page
      .locator("input[type='number'][name='kms_driven']")
      .first();
    if (await kmsInput.isVisible({ timeout: 1500 }).catch(() => false)) {
      await kmsInput.fill(vehicle.kmsDriven ? String(vehicle.kmsDriven) : "15000");
    }

    evidence.push(
      await captureEvidence(page, "obv_fields_filled", runId, {
        make: vehicle.make,
        model: vehicle.model,
        variant: vehicle.variant,
      })
    );

    // Step 4: Submit search
    try {
      await page.click(selectors.searchButton);
      await page.waitForLoadState("domcontentloaded", {
        timeout: config.obvLookupTimeoutMs,
      });
    } catch (err) {
      evidence.push(
        await captureEvidence(page, "obv_search_timeout", runId)
      );
      return {
        success: false,
        idv: null,
        sourceUrl: page.url(),
        reasonCode: "TIMEOUT",
        latencyMs: Date.now() - started,
        evidence,
      };
    }

    evidence.push(await captureEvidence(page, "obv_results_page", runId));

    // Step 5: Check for CAPTCHA on results page
    if (await detectCaptcha(page)) {
      evidence.push(
        await captureEvidence(page, "obv_captcha_on_results", runId)
      );
      return {
        success: false,
        idv: null,
        sourceUrl: page.url(),
        reasonCode: "CAPTCHA_DETECTED",
        latencyMs: Date.now() - started,
        evidence,
      };
    }

    // Step 6: Extract IDV values for Good, Very Good, and Excellent
    const targetConditions = [
      { key: "good" as const, label: "Good" },
      { key: "veryGood" as const, label: "Very Good" },
      { key: "excellent" as const, label: "Excellent" },
    ];

    const conditionValuations: Partial<
      Record<"good" | "veryGood" | "excellent", ConditionRange>
    > = {};

    for (const cond of targetConditions) {
      try {
        const clicked = await page.evaluate((targetLabel) => {
          const tabs = Array.from(
            document.querySelectorAll(
              ".price-tabs a, .price-tabs li, .price-tabs button, a[data-toggle='tab'], [role='tab']"
            )
          );
          const match = tabs.find(
            (t) =>
              (t as HTMLElement).innerText &&
              (t as HTMLElement).innerText.trim().toLowerCase() ===
                targetLabel.toLowerCase()
          );
          if (match) {
            (match as HTMLElement).click();
            return true;
          }
          return false;
        }, cond.label);

        if (clicked) {
          await page.waitForTimeout(600);
        }

        const rawPriceText = await page.evaluate(() => {
          const el = document.querySelector(
            ".mainPrice, .price.price-scroll.mainPrice, .price.price-scroll"
          ) as HTMLElement | null;
          return el ? el.innerText.trim().replace(/\s+/g, " ") : null;
        });

        if (rawPriceText) {
          const midpoint = parseObvIdv(rawPriceText);
          const numbers = rawPriceText
            .replace(/[₹,]/g, "")
            .match(/\b\d{4,9}\b/g)
            ?.map(Number)
            .filter((n: number) => Number.isFinite(n) && n > 1000);

          if (midpoint !== null) {
            const min =
              numbers && numbers.length >= 2
                ? Math.min(numbers[0], numbers[1])
                : midpoint;
            const max =
              numbers && numbers.length >= 2
                ? Math.max(numbers[0], numbers[1])
                : midpoint;

            conditionValuations[cond.key] = {
              min,
              max,
              midpoint,
              raw: rawPriceText,
            };
          }
        }
      } catch (err) {
        console.warn(`⚠ Could not extract condition "${cond.label}":`, err);
      }
    }

    // Benchmark IDV: prefer Very Good, then Good, then Excellent
    const primaryIdv =
      conditionValuations.veryGood?.midpoint ??
      conditionValuations.good?.midpoint ??
      conditionValuations.excellent?.midpoint ??
      null;

    if (primaryIdv !== null) {
      evidence.push(
        await captureEvidence(page, "obv_conditions_extracted", runId, {
          conditions: conditionValuations,
          primaryIdv,
        })
      );

      console.log(
        `✅ OBV Conditions Extracted:` +
          (conditionValuations.good ? ` Good: ${conditionValuations.good.raw} |` : "") +
          (conditionValuations.veryGood ? ` Very Good: ${conditionValuations.veryGood.raw} |` : "") +
          (conditionValuations.excellent ? ` Excellent: ${conditionValuations.excellent.raw}` : "")
      );

      return {
        success: true,
        idv: primaryIdv,
        conditions: conditionValuations,
        sourceUrl: page.url(),
        reasonCode: "SUCCESS",
        latencyMs: Date.now() - started,
        evidence,
        raw: { conditions: conditionValuations },
      };
    }

    // Fallback: check if standard single IDV element is present
    try {
      const idvElement = page.locator(selectors.idvValue).first();
      await idvElement.waitFor({ timeout: 4000 });
      const rawIdvText = await idvElement.innerText();
      const idv = parseObvIdv(rawIdvText);

      if (idv !== null) {
        evidence.push(
          await captureEvidence(page, "obv_idv_extracted", runId, {
            rawText: rawIdvText,
            parsedIdv: idv,
          })
        );
        return {
          success: true,
          idv,
          conditions: conditionValuations,
          sourceUrl: page.url(),
          reasonCode: "SUCCESS",
          latencyMs: Date.now() - started,
          evidence,
          raw: { rawText: rawIdvText },
        };
      }
    } catch {}

    // If neither conditions nor single IDV could be extracted
    evidence.push(
      await captureEvidence(page, "obv_idv_selector_fail", runId)
    );

    return {
      success: false,
      idv: null,
      conditions: conditionValuations,
      sourceUrl: page.url(),
      reasonCode: "SELECTOR_MISMATCH",
      latencyMs: Date.now() - started,
      evidence,
    };
  } catch (err) {
    evidence.push(
      await captureEvidence(page, "obv_unknown_error", runId, {
        error: String(err),
      })
    );
    return {
      success: false,
      idv: null,
      sourceUrl: page.url(),
      reasonCode: "UNKNOWN_ERROR",
      latencyMs: Date.now() - started,
      evidence,
      raw: { error: String(err) },
    };
  }
}
