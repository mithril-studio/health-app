import type { Page } from "@playwright/test";
const dashboard = {
  activities: [],
  events: [],
  wellness: [],
  fitness: [],
  settings: {},
  sync: {},
  insights: {},
};
export async function mockWorkouts(
  page: Page,
  saves: Record<string, unknown>[] = [],
  failFirst = false,
) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {},
      status = 200;
    if (path === "/api/session") body = { authenticated: true };
    else if (path === "/api/dashboard") body = dashboard;
    else if (path === "/api/curves") body = { list: [] };
    else if (path === "/api/telegram/status") body = { connected: false };
    else if (path === "/api/athlete-profile") body = emptyProfile;
    else if (path === "/api/coaching-records") body = { records: [] };
    else if (path === "/api/sessions") {
      saves.push(route.request().postDataJSON());
      status = failFirst && saves.length === 1 ? 503 : 201;
      body =
        status === 201 ? { id: "local-test" } : { detail: "temporary failure" };
    }
    await route.fulfill({ status, json: body });
  });
}

export const emptyProfile = {goals:'',target_date:null,background:'',availability:'',other_sports:'',equipment:'',constraints:'',preferences:'',plan_context:'',updated_at:null,revision:0};
