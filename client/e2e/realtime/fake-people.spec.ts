import { expect, test } from "@playwright/test";
import { DEFAULT_POPULATION } from "@santinh/shared";
import { count, openRoom } from "./open.ts";
import { testServer } from "./server.ts";

// Bots on (the default), unlike the other realtime specs: counts are checked as ranges.
const server = testServer(4667, { FAKE_POPULATION: "on" });

test.beforeAll(() => server.start());
test.afterAll(() => server.stop());

test("P-D5/P-D6: a lone visitor gets bots, and the 10 rooms differ in crowd and none is full (P3-D7)", async ({ page }) => {
  test.setTimeout(240_000);
  await openRoom(page, "san-01", server.url);
  // Us + at least minBots bots (the only real visitor is this tab).
  await expect.poll(() => count(page), { timeout: 20_000 }).toBeGreaterThanOrEqual(DEFAULT_POPULATION.minBots + 1);

  await page.getByRole("button", { name: /Chọn phòng/ }).click();
  const dialog = page.getByRole("dialog", { name: "Chọn phòng" });
  const cards = dialog.getByRole("list", { name: "Danh sách phòng" }).getByRole("button");
  await expect(cards).toHaveCount(10);
  await expect(cards.filter({ hasText: "Đủ người" })).toHaveCount(0);

  // What people see on the cards, not the server JSON: "{count}/{capacity}".
  const counts = (await cards.allInnerTexts()).map((t) => /(\d+)\s*\/\s*\d+/.exec(t)?.[1]);
  expect(counts.every((c) => c !== undefined), counts.join(" | ")).toBe(true);
  expect(new Set(counts).size).toBeGreaterThanOrEqual(3);
});
