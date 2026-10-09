import { test, expect } from "@playwright/test";
import { emptyProfile } from "./workout-fixture";
import AxeBuilder from "@axe-core/playwright";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === "/api/session"
        ? { authenticated: true }
        : path === "/api/dashboard"
          ? {
              activities: [],
              events: [],
              wellness: [],
              fitness: [],
              settings: {},
              sync: {},
            }
          : path === "/api/athlete-profile"
            ? emptyProfile
            : path === "/api/coaching-records"
              ? { records: [] }
              : path === "/api/chat"
                ? { messages: [] }
                : path === "/api/conversations"
                  ? { conversations: [{ id: "web", title: "Earlier chats" }] }
                  : path === "/api/confirmations"
                    ? { pending: [] }
                    : {};
    return route.fulfill({ json: body });
  });
});

test("every page has one bold header title and a full-width section menu", async ({
  page,
}) => {
  for (const [route, title] of [
    ["/", "Overview"],
    ["/calendar", "Calendar"],
    ["/insights", "Insights"],
    ["/athlete", "Athlete"],
    ["/coach", "Chats"],
  ]) {
    await page.goto(route);
    const titleNode = page.locator(".topbar h1");
    await expect(titleNode).toHaveText(title);
    expect(
      await titleNode.evaluate((el) => Number(getComputedStyle(el).fontWeight)),
    ).toBeGreaterThanOrEqual(600);
    await expect(page.locator("#main-content h1")).toHaveCount(0);
    await expect(page.locator("#page-menu > *")).toBeVisible();
    const menu = await page.locator("#page-menu").boundingBox(),
      header = await page.locator(".topbar").boundingBox();
    expect(Math.abs(menu!.x - header!.x)).toBeLessThan(1);
    expect(Math.abs(menu!.width - header!.width)).toBeLessThan(1);
  }
});

test("section tabs are keyboard accessible and switch the visible content", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Recovery", exact: true }).click();
  await expect(
    page.getByRole("tabpanel", { name: "Recovery", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("tabpanel", { name: "This week", exact: true }),
  ).toBeHidden();
  await page
    .getByRole("tab", { name: "Recovery", exact: true })
    .press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Activities", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("tabpanel", { name: "Activities", exact: true }),
  ).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("chat history docks against the main sidebar and fills the remaining height", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/coach");
  const sidebar = await page.locator(".sidebar").boundingBox();
  const history = await page.locator(".conversation-menu").boundingBox();
  const menu = await page.locator("#page-menu").boundingBox();
  expect(Math.abs(history!.x - sidebar!.x - sidebar!.width)).toBeLessThan(1);
  expect(Math.abs(history!.y - menu!.y - menu!.height)).toBeLessThan(1);
  expect(Math.abs(history!.y + history!.height - 900)).toBeLessThan(2);
  await expect(page.getByLabel("Message your coach")).toBeInViewport();
  await page.getByRole("button", { name: "Collapse navigation" }).click();
  // Measure both rectangles in one frame after the collapse animation settles.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const sidebar = document
          .querySelector(".sidebar")!
          .getBoundingClientRect();
        const history = document
          .querySelector(".conversation-menu")!
          .getBoundingClientRect();
        return (
          Math.abs(history.x - sidebar.right) + Math.abs(sidebar.width - 64)
        );
      }),
    )
    .toBeLessThan(1);
  await page.setViewportSize({ width: 320, height: 900 });
  await expect(
    page.getByRole("button", { name: "Show chat history" }),
  ).toBeVisible();
  await expect(page.getByLabel("Message your coach")).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
