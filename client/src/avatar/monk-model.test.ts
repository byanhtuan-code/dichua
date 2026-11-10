import { describe, expect, it } from "vitest";
import { Color } from "three";
import { createMonkGeometry } from "./monk-model.ts";
import { BONE_NAMES, createRig } from "./rig.ts";

const triangles = (detail: "full" | "remote"): number => {
  const g = createMonkGeometry(new Color("#b9c3c7"), detail);
  const n = (g.index?.count ?? 0) / 3;
  g.dispose();
  return n;
};

describe("rig", () => {
  it("has the 17 source bone names under one root", () => {
    expect(BONE_NAMES).toHaveLength(17);
    const rig = createRig();
    let count = 0;
    rig.root.traverse(() => count++);
    expect(count).toBe(17);
    expect(rig.list.map((b) => b.name)).toEqual([...BONE_NAMES]);
  });
});

describe("createMonkGeometry", () => {
  it("stays within the triangle budget (full ≤ 6k, remote ≤ 2k)", () => {
    const full = triangles("full");
    const remote = triangles("remote");
    expect(full).toBeLessThanOrEqual(6000);
    expect(remote).toBeLessThanOrEqual(2000);
    expect(full / remote).toBeGreaterThanOrEqual(3);
  });

  it("skins every vertex to valid bones with weights summing to 1", () => {
    const g = createMonkGeometry(new Color("#b9c3c7"), "remote");
    const idx = g.getAttribute("skinIndex");
    const w = g.getAttribute("skinWeight");
    for (let i = 0; i < w.count; i++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += w.getComponent(i, k);
        expect(idx.getComponent(i, k)).toBeLessThan(BONE_NAMES.length);
      }
      expect(sum).toBeCloseTo(1, 5);
    }
    g.dispose();
  });

  it("is about 1.2 m tall with feet on the ground", () => {
    const g = createMonkGeometry(new Color("#b9c3c7"), "full");
    g.computeBoundingBox();
    expect(g.boundingBox?.min.y).toBeCloseTo(0, 2);
    expect(g.boundingBox?.max.y).toBeGreaterThan(1.1);
    expect(g.boundingBox?.max.y).toBeLessThan(1.25);
    g.dispose();
  });
});
