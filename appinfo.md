# Motor IDV Deviation Workflow

## Purpose

This application is an operations and automation platform for IDV-deviation referrals raised in a motor-insurance referral portal.

The revised operating model is browser-based, scheduled and sandboxed. It does not require a CoreHub webhook or an OrangeBookValue API. A dedicated Playwright worker periodically opens the configured CoreHub Referral page, discovers new referrals, extracts the vehicle/request information, opens the configured OrangeBookValue web flow, captures the displayed valuation, and sends the resulting facts through the deterministic IDV rules engine.

The system is deliberately human-in-the-loop for the final underwriting action. The automation may identify cases that satisfy the configured tolerance and place them in an automation recommendation state, but it does not independently approve or reject an insurance-related case. An authorised underwriter remains responsible for the final action.

## Architecture

- Next.js 16 App Router: operations console, authenticated UI, and review workflows.
- Supabase Auth/PostgreSQL: durable system of record, RBAC roles, Row-Level Security (RLS), audit events, and workflow state.
- Playwright sandbox worker (`src/worker/`): scheduled browser automation for CoreHub and OrangeBookValue (OBV). Supports launching via Google Chrome (`channel: "chrome"`) with fallback to bundled Playwright Chromium, plus session state persistence (`.session/`) to reuse authenticated CoreHub logins.
- Multi-tier OBV Valuation & Condition Spectrum: extracts baseline IDV as well as complete vehicle condition tiers (Fair, Good, Very Good, Excellent).
- Pure TypeScript decision engine: deterministic IDV comparison, condition-band auto-approval (`WITHIN_CONDITION_BAND`), and fail-safe reason codes.
- Condition Spectrum UI: interactive visual breakdown of valuation ranges on case and review detail pages.
- Manual review queue: underwriter decisioning, SLA tracking, and audit annotations.
- GitHub Actions: CI testing, type validation, and scheduled automation execution.
- Vercel: hosting for the Next.js control plane; the browser worker runs separately in an isolated execution sandbox.

## End-to-end workflow

1. A scheduler or operator triggers an isolated worker run (`npm run worker`, `worker:live`, or `worker:visible`).
2. The worker launches a browser context (prefers system Chrome, falls back to Chromium) with reusable session storage if available.
3. It signs into CoreHub (or reuses stored session) using runtime credentials.
4. It navigates to the Referral tab and discovers active referral rows.
5. A stable CoreHub case identifier is used for idempotency (`idempotency_key = corehub:<externalCaseId>`).
6. New cases are copied into Supabase `referral_cases` with source metadata.
7. The worker extracts registration, make, model, variant, fuel, CC and requested IDV.
8. It opens OrangeBookValue and executes the valuation flow for the vehicle specification.
9. OBV valuations are extracted across all available condition bands (Fair, Good, Very Good, Excellent), along with result page URL and evidence screenshots.
10. The deterministic decision engine evaluates requested IDV against reference values:
    - **Exact/Tolerance Match**: Auto-approved if within absolute (INR 5,000) or percentage (2%) tolerance.
    - **Condition Band Match**: If outside base tolerance but within validated condition tiers (Very Good, Good, Excellent), the case qualifies for condition band auto-approval (`WITHIN_CONDITION_BAND`).
    - **Exception / Deviation**: Ambiguity, low vehicle match confidence, timeouts, or out-of-band deviations route to `manual_review`.
11. Every check, comparison, decision, and error is appended to `audit_events`.
12. The browser context is cleanly finalized and closed at the end of the run.

## Safety model

This is an insurance underwriting workflow. The browser worker is therefore an assistive automation, not an autonomous underwriting decision-maker.

- No automatic insurance approval/rejection is performed by the worker.
- No valuation is guessed when OrangeBookValue cannot provide a reliable result.
- No approval recommendation is produced when vehicle identity is below the configured confidence threshold.
- Site errors, authentication failures, CAPTCHA/MFA, DOM changes, timeouts and ambiguous results route to manual review.
- Credentials are never committed to GitHub.
- Selectors are supplied through runtime configuration so website changes do not require changing business rules.
- Every recommendation has a reason code and audit trail.
- Dry-run mode is the default.

## Decision configuration

Current defaults:

- Absolute IDV tolerance: INR 5,000
- Percentage IDV tolerance: 2 percentage points
- Minimum vehicle match confidence: 85%
- Browser/provider timeout target: 4 seconds for the lookup operation where practical
- Maximum transient retries: 2
- Manual review SLA: 4 hours

The exact final business rules are controlled by the application configuration and should be reviewed by the underwriting owner before production use.

## Browser worker configuration

Runtime secrets/configuration include:

