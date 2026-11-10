import { expect, test, type Page } from "@playwright/test";
import { WebSocket } from "ws";
import { BOW_PERIOD_MS, decodeDelta, spaceOf, type DeltaRecord, type ServerMsg } from "@santinh/shared";
import { REAL_PORT } from "../../playwright.config.ts";
import { openRoom, tabPool } from "./open.ts";
import { enterHall } from "../walk.ts";

const tabs = tabPool();
test.afterEach(() => tabs.closeAll());

const ROOM = "san-05";

/** A plain `ws` visitor in the room: records what the server tells everybody else. */
function watch(selfId: string) {
  const records: { at: number; r: DeltaRecord }[] = [];
  const bows: number[] = [];
  let slot: number | null = null;
  const ws = new WebSocket(`ws://localhost:${REAL_PORT}/ws?room=${ROOM}`, { origin: `http://localhost:${REAL_PORT}` });
  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      const frame = decodeDelta(data as Buffer);
      for (const r of frame?.records ?? []) if (r.slot === slot) records.push({ at: Date.now(), r });
      return;
    }
    const msg = JSON.parse(String(data)) as ServerMsg;
    if (msg.type === "snapshot") slot = msg.visitors.find((v) => v.id === selfId)?.slot ?? null;
    if (msg.type === "event" && msg.event.type === "bow" && msg.event.visitorId === selfId) bows.push(Date.now());
  });
  return { records, bows, slot: () => slot, close: () => ws.terminate() };
}

const selfOf = (p: Page) => p.evaluate(() => window.__santinh?.self ?? null);

/** Presses Lạy and waits until A kneels and the room has heard exactly one more bow. Returns what others saw meanwhile. */
async function bow(a: Page, w: ReturnType<typeof watch>) {
  const pressedAt = Date.now();
  const bowsBefore = w.bows.length;
  await a.keyboard.press("Digit1");
  await expect.poll(async () => (await selfOf(a))?.pose, { timeout: 30_000 }).toBe("kneel");
  await expect.poll(() => w.bows.length, { timeout: 5_000 }).toBe(bowsBefore + 1);
  const seen = w.records.filter((m) => m.at >= pressedAt);
  const firstSeated = seen.findIndex((m) => m.r.cushion !== null);
  expect(firstSeated, "A is seated on the wire").toBeGreaterThanOrEqual(0);
  const walk = seen.slice(0, firstSeated);
  expect(walk.every((m) => m.r.cushion === null), "no cushion on the wire while walking").toBe(true);
  for (let i = 1; i < walk.length; i++) {
    const p = walk[i - 1]!.r;
    const q = walk[i]!.r;
    expect(Math.hypot(q.x - p.x, q.z - p.z), "no jump between walking records").toBeLessThan(2);
  }
  const spot = spaceOf(ROOM).cushions[seen[firstSeated]!.r.cushion!]!;
  return { walk: walk.map((m) => m.r), spot };
}

/**
 * Lạy as others see it: the walker reaches the cushion on foot (no jump, no cushion on the wire while walking) and the bow
 * rings once it is there. Round 1 starts just inside the door (Lạy from the gate is refused); round 2 a few steps from a cushion.
 */
test("bow: others see A walk to the cushion, then kneel; the bow comes on arrival; Dừng = one bow, then stand", async ({ browser }) => {
  test.setTimeout(240_000);
  const a = await tabs.open(browser);
  await openRoom(a, ROOM);
  const selfId = await a.evaluate(() => window.__santinh?.selfId ?? null);
  expect(selfId).not.toBeNull();
  const w = watch(selfId!);
  try {
    await expect.poll(() => w.slot(), { timeout: 10_000 }).not.toBeNull();
    await enterHall(a);
    const { walk: walk1 } = await bow(a, w);
    expect(walk1.length, "the walk in from the door was walked, not snapped").toBeGreaterThan(1);

    // Dừng after the sitting-down bow: the room hears exactly one bow, and only then A leaves the cushion.
    await a.waitForTimeout(BOW_PERIOD_MS + 500);
    const stopAt = Date.now();
    const bowsBefore = w.bows.length;
    await a.keyboard.press("Digit1");
    await expect.poll(async () => (await selfOf(a))?.pose, { timeout: 10_000 }).toBe("walk");
    const left = () => w.records.find((m) => m.at >= stopAt && m.r.cushion === null);
    await expect.poll(() => left() !== undefined, { timeout: 5_000 }).toBe(true);
    const leftAt = left()!.at;
    const rising = w.bows.slice(bowsBefore);
    expect(rising, "one bow on Dừng").toHaveLength(1);
    expect(rising[0]!, "the bow comes before A stands").toBeLessThan(leftAt);
    expect(leftAt - rising[0]!, "A bowed for about BOW_PERIOD_MS before standing").toBeGreaterThan(BOW_PERIOD_MS - 1000);

    // Step back: the nearest free cushion is now a short walk away.
    await a.keyboard.down("KeyS");
    await a.waitForTimeout(900);
    await a.keyboard.up("KeyS");
    const { walk, spot } = await bow(a, w);
    expect(walk.length, "the round-2 approach was walked, not snapped").toBeGreaterThan(1);
    const last = walk.at(-1)!;
    expect(Math.hypot(last.x - spot.x, last.z - spot.z), "walked up to the cushion before sitting").toBeLessThan(1);
  } finally {
    w.close();
  }
});
