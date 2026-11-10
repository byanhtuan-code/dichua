import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { count, openRoom, tabPool } from "./open.ts";

const tabs = tabPool();
test.afterEach(() => tabs.closeAll());

const SHOTS = resolve(import.meta.dirname, "../../../_forge/logs/shots");

test("AC5 + AC6 + AC7: two real tabs see each other, greet, and the count drops when one leaves", async ({ browser }) => {
  test.setTimeout(240_000);
  const a = await tabs.open(browser);
  const b = await tabs.open(browser);
  // Together: once one tab renders continuously, software GL starves the other's first frame.
  await Promise.all([openRoom(a, "san-03"), openRoom(b, "san-03")]);

  // AC5
  await expect.poll(() => count(a), { timeout: 15_000 }).toBe(2);
  await expect.poll(() => count(b), { timeout: 15_000 }).toBe(2);
  await b.getByRole("button", { name: "Cài đặt" }).click();
  await expect(b.getByRole("button", { name: "2 người đang ở đây. Xem ai đang ở đây" })).toBeVisible();
  await b.keyboard.press("Escape");

  // Each tab draws the other visitor (not just counts them).
  const idOf = (p: typeof a) => p.evaluate(() => window.__santinh?.selfId ?? "");
  const [ida, idb] = await Promise.all([idOf(a), idOf(b)]);
  const others = (p: typeof a) => p.evaluate(() => window.__santinh?.others ?? []);
  await expect.poll(() => others(a), { timeout: 15_000 }).toContain(idb);
  await expect.poll(() => others(b), { timeout: 15_000 }).toContain(ida);
  mkdirSync(SHOTS, { recursive: true });
  await a.screenshot({ path: resolve(SHOTS, "T7-tab-a.png") });
  await b.screenshot({ path: resolve(SHOTS, "T7-tab-b.png") });

  await a.bringToFront();
  await a.getByRole("toolbar").getByRole("button", { name: /Chắp tay/ }).click();
  await expect(b.getByRole("status").getByText(/chắp tay chào bạn/)).toBeVisible({ timeout: 10_000 });

  // AC7
  await a.close();
  await expect.poll(() => count(b), { timeout: 10_000 }).toBe(1);
  await b.close();
});
