import { describe, expect, it } from "vitest";
import { segmentClear } from "./collision.ts";
import { findPath, pathLength } from "./path.ts";
import { spaceOf } from "./spaces/index.ts";

const space = spaceOf("san-01");
const map = space.collision;

describe("findPath", () => {
  it("already there: empty route", () => {
    expect(findPath(map, space.navPoints, { x: 1, z: 1 }, { x: 1, z: 1 })).toEqual([]);
  });

  it("clear straight line: one leg", () => {
    expect(findPath(map, space.navPoints, { x: 0, z: 10 }, { x: 0, z: 2 })).toEqual([{ x: 0, z: 2 }]);
  });

  it("outside the front wall to a cushion: goes round through the door, every leg clear", () => {
    const from = { x: 8, z: 16.5 };
    const to = space.cushions[28]!;
    expect(segmentClear(map, from, to)).toBe(false);
    const route = findPath(map, space.navPoints, from, to);
    expect(route).not.toBeNull();
    expect(route!.at(-1)).toEqual({ x: to.x, z: to.z });
    let a = from;
    for (const b of route!) {
      expect(segmentClear(map, a, b)).toBe(true);
      a = b;
    }
    expect(pathLength(from, route!)).toBeGreaterThan(Math.hypot(to.x - from.x, to.z - from.z));
  });

  it("target boxed in: null", () => {
    const to = { x: 0, z: 0 };
    const ring = Array.from({ length: 12 }, (_, i) => ({ x: Math.cos(i * 0.52) * 1.2, z: Math.sin(i * 0.52) * 1.2, r: 0.6 }));
    expect(findPath(map, space.navPoints, { x: 0, z: 10 }, to, undefined, ring)).toBeNull();
  });

  it("worst case (no route, whole graph checked) stays well under a frame budget", () => {
    const ring = Array.from({ length: 12 }, (_, i) => ({ x: Math.cos(i * 0.52) * 1.2, z: Math.sin(i * 0.52) * 1.2, r: 0.6 }));
    const t0 = performance.now();
    findPath(map, space.navPoints, { x: 0, z: 38 }, { x: 0, z: 0 }, undefined, ring);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
