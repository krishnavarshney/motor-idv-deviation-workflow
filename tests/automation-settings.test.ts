import assert from "node:assert/strict";
import { parseAutomationSettings } from "../lib/automation-settings";

const row = (setting_key: string, setting_value: unknown) => ({ setting_key, setting_value });

// Missing rows (migration not applied yet) fail safe: rehearse, and the existing auto behaviours on.
assert.deepEqual(parseAutomationSettings([], false), {
  writebackMode: "rehearse",
  dryRun: true,
  forcedDryRun: false,
  autoSendReviews: true,
  fetchAutoEvaluate: true,
});
assert.equal(parseAutomationSettings([row("corehub_writeback_mode", "live")], false).dryRun, false);
// Env kill switch wins over the console setting.
assert.equal(parseAutomationSettings([row("corehub_writeback_mode", "live")], true).dryRun, true);
// Anything but the exact string "live" is a rehearsal.
assert.equal(parseAutomationSettings([row("corehub_writeback_mode", "LIVE")], false).dryRun, true);
assert.equal(parseAutomationSettings([row("corehub_writeback_mode", true)], false).dryRun, true);
assert.equal(parseAutomationSettings([row("corehub_auto_send_reviews", false), row("fetch_auto_evaluate", false)], false).autoSendReviews, false);
assert.equal(parseAutomationSettings([row("fetch_auto_evaluate", "false")], false).fetchAutoEvaluate, true); // non-boolean ignored

console.log("automation-settings tests passed");
