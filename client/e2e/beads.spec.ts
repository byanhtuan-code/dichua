import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__santinh?.ready === true, undefined, { timeout: 30_000 });
}

async function openBeads(page: Page): Promise<void> {
  await page.getByRole("button", { name: /Tràng hạt/ }).click();
  await expect(page.getByRole("heading", { name: "Tràng hạt" })).toBeVisible();
}

test("AC10 + AC11: ↓ five times counts 5 beads, still 5 after a reload", async ({ page }) => {
  await page.goto("/?e2e=1&mock");
  await ready(page);
  await openBeads(page);
  await expect(page.getByText("Vòng này 0 hạt · tổng 0 hạt")).toBeVisible();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowDown");
  await expect(page.getByText("Vòng này 5 hạt")).toBeVisible();
  expect(await page.evaluate(() => window.__santinh?.beads)).toEqual({ round: 1, total: 5 });
  // The first bead frame compiles new shaders (slow on SwiftShader) before the pose is reported.
  await expect.poll(() => page.evaluate(() => window.__santinh?.self?.pose), { timeout: 10_000 }).toBe("beads");

  await page.reload();
  await ready(page);
  await openBeads(page);
  await expect(page.getByText("Vòng này 5 hạt · tổng 5 hạt")).toBeVisible();
});

test("Esc goes back to the game and restores the pose", async ({ page }) => {
  await page.goto("/?e2e=1&mock");
  await ready(page);
  await openBeads(page);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Tràng hạt" })).toBeHidden();
  await expect.poll(() => page.evaluate(() => window.__santinh?.self?.pose)).toBe("walk");
});

test("closing a round shows the toast and starts the next round", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("santinh.beads", JSON.stringify({ round: 1, total: 107 })));
  await page.goto("/?e2e=1&mock");
  await ready(page);
  await openBeads(page);
  await page.keyboard.press("ArrowDown");
  await expect(page.getByText("Đã lần xong 1 vòng")).toBeVisible();
  await expect(page.getByText("Vòng này 108 hạt · tổng 108 hạt")).toBeVisible();
  await page.mouse.wheel(0, 120);
  await expect(page.getByText("Vòng thứ 2")).toBeVisible();
  await expect(page.getByText(/Vòng này [12] hạt/)).toBeVisible();
});
