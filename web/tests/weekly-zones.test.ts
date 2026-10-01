import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDashboard, weeklyZones } from "../src/lib/data";

test("weekly zones sum only recorded seconds and disclose incomplete coverage", () => {
  const data = normalizeDashboard({
    activities: [
      {
        id: "1",
        type: "Run",
        start_date_local: "2026-09-28T10:00:00",
        hr_zone_times: [60, 120, 0],
      },
      {
        id: "2",
        type: "Run",
        start_date_local: "2026-09-29T10:00:00",
        hr_zone_times: [30, 60, 0],
      },
      { id: "3", type: "Run", start_date_local: "2026-09-30T10:00:00" },
      {
        id: "4",
        type: "Run",
        start_date_local: "2026-09-27T10:00:00",
        hr_zone_times: [999],
      },
    ],
  });
  const result = weeklyZones(data.activities, "2026-09-28", "hr", "all");
  assert.equal(result.measured, 2);
  assert.equal(result.total, 3);
  assert.deepEqual(result.zones, [
    { zone: "Z1", seconds: 90 },
    { zone: "Z2", seconds: 180 },
    { zone: "Z3", seconds: 0 },
  ]);
  const missing = weeklyZones(data.activities, "2026-09-28", "power", "all");
  assert.equal(missing.measured, 0);
  assert.deepEqual(missing.zones, []);
});
