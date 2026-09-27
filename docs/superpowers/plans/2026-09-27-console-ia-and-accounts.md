# Console IA and Accounts Implementation Plan (Plan B of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slim the console to a role-filtered sidebar, fold debug pages into case detail and the Runs page, add Overview automation status, and add profile, team and role administration — closing the role-escalation hole in `profiles` on the way.

**Architecture:** Role checks live in one matrix (`lib/authz.ts`, from Plan A) used by the sidebar, page guards (`requirePageAction`) and route handlers (`requireAction`). RLS backs them up: a trigger blocks non-admins from changing `role`/`is_active`, and role helper functions ignore deactivated users. Team administration uses a server-only service-role client for Supabase Auth admin calls.

**Tech Stack:** Next.js 16 App Router, React 19, Supabase Auth + Postgres RLS, shadcn/ui (`radix-nova`), `next-themes`, `tsx` + `node:assert` tests.

**Spec:** `docs/superpowers/specs/2026-09-27-automation-console-design.md`, sections 2 and 3.

## Global Constraints

- **Plan A must be complete first.** This plan uses `lib/authz.ts` (`can`, `Role`, `Action`), `lib/api-auth.ts` (`getSessionProfile`, `requireAction`), `lib/worker-status.ts`, `components/nav.ts` (`activeHref`), `components/job-buttons.tsx`, `components/live-refresh.tsx`, `/automation` pages and the `automation_*` tables.
- Roles: `operator`, `underwriter`, `auditor`, `admin`. Matrix: view = all; run_jobs = operator, underwriter, admin; review = underwriter, admin; test_lookup = underwriter, admin; manage = admin; audit = auditor, admin.
- Sidebar groups and routes exactly: WORKSPACE — Overview `/`, Referrals `/referrals`, Review queue `/reviews`; AUTOMATION — Runs `/automation`, Schedules `/automation/schedules`; ADMIN — Decision rules `/admin/rules`, Team `/admin/team`, Audit log `/audit`.
- Deleted pages: `/vehicles`, `/health`, `/simulate`, `/settings` (redirected).
- New users default to role `operator`. An admin cannot demote or deactivate themself. The last active admin cannot be removed.
- Tests are plain `tsx` scripts with `node:assert`; each new test file is appended to the `test` script in `package.json`.
- `npm run lint` (`tsc --noEmit`) passes after every task.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/202609270010_profile_privileges.sql` | Block self role/status changes; inactive users lose RLS privileges; admin read/update of profiles |
| `lib/api-auth.ts` (modify) | Add `requirePageAction` |
| `lib/team.ts` | Pure guards for team changes; email check |
| `lib/format.ts` (modify) | Add `startOfDayIst` |
| `lib/supabase/admin.ts` | Service-role client for route handlers and server pages only |
| `components/nav.ts` (modify) | New groups with required action; `visibleNav(role)` |
| `components/app-sidebar.tsx` (modify) | Role-filtered nav, badges, user menu with profile + theme |
| `components/command-menu.tsx` (modify) | Role-filtered pages; "Fetch now" |
| `components/test-lookup-sheet.tsx` | Simulator in a sheet on the Runs page |
| `components/account-forms.tsx` | Name and password forms |
| `components/team-table.tsx` | Team rows with role/active controls and invite dialog |
| `app/(console)/admin/rules/page.tsx` | Moved from `settings/page.tsx` |
| `app/(console)/admin/team/page.tsx` | Team admin |
| `app/(console)/account/page.tsx` | Profile |
| `app/api/account/route.ts` | Update own name |
| `app/api/admin/team/route.ts`, `app/api/admin/team/[id]/route.ts` | Invite; change role / active |
| `app/auth/confirm/route.ts` | Email link (invite) verification |
| Modified: `app/(console)/layout.tsx`, `app/(console)/page.tsx`, `app/(console)/referrals/[id]/page.tsx`, `app/(console)/reviews/page.tsx`, `app/(console)/reviews/[id]/page.tsx`, `app/(console)/audit/page.tsx`, `app/(console)/automation/page.tsx`, `app/api/reviews/[id]/route.ts`, `next.config.ts`, `proxy.ts` |
| Deleted: `app/(console)/vehicles/page.tsx`, `app/(console)/health/page.tsx`, `app/(console)/simulate/page.tsx`, `components/theme-toggle.tsx` |

---

### Task 1: Close the profile privilege hole

**Files:**
- Create: `supabase/migrations/202609270010_profile_privileges.sql`

**Interfaces:**
- Produces: non-admin users can no longer change `profiles.role` or `profiles.is_active` (error code `42501`); `current_user_role()` and `is_privileged_user()` return null/false for inactive users; admins can select and update every profile.

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- Migration 010: profile privilege hardening
-- profiles_update_self allowed any user to set their own role (including admin).
-- =============================================================================

create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service role / SQL editor calls carry no end-user JWT.
  if auth.uid() is null then
    return new;
  end if;
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and public.current_user_role() is distinct from 'admin' then
    raise exception 'Only admins can change roles or account status' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_privileges on public.profiles;
create trigger profiles_guard_privileges before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- Deactivated users lose every RLS privilege that goes through these helpers.
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_privileged_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and is_active and role in ('operator', 'underwriter', 'admin')
  )
$$;

drop policy if exists profiles_admin_select on public.profiles;
create policy profiles_admin_select on public.profiles
  for select to authenticated using (public.current_user_role() = 'admin');

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');
```

- [ ] **Step 2: Apply**

Run: `npx supabase db push` or paste into the Supabase SQL editor.
Expected: no errors.

- [ ] **Step 3: Verify the hole is closed**

In the SQL editor, replacing `<operator-uuid>` with a real non-admin user id:

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<operator-uuid>","role":"authenticated"}';
update public.profiles set role = 'admin' where id = '<operator-uuid>';
rollback;
```

Expected: `ERROR: Only admins can change roles or account status`. Repeat with `set full_name = 'x'` instead → succeeds (then rollback).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/202609270010_profile_privileges.sql
git commit -m "fix(db): block self role escalation and strip privileges from inactive users

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Page guards and review route role check

**Files:**
- Modify: `lib/api-auth.ts`, `app/api/reviews/[id]/route.ts`, `app/(console)/reviews/page.tsx`, `app/(console)/reviews/[id]/page.tsx`, `app/(console)/audit/page.tsx`

**Interfaces:**
- Consumes: `getSessionProfile`, `requireAction`, `can` (Plan A).
- Produces: `requirePageAction(action: Action): Promise<{ supabase; user: User; role: Role | null; fullName: string | null }>` — redirects to `/login` when signed out, renders 404 when the role lacks the action.

- [ ] **Step 1: Add `requirePageAction` to `lib/api-auth.ts`**

Add to the imports:

```ts
import { notFound, redirect } from "next/navigation";
```

Append:

```ts
/** Server-page guard: sign-in required, and a 404 (not a hint) for roles without access. */
export async function requirePageAction(action: Action) {
  const supabase = await createClient();
  const profile = await getSessionProfile(supabase);
  if (!profile) redirect("/login");
  if (!can(profile.role, action)) notFound();
  return { supabase, ...profile };
}
```

- [ ] **Step 2: Remove silent role elevation from the review route**

In `app/api/reviews/[id]/route.ts`, delete everything from the line `const supabase = await createClient();` through the closing `}` of the `if (!profile?.is_active) { … }` block (this includes the profile upsert that created underwriters and the "Elevate operator to underwriter" update). Put in its place:

```ts
  const auth = await requireAction("review");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
