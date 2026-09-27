# Motor IDV Deviation Workflow

**Scheduled browser automation and underwriting control plane for motor-insurance IDV deviation referrals.**

## Overview

Motor IDV Deviation Workflow is an operations platform for handling IDV deviation referrals raised through a motor-insurance referral portal.

The revised operating model is browser-based, scheduled and sandboxed. A dedicated Playwright worker periodically opens the authorised CoreHub Referral interface, discovers new referrals, extracts vehicle and requested-IDV information, performs the corresponding OrangeBookValue website lookup, applies deterministic IDV rules, records evidence and routes cases for authorised underwriter review.

The design does not assume or fabricate undocumented CoreHub or OrangeBookValue APIs.

## Architecture

```text
Scheduler -> Sandboxed Playwright Worker
                    |                 |
                    v                 v
                 CoreHub          OrangeBookValue
                    |                 |
                    +-------+---------+
                            v
                     Decision Engine
                       /          \
                      v            v
             Recommendation    Manual Review
                      \            /
                       v          v
                         Supabase
                            |
                            v
                     Next.js Console
```

### Control plane vs automation plane

| Component | Responsibility |
|---|---|
| Next.js | Operations console, queues, configuration and monitoring |
| Supabase | Durable state, authentication, roles, RLS and audit |
| Playwright worker | Browser-based CoreHub and OBV interaction |
| Decision engine | Deterministic IDV evaluation |
| Manual review | Human underwriting control |
| Scheduler | Periodic referral discovery |

## End-to-end workflow

1. A scheduler or operator triggers an isolated worker run (`npm run worker`, `worker:live`, or `worker:visible`).
2. The worker launches a browser context (prefers Google Chrome via `channel: "chrome"`, falls back to Playwright Chromium) and loads persisted CoreHub session state if present.
3. It signs into CoreHub using runtime credentials (or reuses active session cookies from `.session/`).
4. It navigates to the Referral tab and discovers active referral rows.
5. A stable CoreHub case identifier provides idempotency (`idempotency_key = corehub:<externalCaseId>`).
6. Case metadata is persisted to Supabase `referral_cases`.
7. The worker extracts registration, make, model, variant, fuel, CC, and requested IDV.
8. OrangeBookValue is opened and queried for the vehicle specification.
9. Full valuation condition tiers (Fair, Good, Very Good, Excellent) and source URLs are captured.
10. The deterministic decision engine evaluates requested IDV:
    - **Tolerance Match**: Auto-approved if within absolute (INR 5,000) or percentage (2%) tolerance.
    - **Condition Spectrum Match**: If outside standard deviation tolerance but within validated condition tiers (Very Good, Good, Excellent), the case qualifies for condition band auto-approval (`WITHIN_CONDITION_BAND`).
    - **Deviation / Anomaly**: Cases with ambiguity, low vehicle match confidence, timeout, or out-of-band delta route to `manual_review`.
11. Every check, comparison, decision, and error is appended to `audit_events`.
12. The browser context is cleanly closed and execution summary recorded in `automation_runs`.

## Decision rules

Current defaults:

| Rule | Default |
|---|---:|
| Absolute IDV tolerance | INR 5,000 |
| Percentage tolerance | 2 percentage points |
| Minimum vehicle confidence | 85% |
| Manual-review SLA | 4 hours |
| Automation mode | Dry run |

Business configuration must be reviewed by the underwriting owner before production use.

## Safety model

This workflow supports insurance underwriting and is intentionally human-in-the-loop.

- No valuation is guessed when OBV cannot provide a reliable result.
- Low-confidence vehicle matches are routed to manual review.
- Authentication failures, CAPTCHA/MFA, DOM changes and timeouts fail safely.
- Browser selectors are environment-specific and supplied through runtime configuration.
- Credentials are never committed to GitHub.
- Dry-run mode is the default.
- Recommendations and exceptions receive audit records.

## Operations console

The Next.js application provides:

- **Dashboard** (`/`): Real-time metrics, referral pipeline health, and recent deviation decisions.
- **Referrals** (`/referrals`, `/referrals/[id]`): Filterable referral queue and deep case view with the interactive **Condition Spectrum** valuation bar.
- **Manual Review** (`/reviews`, `/reviews/[id]`): Underwriter workbench with priority queuing, condition band auto-approvals, and action modals.
- **Vehicles** (`/vehicles`): Normalization workbench, identity matching, and confidence inspection.
- **Audit Trail** (`/audit`): Immutable chronological log of automation and user actions.
- **Health** (`/health`): Connection health for Supabase, database tables, and workflow states.
- **Settings** (`/settings`): Decision tolerance thresholds (absolute tolerance, percentage tolerance, SLA hours).
- **Simulator** (`/simulate`): Full rule-engine simulation sandbox for test cases without web scraping.

Supabase Auth and role-aware access controls protect the console.

### Invites and password reset

In Supabase → Authentication → URL Configuration, set Site URL to the console URL. In Email Templates, set the Invite user link to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/account?welcome=1` and Reset password to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/account`. The console also needs `SUPABASE_SERVICE_ROLE_KEY` (server-only) for queuing jobs and Team administration.

## Data model

Supabase PostgreSQL is the durable system of record. Core entities include:

```text
referral_cases
vehicle_resolutions
idv_checks
approval_decisions
manual_reviews
audit_events
config_settings
automation_runs
automation_evidence
profiles
```

The database uses Row Level Security (RLS), role-aware access, audit records, foreign keys, indexes and idempotency keys.

## Browser worker

