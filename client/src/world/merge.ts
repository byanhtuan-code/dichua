import { Group, Mesh, type BufferGeometry, type Material, type Matrix4 } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export interface AddOptions {
  /** Re-project UVs from world position so every part shares one texel density (metres per texture tile). */
  worldUV?: number;
  /** Multiply the geometry's own UVs instead (cylinders, where box projection would seam). */
  uvScale?: readonly [number, number];
  castShadow?: boolean;
}

interface Part {
  geometry: BufferGeometry;
  castShadow: boolean;
}

function projectWorldUV(g: BufferGeometry, tile: number): void {
  const pos = g.getAttribute("position");
  const nrm = g.getAttribute("normal");
  const uv = g.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nrm.getX(i));
    const ay = Math.abs(nrm.getY(i));
    const az = Math.abs(nrm.getZ(i));
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      u = pos.getX(i);
      v = pos.getZ(i);
    } else if (ax >= az) {
      u = pos.getZ(i);
      v = pos.getY(i);
    } else {
      u = pos.getX(i);
      v = pos.getY(i);
    }
    uv.setXY(i, u / tile, v / tile);
  }
  uv.needsUpdate = true;
}

/**
 * Collects static geometry per material and merges it into one mesh per material (stack §2: few draw calls per region).
 * Every added geometry must be indexed and carry position + normal + uv (all three built-ins do).
 */
export class GeometryBatch<K extends string> {
  private readonly parts = new Map<K, Part[]>();

  add(key: K, geometry: BufferGeometry, matrix?: Matrix4, opts: AddOptions = {}): void {
    const g = geometry.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (opts.worldUV !== undefined) projectWorldUV(g, opts.worldUV);
    else if (opts.uvScale) {
      const uv = g.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * opts.uvScale[0], uv.getY(i) * opts.uvScale[1]);
    }
    const list = this.parts.get(key) ?? [];
    list.push({ geometry: g, castShadow: opts.castShadow ?? true });
    this.parts.set(key, list);
  }

  /** One Mesh per material key (two when some parts must not cast shadows). Source clones are disposed. */
  build(name: string, materials: Readonly<Record<K, Material>>): Group {
    const group = new Group();
    group.name = name;
    for (const [key, parts] of this.parts) {
      const material = materials[key];
      for (const cast of [true, false]) {
        const geos = parts.filter((p) => p.castShadow === cast).map((p) => p.geometry);
        if (geos.length === 0) continue;
        const merged = mergeGeometries(geos, false);
        if (!merged) throw new Error(`merge: incompatible geometry for "${key}"`);
        for (const g of geos) g.dispose();
        merged.computeBoundingSphere();
        const mesh = new Mesh(merged, material);
        mesh.name = `${name}:${key}${cast ? "" : ":noshadow"}`;
        mesh.castShadow = cast;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
      }
    }
    this.parts.clear();
    group.matrixAutoUpdate = false;
    group.updateMatrixWorld(true);
    return group;
  }
}

/** Disposes every geometry under a group built by GeometryBatch (materials are shared, not owned). */
export function disposeGroupGeometry(group: Group): void {
  group.traverse((o) => {
    if (o instanceof Mesh) o.geometry.dispose();
  });
}
