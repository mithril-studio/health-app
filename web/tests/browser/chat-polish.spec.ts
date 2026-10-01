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
    if (path === "/api/confirmations") body = { pending: [] };
    if (path === "/api/telegram")
      body = { connected: false, bot_username: "coachreachybot" };
    if (path === "/api/telegram/pairing")
      body = {
        url: "https://t.me/coachreachybot?start=synthetic_pairing_token",
        expires_at: new Date(Date.now() + 600000).toISOString(),
      };
    await route.fulfill({ json: body });
  });
});

test("chat is second, markdown is rendered, and Telegram moves into the header", async ({
  page,
}) => {
  await page.goto("/coach");
  await expect(page.locator(".sidebar nav a")).toHaveText([
    "Overview",
    "Coach",
    "Calendar",
    "Insights",
  ]);
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
  const telegram = page
    .locator(".topbar")
    .getByRole("link", { name: "Telegram", exact: true });
  await expect(telegram).toBeVisible();
  const header = await page.locator(".topbar").boundingBox();
  const link = await telegram.boundingBox();
  expect(
    Math.abs(link!.y + link!.height / 2 - header!.y - header!.height / 2),
  ).toBeLessThan(2);
  expect(link!.x).toBeGreaterThan(header!.x + header!.width / 2);
  await telegram.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Connect Telegram", exact: true })
    .click();
  await expect(
    dialog.getByRole("link", { name: "Open Coach Reachy in Telegram" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("Telegram stays available and the chat does not overflow on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/coach");
  await expect(
    page
      .locator(".topbar")
      .getByRole("link", { name: "Telegram", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".topbar")
    .getByRole("link", { name: "Telegram", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