```

Replace the import `import { createClient } from "@/lib/supabase/server";` with:

```ts
import { requireAction } from "@/lib/api-auth";
```

- [ ] **Step 3: Guard the review and audit pages**

In each file below, replace `const supabase = await createClient();` with the guard line shown, and remove the now-unused `import { createClient } from "@/lib/supabase/server";`:

| File | Replacement |
|---|---|
| `app/(console)/reviews/page.tsx` | `const { supabase } = await requirePageAction("review");` |
| `app/(console)/reviews/[id]/page.tsx` | `const { supabase } = await requirePageAction("review");` |
| `app/(console)/audit/page.tsx` | `const { supabase } = await requirePageAction("audit");` |

Add `import { requirePageAction } from "@/lib/api-auth";` to each.

- [ ] **Step 4: Verify**

Run: `npm run lint && npm test && npm run build`
Expected: pass.
Manual: as an operator, `/reviews` and `/audit` show the 404 page; `POST /api/reviews/<id>` from the console returns `403` and the operator's role is unchanged in `profiles`. As an underwriter, reviewing still works end to end.

- [ ] **Step 5: Commit**

```bash
git add lib/api-auth.ts app/api/reviews app/\(console\)/reviews app/\(console\)/audit
git commit -m "fix(auth): enforce review and audit roles; stop auto-elevating operators

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Role-filtered sidebar, badges, page moves and deletions

**Files:**
- Modify: `components/nav.ts`, `components/app-sidebar.tsx`, `components/command-menu.tsx`, `app/(console)/layout.tsx`, `next.config.ts`, `app/(console)/page.tsx` (header action), `tests/console-rules.test.ts`
- Move: `app/(console)/settings/page.tsx` → `app/(console)/admin/rules/page.tsx`
- Delete: `app/(console)/vehicles/page.tsx`, `app/(console)/health/page.tsx`, `app/(console)/simulate/page.tsx`

**Interfaces:**
- Consumes: `can`, `Role`, `Action` (Plan A); `requirePageAction` (Task 2).
- Produces:
  - `NAV` items carry `action: Action`; `visibleNav(role: string | null | undefined)` returns groups with only permitted items (empty groups dropped); `activeHref` unchanged.
  - `AppSidebar` props: `{ userEmail: string; fullName: string | null; role: Role | null; badges: Record<string, number> }`
  - `CommandMenu` props: `{ role: Role | null }`

- [ ] **Step 1: Write the failing test**

Append to `main()` in `tests/console-rules.test.ts`, before the final `console.log`:

```ts
  // Sidebar visibility
  const titles = (role: string | null) => visibleNav(role).flatMap((g) => g.items.map((i) => i.title));
  assert.deepEqual(titles("operator"), ["Overview", "Referrals", "Runs", "Schedules"]);
  assert.deepEqual(titles("underwriter"), ["Overview", "Referrals", "Review queue", "Runs", "Schedules"]);
  assert.deepEqual(titles("auditor"), ["Overview", "Referrals", "Runs", "Schedules", "Audit log"]);
  assert.deepEqual(titles("admin"), ["Overview", "Referrals", "Review queue", "Runs", "Schedules", "Decision rules", "Team", "Audit log"]);
  assert.deepEqual(visibleNav(null), []);
  assert.equal(activeHref("/automation/schedules"), "/automation/schedules");
  assert.equal(activeHref("/automation/jobs/123"), "/automation");
  assert.equal(activeHref("/"), "/");
```

and add the import at the top:

```ts
import { activeHref, visibleNav } from "../components/nav";
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsx tests/console-rules.test.ts`
Expected: FAIL — `visibleNav` is not exported.

- [ ] **Step 3: Rewrite `components/nav.ts`**

```ts
import { Archive, Bot, CalendarClock, ClipboardCheck, FileClock, LayoutDashboard, SlidersHorizontal, Users } from "lucide-react";
import { can } from "@/lib/authz";

export const NAV = [
  {
    label: "Workspace",
    items: [
      { title: "Overview", href: "/", icon: LayoutDashboard, action: "view" },
      { title: "Referrals", href: "/referrals", icon: Archive, action: "view" },
      { title: "Review queue", href: "/reviews", icon: ClipboardCheck, action: "review" },
    ],
  },
  {
    label: "Automation",
    items: [
      { title: "Runs", href: "/automation", icon: Bot, action: "view" },
      { title: "Schedules", href: "/automation/schedules", icon: CalendarClock, action: "view" },
    ],
  },
  {
    label: "Admin",
    items: [
      { title: "Decision rules", href: "/admin/rules", icon: SlidersHorizontal, action: "manage" },
      { title: "Team", href: "/admin/team", icon: Users, action: "manage" },
      { title: "Audit log", href: "/audit", icon: FileClock, action: "audit" },
    ],
  },
] as const;

export function visibleNav(role: string | null | undefined) {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(role, i.action)) })).filter((g) => g.items.length > 0);
}

/** Longest nav href matching the path, so /automation/schedules doesn't also light up /automation. */
export function activeHref(pathname: string): string | undefined {
  return NAV.flatMap((g) => g.items.map((i) => i.href as string))
    .filter((h) => (h === "/" ? pathname === "/" : pathname === h || pathname.startsWith(h + "/")))
    .sort((a, b) => b.length - a.length)[0];
}
```

`tests/` imports `../components/nav`, which imports `@/lib/authz`. `tsx` resolves the `@/` alias from `tsconfig.json` paths; if it does not, change that one import to `../lib/authz`.

- [ ] **Step 4: Run the test**

Run: `npx tsx tests/console-rules.test.ts`
Expected: `console rules tests passed`.

- [ ] **Step 5: Sidebar uses role and badges**

In `components/app-sidebar.tsx`:
- Replace `import { NAV, activeHref } from "@/components/nav";` with `import { activeHref, visibleNav } from "@/components/nav";` and add `SidebarMenuBadge` to the `@/components/ui/sidebar` import list; add `import type { Role } from "@/lib/authz";`.
- Change the signature to:

```tsx
export function AppSidebar({
  userEmail,
  fullName,
  role,
  badges,
}: {
  userEmail: string;
  fullName: string | null;
  role: Role | null;
  badges: Record<string, number>;
}) {
```

- Replace `{NAV.map((group) => (` with `{visibleNav(role).map((group) => (`.
- Inside each `SidebarMenuItem`, directly after the closing `</SidebarMenuButton>`, add:

