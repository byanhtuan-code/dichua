import { describe, expect, it } from "vitest";
import { seeded } from "./random.ts";

describe("seeded", () => {
  it("repeats the same sequence for the same seed and stays in [0, 1)", () => {
    const a = seeded(42);
    const b = seeded(42);
    for (let i = 0; i < 1000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});
