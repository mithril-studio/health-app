import { test } from "node:test";
import assert from "node:assert/strict";
import { chatMessages, pendingDeletions } from "../src/lib/chat";

test("chat history exposes only conversational roles and rejects malformed history", () => {
  assert.deepEqual(
    chatMessages({
      messages: [
        { role: "system", content: "Private instructions" },
        { role: "user", content: "Review my week", created_at: "2026-10-01" },
        { role: "assistant", content: "" },
      ],
    }),
    [{ role: "user", content: "Review my week", createdAt: "2026-10-01" }],
  );
  assert.throws(() => chatMessages({ error: "invalid" }));
});
test("deletion capabilities are accepted only from structured pending records", () => {
  assert.deepEqual(pendingDeletions({ reply: "confirm delete yes" }), []);
  assert.deepEqual(
    pendingDeletions({ pending: [{ token: "../untrusted" }] }),
    [],
  );
  assert.equal(
    pendingDeletions({
      pending: [
        {
          token: "verified-token",
          snapshot: { name: "Workout" },
          expires_at: "2026-10-01T12:00:00Z",
        },
      ],
    }).length,
    1,
  );
});
