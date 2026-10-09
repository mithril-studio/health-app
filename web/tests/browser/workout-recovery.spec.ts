import { test, expect, type Page } from "@playwright/test";
import { mockWorkouts } from "./workout-fixture";
import { DRAFT_KEY, SOUND_KEY } from "../../src/lib/workout-draft";

async function meditation(page: Page) {
  await page.getByRole("tab", { name: "Meditate" }).click();
  await page.getByLabel("Minutes", { exact: true }).fill("1");
  await page
    .getByRole("button", { name: "Start meditation", exact: true })
    .click();
  await expect(page.getByRole("timer")).toBeVisible();
}
async function end(page: Page) {
  await page.getByRole("button", { name: "End session", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "End session", exact: true })
    .click();
}
async function draft(page: Page) {
  return page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY);
}

test("running, paused, and completed drafts survive reload without automatic saving", async ({
  page,
}) => {
  const saves: Record<string, unknown>[] = [];
  await mockWorkouts(page, saves);
  await page.clock.install();
  await page.goto("/workouts");
  await meditation(page);
  const original = JSON.parse((await draft(page))!).timer;
  await page.clock.fastForward(20000);
  await page.reload();
  await expect(page.getByRole("timer")).toHaveText("0:40");
  expect(JSON.parse((await draft(page))!).timer.id).toBe(original.id);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(60000);
  await page.reload();
  await expect(page.getByRole("timer")).toHaveText("0:40");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(40000);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Save session", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Save this session to add it to your calendar."),
  ).toBeVisible();
  await expect(page.getByText("Saved to your calendar")).toHaveCount(0);
  expect(saves).toEqual([]);
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start another session" }),
  ).toBeVisible();
  expect(await draft(page)).toBeNull();
  await page.reload();
  await page.getByRole("tab", { name: "Meditate" }).click();
  await expect(
    page.getByRole("button", { name: "Start meditation" }),
  ).toBeVisible();
});

test("a lost save response survives reload and retries the identical session", async ({
  page,
}) => {
  await mockWorkouts(page);
  const requests: Record<string, unknown>[] = [];
  const records = new Map();
  await page.route("**/api/sessions", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    records.set(body.id, body);
    if (requests.length === 1) await route.abort("failed");
    else await route.fulfill({ status: 201, json: { id: `local-${body.id}` } });
  });
  await page.clock.install();
  await page.goto("/workouts");
  await meditation(page);
  await page.clock.fastForward(60000);
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  expect(await draft(page)).not.toBeNull();
  await page.reload();
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start another session" }),
  ).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toEqual(requests[1]);
  expect(records.size).toBe(1);
  expect(await draft(page)).toBeNull();
});

test("recovery waits for authentication and transient failure preserves the draft", async ({
  page,
}) => {
  await mockWorkouts(page);
  await page.goto("/workouts");
  await meditation(page);
  const original = await draft(page);
  await page.route("**/api/session", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("timer")).toHaveCount(0);
  expect(await draft(page)).toBe(original);
  await page.unroute("**/api/session");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await page.route("**/api/session", (route) =>
    route.fulfill({ json: { authenticated: false } }),
  );
  await page.reload();
  await expect(
    page.getByLabel("Workspace password", { exact: true }),
  ).toBeVisible();
  expect(await draft(page)).toBeNull();
});

test("invalid drafts are cleared without preventing a new timer", async ({
  page,
}) => {
  await mockWorkouts(page);
  await page.goto("/workouts");
  for (const raw of ["not json", '{"version":99,"timer":{}}']) {
    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
      key: DRAFT_KEY,
      raw,
    });
    await page.reload();
    await page.getByRole("tab", { name: "Meditate" }).click();
    await expect(
      page.getByRole("button", { name: "Start meditation" }),
    ).toBeVisible();
    expect(await draft(page)).toBeNull();
  }
  await meditation(page);
});