```tsx
                  {badges[item.href] ? <SidebarMenuBadge>{badges[item.href]}</SidebarMenuBadge> : null}
```

`fullName` is used by the user menu in Task 7.

- [ ] **Step 6: Command menu uses role and offers "Fetch now"**

In `components/command-menu.tsx`:
- Replace `import { NAV } from "@/components/nav";` with:

```tsx
import { CloudDownload } from "lucide-react";
import { toast } from "sonner";
import { visibleNav } from "@/components/nav";
import { can, type Role } from "@/lib/authz";
```

- Change `export function CommandMenu() {` to `export function CommandMenu({ role }: { role: Role | null }) {`.
- After the `go` function add:

```tsx
  const fetchNow = async () => {
    setOpen(false);
    const r = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "fetch" }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) toast.success("Fetch from CoreHub queued");
    else toast.error(d.error || "Unable to queue fetch");
    router.refresh();
  };
```

- Replace `{NAV.map((group, i) => (` with `{visibleNav(role).map((group, i) => (`.
- Directly after the `{query.trim() && ( … )}` search group, add:

```tsx
            {can(role, "run_jobs") && (
              <CommandGroup heading="Actions">
                <CommandItem value="fetch now corehub" onSelect={fetchNow}>
                  <CloudDownload />
                  Fetch from CoreHub now
                </CommandItem>
              </CommandGroup>
            )}
```

- [ ] **Step 7: Layout passes role, name and badge counts**

In `app/(console)/layout.tsx`:
- Add imports `import { getSessionProfile } from "@/lib/api-auth";` and `import { can } from "@/lib/authz";`.
- Replace

```tsx
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
```

with

```tsx
  const profile = await getSessionProfile(supabase);
  if (!profile) redirect("/login");
  const { user, role, fullName } = profile;
```

- After the `worker` line add:

```tsx
  const [{ count: received }, { count: myReviews }] = await Promise.all([
    supabase.from("referral_cases").select("id", { count: "exact", head: true }).eq("referral_status", "received"),
    can(role, "review")
      ? supabase
          .from("manual_reviews")
          .select("id", { count: "exact", head: true })
          .neq("review_status", "completed")
          .or(`assigned_to.is.null,assigned_to.eq.${user.id}`)
      : Promise.resolve({ count: 0 }),
  ]);
  const badges = { "/referrals": received ?? 0, "/reviews": myReviews ?? 0 };
```

- Replace `<AppSidebar userEmail={user.email ?? ""} />` with `<AppSidebar userEmail={user.email ?? ""} fullName={fullName} role={role} badges={badges} />`.
- Replace `<CommandMenu />` with `<CommandMenu role={role} />`.

- [ ] **Step 8: Move rules, delete folded pages, add redirects**

```bash
mkdir -p "app/(console)/admin/rules"
git mv "app/(console)/settings/page.tsx" "app/(console)/admin/rules/page.tsx"
git rm "app/(console)/vehicles/page.tsx" "app/(console)/health/page.tsx" "app/(console)/simulate/page.tsx"
```

In `app/(console)/admin/rules/page.tsx`: replace `const supabase = await createClient();` with `const { supabase } = await requirePageAction("manage");`, swap the `createClient` import for `import { requirePageAction } from "@/lib/api-auth";`, change `metadata` title to `"Decision rules"`, `eyebrow="Governance"` to `eyebrow="Admin"`, and `title="Decision configuration"` to `title="Decision rules"`.

Replace `next.config.ts` with:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["playwright"],
  async redirects() {
    return [
      { source: "/settings", destination: "/admin/rules", permanent: true },
      { source: "/simulate", destination: "/automation", permanent: false },
      { source: "/health", destination: "/automation", permanent: false },
      { source: "/vehicles", destination: "/referrals", permanent: false },
    ];
  },
};

export default nextConfig;
```

In `app/(console)/page.tsx` replace the header action

```tsx
          <Button asChild>
            <Link href="/simulate">
              Run controlled test <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
```

with

```tsx
          <Button asChild variant="outline">
            <Link href="/automation">
              View runs <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
```

- [ ] **Step 9: Verify**

Run: `npm run lint && npm test && npm run build`
Expected: pass; build has no `/vehicles`, `/health`, `/simulate`, `/settings` pages and has `/admin/rules`.
Run: `git grep -n '"/simulate"\|"/vehicles"\|"/health"\|"/settings"' -- app components` → only `next.config.ts` redirects remain (none in app/components).
Manual: sidebar per role matches the Step 1 table; Referrals shows a received-count badge; `/settings` redirects to `/admin/rules`; ⌘K shows "Fetch from CoreHub now" for operators but not auditors.

- [ ] **Step 10: Commit**

```bash
git add -A components/nav.ts components/app-sidebar.tsx components/command-menu.tsx app/\(console\) next.config.ts tests/console-rules.test.ts
git commit -m "feat(ui): role-filtered sidebar with badges; fold vehicles, health and simulator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Case detail tabs

**Files:**
- Modify: `app/(console)/referrals/[id]/page.tsx`

**Interfaces:**
- Consumes: `DecisionEvidence`, `VehicleCard` (`components/decision-evidence.tsx`), `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` (`components/ui/tabs.tsx`), `DetailList`, `money`, `dateTime`, `humanize`.
- Produces: case detail with tabs Summary · Vehicle match · OBV evidence · Timeline. (Evidence screenshots stay on the worker host; they are not served to the console.)

- [ ] **Step 1: Imports**

Add:

```tsx
import { ExternalLink } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money } from "@/lib/format";
```

(merge `money` into the existing `@/lib/format` import rather than duplicating it.)

- [ ] **Step 2: Replace the body grid with tabs**

Replace the whole `<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]"> … </div>` block (from `DecisionEvidence` through the Audit timeline card) with:

