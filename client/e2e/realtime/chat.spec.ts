import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { vi } from "../../src/i18n/vi.ts";
import { count, openRoom, tabPool } from "./open.ts";
import { testServer } from "./server.ts";

// Own SQLite file per run: accounts made here never reach a dev database.
// Made in beforeAll, not at module level: the runner also loads this file to list tests and would leave a dir behind.
const env = { FAKE_POPULATION: "off", DATA_DIR: "" };
const server = testServer(4670, env);
const tabs = tabPool();

test.beforeAll(async () => {
  env.DATA_DIR = mkdtempSync(join(tmpdir(), "santinh-chat-e2e-"));
  await server.start();
});
test.afterEach(() => tabs.closeAll());
test.afterAll(async () => {
  await server.stop();
  if (env.DATA_DIR) rmSync(env.DATA_DIR, { recursive: true, force: true });
});

const CHAT_ROOM = "san-04";
const QUIET_ROOM = "san-01";
const FIRST = "chào cả nhà";
const SECOND = "ngồi yên một lát nhé";

const panel = (p: Page) => p.getByRole("region", { name: vi.chat.title });
const log = (p: Page) => p.getByRole("log", { name: vi.chat.log });
const chatInput = (p: Page) => panel(p).getByRole("textbox", { name: vi.chat.input });
const sendBtn = (p: Page) => panel(p).getByRole("button", { name: new RegExp(`^${vi.chat.send}`) });
// "Gửi (3)": the countdown shown while the cooldown runs.
const COUNTDOWN = new RegExp(`^${vi.chat.sendIn.replace("(", "\\(").replace(")", "\\)").replace("{n}", "\\d+")}$`);
const guestBtn = (p: Page) => panel(p).getByRole("button", { name: vi.chat.needAccount });

test("P4: a new account chats in room 4, a guest reads it (bubble + panel, no input), cooldown, reload keeps the sign-in, room 1 has no chat", async ({ browser }) => {
  test.setTimeout(420_000);
  // Fresh per run, never fixed in the repo (Nguyên tắc 3).
  const username = `e2e_${randomBytes(5).toString("hex")}`;
  const password = randomBytes(12).toString("base64url");

  const a = await tabs.open(browser);
  const b = await tabs.open(browser);
  // Together: once one tab renders continuously, software GL starves the other's first frame.
  await Promise.all([openRoom(a, CHAT_ROOM, server.url), openRoom(b, CHAT_ROOM, server.url)]);
  await expect.poll(() => count(b), { timeout: 20_000 }).toBe(2);

  // A registers from the guest button in the chat panel.
  await expect(chatInput(a)).toBeHidden();
  await guestBtn(a).click();
  const dialog = a.getByRole("dialog", { name: vi.account.registerTitle });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(vi.account.username).fill(username);
  await dialog.getByLabel(vi.account.password).fill(password);
  await dialog.getByLabel(vi.account.displayName).fill("Minh Tâm");
  await dialog.getByRole("button", { name: vi.account.register }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await expect(chatInput(a)).toBeVisible();
  await expect(guestBtn(a)).toBeHidden();

  await chatInput(a).fill(FIRST);
  await sendBtn(a).click();
  await expect(log(a)).toContainText(FIRST, { timeout: 10_000 });

  // Right after our line comes back the send button counts down (CHAT_LIMITS cooldown); checked first so slow tab-B checks cannot outlast it.
  await chatInput(a).fill(SECOND);
  await expect(sendBtn(a)).toBeDisabled();
  await expect(sendBtn(a)).toHaveText(COUNTDOWN);

  // B (guest) reads it in the panel and over A's head, but cannot type.
  await expect(log(b).getByRole("listitem").filter({ hasText: FIRST })).toContainText("Minh Tâm", { timeout: 10_000 });
  // Bubbles live in the aria-hidden label layer, so no role to find them by; within CHAT_BUBBLE_MS of the line.
  await expect(b.locator(".chat-bubble:not([hidden])")).toHaveText(FIRST);
  await expect(chatInput(b)).toBeHidden();
  await expect(guestBtn(b)).toBeVisible();

  // Then it lets the next line go.
  await expect(sendBtn(a)).toBeEnabled({ timeout: 10_000 });
  await expect(sendBtn(a)).toHaveText(vi.chat.send);
  await sendBtn(a).click();
  await expect(log(b)).toContainText(SECOND, { timeout: 10_000 });
  await expect(b.locator(".chat-bubble:not([hidden])")).toHaveText(SECOND);

  // A quiet room has no chat at all, for a guest too.
  await openRoom(b, QUIET_ROOM, server.url);
  await expect.poll(() => b.evaluate(() => window.__santinh?.room ?? null), { timeout: 20_000 }).toBe(QUIET_ROOM);
  await expect(panel(b)).toBeHidden();
  await expect(b.getByRole("button", { name: vi.chat.open })).toBeHidden();
  await b.close();

  // Reload: the saved session signs A back in (input, not the guest button) and the room's history comes back.
  await openRoom(a, CHAT_ROOM, server.url);
  await expect(chatInput(a)).toBeVisible({ timeout: 20_000 });
  await expect(guestBtn(a)).toBeHidden();
  await expect(log(a)).toContainText(FIRST, { timeout: 15_000 });
  await expect(log(a)).toContainText(SECOND);

  // C comes in later as a guest and gets the history too.
  const c = await tabs.open(browser);
  await openRoom(c, CHAT_ROOM, server.url);
  await expect(log(c)).toContainText(FIRST, { timeout: 15_000 });
  await expect(log(c)).toContainText(SECOND);
  await expect(guestBtn(c)).toBeVisible();
  await expect(chatInput(c)).toBeHidden();

  // Signed in or not, room 1 shows no panel.
  await openRoom(a, QUIET_ROOM, server.url);
  await expect.poll(() => a.evaluate(() => window.__santinh?.room ?? null), { timeout: 20_000 }).toBe(QUIET_ROOM);
  await expect(panel(a)).toBeHidden();
  await expect(a.getByRole("button", { name: vi.chat.open })).toBeHidden();
});
