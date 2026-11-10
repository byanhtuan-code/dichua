import { expect, test } from "@playwright/test";

// P-D11 budget at a full room: 26 bots + us + 4 residents, shadows on.
// `spawn` is the default view; `overview` sees the whole site, so frustum culling hides nothing.
for (const cam of ["spawn", "overview"]) {
  test(`30 people (${cam}): ≤ 120 draw calls, ≤ 400k triangles`, async ({ page }) => {
    await page.goto(`/?e2e=1&shadows=1&mock=bots=26&cam=${cam}`);
    await page.waitForFunction(() => window.__santinh?.ready === true, undefined, { timeout: 30_000 });
    await expect.poll(() => page.evaluate(() => window.__santinh?.count), { timeout: 15_000 }).toBe(27);
    // renderer.info holds the last frame only: wait until a frame with every avatar has been drawn.
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    const perf = await page.evaluate(() => window.__santinh?.perf());
    test.info().annotations.push({ type: "perf", description: JSON.stringify(perf) });
    expect(perf?.calls).toBeGreaterThan(0);
    expect(perf?.calls).toBeLessThanOrEqual(120);
    expect(perf?.triangles).toBeLessThanOrEqual(400_000);
  });
}
