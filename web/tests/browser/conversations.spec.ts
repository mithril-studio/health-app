import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("chat history dropdown creates, restores, and switches independent conversations", async ({
  page,
}) => {
  const id = "web:" + "a".repeat(32);
  const latest = "web:" + "b".repeat(32);
  const threads: Record<string, { role: string; content: string }[]> = {
    web: [
      { role: "user", content: "Prior question" },
      { role: "assistant", content: "Prior response" },
    ],
    [latest]: [
      { role: "user", content: "Latest question" },
      { role: "assistant", content: "Latest response" },
    ],
  };
  // The API lists conversations newest first; opening /coach must show the first one.
  const order = [latest, "web"];
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
  const header = page.locator(".topbar");
  const dropdown = page.getByRole("dialog");
  const openHistory = () =>
    header.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.locator(".chat-history")).toContainText("Latest response");
  await expect(page.locator(".chat-history")).not.toContainText(
    "Prior response",
  );
  await openHistory();
  await expect(
    dropdown.getByRole("button", { name: "Latest question", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await expect(dropdown).toHaveCount(0);
  await header.getByRole("button", { name: "Chat", exact: true }).click();
  await expect(page).toHaveURL(/chat=web%3A/);
  await expect(page.locator(".chat-history")).not.toContainText(
    "Prior response",
  );
  await page.getByLabel("Message your coach").fill("New training question");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".chat-history")).toContainText(
    "A separate conversation",
  );
  await openHistory();
  await expect(
    dropdown.getByRole("button", { name: "New training question" }),
  ).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator(".chat-history")).toContainText(
    "A separate conversation",
  );
  await openHistory();
  await expect(dropdown.getByLabel("Search conversations")).toBeFocused();
  await page.keyboard.type("prior");
  await expect(dropdown.locator("nav button")).toHaveText(["Prior question"]);
  await dropdown
    .getByRole("button", { name: "Prior question", exact: true })
    .click();
  await expect(dropdown).toHaveCount(0);
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
  await openHistory();
  await expect(dropdown).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 320, height: 900 });
  await openHistory();
  await dropdown
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