```tsx
      <Tabs defaultValue="summary" className="flex flex-col gap-4">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="vehicle">Vehicle match</TabsTrigger>
          <TabsTrigger value="obv">OBV evidence</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="summary">
          <DecisionEvidence decision={decision} idv={idv} requestedIdv={caseRow.requested_idv} />
        </TabsContent>

        <TabsContent value="vehicle" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <VehicleCard resolution={resolution} fallback={caseRow} />
          <Card className="self-start">
            <CardHeader>
              <CardTitle>From CoreHub</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  ["Registration", <span key="r" className="font-mono uppercase">{caseRow.registration_number || "—"}</span>],
                  ["Make", caseRow.make_raw || "—"],
                  ["Model", caseRow.model_raw || "—"],
                  ["Variant", caseRow.variant_raw || "—"],
                  ["Fuel", caseRow.fuel_type_raw || "—"],
                  ["CC", caseRow.cc_raw || "—"],
                  ["Workflow", humanize(caseRow.workflow_status)],
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="obv" className="grid gap-4 xl:grid-cols-2">
          <Card className="self-start">
            <CardHeader>
              <CardTitle>Lookup</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <DetailList
                items={[
                  ["Provider", idv?.provider ?? "—"],
                  ["Status", humanize(idv?.provider_status)],
                  ["Base valuation", money(idv?.fetched_idv)],
                  ["Latency", idv?.lookup_latency_ms == null ? "—" : `${idv.lookup_latency_ms} ms`],
                  ["Fetched", dateTime(idv?.fetched_at)],
                  ["Reason", idv?.raw_response?.reasonCode ?? "—"],
                ]}
              />
              {idv?.raw_response?.sourceUrl && (
                <Button variant="outline" size="sm" asChild className="w-fit">
                  <a href={idv.raw_response.sourceUrl} target="_blank" rel="noreferrer">
                    <ExternalLink data-icon="inline-start" />
                    Open OBV result page
                  </a>
                </Button>
              )}
            </CardContent>
          </Card>
          <Card className="self-start pb-0">
            <CardHeader>
              <CardTitle>Condition tiers</CardTitle>
            </CardHeader>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Tier</TableHead>
                  <TableHead className="text-right">Min</TableHead>
                  <TableHead className="pr-4 text-right">Max</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(
                  [
                    ["Good", idv?.raw_response?.conditions?.good],
                    ["Very good", idv?.raw_response?.conditions?.veryGood],
                    ["Excellent", idv?.raw_response?.conditions?.excellent],
                  ] as const
                ).map(([label, tier]) => (
                  <TableRow key={label}>
                    <TableCell className="pl-4">{label}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{money(tier?.min)}</TableCell>
                    <TableCell className="pr-4 text-right font-mono tabular-nums">{money(tier?.max)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="timeline">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="size-4 text-muted-foreground" />
                Audit timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-4 border-l pl-4">
                {(events ?? []).map((e) => (
                  <li key={e.id} className="relative">
                    <span
                      className={cn(
                        "absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-4 ring-card",
                        e.severity === "error" ? "bg-destructive" : e.severity === "warning" ? "bg-warning" : "bg-primary",
                      )}
                    />
                    <div className="text-sm font-medium capitalize">{humanize(e.event_type)}</div>
                    <div className="text-xs text-muted-foreground">
                      {dateTime(e.created_at)} · {e.actor_type} · {e.severity}
                    </div>
                  </li>
                ))}
                {!events?.length && <li className="text-sm text-muted-foreground">No events recorded.</li>}
              </ol>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
```

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build`
Expected: pass.
Manual: open a case evaluated by Plan A → four tabs; OBV evidence shows base valuation, tiers and a working "Open OBV result page" link; a case with no lookup shows dashes, not errors.

- [ ] **Step 4: Commit**

```bash
git add "app/(console)/referrals/[id]/page.tsx"
git commit -m "feat(referrals): case detail tabs for summary, vehicle, OBV evidence and timeline

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Test lookup sheet on the Runs page

**Files:**
- Create: `components/test-lookup-sheet.tsx`
- Modify: `app/(console)/automation/page.tsx`

**Interfaces:**
- Consumes: `SimulateClient({ decisionConfig, recentCases })` (`components/simulate-client.tsx`); `loadDecisionConfig` (`src/server/idv-config.ts`); `Sheet*` (`components/ui/sheet.tsx`).
- Produces: `<TestLookupSheet decisionConfig={DecisionConfig} recentCases={…[]} />`.

- [ ] **Step 1: Create `components/test-lookup-sheet.tsx`**

```tsx
"use client";

import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SimulateClient } from "@/components/simulate-client";
import type { DecisionConfig } from "@/src/domain/motor-idv";

export function TestLookupSheet({
  decisionConfig,
  recentCases,
}: {
  decisionConfig: DecisionConfig;
  recentCases: Parameters<typeof SimulateClient>[0]["recentCases"];
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          <FlaskConical data-icon="inline-start" />
          Test lookup
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-4xl">
        <SheetHeader>
          <SheetTitle>Test lookup</SheetTitle>
          <SheetDescription>Run an OBV valuation and the live decision rules without creating a case.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <SimulateClient decisionConfig={decisionConfig} recentCases={recentCases} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Wire into the Runs page**

In `app/(console)/automation/page.tsx`:
- Add imports `import { TestLookupSheet } from "@/components/test-lookup-sheet";` and `import { loadDecisionConfig } from "@/src/server/idv-config";`.
- After the existing `Promise.all`, add:

```tsx
  const canTest = can(profile?.role, "test_lookup");
  const [decisionConfig, { data: recentCases }] = canTest
    ? await Promise.all([
        loadDecisionConfig(supabase),
        supabase
          .from("referral_cases")
          .select("id, external_case_id, make_raw, model_raw, variant_raw, requested_idv, referral_status, metadata")
          .order("created_at", { ascending: false })
          .limit(8),
      ])
    : [null, { data: null }];
```

- Replace the `PageHeader` `actions` prop with:

```tsx
        actions={
          <>
            {canTest && decisionConfig && <TestLookupSheet decisionConfig={decisionConfig} recentCases={recentCases ?? []} />}
            {canRun && <FetchButton disabledReason={fetchReason} />}
          </>
        }
```

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build`
Expected: pass.
Manual: as underwriter, `/automation` → **Test lookup** opens a wide sheet with the simulator; running a simulation behaves as the old `/simulate` page did. As operator the button is absent.

- [ ] **Step 4: Commit**

```bash
git add components/test-lookup-sheet.tsx "app/(console)/automation/page.tsx"
git commit -m "feat(automation): test lookup sheet replaces the simulator page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Overview — automation status, today's funnel, needs attention

**Files:**
- Modify: `lib/format.ts`, `app/(console)/page.tsx`, `tests/console-rules.test.ts`

**Interfaces:**
- Consumes: `getWorkerStatus` (Plan A), `DetailList`.
- Produces: `startOfDayIst(now: Date): Date` in `lib/format.ts` (midnight Asia/Kolkata as a UTC instant).

- [ ] **Step 1: Failing test**

Append to `main()` in `tests/console-rules.test.ts`:

```ts
  // Midnight IST as a UTC instant
  assert.equal(startOfDayIst(new Date("2026-09-27T20:00:00Z")).toISOString(), "2026-09-27T18:30:00.000Z"); // 01:30 IST on the 28th
  assert.equal(startOfDayIst(new Date("2026-09-27T12:00:00Z")).toISOString(), "2026-09-26T18:30:00.000Z"); // 17:30 IST on the 27th
```

Add `import { startOfDayIst } from "../lib/format";`.

Run: `npx tsx tests/console-rules.test.ts` → FAIL (`startOfDayIst` not exported).

- [ ] **Step 2: Implement in `lib/format.ts`**

```ts
const IST_OFFSET_MS = 5.5 * 3_600_000; // India has no DST

