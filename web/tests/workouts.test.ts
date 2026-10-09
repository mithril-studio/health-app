import test from "node:test";
import assert from "node:assert/strict";
import {
  elapsedSeconds,
  timerPosition,
  type TimerState,
} from "../src/lib/workouts";
import { normalizeActivity, sportOf } from "../src/lib/data";
import {
  stretchRoutines,
  routineById,
  routineSeconds,
} from "../src/lib/stretch-catalogue";
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

test("the stretch catalogue has unique, bounded, whole-minute routines", () => {
  const ids = new Set<string>();
  for (const r of stretchRoutines) {
    assert.ok(!ids.has(r.id), `duplicate id ${r.id}`);
    ids.add(r.id);
    assert.ok(r.steps.length > 0);
    for (const step of r.steps) assert.ok(step.seconds >= 15);
    const total = routineSeconds(r);
    assert.equal(total % 60, 0);
    assert.ok(total <= 7200);
  }
});

test("legacy stretch-v1 drafts map to their equivalent catalogue routine", async () => {
  const { decodeDraft, encodeDraft } = await import("../src/lib/workout-draft");
  const base = {
    id: "c6128c0a-65c8-4e39-8850-6b2966b63a58",
    name: "Everyday reset",
    sport: "Stretching" as const,
    started: "2026-10-08T10:00:00.000Z",
    elapsed: 0,
    runningSince: null,
  };
  assert.equal(
    decodeDraft(
      encodeDraft({ ...base, routine: "stretch-v1", total: 300 } as TimerState),
    )?.routine,
    "everyday-reset",
  );
  assert.equal(
    decodeDraft(
      encodeDraft({ ...base, routine: "stretch-v1", total: 600 } as TimerState),
    )?.routine,
    "full-body-unwind",
  );
  assert.equal(
    decodeDraft(
      encodeDraft({ ...base, routine: "stretch-v1", total: 301 } as TimerState),
    ),
    null,
  );
});

test("unknown routine ids and mismatched totals are rejected", async () => {
  const { decodeDraft, encodeDraft } = await import("../src/lib/workout-draft");
  const routine = routineById("everyday-reset")!;
  const base = {
    id: "c6128c0a-65c8-4e39-8850-6b2966b63a58",
    name: routine.name,
    sport: "Stretching" as const,
    started: "2026-10-08T10:00:00.000Z",
    elapsed: 0,
    runningSince: null,
  };
  assert.equal(
    decodeDraft(
      encodeDraft({ ...base, routine: "no-such-routine", total: 300 } as TimerState),
    ),
    null,
  );
  assert.equal(
    decodeDraft(
      encodeDraft({
        ...base,
        routine: routine.id,
        total: routineSeconds(routine) + 30,
      } as TimerState),
    ),
    null,
  );
  assert.equal(
    decodeDraft(
      encodeDraft({
        ...base,
        routine: routine.id,
        total: routineSeconds(routine),
      } as TimerState),
    )?.routine,
    routine.id,
  );
});

test("timerPosition advances correctly across steps of different lengths", () => {
  assert.deepEqual(timerPosition([30, 45, 60], 0), { index: 0, remaining: 30 });
  assert.deepEqual(timerPosition([30, 45, 60], 29), { index: 0, remaining: 1 });
  assert.deepEqual(timerPosition([30, 45, 60], 30), { index: 1, remaining: 45 });
  assert.deepEqual(timerPosition([30, 45, 60], 74), { index: 1, remaining: 1 });
  assert.deepEqual(timerPosition([30, 45, 60], 75), { index: 2, remaining: 60 });
  assert.deepEqual(timerPosition([30, 45, 60], 135), { index: 2, remaining: 0 });
});
