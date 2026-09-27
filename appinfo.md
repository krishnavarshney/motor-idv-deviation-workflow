# Motor IDV Deviation Workflow

## Project identifiers
- GitHub: https://github.com/krishnavarshney/motor-idv-deviation-workflow
- GitHub branch: main
- Lovable workspace ID: sX1zSyP1NFkUCMAywqZ0
- Lovable project ID: 3900429a-28a3-47f8-aff8-c2d85c9fe62f
- Supabase project ref: oyjirtozeoeeacogldpx
- Supabase URL: https://oyjirtozeoeeacogldpx.supabase.co
- Supabase region: ap-south-1
- Vercel team ID: team_J17ufC2e2aZBEnILQy9No7V7
- Vercel team slug: krishnavarshneys-projects

## Current application
- Runtime: Next.js 16 App Router
- Auth: Supabase Auth + SSR + protected proxy
- Database: Supabase PostgreSQL
- Authorization: profiles.role + RLS
- Realtime: Supabase Realtime prepared for workflow queues
- Decision engine: pure TypeScript domain service
- Vehicle resolver: normalization + deterministic/fuzzy scoring
- OBV: isolated official-API adapter; endpoint path must be explicitly configured
- Fail-safe: provider/lookup uncertainty routes to manual review
- Audit: append-oriented audit_events with update/delete revoked from authenticated

## Decision configuration
- idv_abs_tolerance: 5000 INR
- idv_pct_tolerance: 2 percentage points
- vehicle_match_min_confidence: 85%
- obv_lookup_timeout_ms: 4000
- obv_max_retries: 2
- manual_review_sla_hours: 4

## Security and operational rules
- Never commit secrets, passwords, service-role keys or tokens.
- Never auto-approve when vehicle confidence is below threshold.
- Never auto-approve when the OBV provider is unavailable, rate-limited, timed out or returns invalid data.
- Every automated/manual decision must have a reason code and audit event.
- Manual decisions require reviewer notes and underwriter/admin role.
- Use idempotency keys for workflow intake/reprocessing.

## Controlled test mode
- /simulate runs the real decision engine against controlled requested/OBV IDVs.
- Controlled cases are stored with source_system=controlled-simulator and audited.
- CoreHub live intake and automatic production write-back are intentionally not enabled.

## Verification state
- Supabase security advisor: clean at last check.
- Supabase performance advisor: only unused-index notices remain on the near-empty dataset.
- GitHub Actions results are not observable through the current connector's push-run query. Do not claim CI green without an actual run result.
- Vercel project/deployment: not yet created/verified through the available connector.