test("unavailable storage warns while timing and saving remain usable", async ({
  page,
}) => {
  await mockWorkouts(page);
  await page.addInitScript((key) => {
    for (const method of ["getItem", "setItem", "removeItem"] as const) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (k: string, ...args: string[]) {
        if (k === key) throw new DOMException("Blocked", "SecurityError");
        return (original as (...a: string[]) => string | null).call(
          this,
          k,
          ...args,
        );
      };
    }
  }, DRAFT_KEY);
  await page.clock.install();
  await page.goto("/workouts");
  await meditation(page);
  await expect(
    page.getByText(/This browser could not store your timer/),
  ).toBeVisible();
  await page.clock.fastForward(60000);
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start another session" }),
  ).toBeVisible();
});

test("tabs synchronize pause and discard, and a stale tab cannot resurrect the timer", async ({
  page,
  context,
}) => {
  await mockWorkouts(page);
  await page.goto("/workouts");
  await meditation(page);
  const other = await context.newPage();
  await other.addInitScript(() => {
    window.addEventListener("storage", (event) => {
      if ((window as unknown as { blockStorage?: boolean }).blockStorage)
        event.stopImmediatePropagation();
    });
  });
  await mockWorkouts(other);
  await other.goto("/workouts");
  await other.getByRole("tab", { name: "Meditate" }).click();
  await expect(other.getByRole("timer")).toBeVisible();
  await other.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await end(page);
  await expect(
    other.getByRole("button", { name: "Start meditation" }),
  ).toBeVisible();
  await meditation(page);
  await expect(other.getByRole("timer")).toBeVisible();
  // Simulate a tab whose storage events are delayed while suspended.
  await other.evaluate(() => {
    (window as unknown as { blockStorage?: boolean }).blockStorage = true;
  });
  await end(page);
  await other.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    other.getByRole("button", { name: "Start meditation" }),
  ).toBeVisible();
  expect(await draft(other)).toBeNull();
});

test("a late save response cannot remove a replacement session in another tab", async ({
  page,
  context,
}) => {
  await mockWorkouts(page);
  let finish!: () => void;
  const response = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/api/sessions", async (route) => {
    await response;
    await route.fulfill({ status: 201, json: { id: "saved" } });
  });
  await page.clock.install();
  await page.goto("/workouts");
  await meditation(page);
  await page.clock.fastForward(60000);
  const other = await context.newPage();
  await mockWorkouts(other);
  await other.goto("/workouts");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saving…" })).toBeVisible();
  await end(other);
  await other.getByRole("button", { name: /Everyday reset/ }).click();
  await other
    .getByRole("dialog")
    .getByRole("button", { name: "Start" })
    .click();
  await expect(
    other.getByRole("heading", { name: "Everyday reset" }),
  ).toBeVisible();
  const replacement = await draft(other);
  finish();
  await expect(
    page.getByRole("heading", { name: "Everyday reset" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "End session", exact: true }),
  ).toBeEnabled();
  expect(await draft(page)).toBe(replacement);
  await expect(page.getByText("Saved to your calendar")).toHaveCount(0);
});

async function fakeAudio(page: Page) {
  await page.addInitScript(() => {
    const telemetry = { notes: 0, unlocks: 0 };
    (window as unknown as { audioCalls: typeof telemetry }).audioCalls =
      telemetry;
    class FakeAudioContext {
      state = "suspended";
      currentTime = 0;
      destination = {};
      onstatechange: (() => void) | null = null;
      async resume() {
        telemetry.unlocks++;
        this.state = "running";
        this.onstatechange?.();
      }
      async close() {
        this.state = "closed";
      }
      createOscillator() {
        return {
          frequency: { value: 0 },
          connect() {},
          disconnect() {},
          start() {
            telemetry.notes++;
          },
          stop() {},
          onended: null,
        };
      }
      createGain() {
        return {
          gain: {
            setValueAtTime() {},
            linearRampToValueAtTime() {},
            exponentialRampToValueAtTime() {},
          },
          connect() {},
          disconnect() {},
        };
      }
    }
    window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  });
}
async function audioNotes(page: Page) {
  return page.evaluate(
    () =>
      (window as unknown as { audioCalls: { notes: number } }).audioCalls.notes,
  );
}

