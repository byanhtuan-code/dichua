import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { TICH_MAC_DUONG_LANDMARKS, spaceOf } from "@santinh/shared";
import { cameraWorldOf, clearDistance, floorAlongRay } from "./camera-rig.ts";

const world = cameraWorldOf(spaceOf("san-01"));
const { hallBackZ: HALL_BACK_Z, pond: POND } = TICH_MAC_DUONG_LANDMARKS;

describe("camera occlusion", () => {
  it("open garden: full distance", () => {
    expect(clearDistance(world, 0, 1, 30, 0, 0.3, 0.95, 8)).toBe(8);
  });

  it("pulls in before the hall's back wall when standing inside", () => {
    const fz = HALL_BACK_Z + 2;
    const d = clearDistance(world, 0, 1.6, fz, 0, 0.2, -0.98, 10);
    expect(d).toBeLessThan(2);
  });

  it("pulls in under the roof soffit / ceiling", () => {
    expect(clearDistance(world, 0, 1.6, 0, 0, 1, 0, 12)).toBeLessThan(9);
  });
});

describe("floor picking", () => {
  it("hits the ground ahead in the garden", () => {
    const dir = new Vector3(0, -1, -2).normalize();
    const p = floorAlongRay(world, new Vector3(0, 3, 40), dir);
    expect(p?.z).toBeCloseTo(34, 1);
  });

  it("a ray into the hall wall is not floor", () => {
    expect(floorAlongRay(world, new Vector3(8, 3, 22), new Vector3(0, 0, -1))).toBeNull();
  });

  it("a ray to the sky is not floor", () => {
    expect(floorAlongRay(world, new Vector3(0, 3, 40), new Vector3(0, 0.2, -1).normalize())).toBeNull();
  });

  it("the pond surface still returns a point (movement rejects it)", () => {
    const p = floorAlongRay(world, new Vector3(POND.x, 5, POND.z + 5), new Vector3(0, -1, -1).normalize());
    expect(p).not.toBeNull();
  });
});