export function startOfDayIst(now: Date) {
  return new Date(Math.floor((now.getTime() + IST_OFFSET_MS) / 86_400_000) * 86_400_000 - IST_OFFSET_MS);
}
```

Run the test → `console rules tests passed`.

- [ ] **Step 3: Load automation data on the Overview**

In `app/(console)/page.tsx`:
- Add imports:

```tsx
import { Bot } from "lucide-react";
import { DetailList } from "@/components/console";
import { getWorkerStatus } from "@/lib/worker-status";
import { startOfDayIst } from "@/lib/format";
```

(merge into existing imports from the same modules instead of duplicating).
- After the existing `Promise.all`, add:

```tsx
  const today = startOfDayIst(new Date()).toISOString();
  const soon = new Date(Date.now() + 3_600_000).toISOString();
  const [worker, { data: nextSchedule }, { data: todayCases }, { data: slaRisk }, { data: failedJobs }] = await Promise.all([
    getWorkerStatus(supabase),
    supabase.from("automation_schedules").select("name,next_run_at").eq("enabled", true).order("next_run_at").limit(1).maybeSingle(),
    supabase.from("referral_cases").select("referral_status").gte("received_at", today).limit(5000),
    supabase
      .from("manual_reviews")
      .select("id,sla_due_at,referral_cases(external_case_id)")
      .neq("review_status", "completed")
      .lt("sla_due_at", soon)
      .order("sla_due_at")
      .limit(5),
    supabase
      .from("automation_jobs")
      .select("id,type,error,finished_at")
      .eq("status", "failed")
      .gte("created_at", new Date(Date.now() - 86_400_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(5),
  ]);
  const funnel = { fetched: todayCases?.length ?? 0, approved: 0, manual: 0, failed: 0 };
  for (const c of todayCases ?? []) {
    if (c.referral_status === "approved") funnel.approved++;
    else if (c.referral_status === "manual_review") funnel.manual++;
    else if (c.referral_status === "failed") funnel.failed++;
  }
```

- [ ] **Step 4: Render the two cards**

In the right-hand column, replace the opening `<Card className="self-start">` of the "Recent audit activity" card with a wrapper so the column stacks:

```tsx
        <div className="flex flex-col gap-4 self-start">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="size-4 text-muted-foreground" />
                Automation
              </CardTitle>
              <CardAction>
                <Button variant="link" size="sm" asChild className="px-0">
                  <Link href="/automation">Runs</Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  ["Worker", worker.online ? "Online" : "Offline"],
                  ["Next scheduled run", nextSchedule ? `${dateTime(nextSchedule.next_run_at)} · ${nextSchedule.name}` : "No schedule enabled"],
                  ["Received today", funnel.fetched],
                  ["Auto-approved today", funnel.approved],
                  ["Manual review today", funnel.manual],
                  ["Failed today", funnel.failed],
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Needs attention</CardTitle>
              <CardDescription>Reviews due within an hour and jobs that failed in the last day</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-3 text-sm">
                {(slaRisk ?? []).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3">
                    <Link href={`/reviews/${r.id}`} className="font-mono hover:underline">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                      {(r.referral_cases as any)?.external_case_id ?? "Review"}
                    </Link>
                    <span className={cn("text-xs", new Date(r.sla_due_at).getTime() < Date.now() ? "text-destructive" : "text-warning")}>
                      SLA {dateTime(r.sla_due_at)}
                    </span>
                  </li>
                ))}
                {(failedJobs ?? []).map((j) => (
                  <li key={j.id} className="flex items-center justify-between gap-3">
                    <Link href={`/automation/jobs/${j.id}`} className="capitalize hover:underline">
                      {j.type} job failed
                    </Link>
                    <span className="truncate text-xs text-muted-foreground" title={j.error ?? undefined}>
                      {dateTime(j.finished_at)}
                    </span>
                  </li>
                ))}
                {!slaRisk?.length && !failedJobs?.length && <li className="text-muted-foreground">Nothing needs attention.</li>}
              </ul>
            </CardContent>
          </Card>

          <Card>
```

and after the audit card's closing `</Card>` add the wrapper's closing `</div>`.

- [ ] **Step 5: Verify**

Run: `npm run lint && npm test && npm run build`
Expected: pass.
Manual: Overview right column shows Automation (worker state, next scheduled run, today's counts) and Needs attention; counts match `/referrals` filtered by today's cases.

- [ ] **Step 6: Commit**

```bash
git add lib/format.ts "app/(console)/page.tsx" tests/console-rules.test.ts
git commit -m "feat(overview): automation status, today's funnel and needs-attention list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: User menu with profile link and theme

**Files:**
- Modify: `components/app-sidebar.tsx`, `app/(console)/layout.tsx`
- Delete: `components/theme-toggle.tsx`

**Interfaces:**
- Consumes: `fullName`, `role` props (Task 3); `useTheme` from `next-themes`.
- Produces: footer menu — name, role badge, Profile (`/account`), Theme (Light / Dark / System), Sign out.

- [ ] **Step 1: Update the footer in `components/app-sidebar.tsx`**

Add to imports: `Monitor, Moon, Sun, UserRound` from `lucide-react`; `DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger` from `@/components/ui/dropdown-menu`; `import { useTheme } from "next-themes";` and `import { Badge } from "@/components/ui/badge";`.

Inside the component body add:

```tsx
  const { theme, setTheme } = useTheme();
  const displayName = fullName || userEmail;
  const initials = (fullName || userEmail).slice(0, 2).toUpperCase();
```

and delete the old `const initials = userEmail.slice(0, 2).toUpperCase();`.

In the trigger button replace:

```tsx
                    <span className="truncate text-sm font-medium">{userEmail}</span>
                    <span className="truncate text-xs text-muted-foreground">Underwriting operations</span>
```

with:

```tsx
                    <span className="truncate text-sm font-medium">{displayName}</span>
                    <span className="truncate text-xs text-muted-foreground capitalize">{role ?? "No access"}</span>
```

Replace the dropdown content's `DropdownMenuLabel` through the end of the `DropdownMenuGroup` with:

```tsx
                <DropdownMenuLabel className="flex flex-col gap-1 font-normal">
                  <span className="truncate text-sm font-medium">{displayName}</span>
                  <span className="truncate text-xs text-muted-foreground">{userEmail}</span>
                  {role && (
                    <Badge variant="secondary" className="capitalize">
                      {role}
                    </Badge>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem asChild>
                    <Link href="/account">
                      <UserRound />
                      Profile
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Sun />
                      Theme
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
                        <DropdownMenuRadioItem value="light">
                          <Sun />
                          Light
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="dark">
                          <Moon />
                          Dark
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="system">
                          <Monitor />
                          System
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <form action="/auth/signout" method="post">
                    <DropdownMenuItem asChild>
                      <button type="submit" className="w-full">
                        <LogOut />
                        Sign out
                      </button>
                    </DropdownMenuItem>
                  </form>
                </DropdownMenuGroup>
```

- [ ] **Step 2: Remove the header toggle**

In `app/(console)/layout.tsx` delete `import { ThemeToggle } from "@/components/theme-toggle";` and the `<ThemeToggle />` element. Then:

