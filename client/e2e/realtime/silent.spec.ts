import { expect, test } from "@playwright/test";
import { count, openRoom } from "./open.ts";
import { testServer } from "./server.ts";

const server = testServer(4668, { FAKE_POPULATION: "off" });

test.beforeAll(() => server.start());
test.afterAll(() => server.stop());

test("a server that goes silent (socket still open) is noticed: 'Mất kết nối', then back once it answers as the same visitor", async ({ page }) => {
  test.setTimeout(240_000);
  await openRoom(page, "san-06", server.url);
  await expect.poll(() => count(page), { timeout: 15_000 }).toBe(1);
  const selfId = () => page.evaluate(() => window.__santinh?.selfId ?? null);
  const before = await selfId();
  expect(before).not.toBeNull();

  await page.getByRole("button", { name: "Cài đặt" }).click();
  server.pause();
  try {
    // SILENCE_MS 12 s + up to one ping period; no close ever arrives from a frozen server.
    await expect(page.getByRole("button", { name: "Mất kết nối. Xem ai đang ở đây" })).toBeVisible({ timeout: 40_000 });
  } finally {
    server.resume();
  }
  await expect(page.getByRole("button", { name: "1 người đang ở đây. Xem ai đang ở đây" })).toBeVisible({ timeout: 40_000 });
  // The server still held the old socket: the resume token takes it over, so invite links (`?near=<id>`) keep working.
  expect(await selfId()).toBe(before);
});
