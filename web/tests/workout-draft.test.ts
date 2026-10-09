import { test } from "node:test";
import assert from "node:assert/strict";
import {
  migrateLegacyStorage,
  DRAFT_KEY,
  SOUND_KEY,
} from "../src/lib/workout-draft";

function installStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
  (globalThis as { localStorage?: unknown }).localStorage = storage;
  return storage;
}

test("legacy workout storage migrates to the team-endurance keys once", () => {
  const store = installStorage();
  store.setItem("reachy:workout-draft:v1", "draft-raw");
  store.setItem("reachy:workout-sound", "off");
  migrateLegacyStorage();
  assert.equal(store.getItem(DRAFT_KEY), "draft-raw");
  assert.equal(store.getItem(SOUND_KEY), "off");
  assert.equal(store.getItem("reachy:workout-draft:v1"), null);
  assert.equal(store.getItem("reachy:workout-sound"), null);
});

test("migration never overwrites an existing new-key value and is idempotent", () => {
  const store = installStorage();
  store.setItem(SOUND_KEY, "on");
  store.setItem("reachy:workout-sound", "off");
  migrateLegacyStorage();
  assert.equal(store.getItem(SOUND_KEY), "on");
  assert.equal(store.getItem("reachy:workout-sound"), null);
  // A second run with nothing legacy left is a no-op.
  migrateLegacyStorage();
  assert.equal(store.getItem(SOUND_KEY), "on");
});