test("stretch sound respects mute, avoids missed cues, and needs a gesture after recovery", async ({
  page,
}) => {
  await mockWorkouts(page);
  await fakeAudio(page);
  await page.clock.install();
  await page.goto("/workouts");
  await page.getByRole("button", { name: /Everyday reset/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await page.clock.runFor(30000);
  expect(await audioNotes(page)).toBe(1);
  await page.getByRole("button", { name: "Sound cues" }).click();
  await page.clock.runFor(30000);
  expect(await audioNotes(page)).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Sound cues" }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(
    await page.evaluate((key) => localStorage.getItem(key), SOUND_KEY),
  ).toBe("off");
  await page.getByRole("button", { name: "Sound cues" }).click();
  await page.clock.runFor(30000);
  expect(await audioNotes(page)).toBe(1);
  await page.clock.fastForward(60000);
  expect(await audioNotes(page)).toBe(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Enable sound" }),
  ).toBeVisible();
  expect(await audioNotes(page)).toBe(0);
  await page.getByRole("button", { name: "Enable sound" }).click();
  await page.clock.runFor(30000);
  expect(await audioNotes(page)).toBe(1);
  await page.clock.fastForward(90000);
  expect(await audioNotes(page)).toBe(1);
  await page.clock.runFor(30000);
  expect(await audioNotes(page)).toBe(4);
  await page.clock.runFor(1000);
  expect(await audioNotes(page)).toBe(4);
});

test("meditation completion sounds once and restored completion stays silent", async ({
  page,
}) => {
  await mockWorkouts(page);
  await fakeAudio(page);
  await page.clock.install();
  await page.goto("/workouts");
  await meditation(page);
  await page.clock.runFor(60000);
  expect(await audioNotes(page)).toBe(3);
  await page.clock.runFor(2000);
  expect(await audioNotes(page)).toBe(3);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Save session", exact: true }),
  ).toBeVisible();
  expect(await audioNotes(page)).toBe(0);
});

test("hidden transitions stay silent and foreground timing continues", async ({
  page,
}) => {
  await mockWorkouts(page);
  await fakeAudio(page);
  await page.clock.install();
  await page.goto("/workouts");
  await page.getByRole("button", { name: /Everyday reset/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(65000);
  expect(await audioNotes(page)).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByRole("heading", { name: "Hip flexor · left", exact: true }),
  ).toBeVisible();
  await page.clock.runFor(25000);
  expect(await audioNotes(page)).toBe(1);
});

test("audio and wake-lock failures leave the timer usable", async ({
  page,
}) => {
  await mockWorkouts(page);
  await page.addInitScript(() => {
    window.AudioContext = class {
      constructor() {
        throw new Error("Audio unavailable");
      }
    } as unknown as typeof AudioContext;
    Object.defineProperty(navigator, "wakeLock", {
      value: {
        request: async () => {
          throw new Error("Wake lock denied");
        },
      },
    });
    Object.defineProperty(navigator, "locks", { value: undefined });
  });
  await page.clock.install();
  await page.goto("/workouts");
  await meditation(page);
  await expect(
    page.getByRole("button", { name: "Enable sound" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Enable sound" }).click();
  await page.clock.fastForward(60000);
  await expect(
    page.getByRole("button", { name: "Save session", exact: true }),
  ).toBeVisible();
});

test("a user gesture unlocks the browser audio context", async ({ page }) => {
  await mockWorkouts(page);
  await page.goto("/workouts");
  await meditation(page);
  await expect(page.getByRole("button", { name: "Enable sound" })).toHaveCount(
    0,
  );
});
