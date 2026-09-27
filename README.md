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

1. A scheduler starts an isolated worker run.
2. The worker launches a clean Chromium context.
3. It authenticates to CoreHub using runtime-only credentials.
4. It opens the Referral tab and discovers new cases.
5. A stable CoreHub case identifier provides idempotency.
6. Referral information is persisted to Supabase.
7. The worker extracts registration, make, model, variant, fuel, CC and requested IDV.
8. OrangeBookValue is opened through its normal website flow.
9. The displayed valuation and result metadata are captured.
10. The deterministic decision engine compares requested and observed IDV.
11. Cases satisfying the configured rules become automation recommendations for an underwriter.
12. Ambiguous or failed cases go to manual review.
13. Significant events are written to the audit trail.
14. The browser context is closed when the run finishes.

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

- Dashboard
- Referral queue
- Global case search
- Manual-review queue
- Vehicle-resolution workbench
- Audit trail
- System health
- Decision configuration
- Controlled decision simulator

Supabase Auth and role-aware access controls protect the console.

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

The database uses Row Level Security, role-aware access, audit records, foreign keys, indexes and idempotency keys.

## Browser worker

The Playwright worker is intentionally environment-specific. Runtime configuration includes:

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
AUTOMATION_DRY_RUN
PLAYWRIGHT_HEADLESS
```

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

Validate IDV tolerance rules, vehicle-resolution logic and provider failure/retry behaviour.

### Controlled simulation

`/simulate` executes the real decision engine against controlled values without touching production websites.

### Browser dry run

The worker should first run against an authorised test environment in read-only/dry-run mode.

### Reconciliation

Before production use, compare extracted referral values, OBV valuations and recommendations against manually reviewed cases and obtain the required business approvals.

## Deployment model

### Web application

The Next.js control plane is suitable for Vercel deployment.

### Browser worker

The Playwright worker should run independently in an isolated scheduled environment such as an approved container or GitHub Actions runner. It must support Chromium, secure secrets, scheduling, network access to authorised sites and controlled artifact handling.

## Repository structure

```text
app/                    Next.js application routes
components/             Operations UI
src/domain/             Business and decision logic
src/connectors/         External/legacy adapters
worker/                 Sandboxed browser automation
tests/                  Automated tests
supabase/               Database migrations
.github/workflows/      CI workflows
appinfo.md              Complete application information
```

## Current status

Implemented: Next.js operations console, Supabase Auth/PostgreSQL foundation, RLS, deterministic IDV engine, vehicle-resolution foundation, manual-review workflow, audit trail, health/configuration pages, simulator and Playwright worker foundation.

Requires authorised environment validation: CoreHub login and Referral selectors, OrangeBookValue journey and result selectors, authentication/MFA/CAPTCHA behaviour, evidence storage, scheduler and production secrets.

The repository intentionally does not fabricate undocumented website selectors or API contracts.

## Documentation

See [`appinfo.md`](./appinfo.md) for the complete application inventory, configuration contract, architecture and operational status.

## License

This repository is intended for authorised internal use. Production deployment requires the applicable organisational approvals.