- COREHUB_BASE_URL
- COREHUB_REFERRAL_URL
- COREHUB_USERNAME
- COREHUB_PASSWORD
- COREHUB_SELECTORS_JSON
- OBV_SEARCH_URL
- OBV_SELECTORS_JSON
- SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
- AUTOMATION_DRY_RUN=true|false (default true)
- PLAYWRIGHT_HEADLESS=true|false (default true)
- AUTOMATION_POLL_LABEL
- IDV decision configuration variables

### Worker CLI commands

```bash
# Run worker in default dry-run mode (headless)
npm run worker

# Run worker in live mode (persists decisions and actions to Supabase)
npm run worker:live

# Run worker with a visible browser window (headed Chromium/Chrome)
npm run worker:visible

# Interactively log into CoreHub to save/refresh session cookies
npm run worker:login

# Test standalone OBV lookup using referral data
npm run test:obv
```

Selectors are intentionally environment-specific. The repository does not assume undocumented DOM selectors for CoreHub or OrangeBookValue.

## Scheduling

The worker is intended to run on a schedule such as:

- Every 5 minutes for near-real-time monitoring
- Every 10 minutes for a lower-cost default
- Every 15/30 minutes or hourly when required

A referral is considered new when its stable external case identifier has not already reached a terminal workflow state.

## Evidence

Each automated run retains:

- Run record in `automation_runs` (label, status, counts, duration, error summaries)
- Timestamps and correlation IDs
- CoreHub external case identifier
- Extracted referral specifications (make, model, variant, fuel, CC, requested IDV)
- OrangeBookValue source URL and evaluated condition tiers
- Full raw request and response payloads stored in `idv_checks`
- Structured audit events in `audit_events`
- Screenshot artifacts captured in `evidence/` (ignored by git)

## Existing application modules

- Dashboard (`/`): operational counts, workflow pipeline metrics, and recent activity
- Referrals (`/referrals`, `/referrals/[id]`): case search, filterable queue, and case detail with Condition Spectrum breakdown
- Reviews (`/reviews`, `/reviews/[id]`): underwriter manual-review queue, SLA tracking, and one-click decision actions
- Vehicles (`/vehicles`): resolution workbench and normalization confidence inspection
- Audit (`/audit`): immutable audit timeline and actor event log
- Health (`/health`): database, provider, and workflow health status
- Settings (`/settings`): runtime decision tolerance configuration
- Simulator (`/simulate`): interactive rule-engine testing with instant feedback

## Supabase

Project ref: oyjirtozeoeeacogldpx
Region: ap-south-1

The database is the durable system of record. RLS protects application access. Audit events are append-oriented and ordinary authenticated users cannot update/delete them.

## GitHub

Repository: krishnavarshney/motor-idv-deviation-workflow
Default branch: main

CI performs:

- TypeScript validation (`tsc --noEmit`)
- Unit and simulator test suites (`npm test`)
- Next.js production build (`npm run build`)

## Deployment model

The web application can be deployed to Vercel. The Playwright worker should remain a separate sandboxed execution environment because browser sessions are long-running, resource-intensive and require credentials that should not be exposed to the web runtime.

## Current implementation status

Completed:

- Authenticated Next.js 16 operations console with modern design system and operations shell
- Supabase PostgreSQL database, Auth, RLS policies, and migrations
- Deterministic IDV decision engine with absolute, percentage, and condition-band tolerance logic
- CoreHub browser discovery and extraction pipeline (`src/worker/corehub-scraper.ts`)
- Dual-browser launch strategy: Google Chrome (`channel: "chrome"`) with Playwright Chromium fallback
- CoreHub session state persistence (`.session/`) to bypass redundant MFA/login cycles
- OrangeBookValue browser valuation scraper (`src/worker/obv-lookup.ts`) capturing Fair, Good, Very Good, and Excellent condition bands
- Condition Spectrum visual component (`components/condition-spectrum.tsx`) with interactive band visualization
- Automatic Condition Band Approval policy (`WITHIN_CONDITION_BAND`) resolving cases whose requested IDV falls inside valid valuation bands
- Full TypeScript validation across both application and worker codebases
- Automated test suites for decision engine, vehicle resolution, workflow, and simulator

In progress / next operational phase:

- Validate environment-specific selectors against live production CoreHub and OrangeBookValue UI
- Run scheduled dry-run reconciliation (`AUTOMATION_DRY_RUN=true`) with live referral batches before flipping to live mode
- Configure production CI/CD runner secrets and scheduled cron triggers in GitHub Actions or containerized worker infrastructure

## Important operational note

The application cannot be considered production-ready merely because the code builds. The browser selectors, authentication flow, referral table structure and OrangeBookValue journey must be validated in the authorised sandbox/test environment. Production credentials and real customer data should only be introduced after that validation and the required internal approvals.
