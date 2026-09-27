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
