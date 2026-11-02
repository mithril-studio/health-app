import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDashboard,
  weeklyLoad,
  weeklyZones,
  zoneRanges,
} from "../src/lib/data";

test("weekly zones sum only recorded seconds and disclose incomplete coverage", () => {
  const data = normalizeDashboard({
    activities: [
      {
        id: "1",
        type: "Run",
        start_date_local: "2026-09-28T10:00:00",
        icu_hr_zone_times: [60, 120, 0],
      },
      {
        id: "2",
        type: "Run",
        start_date_local: "2026-09-29T10:00:00",
        icu_hr_zone_times: [30, 60, 0],
      },
      { id: "3", type: "Run", start_date_local: "2026-09-30T10:00:00" },
      {
        id: "4",
        type: "Run",
        start_date_local: "2026-09-27T10:00:00",
        icu_hr_zone_times: [999],
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

test("restricted activities count toward coverage but never as measured", () => {
  const data = normalizeDashboard({
    activities: [
      {
        id: "1",
        type: "Run",
        start_date_local: "2026-09-28T10:00:00",
        icu_hr_zone_times: [60, 120],
      },
      {
        id: "2",
        start_date_local: "2026-09-29T10:00:00",
        _note: "STRAVA activities are not available via the API",
      },
    ],
  });
  const result = weeklyZones(data.activities, "2026-09-28", "hr", "all");
  assert.equal(result.total, 2);
  assert.equal(result.measured, 1);
  assert.equal(result.restricted, 1);
  const load = weeklyLoad(data.activities, "2026-09-28");
  assert.deepEqual(
    load.map((r) => [r.sport, r.restricted, r.missing]),
    [
      ["run", 0, 1],
      ["other", 1, 1],
    ],
  );
});

test("zones are filtered by sport and keep bpm ranges only for shared limits", () => {
  const data = normalizeDashboard({
    activities: [
      {
        id: "run-1",
        type: "Run",
        start_date_local: "2026-10-26T10:00:00",
        icu_hr_zone_times: [100, 200, 300],
        icu_hr_zones: [126, 140, 191],
      },
      {
        id: "run-2",
        type: "Run",
        start_date_local: "2026-10-27T10:00:00",
        icu_hr_zone_times: [10, 20, 30],
        icu_hr_zones: [126, 140, 191],
      },
      {
        id: "ride",
        type: "Ride",
        start_date_local: "2026-10-28T10:00:00",
        icu_hr_zone_times: [5, 6, 7],
        icu_hr_zones: [120, 150, 190],
        icu_zone_times: null,
      },
      {
        id: "tennis",
        type: "Tennis",
        start_date_local: "2026-10-29T10:00:00",
        icu_hr_zone_times: [1000, 1000, 1000],
      },
    ],
  });
  const run = weeklyZones(data.activities, "2026-10-26", "hr", "run");
  assert.deepEqual(
    run.zones.map((z) => z.seconds),
    [110, 220, 330],
  );
  assert.deepEqual(run.limits, [126, 140, 191]);
  assert.deepEqual(zoneRanges(run.limits, "bpm"), [
    "≤126 bpm",
    "127–140 bpm",
    "141–191 bpm",
  ]);
  assert.equal(run.total, 2);
  const ride = weeklyZones(data.activities, "2026-10-26", "hr", "ride");
  assert.deepEqual(
    ride.zones.map((z) => z.seconds),
    [5, 6, 7],
  );
  assert.deepEqual(
    weeklyZones(data.activities, "2026-10-26", "power", "ride"),
    {
      zones: [],
      limits: [],
      measured: 0,
      restricted: 0,
      total: 1,
    },
  );
  // Mixed zone definitions sum by index but expose no shared limits.
  const all = weeklyZones(data.activities, "2026-10-26", "hr", "all");
  assert.equal(all.measured, 4);
  assert.deepEqual(all.limits, []);
});
