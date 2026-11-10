import { expect, test } from "@playwright/test";
import { vi } from "../../src/i18n/vi.ts";
import { count, openRoom } from "./open.ts";
import { testServer } from "./server.ts";

const server = testServer(4666, { FAKE_POPULATION: "off" });

test.beforeAll(() => server.start());
test.afterAll(() => server.stop());

test("AC14: stopping the server shows 'Đang kết nối lại'; restarting it reconnects", async ({ page }) => {
  test.setTimeout(240_000);
  await openRoom(page, "san-02", server.url);
  await expect.poll(() => count(page), { timeout: 15_000 }).toBe(1);

  await server.stop();
  await expect(page.getByRole("status").getByText(vi.toast.reconnecting)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("toolbar").getByRole("button", { name: /Thiền/ })).toBeDisabled();
  await page.getByRole("button", { name: "Cài đặt" }).click();
  await expect(page.getByRole("button", { name: "Mất kết nối. Xem ai đang ở đây" })).toBeVisible();

  await server.start();
  await expect(page.getByRole("button", { name: "1 người đang ở đây. Xem ai đang ở đây" })).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("toolbar").getByRole("button", { name: /Thiền/ })).toBeEnabled();
});
