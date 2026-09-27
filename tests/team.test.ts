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
