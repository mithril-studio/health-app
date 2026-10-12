import { test } from "node:test";
import assert from "node:assert/strict";
import { isolatedIndexes } from "../src/lib/chart-points";

const rows = (values: unknown[]) => values.map((v) => ({ v }));

test("a value without recorded neighbours is isolated", () => {
  assert.deepEqual(isolatedIndexes(rows([null, 1, null]), "v"), new Set([1]));
  assert.deepEqual(isolatedIndexes(rows([1, 2, null, 4]), "v"), new Set([3]));
  assert.deepEqual(isolatedIndexes(rows([5]), "v"), new Set([0]));
  assert.deepEqual(isolatedIndexes(rows([0, null, 0]), "v"), new Set([0, 2]));
});

test("strings and NaN are missing, not neighbours", () => {
  assert.deepEqual(isolatedIndexes(rows(["3", 1, NaN]), "v"), new Set([1]));
  assert.deepEqual(isolatedIndexes(rows(["3", NaN]), "v"), new Set());
  assert.deepEqual(isolatedIndexes([], "v"), new Set());
});
