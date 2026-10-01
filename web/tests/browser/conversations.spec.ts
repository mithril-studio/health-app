import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("chat sidebar creates, restores, and switches independent conversations", async ({
  page,
}) => {
  const id = "web:" + "a".repeat(32);
  const threads: Record<string, { role: string; content: string }[]> = {
    web: [
      { role: "user", content: "Prior question" },
      { role: "assistant", content: "Prior response" },
    ],
  };
  const order = ["web"];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    let body: unknown = {};
    if (path === "/api/session") body = { authenticated: true };
    if (path === "/api/dashboard")
      body = {
        activities: [],
        events: [],
        wellness: [],
        fitness: [],
        settings: {},
        sync: {},
      };
    if (path === "/api/conversations") {
      if (route.request().method() === "POST") {
        threads[id] = [];
        order.unshift(id);
        body = { id, title: null };
      } else
        body = {
          conversations: order.map((key) => ({
            id: key,
            title: threads[key][0]?.content ?? null,
          })),
        };
    }
    if (path === "/api/chat") {
      if (route.request().method() === "POST") {
        const data = route.request().postDataJSON();
        expect(data.conversation_id).toBe(id);
        threads[id].push(
          { role: "user", content: data.message },
          { role: "assistant", content: "A separate conversation" },
        );
        body = { reply: "A separate conversation" };
      } else
        body = {
          messages: threads[url.searchParams.get("conversation_id") ?? "web"],
        };
    }
    if (path === "/api/confirmations") body = { pending: [] };
    await route.fulfill({ json: body });
  });
  await page.goto("/coach");
  const menu = page.locator(".conversation-menu");
  await expect(page.locator(".chat-history")).toContainText("Prior response");
  await menu.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page).toHaveURL(/chat=web%3A/);
  await expect(page.locator(".chat-history")).not.toContainText(
    "Prior response",
  );
  await page.getByLabel("Message your coach").fill("New training question");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".chat-history")).toContainText(
    "A separate conversation",
  );
  await expect(
    menu.getByRole("button", { name: "New training question", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".chat-history")).toContainText(
    "A separate conversation",
  );
  await menu
    .getByRole("button", { name: "Prior question", exact: true })
    .click();
  await expect(page.locator(".chat-history")).toContainText("Prior response");
  await expect(page.locator(".chat-history")).not.toContainText(
    "A separate conversation",
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.getByRole("button", { name: "Show chat history" }).click();
  await menu
    .getByRole("button", { name: "New training question", exact: true })
    .click();
  await expect(page.locator(".chat-history")).toContainText(
    "A separate conversation",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
