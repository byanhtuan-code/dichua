import { describe, expect, it } from "vitest";
import { CUSHION_COUNT, RESIDENT_CUSHIONS, cushionPosition, roomId, roomNumber } from "./world.ts";

describe("cushionPosition", () => {
  it("matches the 6×5 grid from world-map (2.4 m apart, facing the altar)", () => {
    expect(cushionPosition(0)).toEqual({ x: -6, z: -6, yaw: Math.PI });
    expect(cushionPosition(5).x).toBeCloseTo(6);
    expect(cushionPosition(6)).toMatchObject({ x: -6, z: -3.6 });
    expect(cushionPosition(29).x).toBeCloseTo(6);
    expect(cushionPosition(29).z).toBeCloseTo(3.6);
  });

  it("puts residents on the four corner cushions", () => {
    const corners = RESIDENT_CUSHIONS.map((i) => cushionPosition(i));
    expect(corners.map((c) => [Math.round(c.x * 10) / 10, Math.round(c.z * 10) / 10])).toEqual([
      [-6, -6],
      [6, -6],
      [-6, 3.6],
      [6, 3.6],
    ]);
  });

  it("rejects indexes outside 0..29", () => {
    expect(() => cushionPosition(-1)).toThrow(RangeError);
    expect(() => cushionPosition(CUSHION_COUNT)).toThrow(RangeError);
    expect(() => cushionPosition(1.5)).toThrow(RangeError);
  });
});

describe("rooms", () => {
  it("formats and parses san-NN ids", () => {
    expect(roomId(1)).toBe("san-01");
    expect(roomId(10)).toBe("san-10");
    expect(roomNumber("san-07")).toBe(7);
    expect(roomNumber("san-11")).toBeNull();
    expect(roomNumber("maru-01")).toBeNull();
    expect(() => roomId(0)).toThrow(RangeError);
  });
});
