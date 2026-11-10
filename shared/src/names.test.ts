import { describe, expect, it } from "vitest";
import {
  MAX_NAME_CHARS,
  FUNNY_NAME_POOL,
  RESIDENTS,
  RESIDENT_NAME_POOL,
  VISITOR_COLORS,
  makeBotName,
  makeName,
  normalizeVisitorName,
  residentsFor,
  uniqueName,
} from "./names.ts";
import { ROOMS } from "./spaces/index.ts";
import { RESIDENT_CUSHIONS } from "./world.ts";

/** Deterministic rng so failures are reproducible. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("makeName", () => {
  it("gives 30 distinct names for a full room", () => {
    const rng = seeded(7);
    const taken = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const name = makeName(rng, taken);
      expect(taken.has(name)).toBe(false);
      expect(name).toMatch(/^\p{Lu}\p{Ll}* \p{Lu}\p{Ll}*$/u);
      taken.add(name);
    }
    expect(taken.size).toBe(30);
  });

  it("never hands out a name any room's residents could have", () => {
    const rng = seeded(1);
    const taken = new Set<string>();
    for (let i = 0; i < 64; i++) taken.add(makeName(rng, taken));
    for (const name of RESIDENT_NAME_POOL) expect(taken.has(name)).toBe(false);
  });

  it("still returns a unique name once every combination is used", () => {
    const rng = seeded(3);
    const taken = new Set<string>();
    for (let i = 0; i < 70; i++) taken.add(makeName(rng, taken));
    expect(taken.size).toBe(70);
  });

  it("copes with rng returning values at the edges", () => {
    expect(makeName(() => 0, new Set())).toBe("Gió Lặng");
    expect(typeof makeName(() => 0.9999999, new Set())).toBe("string");
  });
});

describe("makeBotName", () => {
  it("mixes serious and funny names about half and half, all distinct", () => {
    const rng = seeded(11);
    const taken = new Set<string>();
    let funny = 0;
    for (let i = 0; i < 200; i++) {
      const name = makeBotName(rng, taken);
      expect(taken.has(name)).toBe(false);
      if (FUNNY_NAME_POOL.includes(name)) funny++;
      taken.add(name);
    }
    expect(funny).toBeGreaterThan(70);
    expect(funny).toBeLessThan(130);
  });

  it("funny pool is large, lowercase, unique, fits a name and never clashes with residents", () => {
    expect(FUNNY_NAME_POOL.length).toBeGreaterThanOrEqual(200);
    expect(new Set(FUNNY_NAME_POOL).size).toBe(FUNNY_NAME_POOL.length);
    for (const name of FUNNY_NAME_POOL) {
      expect(name).toBe(name.toLowerCase());
      expect(normalizeVisitorName(name)).toBe(name);
      expect(RESIDENT_NAME_POOL).not.toContain(name);
    }
  });

  it("still returns a unique name once the funny pool is used up", () => {
    const taken = new Set(FUNNY_NAME_POOL);
    const name = makeBotName(() => 0.99, taken);
    expect(taken.has(name)).toBe(false);
  });
});

describe("residentsFor", () => {
  it("gives 4 distinct names that stay the same for a room", () => {
    for (const room of ROOMS) {
      const a = residentsFor(room.id);
      expect(a.map((r) => r.name)).toEqual(residentsFor(room.id).map((r) => r.name));
      expect(new Set(a.map((r) => r.name)).size).toBe(4);
      for (const r of a) expect(RESIDENT_NAME_POOL).toContain(r.name);
    }
  });

  it("differs by at least one name between any two rooms", () => {
    const names = ROOMS.map((room) => residentsFor(room.id).map((r) => r.name).join("|"));
    expect(new Set(names).size).toBe(ROOMS.length);
  });

  it("rejects an unknown room", () => {
    expect(() => residentsFor("san-99")).toThrow(RangeError);
  });
});

describe("seed data", () => {
  it("has 6 robe colours and 4 residents on the fixed cushions", () => {
    expect(VISITOR_COLORS).toHaveLength(6);
    expect(RESIDENTS.map((r) => r.cushion)).toEqual([...RESIDENT_CUSHIONS]);
    expect(RESIDENTS.map((r) => r.id)).toEqual(["resident:1", "resident:2", "resident:3", "resident:4"]);
    expect(RESIDENT_NAME_POOL.length).toBeGreaterThanOrEqual(16);
  });
});

describe("normalizeVisitorName", () => {
  it("collapses and trims whitespace", () => {
    expect(normalizeVisitorName("  An \t\n  Bình  ")).toBe("An Bình");
  });

  it("composes to NFC", () => {
    const decomposed = "Hi\u0300n"; // i + combining grave
    expect(normalizeVisitorName(decomposed)).toBe("Hìn");
    expect(normalizeVisitorName(decomposed)?.length).toBe(3);
  });

  it("drops control, bidi and lone surrogate characters", () => {
    expect(normalizeVisitorName("A\u0000n\u0007")).toBe("An");
    expect(normalizeVisitorName("\u202Ean\u2066 B\u200F")).toBe("an B");
    expect(normalizeVisitorName("An\uD800")).toBe("An");
    expect(normalizeVisitorName("\u200B\uFEFF\u2060")).toBeNull();
    expect(normalizeVisitorName("👨\u200D👩")).toBe("👨\u200D👩");
  });

  it("cuts to MAX_NAME_CHARS code points; an emoji counts 1", () => {
    expect(MAX_NAME_CHARS).toBe(20);
    expect(normalizeVisitorName("a".repeat(21))).toBe("a".repeat(20));
    expect(normalizeVisitorName("🙏".repeat(21))).toBe("🙏".repeat(20));
    expect(normalizeVisitorName("An 🙏")).toBe("An 🙏");
    // A cut that lands on a space does not leave it trailing.
    expect(normalizeVisitorName(`${"a".repeat(19)} b`)).toBe("a".repeat(19));
    expect(normalizeVisitorName("x".repeat(100_000))).toBe("x".repeat(20));
  });

  it("empty or not a string → null", () => {
    for (const raw of ["", "   ", "\u0000\u202E", null, undefined, 3, {}, ["An"]]) expect(normalizeVisitorName(raw), String(raw)).toBeNull();
  });
});

describe("uniqueName", () => {
  it("keeps a free name, numbers a taken one", () => {
    expect(uniqueName("An", new Set())).toBe("An");
    expect(uniqueName("An", new Set(["An"]))).toBe("An 2");
    expect(uniqueName("An", new Set(["An", "An 2"]))).toBe("An 3");
  });

  it("numbers a resident's name too", () => {
    const resident = residentsFor("san-01")[0]?.name ?? "";
    expect(uniqueName(resident, new Set(residentsFor("san-01").map((r) => r.name)))).toBe(`${resident} 2`);
  });

  it("stays within MAX_NAME_CHARS", () => {
    const long = "a".repeat(MAX_NAME_CHARS);
    const name = uniqueName(long, new Set([long]));
    expect(name).toBe(`${"a".repeat(MAX_NAME_CHARS - 2)} 2`);
    expect(Array.from(name)).toHaveLength(MAX_NAME_CHARS);
  });
});
