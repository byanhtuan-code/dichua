import { expect, test } from "@playwright/test";

// AC14, mock version: `?mock=offline` never connects. The real stop/restart of the server is phase 02.
test("AC14 (mock): lost connection shows 'Đang kết nối lại' and locks Lạy", async ({ page }) => {
  await page.goto("/?e2e=1&mock=offline");
  await page.waitForFunction(() => window.__santinh?.ready === true, undefined, { timeout: 30_000 });
  await expect(page.getByRole("status").getByText("Mất kết nối. Đang kết nối lại")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("toolbar").getByRole("button", { name: /Thiền/ })).toBeDisabled();
  await page.getByRole("button", { name: "Cài đặt" }).click();
  await expect(page.getByRole("button", { name: "Mất kết nối. Xem ai đang ở đây" })).toBeVisible();
});
