import { strict as assert } from "node:assert";
import {
  completionModeAllowed,
  cronToSpec,
  describeSchedule,
  nextRunAt,
  specToCron,
  validateScheduleInput,
  type ScheduleSpec,
} from "../lib/schedule";

const ALL = [0, 1, 2, 3, 4, 5, 6] as const;

function main() {
  // Builder ↔ cron round trip
  const specs: ScheduleSpec[] = [
    { kind: "minutes", every: 15, days: [1, 2, 3, 4, 5, 6], fromHour: 9, toHour: 19 },
    { kind: "minutes", every: 10, days: [...ALL], fromHour: 0, toHour: 24 },
    { kind: "hourly", every: 2, days: [1, 2, 3, 4, 5], fromHour: 9, toHour: 19 },
    { kind: "hourly", every: 1, days: [...ALL], fromHour: 0, toHour: 24 },
    { kind: "daily", time: "23:00", days: [...ALL] },
    { kind: "daily", time: "08:30", days: [1, 3, 5] },
    { kind: "monthly", time: "10:30", dayOfMonth: 28 },
  ];
  for (const s of specs) assert.deepEqual(cronToSpec(specToCron(s)), s, `round trip ${specToCron(s)}`);

  assert.equal(specToCron(specs[0]), "*/15 9-18 * * 1,2,3,4,5,6");
  assert.equal(specToCron(specs[1]), "*/10 * * * *");
  assert.equal(specToCron(specs[2]), "0 9-18/2 * * 1,2,3,4,5");
  assert.equal(specToCron(specs[6]), "30 10 28 * *");
  assert.equal(specToCron({ kind: "daily", time: "08:30", days: [5, 1, 3, 3] }), "30 8 * * 1,3,5");

  // Not expressible in the builder → advanced
  assert.equal(cronToSpec("0 9 * * 1-5"), null);
  assert.equal(cronToSpec("0 9 * 1 *"), null);
  assert.equal(cronToSpec("nonsense"), null);

  // Human description
  assert.equal(describeSchedule("*/15 9-18 * * 1,2,3,4,5,6"), "Every 15 min, Mon–Sat 09:00–19:00 IST");
  assert.equal(describeSchedule("0 9-18/2 * * 1,2,3,4,5"), "Every 2 hours, Mon–Fri 09:00–19:00 IST");
  assert.equal(describeSchedule("0 */1 * * *"), "Every hour, every day IST");
  assert.equal(describeSchedule("0 23 * * *"), "Daily at 23:00 IST");
  assert.equal(describeSchedule("30 8 * * 1,3,5"), "Weekly on Mon, Wed, Fri at 08:30 IST");
  assert.equal(describeSchedule("30 10 28 * *"), "Monthly on day 28 at 10:30 IST");
  assert.equal(describeSchedule("0 9 * * 1-5"), "Custom (0 9 * * 1-5) IST");
  assert.equal(describeSchedule("0 9 * * *", "UTC"), "Daily at 09:00 UTC");

  // Next run in IST: Sunday 2026-09-27 17:30 IST → Monday 09:00 IST
  assert.equal(
    nextRunAt("*/15 9-18 * * 1,2,3,4,5,6", "Asia/Kolkata", new Date("2026-09-27T12:00:00Z")).toISOString(),
    "2026-09-28T03:30:00.000Z",
  );
  // Monthly on day 28, already past this month → next month
  assert.equal(
    nextRunAt("30 10 28 * *", "Asia/Kolkata", new Date("2026-09-29T00:00:00Z")).toISOString(),
    "2026-10-28T05:00:00.000Z",
  );

  // Validation
  const ok = validateScheduleInput({ name: " Business hours ", cron: "*/15 9-18 * * 1,2,3,4,5,6" });
  assert.deepEqual(ok, { ok: true, value: { name: "Business hours", cron: "*/15 9-18 * * 1,2,3,4,5,6", timezone: "Asia/Kolkata" } });
  assert.equal(validateScheduleInput({ name: "", cron: "0 9 * * *" }).ok, false);
  assert.equal(validateScheduleInput({ name: "x", cron: "bad" }).ok, false);
  assert.equal(validateScheduleInput({ name: "x", cron: "* * * * *" }).ok, false, "every minute is too frequent");
  assert.equal(validateScheduleInput({ name: "x", cron: "*/2 9-18 * * *" }).ok, false, "every 2 min is too frequent");
  assert.equal(validateScheduleInput({ name: "x", cron: "0 9 * * *", timezone: "Mars/Olympus" }).ok, false);
  assert.equal(validateScheduleInput({ name: "x", cron: "0 9 * * *", enabled: "yes" }).ok, false);
  assert.deepEqual(validateScheduleInput({ enabled: true }, { partial: true }), { ok: true, value: { enabled: true } });

  // Completion mode guard
  assert.equal(completionModeAllowed("in_app", {}), true);
  assert.equal(completionModeAllowed("corehub_writeback", {}), false);
  assert.equal(completionModeAllowed("corehub_writeback", { COREHUB_WRITEBACK_ENABLED: "true" }), true);
  assert.equal(validateScheduleInput({ name: "x", cron: "0 9 * * *", completion_mode: "corehub_writeback" }, { env: {} }).ok, false);
  assert.equal(
    validateScheduleInput({ name: "x", cron: "0 9 * * *", completion_mode: "corehub_writeback" }, { env: { COREHUB_WRITEBACK_ENABLED: "true" } }).ok,
    true,
  );

  console.log("schedule tests passed");
}

main();
