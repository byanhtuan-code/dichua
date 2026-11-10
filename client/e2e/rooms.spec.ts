import { expect, test, type Page } from "@playwright/test";

async function ready(page: Page, query = ""): Promise<void> {
  const mock = new URLSearchParams(query).has("mock") ? "" : "&mock";
  await page.goto(`/?e2e=1${mock}${query}`);
  await page.waitForFunction(() => window.__santinh?.ready === true, undefined, { timeout: 30_000 });
}

test("AC12: the room dialog lists 10 rooms; picking Phòng 5 switches without reload", async ({ page }) => {
  await ready(page);
  await page.waitForFunction(() => window.__santinh?.room !== null, undefined, { timeout: 10_000 });
  await page.getByRole("button", { name: /Chọn phòng/ }).click();
  const dialog = page.getByRole("dialog", { name: "Chọn phòng" });
  const cards = dialog.getByRole("list", { name: "Danh sách phòng" }).getByRole("button");
  await expect(cards).toHaveCount(10);
  await page.evaluate(() => ((window as unknown as { marker: number }).marker = 1));
  await cards.filter({ hasText: "Phòng 5" }).click();
  await expect(dialog).toBeHidden({ timeout: 5_000 });
  await expect(page).toHaveURL(/room=san-05/);
  // D26: the pill shows the room's name; its label keeps the number too.
  await expect(page.getByRole("button", { name: "Phòng 5 · Liên Hoa. Chọn phòng" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__santinh?.room)).toBe("san-05");
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(1);
});

test("AC13: a full room shows the toast and opens the dialog", async ({ page }) => {
  await ready(page, "&mock=full&room=san-07");
  await expect(page.getByRole("status").getByText("Phòng này đã đủ người. Hãy chọn phòng khác.")).toBeVisible({ timeout: 10_000 });
  const dialog = page.getByRole("dialog", { name: "Chọn phòng" });
  await expect(dialog.getByText("Phòng Minh Nguyệt đã đủ người. Hãy chọn phòng khác.")).toBeVisible();
  await dialog.getByRole("button", { name: /^An Nhiên\b/ }).click();
  await expect.poll(() => page.evaluate(() => window.__santinh?.room), { timeout: 10_000 }).toBe("san-02");
  await expect(page).toHaveURL(/room=san-02/);
});
