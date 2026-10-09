import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { DRAFT_KEY } from "../../src/lib/workout-draft";
import { mockWorkouts as mock } from "./workout-fixture";
test("workout page fits iPhone and desktop and passes accessibility scans", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/workouts");
  await expect(
    page.getByRole("heading", { name: "Workouts", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect WHOOP" })).toHaveCount(
    0,
  );
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "artifacts/workouts-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "artifacts/workouts-iphone.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Start stretching" }).click();
  await expect(
    page.getByRole("heading", { name: "Calf · left", exact: true }),
  ).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({
    path: "artifacts/stretch-timer-iphone.png",
    fullPage: true,
  });
});
test("meditation catches up, survives navigation, pauses, and retries saving with same id", async ({
  page,
}) => {
  const saves: Record<string, unknown>[] = [];
  await mock(page, saves, true);
  await page.clock.install();
  await page.goto("/workouts");
  await page.getByLabel("Minutes", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Start meditation" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await page.clock.fastForward(20000);
  await expect(page.getByRole("timer")).toHaveText("0:40");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(60000);
  await expect(page.getByRole("timer")).toHaveText("0:40");
  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await page.getByRole("link", { name: "Your workout timer · Open" }).click();
  await expect(page.getByRole("timer")).toHaveText("0:40");
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(40000);
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Start another session" }),
  ).toBeVisible();
  expect(saves).toHaveLength(2);
  expect(saves[0]).toEqual(saves[1]);
  expect(saves[0].duration).toBe(60);
  expect(saves[0].sport).toBe("Meditation");
});
test("stretch advances across suspended steps and discard does not save", async ({
  page,
}) => {
  const saves: Record<string, unknown>[] = [];
  await mock(page, saves);
  await page.clock.install();
  await page.goto("/workouts");
  await page.getByRole("button", { name: "Start stretching" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await page.clock.fastForward(125000);
  await expect(
    page.getByRole("heading", { name: "Hamstring · left", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("timer")).toHaveText("0:25");
  await page.getByRole("button", { name: "End session", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "End session", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start stretching" }),
  ).toBeVisible();
  expect(saves).toEqual([]);
});
test("manual home workout retries without duplicate writes and accepts soccer", async ({
  page,
}) => {
  const saves: Record<string, unknown>[] = [];
  await mock(page, saves, true);
  await page.goto("/workouts");
  await page
    .getByRole("button", { name: "Log a workout", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Session name").fill("Home circuit");
  await dialog
    .getByRole("combobox", { name: "Sport", exact: true })
    .selectOption("HomeWorkout");
  await dialog.getByLabel("Started at").fill("2026-01-01T10:00");
  await dialog.getByRole("button", { name: "Save session" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Session name")).toBeDisabled();
  await dialog.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(saves[0]).toEqual(saves[1]);
  expect(saves[0].sport).toBe("HomeWorkout");
  await page
    .getByRole("button", { name: "Log a workout", exact: true })
    .first()
    .click();
  await dialog.getByLabel("Session name").fill("Evening soccer");
  await dialog
    .getByRole("combobox", { name: "Sport", exact: true })
    .selectOption("Soccer");
  await dialog.getByLabel("Started at").fill("2026-01-01T10:00");
  await dialog.getByRole("button", { name: "Save session" }).click();
  await expect(dialog).not.toBeVisible();
  expect(saves[2].sport).toBe("Soccer");
});

test("temporary session-check failure keeps the timer but a real sign-out clears it", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/workouts");
  await page.getByRole("button", { name: "Start meditation" }).click();
  await page.route(
    "**/api/session",
    (route) => route.fulfill({ status: 503, json: {} }),
    { times: 1 },
  );
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByLabel("Workspace password", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), DRAFT_KEY),
  ).toBeNull();
  await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
  await expect(
    page.getByRole("button", { name: "Start meditation" }),
  ).toBeVisible();
});
