import { describe, expect, it } from "vitest";
import { BotBrain, GREET_RADIUS, LEAVE_TIMEOUT_MS, type Bot } from "./bots.ts";
import { isWalkable } from "./collision.ts";
import { BOW_PERIOD_MS, TICK_MS } from "./protocol.ts";
import { seeded } from "./random.ts";
import { cushionOf, spaceOf } from "./spaces/index.ts";
import type { Visitor } from "./types.ts";

const space = spaceOf("san-01");

function visitor(i: number): Visitor {
  return { id: `v:bot${i}`, name: `Bot ${i}`, color: "#b9c3c7", joinedAt: 0, pose: "walk", cushion: null, position: { x: 0, z: 0, yaw: 0 } };
}

function setup(count: number, seed: number, seatedEvery = 3) {
  const seats = new Map<number, string>();
  for (const [i, c] of space.residentCushions.entries()) seats.set(c, `resident:${i + 1}`);
  const brain = new BotBrain(space, seeded(seed), seats);
  const bots: Bot[] = Array.from({ length: count }, (_, i) =>
    brain.spawn(visitor(i), 0, { seated: i % seatedEvery === 0, atGate: i % seatedEvery === 1 }),
  );
  return { seats, brain, bots };
}

/** Every cushion has at most one holder and the seat map agrees with the bots. */
function expectSeatsConsistent(seats: Map<number, string>, bots: readonly Bot[]): void {
  const holders = new Map<number, string>();
  for (const b of bots) {
    for (const c of [b.v.cushion, b.seatOnArrive]) {
      if (c === null) continue;
      expect(holders.has(c), `cushion ${c} held twice`).toBe(false);
      holders.set(c, b.v.id);
      expect(seats.get(c)).toBe(b.v.id);
    }
  }
}

