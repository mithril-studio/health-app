import { test } from "node:test";
import assert from "node:assert/strict";
import { intervalMetrics } from "../src/lib/interval-rows";

test("an interval with no moving time falls back to elapsed seconds", () => {
  assert.deepEqual(
    intervalMetrics({
      moving_time: 0,
      elapsed_time: 45,
      distance: 150,
      average_speed: 4,
    }),
    { seconds: 45, distance: 150, paceSecondsPerKm: 250, zeroLength: false },
  );
});

test("a recorded zero-length segment stays zero without a pace", () => {
  assert.deepEqual(
    intervalMetrics({
      moving_time: 0,
      elapsed_time: 0,
      distance: 0,
      average_speed: 3,
    }),
    { seconds: 0, distance: 0, paceSecondsPerKm: null, zeroLength: true },
  );
});

test("missing durations stay missing", () => {
  assert.deepEqual(intervalMetrics({}), {
    seconds: null,
    distance: null,
    paceSecondsPerKm: null,
    zeroLength: false,
  });
});
