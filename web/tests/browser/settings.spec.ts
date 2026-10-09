import { test, expect } from "@playwright/test";
import { mockWorkouts as mock } from "./workout-fixture";

test("WHOOP callback consumes the code once, clears the URL, and shows duplicate status", async ({
  page,
}) => {
  await mock(page);
  const connects: unknown[] = [];
  await page.route("**/api/whoop", (route) =>
    route.fulfill({
      json: {
        configured: true,
        connected: true,
        last_success: "2026-10-08T10:00:00Z",
        error: null,
      },
    }),
  );
  await page.route("**/api/whoop/connect", (route) => {
    connects.push(route.request().postDataJSON());
    return route.fulfill({ json: { connected: true } });
  });
  await page.route("**/api/whoop/workouts?*", (route) =>
    route.fulfill({
      json: {
        workouts: [
          {
            id: "whoop-synthetic",
            name: "Running",
            start_date_local: "2026-10-08T09:00:00",
            duplicate_of: "garmin-synthetic",
          },
          {
            id: "whoop-home",
            name: "Functional Fitness",
            start_date_local: "2026-10-08T11:00:00",
            duplicate_of: null,
          },
        ],
      },
    }),
  );
  await page.goto("/settings?code=synthetic-code&state=synthetic-state");
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByRole("tab", { name: "Connections" }).click();
  await expect(
    page.getByRole("button", { name: "Sync workouts" }),
  ).toBeEnabled();
  expect(connects).toEqual([
    { code: "synthetic-code", state: "synthetic-state" },
  ]);
  await page.getByText("Recent WHOOP imports · 2", { exact: true }).click();
  await expect(
    page.getByText("Matched · not counted twice", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Included", { exact: true })).toBeVisible();
});
