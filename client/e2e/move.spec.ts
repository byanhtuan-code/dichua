import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page): Promise<void> {
  await page.goto("/?e2e=1&mock");
  await page.waitForFunction(() => window.__santinh?.ready === true, undefined, { timeout: 30_000 });
}

function self(page: Page) {
  return page.evaluate(() => window.__santinh?.self ?? null);
}

test("AC3: holding W walks forward (z decreases)", async ({ page }) => {
  await ready(page);
  const before = await self(page);
  expect(before?.pose).toBe("walk");
  await page.keyboard.down("w");
  await page.waitForTimeout(1000);
  await page.keyboard.up("w");
  const after = await self(page);
  expect(after?.position.z ?? 0).toBeLessThan((before?.position.z ?? 0) - 0.3);
});

test("AC4: clicking the floor ahead walks there, the stop chip shows and stops", async ({ page }) => {
  await ready(page);
  const before = await self(page);
  const size = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.mouse.click(size.width / 2, size.height * 0.6);
  await expect(page.getByRole("button", { name: "Đang đi · Dừng" })).toBeVisible();
  await page.waitForTimeout(3000);
  const after = await self(page);
  expect(after?.pose).toBe("walk");
  const moved = Math.hypot((after?.position.x ?? 0) - (before?.position.x ?? 0), (after?.position.z ?? 0) - (before?.position.z ?? 0));
  expect(moved).toBeGreaterThan(0.5);

  // A far click, then Dừng: position freezes.
  await page.mouse.click(size.width / 2, size.height * 0.52);
  await page.getByRole("button", { name: "Đang đi · Dừng" }).click();
  await expect(page.getByRole("button", { name: "Đang đi · Dừng" })).toBeHidden();
  const stopped = await self(page);
  await page.waitForTimeout(500);
  expect((await self(page))?.position.z).toBeCloseTo(stopped?.position.z ?? 0, 2);
});
