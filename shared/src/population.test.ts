import { describe, expect, it } from "vitest";
import {
  DEFAULT_POPULATION,
  SLOT_MS,
  botTarget,
  parsePopulation,
  slotOf,
  tierOf,
  tiersAt,
  type PopulationConfig,
  type RoomTier,
} from "./population.ts";
import { seeded } from "./random.ts";
import { ROOMS } from "./spaces/index.ts";
import { ROOM_CAPACITY, ROOM_COUNT } from "./world.ts";

const START = Date.UTC(2026, 10, 1);
const DAY = 86_400_000;
const DEF = DEFAULT_POPULATION;
/** The phase-02 numbers: one full room. */
const WITH_FULL: PopulationConfig = {
  layout: { full: 1, busy: 2, medium: 3, quiet: 4 },
  bots: { busy: [19, 24], medium: [9, 14], quiet: [3, 5] },
  minBots: 3,
};

/** 200 moments spread over 30 days (seeded so failures repeat). */
function moments(): number[] {
  const rng = seeded(2026);
  return Array.from({ length: 200 }, () => START + Math.floor(rng() * 30 * DAY));
}

function tally(now: number, cfg: PopulationConfig): Record<RoomTier, number> {
  const count: Record<RoomTier, number> = { full: 0, busy: 0, medium: 0, quiet: 0 };
  for (const room of ROOMS) count[tierOf(room.id, now, cfg)] += 1;
  return count;
}

describe("tiers", () => {
  it("default lays out one tier per room and no full room", () => {
    expect(Object.values(DEF.layout).reduce((a, b) => a + b, 0)).toBe(ROOM_COUNT);
    for (const now of moments()) expect(tally(now, DEF)).toEqual({ full: 0, busy: 2, medium: 4, quiet: 4 });
  });

  it("a config with full: 1 keeps the old rule: exactly one full room, never room 1", () => {
    for (const now of moments()) {
      expect(tally(now, WITH_FULL)).toEqual({ full: 1, busy: 2, medium: 3, quiet: 4 });
      expect(tierOf("san-01", now, WITH_FULL)).not.toBe("full");
    }
  });

  it("never makes room 1 full even with several full rooms", () => {
    const many: PopulationConfig = { ...WITH_FULL, layout: { full: 9, busy: 1, medium: 0, quiet: 0 } };
    for (const now of moments()) {
      expect(tally(now, many).full).toBe(9);
      expect(tierOf("san-01", now, many)).toBe("busy");
    }
  });

  it("holds for a whole 3-hour slot and reshuffles between slots", () => {
    const slotStart = slotOf(START) * SLOT_MS - 7 * 3_600_000;
    expect(slotOf(slotStart)).toBe(slotOf(START));
    expect(tiersAt(slotStart + SLOT_MS - 1, DEF)).toEqual(tiersAt(slotStart, DEF));
    const layouts = new Set(Array.from({ length: 16 }, (_, i) => tiersAt(slotStart + i * SLOT_MS, DEF).join(",")));
    expect(layouts.size).toBeGreaterThan(8);
  });

  it("recomputes in the same slot when the layout changes (cache keyed by config too)", () => {
    expect(tiersAt(START, DEF)).not.toContain("full");
    expect(tiersAt(START, WITH_FULL)).toContain("full");
    expect(tiersAt(START, DEF)).not.toContain("full");
  });

  it("rejects an unknown room", () => {
    expect(() => tierOf("san-11", START, DEF)).toThrow(RangeError);
  });
});

describe("botTarget", () => {
  for (const [label, cfg] of [
    ["default", DEF],
    ["full: 1", WITH_FULL],
  ] as const) {
    it(`${label}: stays in the tier range and fills a full room`, () => {
      for (const now of moments()) {
        for (const room of ROOMS) {
          const tier = tierOf(room.id, now, cfg);
          const n = botTarget(room.id, now, ROOM_CAPACITY, 1, cfg);
          if (tier === "full") expect(n).toBe(ROOM_CAPACITY - 1);
          else {
            const [lo, hi] = cfg.bots[tier];
            expect(n).toBeGreaterThanOrEqual(lo);
            expect(n).toBeLessThanOrEqual(hi);
          }
          expect(n).toBeGreaterThanOrEqual(cfg.minBots);
        }
      }
    });
  }

  it("moves by at most 2 between two reads 60 s apart in the same slot", () => {
    for (const now of moments()) {
      const later = now + 60_000;
      if (slotOf(later) !== slotOf(now)) continue;
      for (const room of ROOMS) {
        const a = botTarget(room.id, now, ROOM_CAPACITY, 0, DEF);
        const b = botTarget(room.id, later, ROOM_CAPACITY, 0, DEF);
        expect(Math.abs(a - b)).toBeLessThanOrEqual(2);
      }
    }
  });

  it("never exceeds the free places, and keeps minBots while they fit", () => {
    for (const cfg of [DEF, WITH_FULL]) {
      for (const now of moments().slice(0, 40)) {
        for (const room of ROOMS) {
          for (const real of [0, 5, 20, 26, 27, 28, 29, 30, 31]) {
            const n = botTarget(room.id, now, ROOM_CAPACITY, real, cfg);
            const free = Math.max(0, ROOM_CAPACITY - real);
            expect(n).toBeLessThanOrEqual(free);
            expect(n).toBeGreaterThanOrEqual(Math.min(cfg.minBots, free));
          }
        }
      }
    }
  });

  it("minBots lifts a range that starts lower", () => {
    const cfg: PopulationConfig = { ...DEF, bots: { busy: [0, 0], medium: [0, 0], quiet: [0, 0] }, minBots: 2 };
    for (const room of ROOMS) expect(botTarget(room.id, START, ROOM_CAPACITY, 0, cfg)).toBe(2);
  });
});

