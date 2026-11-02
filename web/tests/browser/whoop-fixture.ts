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
export async function mockWhoop(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = {};
    const status = 200;
    if (path === "/api/session") body = { authenticated: true };
    else if (path === "/api/dashboard") body = dashboard;
    else if (path === "/api/curves") body = { list: [] };
    else if (path === "/api/whoop")
      body = {
        configured: false,
        connected: false,
        last_success: null,
        error: null,
      };
    else if (path === "/api/whoop/workouts") body = { workouts: [] };
    await route.fulfill({ status, json: body });
  });
}
