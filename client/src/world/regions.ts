import { Box3, Frustum, Group, Light, Matrix4, Sphere, type Camera, type Object3D, type Scene } from "three";
import { HALL, ROOF } from "@santinh/shared";

export const REGION_NAMES = ["hall", "garden-near", "garden-west", "garden-east", "gate"] as const;
export type RegionName = (typeof REGION_NAMES)[number];
export type GardenRegion = Extract<RegionName, `garden-${string}`>;

/** Central strip in front of the hall (path + spawn); everything else splits west / east of the axis. */
const NEAR_HALF_X = ROOF.xMax - 2;

export function gardenRegionOf(x: number, z: number): GardenRegion {
  if (z >= HALL.zMax && Math.abs(x) <= NEAR_HALF_X) return "garden-near";
  return x < 0 ? "garden-west" : "garden-east";
}

/**
 * Grows each region's sphere so an off-screen region still casts its shadow into view
 * (the sun's shadow box is ±18 m around the focus).
 */
const SHADOW_MARGIN = 6;

interface Region {
  readonly group: Group;
  /** Objects owned elsewhere (the hall) whose visibility this region toggles. */
  readonly members: Object3D[];
  readonly sphere: Sphere;
}

/**
 * Stack §2 "Cắt vùng": each region is a Group with one bounding sphere; once per frame, regions outside the camera
 * frustum are hidden so three skips their whole subtree (draw + shadow pass).
 * Lights are never hidden: changing the light count recompiles every material.
 */
export class Regions {
  private readonly regions = new Map<RegionName, Region>();
  private readonly frustum = new Frustum();
  private readonly viewProj = new Matrix4();
  private readonly box = new Box3();
  private readonly tmp = new Box3();

  constructor(private readonly scene: Scene) {
    for (const name of REGION_NAMES) {
      const group = new Group();
      group.name = `region:${name}`;
      scene.add(group);
      this.regions.set(name, { group, members: [], sphere: new Sphere() });
    }
  }

  /** Group to put new content of a region in (already in the scene). */
  group(name: RegionName): Group {
    return this.get(name).group;
  }

  /** Adds an object that lives elsewhere in the scene graph; its non-light children are toggled with the region. */
  track(name: RegionName, root: Object3D): void {
    const members = this.get(name).members;
    for (const child of root.children) if (!(child instanceof Light)) members.push(child);
  }

  /** Computes the bounding spheres. Call once after every region is filled. */
  finalize(): void {
    for (const r of this.regions.values()) {
      this.box.makeEmpty();
      for (const o of [r.group, ...r.members]) {
        o.updateWorldMatrix(true, true);
        this.tmp.setFromObject(o, true);
        if (!this.tmp.isEmpty()) this.box.union(this.tmp);
      }
      if (this.box.isEmpty()) r.sphere.makeEmpty();
      else this.box.getBoundingSphere(r.sphere);
      r.sphere.radius += SHADOW_MARGIN;
    }
  }

  update(camera: Camera): void {
    camera.updateMatrixWorld();
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProj);
    for (const r of this.regions.values()) {
      const visible = r.sphere.isEmpty() || this.frustum.intersectsSphere(r.sphere);
      r.group.visible = visible;
      for (const m of r.members) m.visible = visible;
    }
  }

  /** Removes the region groups. Their content is disposed by the modules that built it. */
  dispose(): void {
    for (const r of this.regions.values()) {
      this.scene.remove(r.group);
      for (const m of r.members) m.visible = true;
    }
    this.regions.clear();
  }

  private get(name: RegionName): Region {
    const r = this.regions.get(name);
    if (!r) throw new Error(`region ${name} disposed`);
    return r;
  }
}
