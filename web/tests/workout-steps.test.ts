import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorkoutSteps } from "../src/lib/workout-steps";

test("headings open sections and dash lines become steps", () => {
  assert.deepEqual(
    parseWorkoutSteps(
      "Warmup\n- 15m 70% Pace\n\nMain set 4x\n- 1km 95-100% Pace\n- 2m Z1\n\nCooldown\n- 10m Z1",
    ),
    [
      {
        title: "Warmup",
        repeat: null,
        steps: [{ text: "15m 70% Pace", duration: "15m", target: "70% Pace" }],
      },
      {
        title: "Main set",
        repeat: 4,
        steps: [
          { text: "1km 95-100% Pace", duration: "1km", target: "95-100% Pace" },
          { text: "2m Z1", duration: "2m", target: "Z1" },
        ],
      },
      {
        title: "Cooldown",
        repeat: null,
        steps: [{ text: "10m Z1", duration: "10m", target: "Z1" }],
      },
    ],
  );
});

test("a repeat heading keeps its count", () => {
  const sections = parseWorkoutSteps("Strides 6x\n- 20s fast\n- 1m30s easy");
  assert.equal(sections?.[0].title, "Strides");
  assert.equal(sections?.[0].repeat, 6);
  assert.equal(sections?.[0].steps[1].duration, "1m30s");
});

test("text without dash steps is left unparsed", () => {
  assert.equal(parseWorkoutSteps("Warm up\n4 × 1 km\nCool down"), null);
  assert.equal(parseWorkoutSteps(""), null);
});

test("a step without a leading duration keeps its text", () => {
  assert.deepEqual(parseWorkoutSteps("- Press lap when ready"), [
    {
      title: "",
      repeat: null,
      steps: [
        {
          text: "Press lap when ready",
          duration: null,
          target: "Press lap when ready",
        },
      ],
    },
  ]);
});
