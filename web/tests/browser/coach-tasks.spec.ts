import { test, expect } from "@playwright/test";
import { mockWorkouts } from "./workout-fixture";

for (const mode of ["daily", "weekly", "workout"] as const) {
  test(`${mode} explicit send and retry preserve task, conversation and message identity`, async ({
    page,
  }) => {
    await mockWorkouts(page);
    const attempts: {
      body: Record<string, unknown>;
      key: string | undefined;
    }[] = [];
    await page.route("**/api/chat**", (route) => {
      if (route.request().method() === "POST") {
        attempts.push({
          body: route.request().postDataJSON(),
          key: route.request().headers()["idempotency-key"],
        });
        return route.fulfill({ status: 503, json: {} });
      }
      return route.fulfill({ json: { messages: [] } });
    });
    await page.goto(
      `/coach?chat=synthetic-thread&mode=${mode}${mode === "workout" ? "&activity_id=synthetic-run" : ""}`,
    );
    await expect(page.getByLabel("Message your coach")).toBeVisible();
    expect(attempts).toHaveLength(0);
    await page.getByLabel("Message your coach").fill("Review this task");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry response" }),
    ).toBeVisible();
    await page.getByLabel("Coaching task").selectOption("chat");
    await page.getByRole("button", { name: "Retry response" }).click();
    await expect.poll(() => attempts.length).toBe(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(attempts[0].key).toBeTruthy();
    expect(attempts[0].body).toEqual({
      message: "Review this task",
      conversation_id: "synthetic-thread",
      mode,
      ...(mode === "workout" ? { activity_id: "synthetic-run" } : {}),
    });
  });
}
test("assistant follow-up is editable and never saved until explicitly submitted", async ({
  page,
}) => {
  await mockWorkouts(page);
  let saved: Record<string, unknown> | null = null;
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      json: {
        messages: [
          {
            role: "assistant",
            content: "Try a short easy run.",
            created_at: "2026-10-09T10:00:00Z",
          },
        ],
      },
    }),
  );
  await page.route("**/api/coaching-records", (route) => {
    saved = route.request().postDataJSON();
    return route.fulfill({
      json: {
        ...saved,
        status: "proposed",
        revision: 1,
        outcome: "",
        created_at: "2026-10-09T10:00:00Z",
        updated_at: "2026-10-09T10:00:00Z",
      },
    });
  });
  await page.goto("/coach");
  await page.getByRole("button", { name: "Save for follow-up" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Record text", { exact: true })).toHaveValue(
    "Try a short easy run.",
  );
  expect(saved).toBeNull();
  await dialog
    .getByLabel("Record text", { exact: true })
    .fill("Consider a short run tomorrow");
  await dialog.getByRole("button", { name: "Save proposal" }).click();
  await expect(dialog.getByRole("status")).toContainText(
    "Accept it separately",
  );
  expect(saved).toMatchObject({
    text: "Consider a short run tomorrow",
    kind: "recommendation",
    rationale: "",
  });
  expect(saved).not.toHaveProperty("status");
});

test("retained WHOOP activity shows source and strain and opens explicit workout review", async ({
  page,
}) => {
  await mockWorkouts(page);
  const { today } = await import("../../src/lib/dates");
  const activity = {
    id: "whoop-synthetic",
    source: "whoop",
    name: "Historical workout",
    type: "Run",
    start_date_local: `${today()}T09:00:00`,
    elapsed_time: 1800,
    whoop_strain: 8.4,
  };
  await page.route("**/api/dashboard?*", (route) =>
    route.fulfill({
      json: {
        activities: [activity],
        events: [],
        wellness: [],
        fitness: [],
        settings: {},
        sync: {},
        insights: {},
      },
    }),
  );
  await page.route("**/api/activity/*", (route) =>
    route.fulfill({ json: activity }),
  );
  const requests: unknown[] = [];
  await page.route("**/api/chat**", (route) => {
    if (route.request().method() === "POST")
      requests.push(route.request().postDataJSON());
    return route.fulfill({ json: { messages: [], reply: "Review complete" } });
  });
  await page.goto("/");
  await page.getByRole("tab", { name: "Activities", exact: true }).click();
  await page
    .getByRole("button", { name: /Historical workout/ })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("WHOOP", { exact: true })).toBeVisible();
  await expect(dialog.getByText("WHOOP strain: 8.4")).toBeVisible();
  await dialog.getByRole("link", { name: "Review with coach" }).click();
  await expect(page).toHaveURL(
    /\/coach\?mode=workout&activity_id=whoop-synthetic$/,
  );
  await expect(page.getByLabel("Coaching task")).toHaveValue("workout");
  expect(requests).toHaveLength(0);
  await page.getByLabel("Message your coach").fill("Review my workout");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    mode: "workout",
    activity_id: "whoop-synthetic",
    conversation_id: "web",
  });
});

test("oversized assistant excerpts stay visible for editing and cannot be silently truncated", async ({
  page,
}) => {
  await mockWorkouts(page);
  const excerpt = "a".repeat(4001);
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      json: { messages: [{ role: "assistant", content: excerpt }] },
    }),
  );
  await page.goto("/coach");
  await page.getByRole("button", { name: "Save for follow-up" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Record text", { exact: true })).toHaveValue(
    excerpt,
  );
  await expect(
    dialog.getByText("4,001 / 4,000", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Save proposal" }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Record text", { exact: true })
    .fill("Edited excerpt");
  await expect(
    dialog.getByRole("button", { name: "Save proposal" }),
  ).toBeEnabled();
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  await page.screenshot({
    path: "artifacts/coach-follow-up.png",
    fullPage: true,
  });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
test("workout mode without a selected activity cannot send", async ({
  page,
}) => {
  await mockWorkouts(page);
  await page.route("**/api/chat", (route) =>
    route.fulfill({ json: { messages: [] } }),
  );
  await page.goto("/coach?mode=workout");
  await expect(
    page.getByText("Open a workout and choose Review with coach to select it."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
});
