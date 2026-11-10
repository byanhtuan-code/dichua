import { describe, expect, it } from "vitest";
import { clampToWalkable, isWalkable, segmentClear } from "./collision.ts";
import { spaceOf } from "./spaces/index.ts";
import { LANTERN_LOOP, PATH, PROP_COLLIDERS, WALK_RADIUS } from "./world.ts";

const space = spaceOf("san-01");
const map = space.collision;
const SPAWN = space.spawn;
const SPAWN_JITTER = space.spawnJitter;

describe("isWalkable", () => {
  it("allows spawn, the stone path and every cushion", () => {
    expect(isWalkable(map, SPAWN.x, SPAWN.z)).toBe(true);
    expect(isWalkable(map, 0, 25)).toBe(true);
    space.cushions.forEach((c, i) => {
      expect(isWalkable(map, c.x, c.z), `cushion ${i}`).toBe(true);
    });
  });

  it("allows the whole lantern loop", () => {
    for (const p of LANTERN_LOOP.points) expect(isWalkable(map, p.x, p.z), `${p.x},${p.z}`).toBe(true);
  });

  it("keeps the path, the loop and the spawn area clear of props", () => {
    const half = PATH.width / 2 - WALK_RADIUS;
    for (let z = PATH.from.z + 0.5; z <= PATH.to.z - 1; z += 0.5) {
      for (const x of [-half, 0, half]) expect(isWalkable(map, x, z), `path ${x},${z}`).toBe(true);
    }
    for (const dx of [-SPAWN_JITTER, SPAWN_JITTER]) {
      for (const dz of [-SPAWN_JITTER, SPAWN_JITTER]) expect(isWalkable(map, SPAWN.x + dx, SPAWN.z + dz)).toBe(true);
    }
    // Lotus lanterns stand beside the loop, never on it.
    for (const p of LANTERN_LOOP.points) {
      for (const c of PROP_COLLIDERS) {
        expect(Math.hypot(p.x - c.x, p.z - c.z), `loop ${p.x},${p.z} vs ${c.x},${c.z}`).toBeGreaterThan(c.r + WALK_RADIUS);
      }
    }
  });

  it("blocks garden props (lanterns, rocks)", () => {
    for (const c of PROP_COLLIDERS) expect(isWalkable(map, c.x, c.z), `${c.x},${c.z}`).toBe(false);
  });

  it("blocks columns, including the walker radius", () => {
    expect(isWalkable(map, 12.5, -4)).toBe(false);
    expect(isWalkable(map, 12.5 - 0.7 - WALK_RADIUS + 0.05, -4)).toBe(false);
    expect(isWalkable(map, 12.5 - 0.7 - WALK_RADIUS - 0.05, -4)).toBe(true);
  });

  it("blocks the altar", () => {
    expect(isWalkable(map, 0, -15.5)).toBe(false);
    expect(isWalkable(map, 4, -13.8)).toBe(false);
  });

  it("blocks the pond", () => {
    expect(isWalkable(map, 24, 12)).toBe(false);
    expect(isWalkable(map, 24, 12 + 10 + 0.2)).toBe(false);
    expect(isWalkable(map, 24, 12 + 10 + WALK_RADIUS + 0.1)).toBe(true);
  });

  it("blocks outside the boundary and past the gate", () => {
    expect(isWalkable(map, 0, -30)).toBe(false);
    expect(isWalkable(map, 46.9, 16)).toBe(false);
    expect(isWalkable(map, 0, 50)).toBe(false);
    expect(isWalkable(map, Number.NaN, 0)).toBe(false);
  });

  it("blocks extra circles (rocks, seated people)", () => {
    expect(isWalkable(map, 0, 30, WALK_RADIUS, [{ x: 0.5, z: 30, r: 0.3 }])).toBe(false);
    expect(isWalkable(map, 0, 30, WALK_RADIUS, [{ x: 2, z: 30, r: 0.3 }])).toBe(true);
  });
});

describe("segmentClear", () => {
  it("lets you walk through the front door up the steps", () => {
    expect(segmentClear(map, { x: 0, z: 25 }, { x: 0, z: 0 })).toBe(true);
  });

  it("stops you walking through the front wall beside the door", () => {
    expect(segmentClear(map, { x: 9, z: 20 }, { x: 9, z: 0 })).toBe(false);
  });

  it("stops you walking through the side wall", () => {
    expect(segmentClear(map, { x: -20, z: 0 }, { x: 0, z: 0 })).toBe(false);
  });

  it("stops you crossing the pond", () => {
    expect(segmentClear(map, { x: 14, z: 12 }, { x: 34, z: 12 })).toBe(false);
  });

  it("is false when the target itself is blocked", () => {
    expect(segmentClear(map, { x: 0, z: 30 }, { x: 0, z: 50 })).toBe(false);
  });
});

describe("clampToWalkable", () => {
  it("stops just in front of a column", () => {
    const end = clampToWalkable(map, { x: 12.5, z: 2 }, { x: 12.5, z: -10 });
    expect(end.x).toBe(12.5);
    expect(end.z).toBeGreaterThan(-4 + 0.7 + WALK_RADIUS - 0.001);
    expect(end.z).toBeLessThan(-4 + 0.7 + WALK_RADIUS + 0.2);
  });

  it("returns the target when the path is clear", () => {
    expect(clampToWalkable(map, { x: 0, z: 38 }, { x: 0, z: 30 })).toEqual({ x: 0, z: 30 });
  });

  it("lets you step out of someone who sat down on top of you", () => {
    const seated = [{ x: 0.3, z: 30, r: 0.4 }];
    expect(isWalkable(map, 0, 30, WALK_RADIUS, seated)).toBe(false);
    expect(clampToWalkable(map, { x: 0, z: 30 }, { x: -3, z: 30 }, WALK_RADIUS, seated)).toEqual({ x: -3, z: 30 });
  });

  it("still stops at a person you are not touching yet", () => {
    const end = clampToWalkable(map, { x: 0, z: 30 }, { x: 5, z: 30 }, WALK_RADIUS, [{ x: 3, z: 30, r: 0.4 }]);
    expect(end.x).toBeLessThan(3 - 0.4 - WALK_RADIUS + 0.001);
    expect(end.x).toBeGreaterThan(3 - 0.4 - WALK_RADIUS - 0.2);
  });

  it("returns the start when the first step is blocked", () => {
    const from = { x: 0, z: 43.6 };
    expect(clampToWalkable(map, from, { x: 0, z: 46 })).toEqual(from);
  });
});

describe("zoneOf", () => {
  it("splits hall and garden at the hall walls", () => {
    expect(space.zoneOf(0, 0)).toBe("hall");
    expect(space.zoneOf(0, 16)).toBe("garden");
    expect(space.zoneOf(24, 12)).toBe("garden");
  });
});
