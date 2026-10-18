import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDashboard } from "../src/lib/data";
import { accountabilitySummary, weeklyAccountability } from "../src/lib/athlete";

test("weekly accountability counts a step when enough goal signals are present", () => {
  const data = normalizeDashboard({
    activities: [
      { id: "r1", type: "Run", start_date_local: "2026-09-28", distance: 6000, moving_time: 1800 },
      { id: "r2", type: "Run", start_date_local: "2026-09-30", distance: 5000, moving_time: 1600 },
      { id: "r3", type: "Run", start_date_local: "2026-10-02", distance: 4000, moving_time: 1400 },
      { id: "g1", type: "WeightTraining", start_date_local: "2026-10-03", moving_time: 1800 },
    ],
    wellness: [
      { id: "2026-09-28", hrv: 70 },
      { id: "2026-09-29", sleepSecs: 26000 },
      { id: "2026-09-30", restingHR: 48 },
    ],
  });
  const weeks = weeklyAccountability(data, "2026-10-04", 1);
  assert.equal(weeks[0].week, "2026-09-28");
  assert.equal(weeks[0].score, 5);
  assert.equal(weeks[0].madeStep, true);
  assert.deepEqual(accountabilitySummary(weeks), {
    completed: 1,
    total: 1,
    latest: weeks[0],
    percentage: 100,
  });
});

test("weekly accountability does not turn missing data into progress", () => {
  const data = normalizeDashboard({ activities: [], wellness: [] });
  const weeks = weeklyAccountability(data, "2026-10-04", 2);
  assert.deepEqual(
    weeks.map((week) => [week.score, week.madeStep]),
    [
      [0, false],
      [0, false],
    ],
  );
});
