import { expect, test, type Page } from "@playwright/test";
import { count, openRoom, tabPool } from "./open.ts";

const tabs = tabPool();
test.afterEach(() => tabs.closeAll());

const ROOM = "san-08";
const selfName = (p: Page) => p.evaluate(() => window.__santinh?.selfName ?? null);
const peopleList = (p: Page) => p.getByRole("dialog", { name: "Ai đang ở đây" });

async function openPeopleFromSettings(p: Page): Promise<void> {
  await p.getByRole("button", { name: "Cài đặt" }).click();
  await p.getByRole("button", { name: /Xem ai đang ở đây/ }).click();
}

test("P3-D4: first visit asks the name, the other tab sees it, reload keeps it, renaming reaches the room", async ({ browser }) => {
  test.setTimeout(420_000);
  // A starts from a blank profile (no seeded `santinh.name`); B is seeded.
  const a = await tabs.open(browser, { storageState: { cookies: [], origins: [] } });
  const b = await tabs.open(browser);
  // Together: once one tab renders continuously, software GL starves the other's first frame.
  await Promise.all([openRoom(a, ROOM), openRoom(b, ROOM)]);

  // First visit: the dialog asks before A joins.
  const ask = a.getByRole("dialog", { name: "Bạn tên là gì?" });
  await expect(ask).toBeVisible({ timeout: 15_000 });
  // `ready` comes before B's connect; A is not in the room while asked.
  await expect.poll(() => count(b), { timeout: 20_000 }).toBe(1);
  await ask.getByRole("textbox", { name: "Tên của bạn" }).fill("Minh Tâm");
  await ask.getByRole("button", { name: "Vào" }).click();
  await expect(ask).toBeHidden();
  await expect.poll(() => selfName(a), { timeout: 20_000 }).toBe("Minh Tâm");

  // B sees A's name in the people dialog.
  await expect.poll(() => count(b), { timeout: 20_000 }).toBe(2);
  await openPeopleFromSettings(b);
  await expect(peopleList(b).getByText("Minh Tâm", { exact: true })).toBeVisible({ timeout: 15_000 });

  // Reload: no second ask, same name.
  await openRoom(a, ROOM);
  await expect.poll(() => selfName(a), { timeout: 30_000 }).toBe("Minh Tâm");
  await expect(ask).toBeHidden();
  expect(await a.evaluate(() => localStorage.getItem("santinh.name"))).toBe("Minh Tâm");

  // Our own row in the people dialog opens the same dialog in "Lưu" mode; closing keeps the name.
  await openPeopleFromSettings(a);
  await peopleList(a).getByRole("button", { name: "Đổi tên của bạn (Minh Tâm)" }).click();
  const rename = a.getByRole("dialog", { name: "Đổi tên của bạn" });
  await expect(rename.getByRole("button", { name: "Lưu" })).toBeVisible();
  await expect(rename.getByRole("textbox", { name: "Tên của bạn" })).toHaveValue("Minh Tâm");
  await rename.getByRole("button", { name: "Đóng" }).click();
  await expect(rename).toBeHidden();
  await a.keyboard.press("Escape");
  await expect(peopleList(a)).toBeHidden();

  // Rename mid-visit through settings: B's open dialog follows.
  await a.getByRole("button", { name: "Cài đặt" }).click();
  const settings = a.getByRole("dialog", { name: "Cài đặt" });
  await expect(settings.getByText("Minh Tâm", { exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Đổi tên của bạn" }).click();
  await rename.getByRole("textbox", { name: "Tên của bạn" }).fill("Tâm An");
  await rename.getByRole("button", { name: "Lưu" }).click();
  await expect(rename).toBeHidden();
  await expect(settings.getByText("Tâm An", { exact: true })).toBeVisible();
  await expect.poll(() => selfName(a), { timeout: 20_000 }).toBe("Tâm An");
  await expect(peopleList(b).getByText("Tâm An", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(peopleList(b).getByText("Minh Tâm", { exact: true })).toHaveCount(0);
  expect(await a.evaluate(() => localStorage.getItem("santinh.name"))).toBe("Tâm An");
});
