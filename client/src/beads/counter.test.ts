import { describe, expect, it } from "vitest";
import {
  BEADS_PER_ROUND,
  BEADS_STORAGE_KEY,
  addBead,
  centreSlot,
  inRound,
  loadBeads,
  roundOf,
  saveBeads,
} from "./counter.ts";

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
  };
}

describe("bead counter", () => {
  it("107 → 108 closes the round (toast), 109 starts the next one", () => {
    const at107 = { round: 1, total: 107 };
    const a = addBead(at107);
    expect(a.next).toEqual({ round: 1, total: 108 });
    expect(inRound(a.next.total)).toBe(108);
    expect(a.completed).toBe(1);

    const b = addBead(a.next);
    expect(b.next).toEqual({ round: 2, total: 109 });
    expect(inRound(b.next.total)).toBe(1);
    expect(b.completed).toBeNull();
  });

  it("reports the number of finished rounds", () => {
    expect(addBead({ round: 2, total: 2 * BEADS_PER_ROUND - 1 }).completed).toBe(2);
    expect(roundOf(0)).toBe(1);
    expect(inRound(0)).toBe(0);
    expect(roundOf(12419)).toBe(115);
    expect(inRound(12419)).toBe(107);
  });

  it("puts the guru bead (slot 0 of 109) at the centre exactly when a round closes", () => {
    expect(centreSlot(0) % 109).toBe(1);
    expect(centreSlot(5) % 109).toBe(6);
    expect(centreSlot(108) % 109).toBe(0);
    expect(centreSlot(216) % 109).toBe(0);
    // Slots only grow, so the ring always turns the same way.
    for (let t = 0; t < 400; t++) expect(centreSlot(t + 1)).toBeGreaterThan(centreSlot(t));
  });

  it("saves and loads {round,total}", () => {
    const s = memory();
    saveBeads(s, { round: 1, total: 5 });
    expect(JSON.parse(s.getItem(BEADS_STORAGE_KEY) ?? "")).toEqual({
      round: 1,
      total: 5,
    });
    expect(loadBeads(s)).toEqual({ round: 1, total: 5 });
  });

  it("falls back to zero on missing, broken or throwing storage", () => {
    expect(loadBeads(null)).toEqual({ round: 1, total: 0 });
    const s = memory();
    s.setItem(BEADS_STORAGE_KEY, "{not json");
    expect(loadBeads(s)).toEqual({ round: 1, total: 0 });
    s.setItem(BEADS_STORAGE_KEY, JSON.stringify({ round: 9, total: -3 }));
    expect(loadBeads(s)).toEqual({ round: 1, total: 0 });
    const throwing = {
      getItem: (): string | null => {
        throw new Error("denied");
      },
      setItem: (): void => {
        throw new Error("quota");
      },
    };
    expect(loadBeads(throwing)).toEqual({ round: 1, total: 0 });
    expect(() => saveBeads(throwing, { round: 1, total: 1 })).not.toThrow();
  });
});
