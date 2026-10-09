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
    if (path === "/api/curves") body = { list: [] };
    if (path === "/api/chat") body = { messages: [] };
    if (path === "/api/confirmations") body = { pending: [] };
    if (path === "/api/conversations")
      body = { conversations: [{ id: "web", title: "Earlier chats" }] };
    if (path === "/api/reports")
      body = {
        reports: [
          {
            id: 2,
            kind: "evening",
            content: "**Evening** report body.",
            created_at: "2026-10-02T19:00:00Z",
          },
          {
            id: 1,
            kind: "morning",
            content: "Morning body.",
            created_at: "2026-10-01T06:30:00Z",
          },
        ],
      };
    await route.fulfill({ json: body });
  });
});

test("reports are read-only, labelled, newest first, and navigable", async ({
  page,
}) => {
  await page.goto("/coach");
  await page
    .getByRole("button", { name: "Reports", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/chat=reports/);
  const messages = page.locator(".chat-message.assistant");
  await expect(messages).toHaveCount(2);
  await expect(messages.locator(".message-meta strong")).toHaveText([
    "Evening report",
    "Morning check",
  ]);
  await expect(
    messages.first().locator("strong").filter({ hasText: "Evening" }),
  ).toBeVisible();
  // The scheduled channel is read only: there is no composer.
  await expect(page.locator("textarea")).toHaveCount(0);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("reports do not overflow at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/coach?chat=reports");
  await expect(page.locator(".chat-message.assistant").first()).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});
