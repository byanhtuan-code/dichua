import { expect, test } from "@playwright/test";

// AC5–AC7 need two real tabs on a server (phase 02); here one mock bot plays the other visitor.
test("AC5 + AC6 (mock): one bot → 👥 2, its hello shows 'chắp tay chào bạn'", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/?e2e=1&mock=bots=1&room=san-03");
  await page.waitForFunction(() => window.__santinh?.ready === true, undefined, { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__santinh?.count), { timeout: 10_000 }).toBe(2);
  await page.getByRole("button", { name: "Cài đặt" }).click();
  await expect(page.getByRole("button", { name: "2 người đang ở đây. Xem ai đang ở đây" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Bots greet every 8–38 s after joining (mock timers run slow on SwiftShader).
  await expect(page.getByRole("status").getByText(/chắp tay chào bạn/)).toBeVisible({ timeout: 60_000 });
});
