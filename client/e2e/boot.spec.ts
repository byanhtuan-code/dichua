import { expect, test } from "@playwright/test";

test("AC1: boot hides, canvas shows, __santinh.ready", async ({ page }) => {
  const response = await page.goto("/?e2e=1&mock");
  expect(await response?.text()).toContain("Đang mở cổng chùa");
  await expect(page).toHaveTitle(/Sân Tĩnh/);
  await page.waitForFunction(() => window.__santinh?.ready === true, undefined, { timeout: 15_000 });
  await expect(page.locator("canvas")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sân Tĩnh" })).toBeHidden();
  const perf = await page.evaluate(() => window.__santinh?.perf());
  expect(perf?.calls).toBeGreaterThan(0);
});

test("P-D8: a core asset failing shows the load error with a retry", async ({ page }) => {
  await page.route("**/assets/env/woodland.jpg", (route) => route.abort());
  await page.goto("/?e2e=1&mock");
  await expect(page.getByRole("heading", { name: "Không tải được khung cảnh" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: "Vào lại" })).toBeVisible();
});

test("AC2: blocked .glb models show the load error with a retry", async ({ page }) => {
  await page.route("**/*.glb", (route) => route.abort());
  await page.goto("/?e2e=1&mock");
  await expect(page.getByRole("heading", { name: "Không tải được khung cảnh" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("link", { name: "Vào lại" })).toBeVisible();
});

test("no test hooks without e2e=1", async ({ page }) => {
  await page.goto("/?mock");
  await expect(page.locator("canvas")).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => "__santinh" in window)).toBe(false);
});
