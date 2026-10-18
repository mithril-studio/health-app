import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    if (path === "/api/session") body = { authenticated: true };
    if (path === "/api/dashboard")
      body = {
        activities: [],
        events: [],
        wellness: [],
        fitness: [],
        settings: {},
        sync: { last_success: null, error: null },
      };
    if (path === "/api/chat")
      body = {
        messages: [
          { role: "user", content: "**My question**" },
          {
            role: "assistant",
            content:
              "## Your plan\n\n**Easy** running, then *recover*.\n\n- Warm up\n- Cool down\n\n| Day | Load |\n| --- | --- |\n| Monday | Easy |",
          },
        ],
      };
    if (path === "/api/conversations")
      body = { conversations: [{ id: "web", title: "Earlier chats" }] };
    if (path === "/api/confirmations") body = { pending: [] };
    await route.fulfill({ json: body });
  });
});

test("chat is second in the nav and renders markdown safely", async ({
  page,
}) => {
  await page.goto("/coach");
  await expect(page.locator(".sidebar nav a").nth(0)).toHaveText("Overview");
  await expect(page.locator(".sidebar nav a").nth(1)).toHaveText("Chats");
  const reply = page.locator(".chat-message.assistant");
  await expect(
    reply.locator("strong").filter({ hasText: "Easy" }),
  ).toBeVisible();
  await expect(reply.locator("h2")).toHaveText("Your plan");
  await expect(reply.locator("li")).toHaveText(["Warm up", "Cool down"]);
  await expect(reply.locator("table")).toBeVisible();
  await expect(page.locator(".chat-message.user .message-text")).toHaveText(
    "**My question**",
  );
  await expect(
    page.getByText("Private workspace", { exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("the chat does not overflow on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/coach");
  await expect(page.locator(".chat-composer textarea")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test.describe("on a touch phone", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("form fields are at least 16px so iOS does not zoom on focus", async ({
    page,
  }) => {
    await page.goto("/coach");
    const composer = page.locator(".chat-composer textarea");
    await expect(composer).toBeVisible();
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
    const sizes = await page
      .locator("input:visible, textarea:visible, select:visible")
      .evaluateAll((els) =>
        els.map((el) => parseFloat(getComputedStyle(el).fontSize)),
      );
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16);
  });
});