```bash
git rm components/theme-toggle.tsx
```

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build`
Expected: pass; `git grep -n ThemeToggle` returns nothing.
Manual: footer shows full name (or email when none) and role; Theme submenu switches light/dark/system and persists across reload; Profile goes to `/account` (404 until Task 8).

- [ ] **Step 4: Commit**

```bash
git add -A components/app-sidebar.tsx "app/(console)/layout.tsx" components/theme-toggle.tsx
git commit -m "feat(ui): user menu with profile, role and theme

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Profile page and invite-link confirmation

**Files:**
- Create: `app/api/account/route.ts`, `components/account-forms.tsx`, `app/(console)/account/page.tsx`, `app/auth/confirm/route.ts`
- Modify: `proxy.ts`

**Interfaces:**
- Consumes: `getSessionProfile`, `requireAction("view")`; browser `createClient` (`lib/supabase/client.ts`).
- Produces:
  - `PATCH /api/account` body `{ full_name: string }` (1–80 chars) → `200 { ok: true }`
  - `GET /auth/confirm?token_hash=…&type=invite|recovery|email&next=/path` → verifies and redirects to `next` (default `/account?welcome=1`), or `/login?error=link`
  - `<NameForm initial={string} />`, `<PasswordForm />`

- [ ] **Step 1: Create `app/api/account/route.ts`**

```ts
import { NextResponse } from "next/server";
import { requireAction } from "@/lib/api-auth";

export async function PATCH(request: Request) {
  const auth = await requireAction("view");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const body = await request.json().catch(() => null);
  const fullName = typeof body?.full_name === "string" ? body.full_name.trim() : "";
  if (!fullName || fullName.length > 80) return NextResponse.json({ error: "Name must be 1–80 characters" }, { status: 400 });

  const { error } = await supabase.from("profiles").update({ full_name: fullName }).eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await supabase.from("audit_events").insert({
    event_type: "profile_updated",
    actor_type: "user",
    actor_id: user.id,
    severity: "info",
    payload: { fields: ["full_name"] },
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Create `components/account-forms.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { createClient } from "@/lib/supabase/client";

export function NameForm({ initial }: { initial: string }) {
  const router = useRouter();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = name.trim() !== initial && name.trim().length > 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await fetch("/api/account", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ full_name: name }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast.error(d.error || "Unable to save");
    toast.success("Name updated");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="full-name">Full name</FieldLabel>
        <Input id="full-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </Field>
      <Button type="submit" className="w-fit" disabled={!dirty || busy}>
        {busy && <Spinner data-icon="inline-start" />}
        Save
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= 8 && confirm === password;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(error.message);
    setPassword("");
    setConfirm("");
    toast.success("Password updated");
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <Field data-invalid={tooShort || undefined}>
        <FieldLabel htmlFor="new-password">New password</FieldLabel>
        <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {tooShort ? <FieldError>At least 8 characters.</FieldError> : <FieldDescription>At least 8 characters.</FieldDescription>}
      </Field>
      <Field data-invalid={mismatch || undefined}>
        <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
        <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {mismatch && <FieldError>Passwords don’t match.</FieldError>}
      </Field>
      <Button type="submit" className="w-fit" disabled={!ready || busy}>
        {busy && <Spinner data-icon="inline-start" />}
        Update password
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Create `app/(console)/account/page.tsx`**

```tsx
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList, PageHeader } from "@/components/console";
import { NameForm, PasswordForm } from "@/components/account-forms";
import { getSessionProfile } from "@/lib/api-auth";
import { dateTime, humanize } from "@/lib/format";

export const metadata = { title: "Profile" };

export default async function Account({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { welcome } = await searchParams;
  const supabase = await createClient();
  const profile = await getSessionProfile(supabase);
  if (!profile) redirect("/login");
  const { data: events } = await supabase
    .from("audit_events")
    .select("id,event_type,created_at,case_id")
    .eq("actor_id", profile.user.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <>
      <PageHeader eyebrow="Account" title="Profile" description="Your name, password and recent activity." />

      {welcome && (
        <Alert>
          <KeyRound />
          <AlertTitle>Welcome</AlertTitle>
          <AlertDescription>Set a password below to finish setting up your account.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>Your role is managed by an admin.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <DetailList
              items={[
                ["Email", <span key="e" className="normal-case">{profile.user.email}</span>],
                ["Role", profile.role ?? "No access"],
                ["Last sign-in", dateTime(profile.user.last_sign_in_at)],
              ]}
            />
            <NameForm initial={profile.fullName ?? ""} />
          </CardContent>
        </Card>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Password</CardTitle>
          </CardHeader>
          <CardContent>
            <PasswordForm />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>My activity</CardTitle>
          <CardDescription>Your last 20 recorded actions</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y text-sm">
            {(events ?? []).map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-4 py-2">
                <span className="capitalize">{humanize(e.event_type)}</span>
                <span className="text-xs text-muted-foreground">{dateTime(e.created_at)}</span>
              </li>
            ))}
            {!events?.length && <li className="py-2 text-muted-foreground">No activity yet.</li>}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}
```

- [ ] **Step 4: Create `app/auth/confirm/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = ["invite", "recovery", "email", "signup", "magiclink", "email_change"];

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = url.searchParams.get("next") ?? "/account?welcome=1";
  // Only same-site relative paths: never redirect to another origin.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/account?welcome=1";

  if (tokenHash && type && TYPES.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(safeNext, request.url));
  }
  return NextResponse.redirect(new URL("/login?error=link", request.url));
}
```

- [ ] **Step 5: Let unauthenticated users reach `/auth/confirm`**

In `proxy.ts` replace:

```ts
  if (!claims && request.nextUrl.pathname !== "/login")
```

with:

```ts
  if (!claims && !["/login", "/auth/confirm"].includes(request.nextUrl.pathname))
```

- [ ] **Step 6: Configure the Supabase invite email (manual, dashboard)**

Tell the user to do this; it cannot be done from code:
1. Supabase Dashboard → Authentication → URL Configuration → Site URL = the deployed console URL.
2. Authentication → Email Templates → **Invite user**: set the link to
   `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/account?welcome=1`
3. Optionally the same pattern for **Reset password** with `type=recovery&next=/account`.

- [ ] **Step 7: Verify**

Run: `npm run lint && npm run build`
Expected: pass.
Manual: `/account` shows email, role, last sign-in; saving a new name updates the sidebar footer after refresh; setting a password (≥ 8 chars, matching) succeeds and signing in with it works; `/auth/confirm` with no params redirects to `/login?error=link`; `/auth/confirm?next=//evil.com&token_hash=x&type=invite` never redirects off-site.

- [ ] **Step 8: Commit**

```bash
git add app/api/account components/account-forms.tsx "app/(console)/account" app/auth/confirm proxy.ts
git commit -m "feat(account): profile page, password change and invite link confirmation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Team administration

**Files:**
- Create: `lib/team.ts`, `tests/team.test.ts`, `lib/supabase/admin.ts`, `app/api/admin/team/route.ts`, `app/api/admin/team/[id]/route.ts`, `components/team-table.tsx`, `app/(console)/admin/team/page.tsx`
- Modify: `package.json` (test script), `lib/authz.ts` (export `ROLES`)

**Interfaces:**
- Consumes: `requireAction("manage")`, `requirePageAction("manage")`, `Role`.
- Produces:
  - `lib/authz.ts`: `ROLES: readonly Role[] = ["operator", "underwriter", "auditor", "admin"]`
  - `lib/team.ts`: `type TeamPatch = { role?: Role; is_active?: boolean }`, `parseTeamPatch(body: unknown): { ok: true; value: TeamPatch } | { ok: false; error: string }`, `teamChangeError(i: { actorId: string; targetId: string; target: { role: Role; is_active: boolean }; patch: TeamPatch; activeAdminCount: number }): string | null`, `isEmail(s: string): boolean`
  - `lib/supabase/admin.ts`: `createAdminClient(): SupabaseClient` (service role; server only)
  - `POST /api/admin/team` `{ email, role? }` → `201 { id }`; `PATCH /api/admin/team/:id` `{ role?, is_active? }` → `200 { ok: true }`; `400`/`403`/`404`/`409` with `{ error }`

- [ ] **Step 1: Export roles**

In `lib/authz.ts` add below the `Role` type:

```ts
export const ROLES: readonly Role[] = ["operator", "underwriter", "auditor", "admin"];
```

- [ ] **Step 2: Write the failing test**

Create `tests/team.test.ts`:

```ts
import { strict as assert } from "node:assert";
import { isEmail, parseTeamPatch, teamChangeError } from "../lib/team";

function main() {
  const admin = { role: "admin" as const, is_active: true };
  const operator = { role: "operator" as const, is_active: true };

  // Self-protection
  assert.equal(teamChangeError({ actorId: "a", targetId: "a", target: admin, patch: { role: "operator" }, activeAdminCount: 3 }), "You can't remove your own admin access");
  assert.equal(teamChangeError({ actorId: "a", targetId: "a", target: admin, patch: { is_active: false }, activeAdminCount: 3 }), "You can't remove your own admin access");
  assert.equal(teamChangeError({ actorId: "a", targetId: "a", target: admin, patch: { role: "admin" }, activeAdminCount: 1 }), null);

  // Last active admin
  assert.equal(teamChangeError({ actorId: "a", targetId: "b", target: admin, patch: { role: "auditor" }, activeAdminCount: 1 }), "At least one active admin is required");
  assert.equal(teamChangeError({ actorId: "a", targetId: "b", target: admin, patch: { is_active: false }, activeAdminCount: 1 }), "At least one active admin is required");
  assert.equal(teamChangeError({ actorId: "a", targetId: "b", target: admin, patch: { role: "auditor" }, activeAdminCount: 2 }), null);

  // Ordinary changes
  assert.equal(teamChangeError({ actorId: "a", targetId: "b", target: operator, patch: { role: "underwriter" }, activeAdminCount: 1 }), null);
  assert.equal(teamChangeError({ actorId: "a", targetId: "b", target: operator, patch: { is_active: false }, activeAdminCount: 1 }), null);

  // Parsing
  assert.deepEqual(parseTeamPatch({ role: "auditor" }), { ok: true, value: { role: "auditor" } });
  assert.deepEqual(parseTeamPatch({ is_active: false }), { ok: true, value: { is_active: false } });
  assert.equal(parseTeamPatch({ role: "root" }).ok, false);
  assert.equal(parseTeamPatch({ is_active: "no" }).ok, false);
  assert.equal(parseTeamPatch({}).ok, false);

  assert.equal(isEmail("a.b@kiwi.example"), true);
  assert.equal(isEmail("not-an-email"), false);
  assert.equal(isEmail("a@b"), false);

  console.log("team tests passed");
}

main();
```

Run: `npx tsx tests/team.test.ts` → FAIL (`Cannot find module '../lib/team'`).

- [ ] **Step 3: Implement `lib/team.ts`**

```ts
import { ROLES, type Role } from "./authz";

export type TeamPatch = { role?: Role; is_active?: boolean };

export function parseTeamPatch(body: unknown): { ok: true; value: TeamPatch } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const value: TeamPatch = {};
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role as Role)) return { ok: false, error: "Invalid role" };
    value.role = b.role as Role;
  }
  if (b.is_active !== undefined) {
    if (typeof b.is_active !== "boolean") return { ok: false, error: "is_active must be true or false" };
    value.is_active = b.is_active;
  }
  if (value.role === undefined && value.is_active === undefined) return { ok: false, error: "Nothing to change" };
  return { ok: true, value };
}

