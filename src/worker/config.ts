/**
 * Worker configuration — reads all environment variables needed by the
 * Playwright-based scheduled worker. Every field has a sensible default
 * or throws early if a required value is missing.
 */

import { join } from "path";

// Auto-load .env file if available in the Node runtime and not already loaded
try {
  if (typeof (process as any).loadEnvFile === "function") {
    (process as any).loadEnvFile();
  }
} catch {
  // .env may not exist in CI or is already provided by environment
}


export interface CorehubSelectors {
  /** Selector for the referral table rows */
  tableRow: string;
  /** Selector for the case-ID cell within a row */
  caseId: string;
  /** Selector for registration number */
  registration: string;
  /** Selector for make */
  make: string;
  /** Selector for model */
  model: string;
  /** Selector for variant */
  variant: string;
  /** Selector for fuel type */
  fuel: string;
  /** Selector for CC */
  cc: string;
  /** Selector for requested IDV */
  requestedIdv: string;
  /** Selector for the login username field */
  loginUsername: string;
  /** Selector for the login password field */
  loginPassword: string;
  /** Selector for the login submit button */
  loginSubmit: string;
}

export interface ObvSelectors {
  /** Selector for the make/brand input or dropdown */
  makeInput: string;
  /** Selector for the model input or dropdown */
  modelInput: string;
  /** Selector for the variant input or dropdown */
  variantInput: string;
  /** Selector for the search/submit button */
  searchButton: string;
  /** Selector for the displayed IDV value */
  idvValue: string;
}

export interface WorkerConfig {
  // CoreHub
  corehubBaseUrl: string;
  corehubReferralUrl: string;
  corehubUsername?: string;
  corehubPassword?: string;
  corehubSelectors: CorehubSelectors;

  // OBV
  obvSearchUrl: string;
  obvSelectors: ObvSelectors;

  // Supabase (service role — bypasses RLS)
  supabaseUrl: string;
  supabaseServiceRoleKey: string;

  // Worker behavior
  dryRun: boolean;
  headless: boolean;
  pollLabel: string;
  triggerSource: "manual" | "cron" | "github_actions";

  // Session persistence — reuse CoreHub login across runs
  sessionStoragePath: string;

  // Timeouts
  navigationTimeoutMs: number;
  obvLookupTimeoutMs: number;
}

const DEFAULT_COREHUB_SELECTORS: CorehubSelectors = {
  tableRow: "table.referrals tbody tr",
  caseId: "td:nth-child(1)",
  registration: "td:nth-child(2)",
  make: "td:nth-child(3)",
  model: "td:nth-child(4)",
  variant: "td:nth-child(5)",
  fuel: "td:nth-child(6)",
  cc: "td:nth-child(7)",
  requestedIdv: "td:nth-child(8)",
  loginUsername: 'input[name="username"], input[type="email"]',
  loginPassword: 'input[name="password"], input[type="password"]',
  loginSubmit: 'button[type="submit"]',
};

const DEFAULT_OBV_SELECTORS: ObvSelectors = {
  makeInput: "select[name='make'], #brand, #make",
  modelInput: "select[name='model'], #model",
  variantInput: "select[name='trim'], select[name='variant'], #variant",
  searchButton: "button#check_price_used, button[type='submit'], .search-btn",
  idvValue: ".mainPrice, .price.price-scroll, .price-value, .idv-value, .valuation-price",
};

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. ` +
        `Check your .env or GitHub Actions secrets.`
    );
  }
  return value;
}

function parseJsonEnv<T>(key: string, fallback: T): T {
  const raw = process.env[key];
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.warn(
      `⚠ Could not parse ${key} as JSON, using defaults. Value: ${raw}`
    );
    return fallback;
  }
}

export function loadWorkerConfig(
  overrides?: Partial<WorkerConfig>
): WorkerConfig {
  return {
    corehubBaseUrl:
      overrides?.corehubBaseUrl ??
      requireEnv("COREHUB_BASE_URL"),
    corehubReferralUrl:
      overrides?.corehubReferralUrl ||
      process.env.COREHUB_REFERRAL_URL ||
      (overrides?.corehubBaseUrl || process.env.COREHUB_BASE_URL || "") + "/referrals",
    corehubUsername:
      overrides?.corehubUsername || process.env.COREHUB_USERNAME || "",
    corehubPassword:
      overrides?.corehubPassword || process.env.COREHUB_PASSWORD || "",
    corehubSelectors:
      overrides?.corehubSelectors ??
      parseJsonEnv("COREHUB_SELECTORS_JSON", DEFAULT_COREHUB_SELECTORS),

    obvSearchUrl:
      overrides?.obvSearchUrl ||
      process.env.OBV_SEARCH_URL ||
      "https://www.orangebookvalue.com",
    obvSelectors:
      overrides?.obvSelectors ??
      parseJsonEnv("OBV_SELECTORS_JSON", DEFAULT_OBV_SELECTORS),

    supabaseUrl:
      overrides?.supabaseUrl ||
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      requireEnv("SUPABASE_URL"),
    supabaseServiceRoleKey:
      overrides?.supabaseServiceRoleKey ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_SECRET_KEY ||
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),

    dryRun:
      overrides?.dryRun ?? process.env.AUTOMATION_DRY_RUN !== "false",
    headless:
      overrides?.headless ?? process.env.PLAYWRIGHT_HEADLESS !== "false",
    pollLabel:
      overrides?.pollLabel ||
      process.env.AUTOMATION_POLL_LABEL ||
      "idv-deviation-check",
    triggerSource:
      overrides?.triggerSource ??
      (process.env.AUTOMATION_TRIGGER_SOURCE as WorkerConfig["triggerSource"]) ??
      "manual",

    navigationTimeoutMs:
      overrides?.navigationTimeoutMs ??
      Number(process.env.NAVIGATION_TIMEOUT_MS || 30000),
    obvLookupTimeoutMs:
      overrides?.obvLookupTimeoutMs ??
      Number(process.env.OBV_LOOKUP_TIMEOUT_MS || 15000),

    sessionStoragePath:
      overrides?.sessionStoragePath ||
      process.env.SESSION_STORAGE_PATH ||
      join(process.cwd(), ".session", "corehub-state.json"),
  };
}
