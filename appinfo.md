# Motor IDV Deviation Workflow

## Purpose

This application is an operations and automation platform for IDV-deviation referrals raised in a motor-insurance referral portal.

The revised operating model is browser-based, scheduled and sandboxed. It does not require a CoreHub webhook or an OrangeBookValue API. A dedicated Playwright worker periodically opens the configured CoreHub Referral page, discovers new referrals, extracts the vehicle/request information, opens the configured OrangeBookValue web flow, captures the displayed valuation, and sends the resulting facts through the deterministic IDV rules engine.

The system is deliberately human-in-the-loop for the final underwriting action. The automation may identify cases that satisfy the configured tolerance and place them in an automation recommendation state, but it does not independently approve or reject an insurance-related case. An authorised underwriter remains responsible for the final action.

## Architecture

- Next.js 16 App Router: operations console and authenticated UI.
- Supabase Auth/PostgreSQL: system of record, roles, RLS, audit events and workflow state.
- Playwright sandbox worker: scheduled browser automation for CoreHub and OrangeBookValue.
- Pure TypeScript decision engine: deterministic IDV comparison and fail-safe reason codes.
- Manual review queue: final underwriter action and notes.
- GitHub Actions: CI and controlled worker execution.
- Vercel: intended hosting for the web/control plane; the browser worker is kept separate from the web runtime.

## End-to-end workflow

1. A scheduler starts an isolated worker run at a configured frequency.
2. The worker launches a clean Chromium context.
3. It signs into CoreHub using runtime-only credentials.
4. It opens the Referral tab and discovers referral rows.
5. A stable CoreHub case identifier is used for idempotency.
6. New cases are copied into Supabase with source metadata.
7. The worker opens the referral and extracts registration, make, model, variant, fuel, CC and requested IDV.
8. It opens OrangeBookValue in a separate browser page/context and performs the normal website lookup.
9. The displayed valuation and source URL are recorded as evidence metadata.
10. The shared decision engine compares requested IDV with the observed valuation and checks vehicle confidence/provider state.
11. Cases that meet the configured rules are marked as automation recommendation for an underwriter.
12. Cases with ambiguity, lookup failure, timeout, provider/site changes or rule failure go to manual review.
13. Every scan, lookup, decision and exception creates an audit event.
14. The browser context is closed at the end of the run.

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
- PLAYWRIGHT_HEADLESS=true
- AUTOMATION_POLL_LABEL
- IDV decision configuration variables

Selectors are intentionally environment-specific. The repository does not assume undocumented DOM selectors for CoreHub or OrangeBookValue.

## Scheduling

The worker is intended to run on a schedule such as:

- Every 5 minutes for near-real-time monitoring
- Every 10 minutes for a lower-cost default
- Every 15/30 minutes or hourly when required

A referral is considered new when its stable external case identifier has not already reached a terminal workflow state.

## Evidence

Each automated run should retain:

- run identifier
- timestamps
- CoreHub case identifier
- extracted referral fields
- requested IDV
- OrangeBookValue source URL
- observed valuation
- lookup status/reason code
- decision-engine result
- recommendation reason
- failure details where applicable

Screenshots should be treated as controlled evidence artifacts and stored outside the Git repository.

## Existing application modules

- Dashboard: operational counts and recent activity
- Referrals: case search and queue
- Reviews: manual review queue
- Vehicles: resolution workbench
- Audit: event history
- Health: database/workflow/provider health
- Settings: decision configuration
- Simulator: controlled rule-engine testing

## Supabase

Project ref: oyjirtozeoeeacogldpx
Region: ap-south-1

The database is the durable system of record. RLS protects application access. Audit events are append-oriented and ordinary authenticated users cannot update/delete them.

## GitHub

Repository: krishnavarshney/motor-idv-deviation-workflow
Default branch: main

CI performs:

- TypeScript validation
- unit tests
- Next.js production build

## Deployment model

The web application can be deployed to Vercel. The Playwright worker should remain a separate sandboxed execution environment because browser sessions are long-running, resource-intensive and require credentials that should not be exposed to the web runtime.

## Current implementation status

Completed:

- authenticated Next.js operations console
- Supabase database/auth/RLS foundation
- deterministic IDV decision engine
- vehicle-resolution foundation
- manual-review workflow
- audit trail
- health and configuration pages
- controlled simulator
- previous webhook/API adapters retained only as legacy/transition code

In progress / next deployment phase:

- replace webhook-first intake with scheduled CoreHub browser discovery
- replace API-first OBV integration with browser-based OBV lookup
- add durable automation-run state
- add worker scheduling
- add evidence artifact handling
- validate environment-specific selectors against the actual CoreHub and OrangeBookValue UI
- conduct dry-run reconciliation with real referrals before enabling any production recommendation workflow

## Important operational note

The application cannot be considered production-ready merely because the code builds. The browser selectors, authentication flow, referral table structure and OrangeBookValue journey must be validated in the authorised sandbox/test environment. Production credentials and real customer data should only be introduced after that validation and the required internal approvals.
