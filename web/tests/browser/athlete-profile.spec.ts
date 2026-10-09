import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockWorkouts } from "./workout-fixture";
const emptyProfile = {
  goals: "",
  target_date: null,
  background: "",
  availability: "",
  other_sports: "",
  equipment: "",
  constraints: "",
  preferences: "",
  plan_context: "",
  updated_at: null,
  revision: 0,
};
async function fixture(page: Page) {
  await mockWorkouts(page);
  let profile: Record<string, unknown> = { ...emptyProfile };
  let failure = 0;
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/athlete-profile", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      writes.push(body);
      if (failure) return route.fulfill({ status: failure, json: {} });
      expect(body).not.toHaveProperty("updated_at");
      expect(body.revision).toBe(profile.revision);
      profile = {
        ...body,
        revision: Number(profile.revision) + 1,
        updated_at: "2026-10-09T10:00:00Z",
      };
    }
    await route.fulfill({ json: profile });
  });
  await page.route("**/api/coaching-records", (route) =>
    route.fulfill({ json: { records: [] } }),
  );
  return {
    writes,
    fail: (status: number) => {
      failure = status;
    },
  };
}
test("confirmed profile persists after reload and fits mobile", async ({
  page,
}) => {
  const mock = await fixture(page);
  await page.goto("/athlete");
  await page.getByLabel("Goals", { exact: true }).fill("Comfortable 10 km");
  await page.getByLabel("Target date").fill("2027-04-01");
  await page.getByLabel("Training background").fill("Two years running");
  expect(mock.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.reload();
  await expect(page.getByLabel("Goals", { exact: true })).toHaveValue(
    "Comfortable 10 km",
  );
  await expect(page.getByLabel("Target date")).toHaveValue("2027-04-01");
  await expect(page.getByText("Zones & scores", { exact: true })).toHaveCount(
    0,
  );
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("rejected and stale profile saves preserve draft and require conflict reload", async ({
  page,
}) => {
  const mock = await fixture(page);
  await page.goto("/athlete");
  await page.getByLabel("Goals", { exact: true }).fill("My draft");
  mock.fail(503);
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Goals", { exact: true })).toHaveValue(
    "My draft",
  );
  mock.fail(409);
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("changed elsewhere");
  await expect(
    page.getByRole("button", { name: "Save profile", exact: true }),
  ).toBeDisabled();
  mock.fail(0);
  await page.getByRole("button", { name: "Reload saved profile" }).click();
  await expect(page.getByLabel("Goals", { exact: true })).toHaveValue("");
  await page.getByLabel("Goals", { exact: true }).fill("Reconciled goal");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
});
