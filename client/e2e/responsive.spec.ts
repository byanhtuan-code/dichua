import { expect, test, type Locator } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

type Box = { x: number; y: number; width: number; height: number };

async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error("element not rendered");
  return b;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test("AC15: 390×844 — dock fits, top-left and top-right do not overlap, no horizontal scroll", async ({ page }) => {
  await page.goto("/?e2e=1&mock");
  await page.waitForFunction(() => window.__santinh?.ready === true, undefined, { timeout: 30_000 });
  await page.waitForFunction(() => window.__santinh?.room !== null, undefined, { timeout: 10_000 });

  const dock = page.getByRole("toolbar", { name: "Việc có thể làm" });
  const buttons = dock.getByRole("button");
  await expect(buttons).toHaveCount(5);
  for (const b of await buttons.all()) {
    const r = await box(b);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width).toBeLessThanOrEqual(390);
    expect(r.height).toBeGreaterThanOrEqual(32);
  }

  const left = [page.locator(".lotus-player-card"), page.getByRole("button", { name: /Chọn phòng$/ })];
  const right = [
    page.locator(".lotus-currency-bar"),
    page.getByRole("button", { name: "Cài đặt" }),
    page.getByRole("button", { name: "Nhiệm Vụ" }),
  ];
  for (const l of left) {
    const lb = await box(l);
    for (const r of right) expect(overlaps(lb, await box(r))).toBe(false);
  }

  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.inner);
});
