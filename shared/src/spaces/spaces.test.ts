import { describe, expect, it } from "vitest";
import { isWalkable } from "../collision.ts";
import { ROOM_COUNT, roomId } from "../world.ts";
import grid from "./fixtures/walkable-grid.json" with { type: "json" };
import { QUIET_ROOM_COUNT, ROOMS, SPACES, roomAllowsChat, spaceOf } from "./index.ts";

// shared/ has no Node or DOM types, so no Buffer / atob.
function decodeBase64(text: string): Uint8Array {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let acc = 0;
  let n = 0;
  let o = 0;
  for (const ch of clean) {
    acc = (acc << 6) | abc.indexOf(ch);
    n += 6;
    if (n >= 8) {
      n -= 8;
      out[o++] = (acc >> n) & 0xff;
    }
  }
  return out;
}

describe("spaceOf / ROOMS", () => {
  it("maps every room to tich-mac-duong", () => {
    expect(ROOMS.length).toBe(ROOM_COUNT);
    expect(ROOMS.map((r) => r.id)).toEqual(Array.from({ length: ROOM_COUNT }, (_, i) => roomId(i + 1)));
    expect(spaceOf("san-07").id).toBe("tich-mac-duong");
    for (const r of ROOMS) expect(SPACES[r.spaceId].id).toBe(r.spaceId);
  });

  it("throws for an unknown room", () => {
    expect(() => spaceOf("san-11")).toThrow(RangeError);
    expect(() => spaceOf("")).toThrow(RangeError);
  });
});

describe("roomAllowsChat", () => {
  it("rooms 1–3 are quiet, 4–10 allow chat, unknown ids never do", () => {
    expect(QUIET_ROOM_COUNT).toBe(3);
    for (let n = 1; n <= ROOM_COUNT; n++) expect(roomAllowsChat(roomId(n))).toBe(n > 3);
    for (const r of ROOMS) expect(r.chat).toBe(roomAllowsChat(r.id));
    for (const bad of ["san-11", "san-00", "", "SAN-04", "toString"]) expect(roomAllowsChat(bad)).toBe(false);
  });
});

describe("tich-mac-duong", () => {
  const space = spaceOf("san-01");

  // Fixture captured from the pre-space isWalkable (hard-coded map): the data-driven map must match every point.
  it("isWalkable matches the pre-refactor walkable grid at 100 %", () => {
    const bits = decodeBase64(grid.bits);
    let mismatches = 0;
    for (let iz = 0; iz < grid.nz; iz++) {
      for (let ix = 0; ix < grid.nx; ix++) {
        const i = iz * grid.nx + ix;
        const want = ((bits[i >> 3] ?? 0) >> (i & 7)) & 1;
        const got = isWalkable(space.collision, grid.xMin + ix * grid.step, grid.zMin + iz * grid.step, grid.r) ? 1 : 0;
        if (got !== want) mismatches++;
      }
    }
    expect(grid.nx * grid.nz).toBe(37185);
    expect(mismatches).toBe(0);
  });

  it("has 30 cushions facing the altar, four kept by residents", () => {
    expect(space.cushions).toHaveLength(30);
    expect(space.cushions[0]).toEqual({ x: -6, z: -6, yaw: Math.PI });
    expect(space.residentCushions).toEqual([0, 5, 24, 29]);
  });

  it("groundY: hall floor inside, ramps down the steps, ground outside", () => {
    expect(space.groundY(0, 0)).toBe(0.6);
    expect(space.groundY(0, 16)).toBeCloseTo(0.3);
    expect(space.groundY(0, 30)).toBe(0);
  });

  it("zoneOf: hall vs garden", () => {
    expect(space.zones).toContain(space.seatZone);
    expect(space.zoneOf(0, 0)).toBe("hall");
    expect(space.zoneOf(0, 16)).toBe("garden");
  });

  it("spawn stands on walkable ground", () => {
    expect(isWalkable(space.collision, space.spawn.x, space.spawn.z)).toBe(true);
  });
});
