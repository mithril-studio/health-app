import { test } from "node:test";
import assert from "node:assert/strict";
import { pairingURL } from "../src/lib/telegram";

test("pairing links only open the HTTPS Telegram bot domain", () => {
  assert.equal(
    pairingURL("https://t.me/coachreachybot?start=synthetic"),
    "https://t.me/coachreachybot?start=synthetic",
  );
  for (const url of [
    "javascript:alert(1)",
    "https://evil.example/?start=a",
    "http://t.me/coachreachybot?start=a",
    "https://t.me/coachreachybot",
    null,
  ])
    assert.throws(() => pairingURL(url));
});
