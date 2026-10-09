import test from "node:test";
import assert from "node:assert/strict";
import {
  elapsedSeconds,
  timerPosition,
  type TimerState,
} from "../src/lib/workouts";
import { normalizeActivity, sportOf } from "../src/lib/data";
test("timer catches up after suspension, caps completion, and excludes paused time", () => {
  const timer: TimerState = {
    id: "test",
    name: "test",
    sport: "Meditation",
    routine: "meditation-v1",
    started: "",
    total: 300,
    elapsed: 30,
    runningSince: 1000,
  };
  assert.equal(elapsedSeconds(timer, 61000), 90);
  assert.equal(elapsedSeconds(timer, 999999), 300);
  assert.equal(elapsedSeconds({ ...timer, runningSince: null }, 999999), 30);
  assert.equal(elapsedSeconds(timer, 0), 30);
  assert.deepEqual(timerPosition([30, 30, 30], 61), {
    index: 2,
    remaining: 29,
  });
  assert.deepEqual(timerPosition([30, 30, 30], 90), { index: 2, remaining: 0 });
});
test("new sports stay distinct and WHOOP elapsed duration does not become training load", () => {
  assert.equal(sportOf("HomeWorkout"), "home");
  assert.equal(sportOf("functional fitness"), "gym");
  assert.equal(sportOf("soccer"), "football");
  assert.equal(sportOf("Stretching"), "stretch");
  assert.equal(sportOf("Meditation"), "meditation");
  const a = normalizeActivity({
    id: "whoop-test",
    start_date_local: "2026-10-01T12:00:00",
    type: "running",
    session_duration: 3600,
    elapsed_time: 3600,
    whoop_strain: 14,
  });
  assert.equal(a?.duration, 3600);
  assert.equal(a?.load, null);
  assert.equal(a?.distance, null);
});

test("drafts retain only valid, versioned, bounded timer state", async () => {
  const { decodeDraft, encodeDraft } = await import("../src/lib/workout-draft");
  const timer: TimerState = {
    id: "c6128c0a-65c8-4e39-8850-6b2966b63a58",
    name: "Meditation",
    sport: "Meditation",
    routine: "meditation-v1",
    started: "2026-10-08T10:00:00.000Z",
    total: 60,
    elapsed: 10,
    runningSince: Date.parse("2026-10-08T10:00:10.000Z"),
  };
  assert.deepEqual(decodeDraft(encodeDraft(timer)), timer);
  assert.deepEqual(decodeDraft(encodeDraft({ ...timer, runningSince: null })), {
    ...timer,
    runningSince: null,
  });
  for (const raw of [
    null,
    "broken",
    "null",
    "[]",
    JSON.stringify({ version: 2, timer }),
    ...[
      { id: "bad" },
      { routine: "unknown" },
      { total: 61 },
      { elapsed: -1 },
      { elapsed: 61 },
      { started: "bad" },
      { runningSince: "10" },
      { runningSince: 1 },
      { sport: "Stretching" },
      { name: "" },
    ].map((change) => encodeDraft({ ...timer, ...change } as TimerState)),
  ]) {
    assert.equal(decodeDraft(raw), null);
  }
  assert.deepEqual(
    decodeDraft(
      JSON.stringify({ version: 1, timer: { ...timer, secret: "ignore" } }),
    ),
    timer,
  );
});