The Playwright worker runs in an isolated runtime environment (`src/worker/`). It features:
- **Dual browser engine launch**: Prefers local Google Chrome (`channel: "chrome"`) to minimize bot detection, falling back to Playwright Chromium.
- **Session state caching**: Saves authenticated CoreHub cookies in `.session/` to avoid repeated 2FA/login challenges.
- **Condition Spectrum extraction**: Extracts Fair, Good, Very Good, and Excellent valuation tiers from OrangeBookValue.

### Runtime configuration

```text
COREHUB_BASE_URL
COREHUB_REFERRAL_URL
COREHUB_USERNAME
COREHUB_PASSWORD
COREHUB_SELECTORS_JSON
OBV_SEARCH_URL
OBV_SELECTORS_JSON
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
AUTOMATION_DRY_RUN=true|false (default: true)
PLAYWRIGHT_HEADLESS=true|false (default: true)
```

On the console (Vercel), `AUTOMATION_DRY_RUN` decides dry-run for jobs started
from the UI; on the daemon host it only affects `npm run worker` CLI runs.

Never commit passwords, service-role keys, session cookies, browser state, customer PII or production screenshots.

## Scheduling

The worker can run every 5, 10, 15 or 30 minutes, or hourly, depending on the required operational SLA and approved website usage. Near-real-time behaviour is achieved through polling rather than an assumed webhook.

## Development

### Prerequisites

- Node.js 22+
- npm
- Supabase project access
- Playwright-compatible execution environment for the worker

### Install

```bash
npm install
```

### Run the web application

```bash
npm run dev
```

### Worker execution commands

```bash
# Run worker in default dry-run mode (headless)
npm run worker

# Run worker in live mode (commits decisions & actions to Supabase)
npm run worker:live

# Run worker with a visible browser window (headed mode for debugging)
npm run worker:visible

# Interactively log into CoreHub to initialize or refresh session cookies
npm run worker:login

# Standalone OBV test lookup using vehicle details
npm run test:obv
```

### Worker daemon (console-driven runs and schedules)

The console never runs a browser. It queues jobs in `automation_jobs`; the daemon
claims and executes them and fires enabled `automation_schedules`.

```bash
npm run worker:daemon
```

Run it on a host that can reach CoreHub and keep it alive with a process manager
(systemd, pm2, a container restart policy). Optional `WORKER_ID` names the worker;
it defaults to `<hostname>-<pid>`. The console shows the worker offline when no
heartbeat has arrived for 2 minutes.

### Validate TypeScript

```bash
npm run lint
```

### Run tests

```bash
npm test
```

### Production build

```bash
npm run build
```

## Testing strategy

### Unit tests

Validate IDV tolerance rules, vehicle-resolution logic, simulator engines, and provider failure/retry behaviour (`npm test`).

### Controlled simulation

`/simulate` executes the real decision engine against controlled values without touching external websites.

### Browser dry run

The worker should first run against an authorised test environment in read-only/dry-run mode (`npm run worker`).

### Reconciliation

Before production use, compare extracted referral values, OBV valuations and recommendations against manually reviewed cases and obtain the required business approvals.

## Deployment model

### Web application

The Next.js control plane is suitable for Vercel deployment.

### Browser worker

The Playwright worker should run independently in an isolated scheduled environment such as an approved container or GitHub Actions runner. It must support Chromium/Chrome, secure secrets, scheduling, network access to authorised sites and controlled artifact handling.

## Repository structure

```text
app/                    Next.js App Router pages (Dashboard, Referrals, Reviews, Settings, Simulator)
components/             UI components (ConditionSpectrum, ReviewActions, OperationsShell, Status)
src/domain/             Pure decision engine, tolerance math, and core domain interfaces
src/connectors/         External & fallback connectors
src/worker/             Sandboxed browser automation:
  ├── run.ts            Worker orchestrator (scrape -> lookup -> decision -> persist)
  ├── corehub-scraper.ts CoreHub referral scraper with session restoration
  ├── obv-lookup.ts     OrangeBookValue scraper with multi-tier condition spectrum
  ├── auth-corehub.ts   CoreHub interactive session login helper
  ├── config.ts         Environment variable parsing & selector defaults
  ├── evidence.ts       Screenshot and diagnostic evidence artifact capture
  └── test-referral-obv.ts Standalone OBV scraper validation tool
tests/                  Automated test suites (decision engine, vehicle resolution, workflow, simulator)
supabase/               Database schema, migrations, RLS policies, and triggers
.github/workflows/      CI and worker automation workflows
appinfo.md              Comprehensive application documentation
```

## Current status

Implemented:
- Authenticated Next.js 16 operations console with modern design system and operations shell.
- Supabase Auth/PostgreSQL schema, RLS policies, audit logs, and workflow tracking.
- Deterministic IDV engine with tolerance comparisons and Condition Band auto-approvals (`WITHIN_CONDITION_BAND`).
- Playwright-based CoreHub browser intake and referral discovery.
- OrangeBookValue browser valuation pipeline extracting complete condition tiers.
- Condition Spectrum visual component and band matching.
- Google Chrome channel fallback & persistent session caching.
- Zero TypeScript diagnostics across both application and worker codebases.

Operational validation:
- Validate environment selectors against live CoreHub and OBV production pages.
- Conduct dry-run reconciliation before switching `AUTOMATION_DRY_RUN=false`.
- Deploy scheduled cron jobs in GitHub Actions or containerized worker host.

## Documentation

See [`appinfo.md`](./appinfo.md) for the complete application inventory, configuration contract, architecture and operational status.

## License

This repository is intended for authorised internal use. Production deployment requires the applicable organisational approvals.
