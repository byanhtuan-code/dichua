// Renders the social preview (og:image) from the live scene: `npm run og -w client` with the dev server on :4664.
import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";

const BASE = process.env.OG_BASE ?? "http://localhost:4664";
const OUT = fileURLToPath(new URL("../public/og.jpg", import.meta.url));
const W = 1200;
const H = 630;
// Wider viewport, then crop: shifts the lit hall right so the left side stays dark for the text.
const VIEW_W = 1800;
const CROP_X = 20;

const { vi } = await import("../src/i18n/vi.ts");
const { title, tagline, line } = vi.og;

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: VIEW_W, height: H }, deviceScaleFactor: 2 });
await page.goto(`${BASE}/?e2e=1&shadows=1&cam=spawn&time=20:00`);
await page.waitForFunction(() => window.__santinh?.ready === true, undefined, { timeout: 60_000 });
await page.addStyleTag({ content: ".game-hud,.visitor-labels,.toasts,[class*=toast],[class*=chip]{display:none!important}" });
await page.waitForTimeout(2500);
const scene = await page.screenshot({ clip: { x: CROP_X, y: 0, width: W, height: H } });

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
// Composed at 1x so the file is exactly the 1200×630 Facebook expects; the 2x scene keeps it sharp.
const card = await browser.newPage({ viewport: { width: W, height: H } });
await card.setContent(`<!doctype html><meta charset="utf-8"><style>
  * { margin: 0; box-sizing: border-box; }
  body { width: ${W}px; height: ${H}px; overflow: hidden; background: #20251f url(data:image/png;base64,${scene.toString("base64")}) center / cover;
         font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Be Vietnam Pro", Roboto, sans-serif; color: #f3efe5; }
  .shade { position: absolute; inset: 0;
           background: linear-gradient(90deg, rgb(16 23 17 / .92) 0%, rgb(16 23 17 / .72) 30%, rgb(16 23 17 / 0) 58%),
                       linear-gradient(0deg, rgb(16 23 17 / .55) 0%, rgb(16 23 17 / 0) 35%); }
  .text { position: absolute; left: 72px; top: 0; bottom: 0; width: 520px; display: flex; flex-direction: column; justify-content: center; }
  .mark { width: 54px; height: 54px; color: #f2d19b; margin-bottom: 26px; }
  h1 { font-size: 92px; font-weight: 600; letter-spacing: -1.5px; line-height: 1.02; }
  .tag { margin-top: 18px; font-size: 34px; font-weight: 400; color: #f2d19b; }
  .rule { width: 64px; height: 2px; background: #a38d5f; margin: 30px 0 22px; }
  .line { font-size: 22px; line-height: 1.45; color: #d6d2c4; }
  .line span { display: block; }
</style>
<div class="shade"></div>
<div class="text">
  <svg class="mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5c4-.6 7-3 9-6 2 3 5 5.4 9 6M5 11.5h14M7.5 12v7.5m9-7.5v7.5M4.5 19.5h15M10.5 14.5h3v5"/><circle cx="12" cy="8" r=".6" fill="currentColor"/></svg>
  <h1>${esc(title)}</h1>
  <p class="tag">${esc(tagline)}</p>
  <div class="rule"></div>
  <p class="line">${line.split(/(?<=\.) /).map((s) => `<span>${esc(s)}</span>`).join("")}</p>
</div>`);
await card.screenshot({ path: OUT, type: "jpeg", quality: 86 });
await browser.close();
console.log(`og image → ${OUT}`);
