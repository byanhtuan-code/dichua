import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from "three";
import { BOUNDARY, GATE_Z, HALL, LANTERN_LOOP, PATH, POND, PROP_COLLIDERS, ROOF, STEPS } from "@santinh/shared";
import { seeded } from "./random.ts";
import { gardenRegionOf, type GardenRegion, type Regions } from "./regions.ts";

/** Sparse, low accent tufts near outer garden rocks/edges so the temple ground stays clean and uncluttered. */
const CLUMPS = 64;
const TUFTS_PER_CLUMP = [3, 5] as const;
const CLUMP_RADIUS = 1.25;
const BLADES = 5;
const BLADE_HEIGHT = [0.11, 0.22] as const;
/** Wind sway at the blade tip (metres). */
const SWAY = 0.065;

/** Natural moss-green base blending into soft spring-green blade tips. */
const BASE = new Color(0x286332);
const TIP = new Color(0x64b84c);

/** Several thin triangles fanned around the origin, leaning outwards. `uv.y` = height fraction (wind weight). */
function tuftGeometry(rand: () => number): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  for (let i = 0; i < BLADES; i++) {
    const a = (i / BLADES) * Math.PI * 2 + rand() * 0.6;
    const h = BLADE_HEIGHT[0] + rand() * (BLADE_HEIGHT[1] - BLADE_HEIGHT[0]);
    const w = 0.018 + rand() * 0.01;
    const cx = Math.cos(a);
    const sz = Math.sin(a);
    const lean = 0.06 + rand() * 0.09;
    // Base corners across the lean direction, tip leaning outwards.
    pos.push(-sz * w, 0, cx * w, sz * w, 0, -cx * w, cx * lean, h, sz * lean);
    // Up-facing normals light grass softly from both sides (no dark backfaces).
    nrm.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    col.push(BASE.r, BASE.g, BASE.b, BASE.r, BASE.g, BASE.b, TIP.r, TIP.g, TIP.b);
    uv.push(0, 0, 1, 0, 0.5, 1);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nrm, 3));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  return g;
}

function nearPolyline(x: number, z: number, pts: readonly { x: number; z: number }[], d: number): boolean {
  const d2 = d * d;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len2 = dx * dx + dz * dz;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
    const px = a.x + t * dx - x;
    const pz = a.z + t * dz - z;
    if (px * px + pz * pz < d2) return true;
  }
  return false;
}

/** True where grass may grow: inside the boundary, off the hall, central courtyard, paths, pond and props. */
export function grassAllowed(x: number, z: number): boolean {
  const bu = (x - BOUNDARY.x) / BOUNDARY.rx;
  const bv = (z - BOUNDARY.z) / BOUNDARY.rz;
  if (bu * bu + bv * bv > 1 || z > GATE_Z - 0.3) return false;
  if (x > ROOF.xMin - 0.5 && x < ROOF.xMax + 0.5 && z > HALL.zMin - 2.5 && z < HALL.zMax + 1.5) return false;
  if (x > STEPS.xMin - 0.5 && x < STEPS.xMax + 0.5 && z >= HALL.zMax && z < STEPS.zMax + 0.3) return false;
  if (Math.abs(x - PATH.from.x) < PATH.width / 2 + 0.15 && z > PATH.from.z - 0.5) return false;
  if (nearPolyline(x, z, LANTERN_LOOP.points, LANTERN_LOOP.width / 2 + 0.1)) return false;
  const pu = (x - POND.x) / (POND.rx * 1.15);
  const pv = (z - POND.z) / (POND.rz * 1.15);
  if (pu * pu + pv * pv < 1) return false;
  for (const c of PROP_COLLIDERS) if (Math.hypot(x - c.x, z - c.z) < c.r * 0.85) return false;
  return true;
}

export interface Grass {
  update(t: number): void;
  dispose(): void;
}

/** Tufts as one InstancedMesh per garden region, swaying in the vertex shader (stack §2). */
export function createGrass(regions: Regions): Grass {
  const rand = seeded(0x6a55);
  const geometry = tuftGeometry(rand);
  const time = { value: 0 };
  const material = new MeshLambertMaterial({
    vertexColors: true,
    emissive: new Color(0x0e2912),
    emissiveIntensity: 0.26,
    side: DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = time;
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nuniform float uTime;").replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
      vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
      float gust = 0.6 * sin(uTime * 1.7 + ip.x * 0.31 + ip.y * 0.23) + 0.3 * sin(uTime * 3.1 + ip.x * 0.9 - ip.y * 0.4);
      float bend = uv.y * uv.y * ${SWAY.toFixed(3)};
      transformed.x += gust * bend;
      transformed.z += 0.4 * gust * bend;`,
    );
  };

  const byRegion = new Map<GardenRegion, Matrix4[]>();
  const q = new Quaternion();
  const p = new Vector3();
  const s = new Vector3();
  const Y = new Vector3(0, 1, 0);
  for (let c = 0; c < CLUMPS; c++) {
    // Bias clumps toward the outer garden ring (r in 0.42..0.96) so the central courtyard stays open and clean.
    const a = rand() * Math.PI * 2;
    const r = 0.42 + Math.sqrt(rand()) * 0.54;
    const cx = BOUNDARY.x + Math.cos(a) * BOUNDARY.rx * r;
    const cz = BOUNDARY.z + Math.sin(a) * BOUNDARY.rz * r;
    // Keep the main front courtyard strip along the stone path completely clear of random grass clumps.
    if (Math.abs(cx) < 9.5 && cz > HALL.zMax - 1 && cz < GATE_Z) continue;
    const n = TUFTS_PER_CLUMP[0] + Math.floor(rand() * (TUFTS_PER_CLUMP[1] - TUFTS_PER_CLUMP[0] + 1));
    for (let i = 0; i < n; i++) {
      const ta = rand() * Math.PI * 2;
      const tr = Math.sqrt(rand()) * CLUMP_RADIUS;
      const x = cx + Math.cos(ta) * tr;
      const z = cz + Math.sin(ta) * tr;
      if (Math.abs(x) < 8.5 && z > HALL.zMax - 1 && z < GATE_Z) continue;
      if (!grassAllowed(x, z)) continue;
      const k = 0.65 + rand() * 0.45;
      const m = new Matrix4().compose(p.set(x, 0, z), q.setFromAxisAngle(Y, rand() * Math.PI * 2), s.set(k, k * (0.75 + rand() * 0.35), k));
      const region = gardenRegionOf(x, z);
      let list = byRegion.get(region);
      if (!list) byRegion.set(region, (list = []));
      list.push(m);
    }
  }

  const meshes: InstancedMesh[] = [];
  for (const [name, list] of byRegion) {
    if (list.length === 0) continue;
    const mesh = new InstancedMesh(geometry, material, list.length);
    list.forEach((m, i) => mesh.setMatrixAt(i, m));
    mesh.computeBoundingSphere();
    mesh.receiveShadow = true;
    mesh.name = `grass:${name}`;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    regions.group(name).add(mesh);
    meshes.push(mesh);
  }

  return {
    update(t) {
      time.value = t;
    },
    dispose() {
      for (const m of meshes) {
        m.removeFromParent();
        m.dispose();
      }
      geometry.dispose();
      material.dispose();
    },
  };
}
