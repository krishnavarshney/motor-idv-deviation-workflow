# Motor IDV Control Center Design System

Dense B2B motor-insurance operations console for underwriting and referral teams.

Direction: minimal enterprise UI with restrained status colors and subtle glass accents. Optimize scan speed, decision confidence, auditability and exception handling. Avoid hero sections, excessive rounded cards, decorative gradients, neon colors and unnecessary animation.

Information architecture: Overview, Referral Queue, Manual Review, Vehicle Resolution, Audit Trail, System Health, Configuration.

Tokens: Background #F6F8FB; Surface #FFFFFF; Subtle #F1F5F9; Ink #0F172A; Muted #64748B; Border #E2E8F0; Primary #0F766E; Info #2563EB; Success #15803D; Warning #B45309; Danger #B91C1C.

Typography: Geist Sans / Geist Mono. Body 14px, dense tables 13px, KPI 28px. Spacing 4/8/12/16/24/32. Sidebar 248px. Table rows 52-60px.

Components: DecisionBadge, ConfidenceMeter, IdvDelta, ProviderHealth, VehicleIdentity, AuditTimeline, ReviewDrawer, FilterBar, KPI strip, DataTable, EmptyState.

UX: Put decision and exception state above the fold. Show requested IDV and OBV IDV side by side. Show vehicle confidence beside resolved vehicle. Explain every automated decision with reason codes. Preserve filters in URL state. Keep critical evidence visible. Fail closed to manual review on uncertain external data. Respect reduced motion. Status must never rely on color alone.