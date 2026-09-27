# Motor IDV Deviation Workflow - Project Info

## Project IDs and Links

| Resource | Value |
|---|---|
| GitHub repository | https://github.com/krishnavarshney/motor-idv-deviation-workflow |
| GitHub default branch | main |
| Lovable workspace ID | sX1zSyP1NFkUCMAywqZ0 |
| Lovable project ID | 3900429a-28a3-47f8-aff8-c2d85c9fe62f |
| Supabase project ref | oyjirtozeoeeacogldpx |
| Supabase URL | https://oyjirtozeoeeacogldpx.supabase.co |
| Supabase region | ap-south-1 |
| Vercel team ID | team_J17ufC2e2aZBEnILQy9No7V7 |
| Vercel team slug | krishnavarshneys-projects |

## Important credential rule

Do not store Supabase passwords, service-role keys, OBV credentials, Vercel tokens, or other secrets in this file or GitHub. Use Vercel/Supabase environment variables and secret storage.

A database password was previously exposed during setup and must be rotated before production use.

## Architecture

- Frontend: React/TypeScript application prepared for Vercel.
- Authentication: Supabase Auth.
- Database: Supabase PostgreSQL.
- Authorization: Supabase RLS + profiles.role.
- Realtime: Supabase Realtime for workflow queues.
- Source control: GitHub.
- Deployment: Vercel.
- External valuation: isolated OBV connector.
- Decisioning: deterministic, explainable domain engine.

## OBV integration status

OBV publicly documents an Enterprise API integration panel and token generation, but the public documentation checked during development did not expose a canonical API endpoint path. The production connector therefore requires OBV_BASE_URL, OBV_API_TOKEN, and OBV_ENDPOINT_PATH and fails safely to manual review when they are not configured. Do not substitute a guessed endpoint or browser scraping.

## Vercel deployment status

Vercel team access is available for team_J17ufC2e2aZBEnILQy9No7V7 (krishnavarshneys-projects). No existing Vercel project for this repository was found during setup. The current connector exposes project inspection/deployment diagnostics but not project creation/import from GitHub, so deployment remains the next manual/connector step. No Vercel token or secret is stored here.

## 2026-09-27 build status

Implemented after Lovable handoff: professional operations shell, referral queue with filters, case detail evidence view, manual review queue and audited review action API, controlled decision simulator, runtime health, audit trail, admin decision configuration, database-backed decision config loader, RLS hardening, timestamp triggers, covering indexes, and standardized percentage tolerance semantics (2 means 2%).

Production database hardening was applied directly to Supabase project `oyjirtozeoeeacogldpx` and the matching migration is stored in `supabase/migrations/202609270006_rls_performance_hardening.sql`. Supabase security advisors are clear after hardening; remaining performance notices are expected unused-index notices on a new/empty workload. No production referral data exists yet.

GitHub Actions status cannot be verified through the current connector for push-triggered runs because the available workflow-run query is PR-filtered; combined status currently reports no external checks. Do not treat this as a successful CI result.
