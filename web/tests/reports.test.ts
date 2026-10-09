import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReports, REPORTS } from "../src/lib/reports";

test("reports keep order, expose known kinds, and fall back otherwise", () => {
  assert.equal(REPORTS, "reports");
  assert.deepEqual(
    parseReports({
      reports: [
        {
          id: 3,
          kind: "activity",
          content: "Workout review",
          created_at: "2026-10-03T07:00:00Z",
        },
        {
          id: 2,
          kind: "evening",
          content: "Evening",
          created_at: "2026-10-02T19:00:00Z",
        },
        {
          id: 1,
          kind: "weekly",
          content: "Weekly digest",
          created_at: "2026-10-01T06:00:00Z",
        },
        { id: 4, kind: "morning", content: "" },
      ],
    }),
    [
      {
        id: 3,
        kind: "activity",
        content: "Workout review",
        createdAt: "2026-10-03T07:00:00Z",
      },
      {
        id: 2,
        kind: "evening",
        content: "Evening",
        createdAt: "2026-10-02T19:00:00Z",
      },
      {
        id: 1,
        kind: "report",
        content: "Weekly digest",
        createdAt: "2026-10-01T06:00:00Z",
      },
    ],
  );
  assert.throws(() => parseReports({ error: "nope" }));
});
