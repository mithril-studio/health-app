import { test, expect } from "@playwright/test";
import { mockWorkouts } from "./workout-fixture";
import type { CoachingRecord } from "../../src/lib/athlete";

test("proposal retries use one UUID, acceptance is separate, completion retains outcome and history", async ({
  page,
}) => {
  await mockWorkouts(page);
  const records: CoachingRecord[] = [];
  const creates: Record<string, unknown>[] = [];
  const patches: Record<string, unknown>[] = [];
  let failPatch = true;
  await page.route("**/api/coaching-records**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const body = req.postDataJSON();
      creates.push(body);
      if (!records.length)
        records.push({
          ...body,
          status: "proposed",
          outcome: "",
          revision: 1,
          created_at: "2026-10-09T09:00:00Z",
          updated_at: "2026-10-09T09:00:00Z",
        });
      if (creates.length === 1) return route.fulfill({ status: 503, json: {} });
      return route.fulfill({ json: records[0] });
    }
    if (req.method() === "PATCH") {
      const body = req.postDataJSON();
      patches.push(body);
      if (failPatch) {
        failPatch = false;
        return route.fulfill({ status: 409, json: {} });
      }
      expect(body.revision).toBe(records[0].revision);
      records[0] = {
        ...records[0],
        ...body,
        revision: records[0].revision + 1,
        updated_at: "2026-10-09T10:00:00Z",
      };
      return route.fulfill({ json: records[0] });
    }
    return route.fulfill({ json: { records } });
  });
  await page.goto("/athlete");
  await page.getByRole("tab", { name: "Coaching record", exact: true }).click();
  await page.getByLabel("Record type").selectOption("recommendation");
  await page.getByLabel("Record text", { exact: true }).fill("Try an easy run");
  await page
    .getByLabel("Rationale", { exact: true })
    .fill("Keep training manageable");
  await page.getByRole("button", { name: "Save proposal" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Record text", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.getByText("Proposed · not confirmed", { exact: true }),
  ).toBeVisible();
  expect(creates).toHaveLength(2);
  expect(creates[1]).toEqual(creates[0]);
  expect(creates[0].id).toMatch(/^[0-9a-f-]{36}$/);
  expect(patches).toHaveLength(0);
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "changed elsewhere",
  );
  await page.getByRole("button", { name: "Reload records" }).click();
  await page.getByRole("button", { name: "Accept", exact: true }).click();
  await expect(page.getByText("Accepted", { exact: true })).toBeVisible();
  await page.getByLabel("Outcome", { exact: true }).fill("Felt comfortable");
  await page.getByRole("button", { name: "Complete with outcome" }).click();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole("tab", { name: "Coaching record", exact: true }).click();
  await expect(page.getByLabel("Outcome", { exact: true })).toHaveValue(
    "Felt comfortable",
  );
  await expect(page.locator("li time").first()).toHaveAttribute(
    "datetime",
    "2026-10-09T09:00:00Z",
  );
  await page
    .getByLabel("Outcome", { exact: true })
    .fill("Comfortable; repeated next week");
  await page.getByRole("button", { name: "Update outcome" }).click();
  await expect
    .poll(() => records[0].outcome)
    .toBe("Comfortable; repeated next week");
});

test("proposed and accepted records can be dismissed explicitly", async ({
  page,
}) => {
  await mockWorkouts(page);
  let records: CoachingRecord[] = ["proposed", "accepted"].map((status, i) => ({
    id: `00000000-0000-4000-8000-00000000000${i}`,
    kind: "question",
    status: status as CoachingRecord["status"],
    text: `Question ${i}`,
    rationale: "",
    outcome: "",
    revision: 1,
    created_at: "2026-10-09T09:00:00Z",
    updated_at: "2026-10-09T09:00:00Z",
  }));
  await page.route("**/api/coaching-records**", async (route) => {
    if (route.request().method() === "PATCH") {
      const id = new URL(route.request().url()).pathname.split("/").pop();
      records = records.map((r) =>
        r.id === id
          ? {
              ...r,
              ...route.request().postDataJSON(),
              revision: r.revision + 1,
            }
          : r,
      );
      return route.fulfill({ json: records.find((r) => r.id === id) });
    }
    return route.fulfill({ json: { records } });
  });
  await page.goto("/athlete");
  await page.getByRole("tab", { name: "Coaching record", exact: true }).click();
  await page
    .getByRole("button", { name: "Dismiss", exact: true })
    .first()
    .click();
  await expect(page.getByText("Dismissed", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(page.getByText("Dismissed", { exact: true })).toHaveCount(2);
});

test("record load retries, bounds history, and remains accessible at narrow widths", async ({
  page,
}) => {
  await mockWorkouts(page);
  let count = 0;
  await page.route("**/api/coaching-records", (route) => {
    count++;
    return count === 1
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({
          json: {
            records: Array.from({ length: 55 }, (_, i) => ({
              id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
              kind: "observation",
              status: "dismissed",
              text: `Historical observation ${i}`,
              rationale: "",
              outcome: "",
              created_at: "2026-10-09T10:00:00Z",
              updated_at: "2026-10-09T10:00:00Z",
              revision: 1,
            })),
          },
        });
  });
  await page.goto("/athlete");
  await page.getByRole("tab", { name: "Coaching record", exact: true }).click();
  await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".athlete-records li")).toHaveCount(50);
  await page.setViewportSize({ width: 320, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  await page.screenshot({
    path: "artifacts/records-mobile.png",
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
