import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function mockScores(page: Page) {
  let scores = {
    lt1_hr: null as number | null,
    lt2_hr: null as number | null,
    vo2max: null as number | null,
    hr_zones: null as { min_bpm: number; max_bpm: number }[] | null,
  };
  let failSave = false;
  let failLoad = false;
  let writes = 0;
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
        insights: {},
      };
    if (path === "/api/athlete-scores") {
      if (route.request().method() === "POST") {
        writes++;
        if (failSave) return route.fulfill({ status: 503, json: {} });
        scores = route.request().postDataJSON();
      } else if (failLoad) return route.fulfill({ status: 503, json: {} });
      body = scores;
    }
    await route.fulfill({ json: body });
  });
  return {
    failSave: (value: boolean) => {
      failSave = value;
    },
    failLoad: (value: boolean) => {
      failLoad = value;
    },
    writes: () => writes,
  };
}

test("enter, persist and clear personal scores", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await mockScores(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByLabel("LT2 heart rate", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    page.getByRole("button", { name: "Save scores" }),
  ).toBeDisabled();
  await page.screenshot({
    path: "../.context/settings-desktop.png",
    fullPage: true,
  });
  const accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByLabel("LT1 heart rate", { exact: true }).fill("145");
  await page.getByLabel("LT2 heart rate", { exact: true }).fill("172");
  await page.getByLabel("VO₂max", { exact: true }).fill("58.5");
  const bounds = [
    [100, 130],
    [131, 145],
    [146, 160],
    [161, 175],
    [176, 200],
  ];
  for (const [index, [low, high]] of bounds.entries()) {
    await page
      .getByLabel(`Z${index + 1} lower limit`, { exact: true })
      .fill(String(low));
    await page
      .getByLabel(`Z${index + 1} upper limit`, { exact: true })
      .fill(String(high));
  }
  await page.getByRole("button", { name: "Save scores" }).click();
  await expect(page.getByRole("status")).toContainText("Saved.");
  await page.reload();
  await expect(page.getByLabel("LT2 heart rate", { exact: true })).toHaveValue(
    "172",
  );
  await expect(page.getByLabel("VO₂max", { exact: true })).toHaveValue("58.5");
  await expect(page.getByLabel("Z5 upper limit", { exact: true })).toHaveValue(
    "200",
  );
  await page.getByLabel("Z2 lower limit", { exact: true }).fill("130");
  await page.getByRole("button", { name: "Save scores" }).click();
  await expect(
    page.locator(".athlete-scores").getByRole("alert"),
  ).toContainText("Each zone must start 1 bpm above");
  await page.getByLabel("Z2 lower limit", { exact: true }).fill("131");
  await page.getByLabel("LT2 heart rate", { exact: true }).fill("");
  await page.getByRole("button", { name: "Save scores" }).click();
  await expect(page.getByRole("status")).toContainText("Saved.");
  await page.reload();
  await expect(page.getByLabel("LT2 heart rate", { exact: true })).toHaveValue(
    "",
  );
  await expect(page.getByLabel("LT1 heart rate", { exact: true })).toHaveValue(
    "145",
  );
  await expect(page.getByLabel("Z1 lower limit", { exact: true })).toHaveValue(
    "100",
  );
  await page.getByRole("button", { name: "Clear zones", exact: true }).click();
  await page.getByRole("button", { name: "Save scores" }).click();
  await expect(page.getByRole("status")).toContainText("Saved.");
  await page.reload();
  await expect(page.getByLabel("Z1 lower limit", { exact: true })).toHaveValue(
    "",
  );
  await expect(page.getByLabel("VO₂max", { exact: true })).toHaveValue("58.5");
});

test("validation, loading retry and failed save preserve input on mobile", async ({
  page,
}) => {
  const mock = await mockScores(page);
  mock.failLoad(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Expand navigation" }).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.locator(".athlete-scores").getByRole("alert"),
  ).toBeVisible();
  mock.failLoad(false);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByLabel("LT1 heart rate", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../.context/settings-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByLabel("LT1 heart rate", { exact: true }).fill("180");
  await page.getByLabel("LT2 heart rate", { exact: true }).fill("172");
  await page.getByRole("button", { name: "Save scores" }).click();
  await expect(
    page.locator(".athlete-scores").getByRole("alert"),
  ).toContainText("LT1 heart rate must be lower");
  expect(mock.writes()).toBe(0);
  await page.getByLabel("LT1 heart rate", { exact: true }).fill("145");
  mock.failSave(true);
  await page.getByRole("button", { name: "Save scores" }).click();
  await expect(
    page.locator(".athlete-scores").getByRole("alert"),
  ).toBeVisible();
  await expect(page.getByLabel("LT2 heart rate", { exact: true })).toHaveValue(
    "172",
  );
  await expect(page.getByRole("status")).not.toContainText("Saved.");
  mock.failSave(false);
  await page.getByRole("button", { name: "Save scores" }).click();
  await expect(page.getByRole("status")).toContainText("Saved.");
});
