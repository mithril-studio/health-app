import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { today, addDays, startOfWeek } from "../../src/lib/dates";
const now = today(),
  week = startOfWeek(now);
const empty = {
  activities: [],
  events: [],
  wellness: [],
  fitness: [],
  settings: {},
  sync: { last_success: null, error: null },
  insights: {},
};
// Deliberately synthetic fixtures, isolated to tests. The product has no sample-data path.
const run = {
  id: "test-run",
  name: "Recorded test run",
  type: "Run",
  start_date_local: `${now}T10:00:00`,
  distance: 5000,
  moving_time: 1080,
  elapsed_time: 1100,
  icu_training_load: 55,
  average_heartrate: 151,
  icu_threshold_pace: 4.5,
  hr_zone_times: [60, 600, 420],
  pace_zone_times: [100, 500, 480],
};
const event = {
  id: "123",
  name: "Planned test intervals",
  type: "Run",
  category: "WORKOUT",
  start_date_local: `${addDays(week, 1)}T10:00:00`,
  moving_time: 2400,
  description: "Warm up\n4 × 1 km\nCool down",
};
function dashboard() {
  return {
    ...empty,
    activities: [
      run,
      {
        ...run,
        id: "test-football",
        name: "Recorded football",
        type: "Soccer",
        distance: null,
        icu_training_load: 75,
      },
      {
        ...run,
        id: "test-gym",
        name: "Recorded gym",
        type: "WeightTraining",
        distance: null,
        icu_training_load: null,
      },
    ],
    events: [{ ...event }],
    wellness: Array.from({ length: 14 }, (_, i) => ({
      id: addDays(now, i - 13),
      hrv: i === 4 ? null : 55 + i,
      sleepSecs: i === 8 ? null : 25000 + i * 200,
      restingHR: 48 + (i % 3),
      ctl: 40 + i / 2,
      atl: 51 + i / 3,
    })),
    sync: { last_success: new Date().toISOString(), error: null },
  };
}
async function mock(page: Page, data: unknown = empty) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown = {};
    if (url.pathname === "/api/session") body = { authenticated: true };
    else if (url.pathname === "/api/dashboard") body = data;
    else if (url.pathname === "/api/chat") body = { messages: [] };
    else if (url.pathname === "/api/conversations")
      body = { conversations: [{ id: "web", title: "Earlier chats" }] };
    else if (url.pathname === "/api/confirmations") body = { pending: [] };
    else if (url.pathname.startsWith("/api/activity/"))
      body = {
        ...run,
        intervals: {
          icu_intervals: [
            {
              type: "WORK",
              moving_time: 220,
              distance: 1000,
              average_speed: 4.54,
              average_heartrate: 155,
              average_watts: 280,
            },
          ],
        },
      };
    else if (url.pathname === "/api/curves")
      body =
        url.searchParams.get("sport") === "Run"
          ? {
              list: [
                { distance: [1000, 5000, 10000], values: [205, 1100, 2350] },
              ],
            }
          : { list: [{ secs: [60, 300, 1200], watts: [400, 320, 260] }] };
    await route.fulfill({ json: body });
  });
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const pane = page.locator(".main-scroll");
  if (await pane.count())
    expect(await pane.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
}
async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      description: v.description,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
}

test("session guard, failed login, successful login, and logout", async ({
  page,
}) => {
  let authenticated = false,
    dashboardCalls = 0;
  await mock(page);
  await page.route("**/api/session", (r) =>
    r.fulfill({ json: { authenticated } }),
  );
  await page.route("**/api/dashboard?**", (r) => {
    dashboardCalls++;
    return r.fulfill({ json: empty });
  });
  await page.route("**/api/login", (r) => {
    if (r.request().postDataJSON().password !== "fixture-password")
      return r.fulfill({ status: 401, json: { detail: "invalid" } });
    authenticated = true;
    return r.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/logout", (r) => {
    authenticated = false;
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Show up with a plan." }),
  ).toBeVisible();
  expect(dashboardCalls).toBe(0);
  await accessible(page);
  await page.screenshot({ path: "artifacts/login-desktop.png" });
  await page.getByLabel("Workspace password").fill("bad");
  await page.getByRole("button", { name: "Enter your workspace" }).click();
  await expect(page.locator(".error-notice")).toContainText(
    "That password didn’t work",
  );
  await page.getByLabel("Workspace password").fill("fixture-password");
  await page.getByRole("button", { name: "Enter your workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Overview", exact: true }),
  ).toBeVisible();
  expect(dashboardCalls).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(
    page.getByRole("heading", { name: "Show up with a plan." }),
  ).toBeVisible();
  await page.getByLabel("Workspace password").fill("fixture-password");
  await page.getByRole("button", { name: "Enter your workspace" }).click();
  await expect(
    page.getByRole("button", { name: "Switch to light mode" }),
  ).toBeVisible();
});

