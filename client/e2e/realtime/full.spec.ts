import { expect, test } from "@playwright/test";
import { DEFAULT_ROOM_NAMES } from "@santinh/shared";
import { vi } from "../../src/i18n/vi.ts";
import { count, openRoom, tabPool } from "./open.ts";

const tabs = tabPool();
test.afterEach(() => tabs.closeAll());
import { testServer } from "./server.ts";

const server = testServer(4665, { CAPACITY: "1", FAKE_POPULATION: "off" });

test.beforeAll(() => server.start());
test.afterAll(() => server.stop());

test("AC13: with CAPACITY=1 the second visitor is turned away with the full-room message", async ({ browser }) => {
  test.setTimeout(240_000);
  const a = await tabs.open(browser);
  const b = await tabs.open(browser);
  await openRoom(a, "san-07", server.url);
  await expect.poll(() => count(a), { timeout: 15_000 }).toBe(1);

  // No wait for `ready`: while A renders, software GL may starve B's first frame; the toast needs none.
  await b.goto(`${server.url}/?e2e=1&room=san-07`);
  await expect(b.getByRole("status").getByText(vi.toast.roomFull)).toBeVisible({ timeout: 90_000 });
  const dialog = b.getByRole("dialog", { name: "Chọn phòng" });
  await expect(dialog.getByText(vi.rooms.full.replace("{room}", DEFAULT_ROOM_NAMES[6] ?? ""))).toBeVisible();
  expect(await count(a)).toBe(1);
});
