import { test } from "node:test";
import assert from "node:assert/strict";
import { clock, count, plural } from "../src/lib/format";

test("clock keeps seconds for short segments", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(95), "1:35");
  assert.equal(clock(3661), "1:01:01");
  assert.equal(clock(null), "—");
  assert.equal(clock(NaN), "—");
});

test("counts use the singular only for exactly one", () => {
  assert.equal(plural(1, "session", "sessions"), "session");
  assert.equal(plural(0, "session", "sessions"), "sessions");
  assert.equal(count(1, "session", "sessions"), "1 session");
  assert.equal(count(2, "session", "sessions"), "2 sessions");
  assert.equal(count(null, "session", "sessions"), "— sessions");
});
