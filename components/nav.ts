import { Activity, Archive, ClipboardCheck, FileClock, FlaskConical, LayoutDashboard, Settings, SlidersHorizontal } from "lucide-react";

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
