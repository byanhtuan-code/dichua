import { expect, test, type Page } from "@playwright/test";
import { BOW_PERIOD_MS } from "@santinh/shared";
import { enterHall } from "./walk.ts";

// Every test walks in from the gate first (software GL frames make that slow).
test.describe.configure({ timeout: 120_000 });

async function ready(page: Page): Promise<void> {
  await page.goto("/?e2e=1&mock");
  await page.waitForFunction(() => window.__santinh?.ready === true, undefined, { timeout: 30_000 });
  // The mock joins a room shortly after the first frame; Lạy needs the connection.
  await page.waitForFunction(() => window.__santinh?.room !== null, undefined, { timeout: 10_000 });
  await enterHall(page);
}

function self(page: Page) {
  return page.evaluate(() => window.__santinh?.self ?? null);
}

test("AC8 + AC9: key 1 kneels on a cushion, key 1 again bows once then stands up", async ({ page }) => {
  await ready(page);
  await page.keyboard.press("1");
  await expect.poll(async () => (await self(page))?.pose, { timeout: 10_000 }).toBe("kneel");
  expect((await self(page))?.cushion).not.toBeNull();

  // Let the sitting-down bow finish so Dừng starts a bow of its own.
  await page.waitForTimeout(BOW_PERIOD_MS + 500);
  await page.keyboard.press("1");
  await expect(page.getByRole("button", { name: /Dừng/ })).toBeVisible();
  await page.waitForTimeout(1000);
  expect((await self(page))?.pose, "still bowing on the cushion").toBe("kneel");
  expect((await self(page))?.cushion).not.toBeNull();
  await expect.poll(async () => (await self(page))?.pose, { timeout: 10_000 }).toBe("walk");
  expect((await self(page))?.cushion).toBeNull();
});

test("key 1 twice while bowing up: stands at once", async ({ page }) => {
  await ready(page);
  await page.keyboard.press("1");
  await expect.poll(async () => (await self(page))?.pose, { timeout: 10_000 }).toBe("kneel");
  await page.waitForTimeout(BOW_PERIOD_MS + 500);
  await page.keyboard.press("1");
  await page.waitForTimeout(500);
  await page.keyboard.press("1");
  // Well inside the bow's BOW_PERIOD_MS: only the second press can have stood us up.
  await expect.poll(async () => (await self(page))?.pose, { timeout: 1_500 }).toBe("walk");
  expect((await self(page))?.cushion).toBeNull();
});

test("walking with W stands up from the cushion", async ({ page }) => {
  await ready(page);
  await page.keyboard.press("e");
  await expect.poll(async () => (await self(page))?.cushion, { timeout: 10_000 }).not.toBeNull();
  await page.keyboard.down("w");
  await expect.poll(async () => (await self(page))?.cushion, { timeout: 5_000 }).toBeNull();
  await page.keyboard.up("w");
  expect((await self(page))?.pose).toBe("walk");
});
