import { test, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "@playwright/test";

/** Opens the game against the real server and waits until the first frame is up. */
export async function openRoom(page: Page, room: string, base = ""): Promise<void> {
  await page.goto(`${base}/?e2e=1&room=${room}`);
  await page.waitForFunction(() => window.__santinh?.ready === true, undefined, { timeout: 90_000 });
}

export function count(page: Page): Promise<number | undefined> {
  return page.evaluate(() => window.__santinh?.count);
}

/**
 * Extra tabs from `browser.newContext()` are not closed by Playwright. A leftover one keeps rendering in software GL
 * and retrying its dead server, which starves the next spec's first frame — so close them after every test.
 * New contexts don't inherit the project's `use`, so the seeded name (config `storageState`) is passed unless `options` sets one.
 */
export function tabPool(): { open(browser: Browser, options?: BrowserContextOptions): Promise<Page>; closeAll(): Promise<void> } {
  const contexts: BrowserContext[] = [];
  return {
    async open(browser, options) {
      const storageState = options?.storageState ?? test.info().project.use.storageState;
      const ctx = await browser.newContext({ ...options, storageState });
      contexts.push(ctx);
      return ctx.newPage();
    },
    async closeAll() {
      await Promise.all(contexts.splice(0).map((c) => c.close()));
    },
  };
}
