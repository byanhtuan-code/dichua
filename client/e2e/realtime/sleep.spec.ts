import { expect, test } from "@playwright/test";
import { tabPool } from "./open.ts";

const tabs = tabPool();
test.afterEach(() => tabs.closeAll());

test("D25: an idle visitor dozes in the room (others see it), input wakes them, nobody is sent away", async ({ browser }) => {
  test.setTimeout(420_000);
  const a = await tabs.open(browser);
  // `?sleep=` shortens the 3 min idle doze for the test.
  await a.goto("/?e2e=1&room=san-06&sleep=4000");
  await a.waitForFunction(() => window.__santinh?.ready === true, undefined, { timeout: 300_000 });
  const aId = await a.evaluate(() => window.__santinh?.selfId ?? null);
  expect(aId).not.toBeNull();

  const b = await tabs.open(browser);
  await b.goto("/?e2e=1&room=san-06");
  await b.waitForFunction(() => window.__santinh?.ready === true, undefined, { timeout: 300_000 });
  // B keeps moving the mouse so only A goes idle.
  const keepAwake = setInterval(() => void b.mouse.move(Math.random() * 300, Math.random() * 300).catch(() => undefined), 1000);
  try {
    await expect.poll(() => a.evaluate(() => window.__santinh?.self?.asleep), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => b.evaluate(() => window.__santinh?.asleep ?? []), { timeout: 15_000 }).toContain(aId);
    // Dozing is not the rest screen: A is still in the room.
    await expect(a.getByRole("dialog")).toHaveCount(0);
    expect(await b.evaluate(() => window.__santinh?.others ?? [])).toContain(aId);

    await a.mouse.move(200, 200);
    await a.mouse.move(240, 260);
    await expect.poll(() => a.evaluate(() => window.__santinh?.self?.asleep), { timeout: 10_000 }).toBe(false);
    await expect.poll(() => b.evaluate(() => window.__santinh?.asleep ?? []), { timeout: 15_000 }).not.toContain(aId);
  } finally {
    clearInterval(keepAwake);
  }
});
