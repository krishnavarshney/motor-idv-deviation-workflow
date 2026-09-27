import { Archive, Bot, CalendarClock, ClipboardCheck, FileClock, FlaskConical, LayoutDashboard, SlidersHorizontal, Users } from "lucide-react";
import { can } from "../lib/authz";

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
      { title: "Simulator", href: "/simulate", icon: FlaskConical, action: "test_lookup" },
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
