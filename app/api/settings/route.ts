import { NextResponse } from "next/server";
import { requireAction } from "@/lib/api-auth";

const NUMERIC = ["idv_abs_tolerance", "idv_pct_tolerance", "vehicle_match_min_confidence", "obv_lookup_timeout_ms", "obv_max_retries", "manual_review_sla_hours"];
const BOOLEAN = ["corehub_auto_send_reviews", "fetch_auto_evaluate"];
const MODES = ["rehearse", "live"];

/** Admin-only. Body: any subset of the keys above, plus confirm_live: true when switching write-back to live. */
export async function POST(request: Request) {
  const auth = await requireAction("manage");
  if (!auth.ok) return auth.response;
  const { supabase, user } = auth;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const updates: [string, unknown][] = [];
  for (const key of NUMERIC) {
    if (body[key] === undefined) continue;
    const value = Number(body[key]);
    if (!Number.isFinite(value) || value < 0) return NextResponse.json({ error: "Invalid value for " + key }, { status: 400 });
    updates.push([key, value]);
  }
  for (const key of BOOLEAN) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "boolean") return NextResponse.json({ error: "Invalid value for " + key }, { status: 400 });
    updates.push([key, body[key]]);
  }
  if (body.corehub_writeback_mode !== undefined) {
    if (!MODES.includes(body.corehub_writeback_mode as string)) return NextResponse.json({ error: "Invalid write-back mode" }, { status: 400 });
    // Going live means real Approve/Reject clicks in CoreHub; the client must say so explicitly.
    if (body.corehub_writeback_mode === "live" && body.confirm_live !== true) {
      return NextResponse.json({ error: "Confirm switching CoreHub write-back to live" }, { status: 400 });
    }
    updates.push(["corehub_writeback_mode", body.corehub_writeback_mode]);
  }
  if (!updates.length) return NextResponse.json({ error: "Nothing to save" }, { status: 400 });

  const { data: before } = await supabase.from("config_settings").select("setting_key,setting_value").in("setting_key", updates.map(([k]) => k));
  const prev = new Map((before ?? []).map((r) => [r.setting_key, r.setting_value]));
  const missing = updates.filter(([k]) => !prev.has(k)).map(([k]) => k);
  if (missing.length) {
    return NextResponse.json({ error: `Settings not in the database yet (${missing.join(", ")}) — apply migration 202609280007` }, { status: 409 });
  }

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, value] of updates) {
    if (JSON.stringify(prev.get(key)) === JSON.stringify(value)) continue;
    const { error } = await supabase.from("config_settings").update({ setting_value: value, updated_by: user.id }).eq("setting_key", key);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    changes[key] = { from: prev.get(key), to: value };
  }
  if (Object.keys(changes).length) {
    await supabase.from("audit_events").insert({
      event_type: "configuration_changed",
      actor_type: "user",
      actor_id: user.id,
      severity: changes.corehub_writeback_mode?.to === "live" ? "warning" : "info",
      payload: { changes },
    });
  }
  return NextResponse.json({ ok: true, changed: Object.keys(changes) });
}