export function teamChangeError(i: {
  actorId: string;
  targetId: string;
  target: { role: Role; is_active: boolean };
  patch: TeamPatch;
  activeAdminCount: number;
}): string | null {
  const losesAdmin = (i.patch.role !== undefined && i.patch.role !== "admin") || i.patch.is_active === false;
  if (i.actorId === i.targetId && losesAdmin) return "You can't remove your own admin access";
  if (i.target.role === "admin" && i.target.is_active && losesAdmin && i.activeAdminCount <= 1) {
    return "At least one active admin is required";
  }
  return null;
}

export function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
```

Run: `npx tsx tests/team.test.ts` → `team tests passed`. Append ` && tsx tests/team.test.ts` to the `test` script.

- [ ] **Step 4: Create `lib/supabase/admin.ts`**

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses RLS. Import only from route handlers and
 * server components — never from a "use client" module.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured for the console");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
```

Add a note to `.env.example` next to `SUPABASE_SERVICE_ROLE_KEY`: `# Also required by the console (Vercel, server-only) for Team administration`.

- [ ] **Step 5: Create `app/api/admin/team/route.ts` (invite)**

```ts
import { NextResponse } from "next/server";
import { requireAction } from "@/lib/api-auth";
import { ROLES, type Role } from "@/lib/authz";
import { isEmail } from "@/lib/team";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const auth = await requireAction("manage");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const role: Role = ROLES.includes(body?.role) ? body.role : "operator";
  if (!isEmail(email)) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: new URL("/account?welcome=1", request.url).toString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // handle_new_user() created the profile as operator; set the chosen role.
  if (role !== "operator") await admin.from("profiles").update({ role }).eq("id", data.user.id);

  await supabase.from("audit_events").insert({
    event_type: "team_member_invited",
    actor_type: "user",
    actor_id: user.id,
    severity: "info",
    payload: { invitedUserId: data.user.id, email, role },
  });
  return NextResponse.json({ id: data.user.id }, { status: 201 });
}
```

- [ ] **Step 6: Create `app/api/admin/team/[id]/route.ts` (role / active)**

