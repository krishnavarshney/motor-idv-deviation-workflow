import { Activity, Archive, Bot, CalendarClock, ClipboardCheck, FileClock, FlaskConical, LayoutDashboard, Settings, SlidersHorizontal } from "lucide-react";

export const NAV = [
  {
    label: "Operations",
    items: [
      { title: "Overview", href: "/", icon: LayoutDashboard },
      { title: "Referral queue", href: "/referrals", icon: Archive },
      { title: "Manual review", href: "/reviews", icon: ClipboardCheck },
    ],
  },
  {
    label: "Automation",
    items: [
      { title: "Runs", href: "/automation", icon: Bot },
      { title: "Schedules", href: "/automation/schedules", icon: CalendarClock },
    ],
  },
  {
    label: "Engine",
    items: [
      { title: "Vehicle resolution", href: "/vehicles", icon: SlidersHorizontal },
      { title: "Simulator", href: "/simulate", icon: FlaskConical },
    ],
  },
  {
    label: "Governance",
    items: [
      { title: "Audit trail", href: "/audit", icon: FileClock },
      { title: "System health", href: "/health", icon: Activity },
      { title: "Configuration", href: "/settings", icon: Settings },
    ],
  },
] as const;

/** Longest nav href matching the path, so /automation/schedules doesn't also light up /automation. */
export function activeHref(pathname: string): string | undefined {
  return NAV.flatMap((g) => g.items.map((i) => i.href as string))
    .filter((h) => (h === "/" ? pathname === "/" : pathname === h || pathname.startsWith(h + "/")))
    .sort((a, b) => b.length - a.length)[0];
}