describe("BotBrain", () => {
  it("1000 steps: nobody stands in a wall and no cushion is shared", () => {
    for (const seed of [1, 7, 42]) {
      const { seats, brain, bots } = setup(20, seed);
      let events = 0;
      let moves = 0;
      for (let t = 1; t <= 1000; t++) {
        const now = t * TICK_MS;
        for (const b of bots) {
          const r = brain.step(b, now, TICK_MS);
          if (r.event) events += 1;
          if (r.changed) moves += 1;
          if (b.v.cushion === null) {
            expect(isWalkable(space.collision, b.v.position.x, b.v.position.z), `${b.v.id} @ ${b.v.position.x},${b.v.position.z}`).toBe(true);
          } else expect(b.v.pose).toBe("kneel");
        }
        expectSeatsConsistent(seats, bots);
      }
      expect(moves).toBeGreaterThan(1000);
      expect(events).toBeGreaterThan(0);
      // Some bots sat down on their own along the way.
      expect(bots.some((b) => b.v.cushion !== null)).toBe(true);
    }
  });

  it("seated spawn takes a free cushion and kneels there", () => {
    const { seats, bots } = setup(3, 5, 1);
    for (const b of bots) {
      expect(b.v.cushion).not.toBeNull();
      expect(b.v.pose).toBe("kneel");
      expect(space.residentCushions).not.toContain(b.v.cushion);
    }
    expectSeatsConsistent(seats, bots);
  });

  it("leave frees the cushion and ends with gone", () => {
    for (const seed of [2, 3, 4, 5]) {
      const { seats, brain, bots } = setup(9, seed);
      for (let t = 1; t <= 300; t++) for (const b of bots) brain.step(b, t * TICK_MS, TICK_MS);
      const start = 300 * TICK_MS;
      for (const b of bots) brain.leave(b, start);
      for (const c of seats.keys()) expect(seats.get(c)).toMatch(/^resident:/);

      const goneAt = new Map<string, number>();
      for (let t = 1; goneAt.size < bots.length; t++) {
        const now = start + t * TICK_MS;
        expect(now - start).toBeLessThanOrEqual(LEAVE_TIMEOUT_MS + TICK_MS);
        for (const b of bots) {
          if (goneAt.has(b.v.id)) continue;
          const r = brain.step(b, now, TICK_MS);
          expect(r.event).toBeUndefined();
          expect(b.v.cushion).toBeNull();
          if (r.gone) goneAt.set(b.v.id, now);
        }
      }
      // Most walk out through the gate well before the timeout.
      const early = [...goneAt.values()].filter((at) => at - start < LEAVE_TIMEOUT_MS).length;
      expect(early).toBeGreaterThan(bots.length / 2);
    }
  });

  it("greets back someone close, not someone far away", () => {
    const { brain, bots } = setup(40, 11, 1000);
    const near = bots.filter((b) => b.v.cushion === null);
    let scheduled = 0;
    for (const b of near) if (brain.greetBack(b, 0, b.v.position)) scheduled += 1;
    expect(scheduled).toBeGreaterThan(5);
    expect(scheduled).toBeLessThan(near.length);

    const far = { x: 1000, z: 1000 };
    const fresh = setup(5, 12, 1000);
    for (const b of fresh.bots) expect(fresh.brain.greetBack(b, 0, far)).toBe(false);

    const greeter = near.find((b) => b.greetAt !== null);
    if (!greeter) throw new Error("no greeter");
    const at = greeter.greetAt ?? 0;
    expect(at).toBeGreaterThanOrEqual(1000);
    expect(at).toBeLessThanOrEqual(3000);
    let event: string | undefined;
    for (let now = TICK_MS; now <= 3200 && !event; now += TICK_MS) event = brain.step(greeter, now, TICK_MS).event;
    expect(event).toBe("hello");
  });

  it("greets back exactly within GREET_RADIUS", () => {
    // rng 0 → the 50 % roll always passes, so only distance decides.
    const brain = new BotBrain(space, () => 0, new Map());
    const p = { x: 0, z: 30 };
    const inside = brain.spawn(visitor(1), 0);
    inside.v.position = { ...p, yaw: 0 };
    const outside = brain.spawn(visitor(2), 0);
    outside.v.position = { ...p, yaw: 0 };
    expect(brain.greetBack(inside, 0, { x: p.x + GREET_RADIUS - 0.1, z: p.z })).toBe(true);
    expect(brain.greetBack(outside, 0, { x: p.x + GREET_RADIUS + 0.1, z: p.z })).toBe(false);
  });

  it("stands still while greeting, then walks on, with one hello only", () => {
    const { brain, bots } = setup(10, 21, 1000);
    const bot = bots.find((b) => b.v.cushion === null && !b.v.id.endsWith("1"));
    if (!bot) throw new Error("no walker");
    const p = bot.v.position;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
    const d = dirs.find(([dx, dz]) => isWalkable(space.collision, p.x + dx * 2, p.z + dz * 2) && isWalkable(space.collision, p.x + dx, p.z + dz));
    if (!d) throw new Error("boxed in");
    bot.target = { x: p.x + d[0] * 2, z: p.z + d[1] * 2 };
    bot.greetAt = TICK_MS;
    bot.nextHelloAt = 2 * TICK_MS;

    expect(brain.step(bot, TICK_MS, TICK_MS).event).toBe("hello");
    const at = { x: p.x, z: p.z };
    const events: string[] = [];
    let now = 2 * TICK_MS;
    for (; bot.v.pose === "hello"; now += TICK_MS) {
      const r = brain.step(bot, now, TICK_MS);
      if (r.event) events.push(r.event);
      if (bot.v.pose === "hello") expect(bot.v.position).toMatchObject(at);
    }
    expect(events).toEqual([]);
    brain.step(bot, now, TICK_MS);
    expect(Math.hypot(bot.v.position.x - at.x, bot.v.position.z - at.z)).toBeGreaterThan(0);
  });

  it("drops a pending greet-back when the bot sits down first", () => {
    const seats = new Map<number, string>();
    const brain = new BotBrain(space, seeded(9), seats);
    const bot = brain.spawn(visitor(1), 0);
    const c = space.cushions.findIndex((_, i) => !space.residentCushions.includes(i));
    const cushion = cushionOf(space, c);
    bot.v.position = { x: cushion.x, z: cushion.z + 0.1, yaw: 0 };
    seats.set(c, bot.v.id);
    bot.seatOnArrive = c;
    bot.target = { x: cushion.x, z: cushion.z };
    bot.greetAt = 2000;

    expect(brain.step(bot, TICK_MS, TICK_MS).event).toBe("bow");
    expect(bot.v.cushion).toBe(c);
    expect(bot.greetAt).toBeNull();
  });

  it("never seats a bot on a resident cushion, even with an empty seat map", () => {
    const seats = new Map<number, string>();
    const brain = new BotBrain(space, seeded(13), seats);
    const bots = Array.from({ length: 26 }, (_, i) => brain.spawn(visitor(i), 0, { seated: true }));
    for (let t = 1; t <= 500; t++) for (const b of bots) brain.step(b, t * TICK_MS, TICK_MS);
    for (const c of seats.keys()) expect(space.residentCushions).not.toContain(c);
  });

  it("a periodic hello answers a pending greet-back (no late second hello)", () => {
    const { brain, bots } = setup(10, 31, 1000);
    const bot = bots.find((b) => b.v.cushion === null);
    if (!bot) throw new Error("no walker");
    bot.target = null;
    bot.greetAt = 1000;
    bot.nextHelloAt = TICK_MS;
    const events: string[] = [];
    for (let now = TICK_MS; now <= 4000; now += TICK_MS) {
      const e = brain.step(bot, now, TICK_MS).event;
      if (e) events.push(e);
    }
    expect(events).toEqual(["hello"]);
  });

  it("bows once when its sit is over, keeps kneeling for the bow, then gives the cushion back", () => {
    const { seats, brain, bots } = setup(1, 9, 1);
    const b = bots[0];
    if (!b) throw new Error("no bot");
    const cushion = b.v.cushion;
    expect(cushion).not.toBeNull();
    const at = b.sitUntil;
    expect(brain.step(b, at - 1, TICK_MS)).toEqual({ changed: false });
    expect(brain.step(b, at, TICK_MS)).toEqual({ changed: true, event: "bow" });
    expect(b.v.bowAt).toBe(at);
    expect(b.riseAt).toBe(at + BOW_PERIOD_MS);
    const events: string[] = [];
    for (let now = at + TICK_MS; now < at + BOW_PERIOD_MS; now += TICK_MS) {
      const r = brain.step(b, now, TICK_MS);
      if (r.event) events.push(r.event);
      expect(b.v.pose).toBe("kneel");
      expect(b.v.cushion).toBe(cushion);
    }
    expect(events).toEqual([]);
    expect(brain.step(b, at + BOW_PERIOD_MS, TICK_MS)).toEqual({ changed: true });
    expect(b.v.cushion).toBeNull();
    expect(b.v.pose).toBe("walk");
    expect(b.v.bowAt).toBeUndefined();
    expect(seats.has(cushion ?? -1)).toBe(false);
  });

  it("leave during the farewell bow stands at once", () => {
    const { seats, brain, bots } = setup(1, 9, 1);
    const b = bots[0];
    if (!b) throw new Error("no bot");
    const cushion = b.v.cushion ?? -1;
    brain.step(b, b.sitUntil, TICK_MS);
    brain.leave(b, b.sitUntil + TICK_MS);
    expect(b.v.cushion).toBeNull();
    expect(b.v.pose).toBe("walk");
    expect(b.riseAt).toBeNull();
    expect(seats.has(cushion)).toBe(false);
  });

  it("shift moves the rise time too (a frozen bot finishes its bow after waking)", () => {
    const { brain, bots } = setup(1, 9, 1);
    const b = bots[0];
    if (!b) throw new Error("no bot");
    const at = b.sitUntil;
    brain.step(b, at, TICK_MS);
    brain.shift(b, 60_000);
    expect(b.riseAt).toBe(at + BOW_PERIOD_MS + 60_000);
  });
});
