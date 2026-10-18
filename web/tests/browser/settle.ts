import type { Page } from "@playwright/test";

// Let finite animations (dialog fade-in) finish so axe measures contrast at rest.
export async function settleAnimations(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished),
    ),
  );
}