```ts
import { NextResponse } from "next/server";
import { requireAction } from "@/lib/api-auth";
import type { Role } from "@/lib/authz";
import { parseTeamPatch, teamChangeError } from "@/lib/team";
import { createAdminClient } from "@/lib/supabase/admin";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireAction("manage");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;

  const parsed = parseTeamPatch(await request.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const patch = parsed.value;

  const admin = createAdminClient();
  const [{ data: target }, { count: activeAdminCount }] = await Promise.all([
    admin.from("profiles").select("role,is_active").eq("id", id).maybeSingle(),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin").eq("is_active", true),
  ]);
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const blocked = teamChangeError({
    actorId: user.id,
    targetId: id,
    target: target as { role: Role; is_active: boolean },
    patch,
    activeAdminCount: activeAdminCount ?? 0,
  });
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });

  const { error } = await admin.from("profiles").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  // Deactivation also blocks sign-in, not just RLS privileges.
  if (patch.is_active !== undefined) {
    await admin.auth.admin.updateUserById(id, { ban_duration: patch.is_active ? "none" : "876000h" });
  }

  await supabase.from("audit_events").insert({
    event_type: "team_member_updated",
    actor_type: "user",
    actor_id: user.id,
    severity: "info",
    payload: { userId: id, before: target, changes: patch },
  });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 7: Create `components/team-table.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLES, type Role } from "@/lib/authz";
import { dateTime } from "@/lib/format";

export type Member = { id: string; name: string | null; email: string; role: Role; is_active: boolean; last_sign_in_at: string | null };

async function send(url: string, method: string, body: unknown) {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Request failed");
}

export function InviteDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [busy, setBusy] = useState(false);

  async function invite() {
    setBusy(true);
    try {
      await send("/api/admin/team", "POST", { email, role });
      toast.success(`Invitation sent to ${email}`);
      setOpen(false);
      setEmail("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to invite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus data-icon="inline-start" />
          Invite
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>They get an email link to set a password.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="invite-email">Email</FieldLabel>
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </Field>
          <Field>
            <FieldLabel>Role</FieldLabel>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger className="capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !email.includes("@")} onClick={invite}>
            {busy && <Spinner data-icon="inline-start" />}
            Send invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TeamTable({ members, currentUserId }: { members: Member[]; currentUserId: string }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function update(id: string, patch: Partial<Pick<Member, "role" | "is_active">>, success: string) {
    setBusyId(id);
    try {
      await send(`/api/admin/team/${id}`, "PATCH", patch);
      toast.success(success);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Unable to update");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-4">Member</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Active</TableHead>
          <TableHead className="hidden pr-4 md:table-cell">Last sign-in</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((m) => {
          const self = m.id === currentUserId;
          return (
            <TableRow key={m.id}>
              <TableCell className="pl-4">
                <div className="font-medium">
                  {m.name || m.email}
                  {self && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                </div>
                {m.name && <div className="text-xs text-muted-foreground">{m.email}</div>}
              </TableCell>
              <TableCell>
                <Select
                  value={m.role}
                  disabled={self || busyId === m.id}
                  onValueChange={(v) => update(m.id, { role: v as Role }, `${m.name || m.email} is now ${v}`)}
                >
                  <SelectTrigger className="w-36 capitalize" aria-label={`Role for ${m.email}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r} className="capitalize">
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Switch
                  checked={m.is_active}
                  disabled={self || busyId === m.id}
                  onCheckedChange={(v) => update(m.id, { is_active: v }, v ? "Access restored" : "Access removed")}
                  aria-label={`${m.is_active ? "Deactivate" : "Activate"} ${m.email}`}
                />
              </TableCell>
              <TableCell className="hidden pr-4 text-muted-foreground md:table-cell">{dateTime(m.last_sign_in_at)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 8: Create `app/(console)/admin/team/page.tsx`**

```tsx
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/console";
import { InviteDialog, TeamTable, type Member } from "@/components/team-table";
import { requirePageAction } from "@/lib/api-auth";
import type { Role } from "@/lib/authz";
import { createAdminClient } from "@/lib/supabase/admin";

export const metadata = { title: "Team" };

export default async function Team() {
  const { user } = await requirePageAction("manage");
  const admin = createAdminClient();
  const [{ data: users }, { data: profiles }] = await Promise.all([
    admin.auth.admin.listUsers({ perPage: 200 }),
    admin.from("profiles").select("id,full_name,role,is_active"),
  ]);
  const byId = new Map((profiles ?? []).map((p) => [p.id as string, p]));
  const members: Member[] = (users?.users ?? [])
    .map((u) => {
      const p = byId.get(u.id);
      return {
        id: u.id,
        name: (p?.full_name as string | null) ?? null,
        email: u.email ?? "",
        role: ((p?.role as Role | undefined) ?? "operator") as Role,
        is_active: (p?.is_active as boolean | undefined) ?? false,
        last_sign_in_at: u.last_sign_in_at ?? null,
      };
    })
    .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));

  return (
    <>
      <PageHeader eyebrow="Admin" title="Team" description="Who can use the console and what they can do." />
      <Card className="pb-0">
        <CardHeader>
          <CardTitle>{members.length} members</CardTitle>
          <CardDescription>Operators run fetches and evaluations; underwriters also review; auditors read the audit log; admins manage everything.</CardDescription>
          <CardAction>
            <InviteDialog />
          </CardAction>
        </CardHeader>
        <TeamTable members={members} currentUserId={user.id} />
      </Card>
    </>
  );
}
```

`perPage: 200` covers the expected team size; paginate with `page` when the team outgrows it.

- [ ] **Step 9: Verify**

Run: `npm run lint && npm test && npm run build`
Expected: pass.
Manual as admin (with `SUPABASE_SERVICE_ROLE_KEY` set for `npm run dev`):
1. `/admin/team` lists members; your own row's controls are disabled.
2. Invite a test address as auditor → toast, row appears with role auditor; the email link (after Task 8 Step 6 template change) lands on `/account?welcome=1`.
3. Change another user's role → toast; their sidebar changes after they reload.
4. Deactivate a user → they can no longer sign in; reactivate restores it.
5. With a single admin, try demoting them from a second admin session after deactivating the other admins → `At least one active admin is required`.
6. As non-admin, `/admin/team` is a 404 and `POST /api/admin/team` returns 403.

- [ ] **Step 10: Commit**

```bash
git add lib/authz.ts lib/team.ts tests/team.test.ts lib/supabase/admin.ts app/api/admin "app/(console)/admin/team" components/team-table.tsx package.json .env.example
git commit -m "feat(admin): team page with invites, role changes and deactivation

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] `npm run lint && npm test && npm run build` all pass.
- [ ] Sign in once per role (operator, underwriter, auditor, admin) and confirm sidebar, page access (404 where denied) and actions match the role matrix in Global Constraints.
- [ ] Re-run the Task 1 Step 3 SQL against production to confirm self-escalation is still blocked.
- [ ] `git grep -n 'OperationsShell\|ThemeToggle\|"/simulate"\|"/vehicles"\|"/health"' -- app components` returns nothing.
