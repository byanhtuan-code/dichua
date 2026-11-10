import { expect, test } from "@playwright/test";
import { openRoom, tabPool } from "./open.ts";

const tabs = tabPool();
test.afterEach(() => tabs.closeAll());

test("T9: invite link seats the friend next to the inviter and A gets a toast", async ({ browser }) => {
  test.setTimeout(420_000);
  const a = await tabs.open(browser, { permissions: ["clipboard-read", "clipboard-write"] });
  await openRoom(a, "san-04");
  await expect.poll(() => a.evaluate(() => window.__santinh?.selfId ?? null), { timeout: 15_000 }).not.toBeNull();

  // Open Settings to access the Invite button ("Mời bạn ngồi cạnh").
  await a.getByRole("button", { name: "Cài đặt" }).click();
  const hudInvite = a.getByRole("button", { name: "Mời bạn ngồi cạnh" });
  await expect(hudInvite).toBeEnabled({ timeout: 15_000 });
  await hudInvite.click();
  // Our own dialog, not the OS share sheet: the link is shown and the button copies it.
  const dialog = a.getByRole("dialog", { name: "Mời bạn ngồi cạnh" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Chép liên kết" }).click();
  await expect(dialog.getByRole("button", { name: /Đã chép/ })).toBeVisible({ timeout: 10_000 });
  const link = await a.evaluate(() => navigator.clipboard.readText());
  await expect(dialog.getByRole("textbox", { name: "Liên kết mời" })).toHaveValue(link);
  await dialog.getByRole("button", { name: "Đóng" }).click();
  await expect(a.getByRole("dialog")).toHaveCount(0);
  const hook = await a.evaluate(() => ({ r: window.__santinh?.room, s: window.__santinh?.selfId, u: window.__santinh?.inviteUrl() }));
  expect(link, JSON.stringify(hook)).toBe(hook.u);
  expect(link).toMatch(/[?&]near=v:[a-z0-9]+$/);

  // The toast is up for 3 s only; B may take minutes to render its first frame, so watch from before B joins.
  const toast = expect(a.getByRole("status").getByText(/vừa đến ngồi cạnh bạn/)).toBeVisible({ timeout: 400_000 });
  const b = await tabs.open(browser);
  await b.goto(link.replace(/^https?:\/\/[^/]+/, "") + "&e2e=1");
  await b.waitForFunction(() => window.__santinh?.ready === true, undefined, { timeout: 300_000 });

  const posOf = (p: typeof a) => p.evaluate(() => window.__santinh?.self?.position ?? null);
  const pa = await posOf(a);
  const pb = await posOf(b);
  expect(pa && pb).toBeTruthy();
  expect(Math.hypot((pa?.x ?? 0) - (pb?.x ?? 0), (pa?.z ?? 0) - (pb?.z ?? 0))).toBeLessThanOrEqual(2.5);

  await toast;
  expect(new URL(b.url()).searchParams.has("near")).toBe(false);
  expect(new URL(b.url()).searchParams.get("room")).toBe("san-04");
});
