import { test, expect } from "@playwright/test";
import { mockWorkouts } from "./workout-fixture";

test("settings and WHOOP controls are removed without processing OAuth URLs", async ({
  page,
}) => {
  await mockWorkouts(page);
  const retired: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/(whoop|athlete-scores)/.test(request.url()))
      retired.push(request.url());
  });
  await page.goto("/workouts?code=synthetic-code&state=synthetic-state");
  await expect(
    page.getByRole("button", { name: "Start meditation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Settings", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /WHOOP/ })).toHaveCount(0);
  expect(retired).toEqual([]);
  await page.goto("/settings");
  await expect(page.getByText("Save scores", { exact: true })).toHaveCount(0);
});
