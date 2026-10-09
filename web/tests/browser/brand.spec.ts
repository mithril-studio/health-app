import { test, expect, type Page } from "@playwright/test";

async function mockAuthed(page: Page) {
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
    if (path === "/api/conversations")
      body = { conversations: [{ id: "web", title: "Earlier chats" }] };
    if (path === "/api/confirmations") body = { pending: [] };
    if (path === "/api/chat")
      body = { messages: [{ role: "assistant", content: "A grounded reply." }] };
    await route.fulfill({ json: body });
  });
}

test("wordmark, title, favicon and the TE assistant avatar", async ({
  page,
}) => {
  await mockAuthed(page);
  await page.goto("/coach");
  await expect(page.locator(".sidebar .brand .wordmark")).toHaveText(
    "Team-Endurance",
  );
  expect(await page.title()).toContain("Team-Endurance");
  const icon = await page.request.get("/icon.svg");
  expect(icon.status()).toBe(200);
  await expect(
    page.locator(".chat-message.assistant .message-avatar .monogram"),
  ).toHaveText("TE");
});

test("login shows the wordmark when unauthenticated", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: path === "/api/session" ? { authenticated: false } : {},
    });
  });
  await page.goto("/");
  await expect(page.locator(".brand .wordmark").first()).toHaveText(
    "Team-Endurance",
  );
});
