import { test, expect } from "@playwright/test";

for (const method of ["button", "Enter"] as const) {
  test(`password-manager autofill without input events can sign in using ${method}`, async ({
    page,
  }) => {
    let authenticated = false;
    let submitted = "";
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/login") {
        submitted = route.request().postDataJSON().password;
        authenticated = submitted === "autofilled-test-password";
        return route.fulfill({ json: { ok: true } });
      }
      if (path === "/api/session")
        return route.fulfill({ json: { authenticated } });
      if (path === "/api/dashboard")
        return route.fulfill({
          json: {
            activities: [],
            events: [],
            wellness: [],
            fitness: [],
            settings: {},
            sync: {},
          },
        });
      return route.fulfill({ json: {} });
    });
    await page.goto("/");
    const input = page.getByLabel("Workspace password");
    await expect(input).toBeVisible();
    // Password managers can update the native field without notifying React.
    await input.evaluate((el: HTMLInputElement) => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(el, "autofilled-test-password");
    });
    if (method === "button") {
      const button = page.getByRole("button", { name: "Enter your workspace" });
      await expect(button).toBeEnabled();
      await button.click();
    } else await input.press("Enter");
    await expect(page.locator(".sidebar")).toBeVisible();
    expect(submitted).toBe("autofilled-test-password");
  });
}

test("an accepted password without a retained session shows an actionable error and allows retry", async ({
  page,
}) => {
  let authenticated = false;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/session")
      return route.fulfill({ json: { authenticated } });
    if (path === "/api/dashboard")
      return route.fulfill({
        json: {
          activities: [],
          events: [],
          wellness: [],
          fitness: [],
          settings: {},
          sync: {},
        },
      });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  const input = page.getByLabel("Workspace password");
  await input.fill("test-password");
  await page.getByRole("button", { name: "Enter your workspace" }).click();
  await expect(page.locator(".error-notice[role=alert]")).toContainText(
    "Your password was accepted",
  );
  await expect(page.locator(".error-notice[role=alert]")).toContainText("cookies");
  await expect(input).toHaveValue("test-password");
  await expect(
    page.getByRole("button", { name: "Enter your workspace" }),
  ).toBeEnabled();
  authenticated = true;
  await page.getByRole("button", { name: "Enter your workspace" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
});