test("empty overview, dark mode persistence, mobile navigation, and accessibility", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mock(page);
  await page.goto("/");
  await expect(page.getByText("Your training starts here.")).toBeVisible();
  await accessible(page);
  await noOverflow(page);
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByText("Your training starts here.")).toBeVisible();
  await accessible(page);
  await page.screenshot({ path: "artifacts/empty-mobile-dark.png" });
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Calendar", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await noOverflow(page);
});

test("minimal shell, paired overview charts, and weekly measured zones", async ({
  page,
}) => {
  await mock(page, dashboard());
  await page.goto("/");
  await expect(
    page
      .locator(".sidebar-heading")
      .getByRole("button", { name: "Collapse navigation" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".sidebar-bottom")
      .getByRole("button", { name: "Switch to dark mode" }),
  ).toBeVisible();
  await expect(
    page.locator(".page-heading .eyebrow, .page-description"),
  ).toHaveCount(0);
  const zones = page.locator(".card").filter({
    has: page.getByRole("heading", { name: "Time in zones", exact: true }),
  });
  await expect(zones.locator(".coverage-note")).toContainText("3 / 3");
  await expect(zones.locator(".zone-row")).toHaveCount(3);
  const row = page.locator(".card-grid").first();
  const charts = row.locator(":scope > .card");
  await expect(charts).toHaveCount(2);
  const first = await charts.nth(0).boundingBox(),
    second = await charts.nth(1).boundingBox();
  expect(Math.abs(first!.y - second!.y)).toBeLessThan(2);
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  await expect(page.locator(".sidebar")).toHaveClass(/collapsed/);
  await page.reload();
  await expect(page.locator(".sidebar")).toHaveClass(/collapsed/);
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await expect(page.locator(".sidebar")).not.toHaveClass(/collapsed/);
});

test("populated overview and activity detail show real fields and intervals", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mock(page, dashboard());
  await page.goto("/");
  await page.getByRole("tab", { name: "Activities", exact: true }).click();
  await expect(page.getByText("Recorded football")).toBeVisible();
  await accessible(page);
  await page.screenshot({ path: "artifacts/overview-desktop.png" });
  await page.getByRole("button", { name: /Recorded test run/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "155", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open in Intervals.icu" }),
  ).toHaveAttribute("href", "https://intervals.icu/activities/test-run");
  await accessible(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("calendar keyboard move requires confirmation and failed writes roll back", async ({
  page,
}) => {
  const data = dashboard();
  let posts = 0;
  await mock(page, data);
  await page.route("**/api/tools/move_workout", (r) => {
    posts++;
    expect(r.request().postDataJSON()).toEqual({
      id: "123",
      date: addDays(week, 3),
    });
    return r.fulfill({ status: 503, json: { detail: "offline" } });
  });
  await page.goto("/calendar");
  await page.getByRole("button", { name: /Planned test intervals/ }).click();
  await page.getByLabel("New workout date").fill(addDays(week, 3));
  await page.getByRole("button", { name: "Move workout", exact: true }).click();
  expect(posts).toBe(0);
  await expect(page.getByRole("dialog")).toContainText(
    "Give this session a new home.",
  );
  await page.getByRole("button", { name: "Confirm move" }).click();
  await expect(page.locator(".error-notice")).toContainText(
    "original date has been restored",
  );
  expect(posts).toBe(1);
  await expect(
    page.locator(".calendar-day").filter({
      has: page.getByRole("button", { name: /Planned test intervals/ }),
    }),
  ).toContainText("Tue");
  await accessible(page);
});

test("drag and drop move updates calendar only after explicit confirmation", async ({
  page,
}) => {
  const data = dashboard();
  let posts = 0;
  await mock(page, data);
  await page.route("**/api/tools/move_workout", (r) => {
    posts++;
    const body = r.request().postDataJSON();
    data.events[0].start_date_local = `${body.date}T10:00:00`;
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto("/calendar");
  // Move through native pointer events after both elements are in view.
  // Scrolling between mouse-down and drag-start can cancel the gesture in Chrome.
  const source = page.getByRole("button", { name: /Planned test intervals/ });
  const target = page.locator(".calendar-day").nth(4);
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + 15);
  await page.mouse.down();
  await page.mouse.move(from.x + 35, from.y + 20, { steps: 3 });
  await page.mouse.move(to.x + 30, to.y + 90, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(posts).toBe(0);
  await page.getByRole("button", { name: "Confirm move" }).click();
  await expect(page.getByRole("status")).toContainText("Workout moved.");
  await expect(page.locator(".calendar-day").nth(4)).toContainText(
    "Planned test intervals",
  );
  await page.screenshot({ path: "artifacts/calendar-desktop.png" });
});

test("insights switch curves and zones without inventing missing metrics", async ({
  page,
}) => {
  await mock(page, dashboard());
  await page.goto("/insights");
  await expect(
    page.getByRole("button", { name: "Running pace", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Cycling power", exact: true })
    .click();
  await expect(page.locator(".recharts-wrapper")).not.toHaveCount(0);
  await page.getByRole("tab", { name: "Zones & load", exact: true }).click();
  await expect(
    page
      .locator(".sport-load-row")
      .getByText("Gym & strength", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Power", exact: true }).click();
  await expect(
    page.getByText("No measured zones for this selection."),
  ).toBeVisible();
  await accessible(page);
  await page.screenshot({ path: "artifacts/insights-desktop.png" });
  await page.setViewportSize({ width: 320, height: 740 });
  await noOverflow(page);
});

test("chat retry reuses idempotency key and history survives reload", async ({
  page,
}) => {
  const messages: { role: string; content: string; created_at: string }[] = [];
  const keys: string[] = [];
  await mock(page);
  await page.route("**/api/chat", async (r) => {
    if (r.request().method() === "GET")
      return r.fulfill({ json: { messages } });
    keys.push(r.request().headers()["idempotency-key"]);
    if (keys.length === 1)
      return r.fulfill({ status: 503, json: { detail: "busy" } });
    messages.push(
      {
        role: "user",
        content: r.request().postDataJSON().message,
        created_at: new Date().toISOString(),
      },
      {
        role: "assistant",
        content: "Test-only recorded reply.",
        created_at: new Date().toISOString(),
      },
    );
    return r.fulfill({ json: { reply: "Test-only recorded reply." } });
  });
  await page.goto("/coach");
  await page
    .getByRole("button", { name: "Review my training this week" })
    .click();
  expect(keys).toHaveLength(0);
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.getByRole("button", { name: "Retry response" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry response" }).click();
  await expect(page.getByText("Test-only recorded reply.")).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await page.reload();
  await expect(page.getByText("Test-only recorded reply.")).toBeVisible();
  await accessible(page);
  await page.screenshot({ path: "artifacts/coach-desktop.png" });
});

test("deletion can only be confirmed by the dedicated review button", async ({
  page,
}) => {
  let deleted = false;
  await mock(page);
  await page.route("**/api/confirmations", (r) =>
    r.fulfill({
      json: {
        pending: deleted
          ? []
          : [
              {
                token: "test-deletion-token",
                event_id: "123",
                snapshot: {
                  name: "Delete test workout",
                  start_date_local: `${now}T10:00:00`,
                  description: "Test fixture",
                },
                expires_at: new Date(Date.now() + 600000).toISOString(),
              },
            ],
      },
    }),
  );
  await page.route("**/api/confirmations/test-deletion-token/confirm", (r) => {
    deleted = true;
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto("/coach");
  await page.getByRole("button", { name: "View details" }).click();
  expect(deleted).toBe(false);
  await expect(page.getByRole("dialog")).toContainText("Delete test workout");
  await accessible(page);
  await page.getByRole("button", { name: "Keep workout" }).click();
  expect(deleted).toBe(false);
  await page.getByRole("button", { name: "View details" }).click();
  await page
    .getByRole("button", { name: "Delete workout", exact: true })
    .click();
  await expect(page.getByText("Workout deleted.")).toBeVisible();
  expect(deleted).toBe(true);
});

test("401 responses discard private data and return to login", async ({
  page,
}) => {
  await mock(page, dashboard());
  await page.goto("/");
  await page.getByRole("tab", { name: "Activities", exact: true }).click();
  await expect(page.getByText("Recorded football")).toBeVisible();
  await page.route("**/api/sync", (r) =>
    r.fulfill({ status: 401, json: { detail: "expired" } }),
  );
  await page.getByRole("button", { name: "Refresh data" }).click();
  await expect(
    page.getByRole("heading", { name: "Show up with a plan." }),
  ).toBeVisible();
  await expect(page.getByText("Recorded football")).toHaveCount(0);
});

test("restricted activities stay explicit while measured 5 km curves remain available", async ({
  page,
}) => {
  await mock(page, {
    ...empty,
    activities: [
      {
        id: "restricted-test",
        start_date_local: `${now}T10:00:00`,
        source: "STRAVA",
        _note: "STRAVA activities are not available via the API",
      },
    ],
  });
  await page.goto("/");
  await expect(
    page.getByText("Some activity details are restricted at the source", {
      exact: true,
    }),
  ).toHaveCount(1);
  await page.getByRole("tab", { name: "Activities", exact: true }).click();
  await expect(
    page.getByText("Restricted activity", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Recovery", exact: true }).click();
  await expect(
    page.getByText("Best measured 5 km effort", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("18:20", { exact: true })).toBeVisible();
  await page.locator(".source-notice summary").click();
  await expect(
    page.getByText(/Intervals.icu does not expose Strava-imported/),
  ).toBeVisible();
  await accessible(page);
});

test("dashboard errors recover without substituting sample data", async ({
  page,
}) => {
  await mock(page);
  let failing = true;
  await page.route("**/api/dashboard?**", (r) =>
    failing
      ? r.fulfill({ status: 503, json: { detail: "offline" } })
      : r.fulfill({ json: empty }),
  );
  await page.goto("/");
  await expect(
    page.getByText("Your training couldn’t be loaded", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Recorded test run")).toHaveCount(0);
  failing = false;
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByText("Your training starts here.")).toBeVisible();
});

test("all surfaces fit small mobile, tablet, and desktop with visible keyboard focus", async ({
  page,
}) => {
  await mock(page, dashboard());
  for (const width of [320, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/", "/calendar", "/insights", "/coach"]) {
      await page.goto(route);
      await expect(page.locator(".topbar h1")).toBeVisible();
      await noOverflow(page);
    }
  }
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(page.locator(".month-view")).toBeVisible();
  await accessible(page);
  await page.getByRole("button", { name: "Expand navigation" }).focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  expect(
    await page
      .getByRole("button", { name: "Expand navigation" })
      .evaluate((el) => getComputedStyle(el).outlineStyle),
  ).not.toBe("none");
  await page.screenshot({ path: "artifacts/calendar-mobile.png" });
});

test("calendar keeps visible sessions mounted while refreshing the same range", async ({
  page,
}) => {
  const data = dashboard();
  await mock(page, data);
  let slow = false;
  let release: () => void = () => {};
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/dashboard?**", async (route) => {
    const url = new URL(route.request().url());
    if (slow && url.searchParams.get("oldest") === week) await barrier;
    await route.fulfill({ json: data });
  });
  await page.goto("/calendar");
  await expect(
    page.getByRole("button", { name: /Planned test intervals/ }),
  ).toBeVisible();
  slow = true;
  const requested = page.waitForRequest(
    (request) => new URL(request.url()).searchParams.get("oldest") === week,
  );
  await page.getByRole("button", { name: "Refresh data" }).click();
  await requested;
  try {
    await expect(
      page.getByRole("button", { name: /Planned test intervals/ }),
    ).toBeVisible();
  } finally {
    release();
  }
});