describe("parsePopulation", () => {
  type Loose = { layout?: Record<string, unknown>; bots?: Record<string, unknown>; minBots?: unknown; [k: string]: unknown };
  const clone = (): Loose => JSON.parse(JSON.stringify(DEF)) as Loose;
  const edit = (f: (c: Loose & { layout: Record<string, unknown>; bots: Record<string, unknown> }) => void) => {
    const c = clone() as Loose & { layout: Record<string, unknown>; bots: Record<string, unknown> };
    f(c);
    return parsePopulation(c, ROOM_CAPACITY);
  };

  it("accepts the default and the full: 1 config, as fresh objects without extra fields", () => {
    expect(parsePopulation(DEF, ROOM_CAPACITY)).toEqual(DEF);
    expect(parsePopulation(DEF, ROOM_CAPACITY)).not.toBe(DEF);
    expect(parsePopulation(WITH_FULL, ROOM_CAPACITY)).toEqual(WITH_FULL);
    expect(parsePopulation({ ...clone(), extra: 1 }, ROOM_CAPACITY)).toEqual(DEF);
  });

  it("rejects what is not an object", () => {
    for (const raw of [null, undefined, 3, "x", [], { layout: [], bots: {}, minBots: 1 }]) {
      expect(parsePopulation(raw, ROOM_CAPACITY)).toBeNull();
    }
  });

  it("rejects missing fields", () => {
    const { layout, bots, minBots } = clone();
    expect(parsePopulation({ bots, minBots }, ROOM_CAPACITY)).toBeNull();
    expect(parsePopulation({ layout, minBots }, ROOM_CAPACITY)).toBeNull();
    expect(parsePopulation({ layout, bots }, ROOM_CAPACITY)).toBeNull();
    expect(edit((c) => delete c.layout.quiet)).toBeNull();
    expect(edit((c) => delete c.bots.medium)).toBeNull();
  });

  it("rejects non-integers", () => {
    expect(edit((c) => (c.layout.busy = 2.5))).toBeNull();
    expect(edit((c) => (c.layout.busy = "2"))).toBeNull();
    expect(edit((c) => (c.bots.busy = [8, 12.5]))).toBeNull();
    expect(edit((c) => (c.bots.busy = [Number.NaN, 12]))).toBeNull();
    expect(edit((c) => (c.minBots = 1.5))).toBeNull();
    expect(edit((c) => (c.minBots = Infinity))).toBeNull();
  });

  it("rejects a negative layout or one not summing to ROOM_COUNT, and an all-full layout", () => {
    expect(edit((c) => (c.layout = { full: -1, busy: 3, medium: 4, quiet: 4 }))).toBeNull();
    expect(edit((c) => (c.layout = { full: 0, busy: 2, medium: 4, quiet: 5 }))).toBeNull();
    expect(edit((c) => (c.layout = { full: 0, busy: 2, medium: 4, quiet: 3 }))).toBeNull();
    expect(edit((c) => (c.layout = { full: ROOM_COUNT, busy: 0, medium: 0, quiet: 0 }))).toBeNull();
  });

  it("rejects bad ranges: lo > hi, hi > capacity − 1, negative, wrong length", () => {
    expect(edit((c) => (c.bots.quiet = [3, 1]))).toBeNull();
    expect(edit((c) => (c.bots.busy = [8, ROOM_CAPACITY]))).toBeNull();
    expect(edit((c) => (c.bots.busy = [-1, 2]))).toBeNull();
    expect(edit((c) => (c.bots.busy = [8]))).toBeNull();
    expect(edit((c) => (c.bots.busy = [8, 9, 10]))).toBeNull();
    expect(edit((c) => (c.bots.busy = [8, ROOM_CAPACITY - 1]))).not.toBeNull();
    expect(parsePopulation(DEF, 12)).toBeNull();
    expect(parsePopulation(DEF, 13)).toEqual(DEF);
  });

  it("rejects minBots outside 0…5", () => {
    expect(edit((c) => (c.minBots = -1))).toBeNull();
    expect(edit((c) => (c.minBots = 6))).toBeNull();
    expect(edit((c) => (c.minBots = 0))?.minBots).toBe(0);
    expect(edit((c) => (c.minBots = 5))?.minBots).toBe(5);
  });
});
