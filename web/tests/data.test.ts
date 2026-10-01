import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDashboard, number, zoneTimes, weeklyLoad, goalResults, normalizeCurves, fitnessSeries } from "../src/lib/data";
import { addDays, startOfWeek, calendarDays } from "../src/lib/dates";

test("missing metrics are unknown, not zero; actual zero is preserved", () => {
  assert.equal(number(null), null);
  assert.equal(number(""), null);
  assert.equal(number(false), null);
  assert.equal(number(Infinity), null);
  assert.equal(number(0), 0);
  const data = normalizeDashboard({ activities: [{ id: "a", start_date_local: "2026-10-01T09:00:00", type: "Run" }] });
  assert.equal(data.activities[0].load, null);
  assert.equal(data.activities[0].duration, null);
  assert.deepEqual(data.wellness, []);
});

test("a malformed dashboard is rejected instead of looking like an empty cache", () => {
  assert.throws(() => normalizeDashboard(null));
  assert.throws(() => normalizeDashboard({ error: "bad" }));
});

test("raw zone arrays and power zone objects retain measured zero and omit missing values", () => {
  assert.deepEqual(zoneTimes([60, null, 0, 120]), [{ zone: "Z1", seconds: 60 }, { zone: "Z3", seconds: 0 }, { zone: "Z4", seconds: 120 }]);
  assert.deepEqual(zoneTimes([{ id: "Z1", secs: 90 }, { id: "Z2", secs: null }]), [{ zone: "Z1", seconds: 90 }]);
});

test("weekly load includes football and gym without filling absent load with zero", () => {
  const data = normalizeDashboard({ activities: [
    { id: "a", start_date_local: "2026-09-28", type: "Soccer", icu_training_load: 55 },
    { id: "b", start_date_local: "2026-09-29", type: "WeightTraining" },
    { id: "c", start_date_local: "2026-09-30", type: "Run", icu_training_load: 0 }
  ] });
  const result = weeklyLoad(data.activities, "2026-09-28");
  assert.equal(result.find(x => x.sport === "football")?.load, 55);
  assert.equal(result.find(x => x.sport === "gym")?.load, null);
  assert.equal(result.find(x => x.sport === "run")?.load, 0);
});

test("5 km results use elapsed times of actual 5 km runs, never scale longer runs", () => {
  const data = normalizeDashboard({ activities: [
    { id: "a", type: "Run", start_date_local: "2026-09-01", distance: 5000, elapsed_time: 1090, moving_time: 1000 },
    { id: "b", type: "Run", start_date_local: "2026-09-02", distance: 10000, elapsed_time: 1800 },
    { id: "c", type: "Run", start_date_local: "2026-09-03", distance: 5000, moving_time: 990 },
    { id: "d", type: "Ride", start_date_local: "2026-09-04", distance: 5000, elapsed_time: 800 }
  ] });
  assert.deepEqual(goalResults(data.activities).map(x => [x.id, x.seconds]), [["a", 1090]]);
});

test("fitness fills from wellness only where reported and derives form only from both values", () => {
  const data = normalizeDashboard({ activities: [], fitness: [{ date: "2026-10-01", ctl: 40, atl: null }], wellness: [{ id: "2026-09-30", ctl: 39, atl: 50 }] });
  assert.deepEqual(fitnessSeries(data).map(x => [x.date, x.ctl, x.atl, x.form]), [["2026-09-30", 39, 50, -11], ["2026-10-01", 40, null, null]]);
});

test("curves support raw Intervals parallel arrays and ignore missing curve values", () => {
  assert.deepEqual(normalizeCurves({ list: [{ secs: [60, 300, 600], watts: [400, null, 250] }] }, "Ride"), [{ x: 60, value: 400 }, { x: 600, value: 250 }]);
  assert.deepEqual(normalizeCurves({ list: [{ distances: [1000, 5000], secs: [200, 1080] }] }, "Run"), [{ x: 1000, value: 200 }, { x: 5000, value: 216 }]);
  assert.deepEqual(normalizeCurves({}, "Run"), []);
});

test("calendar date arithmetic is independent of DST and week starts Monday", () => {
  assert.equal(addDays("2026-10-25", 1), "2026-10-26");
  assert.equal(startOfWeek("2026-10-04"), "2026-09-28");
  const dates = calendarDays("2026-10-01", "month");
  assert.equal(dates.length, 35);
  assert.equal(dates[0], "2026-09-28");
  assert.equal(dates.at(-1), "2026-11-01");
});
