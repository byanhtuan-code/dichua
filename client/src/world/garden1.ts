import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector2,
  Vector3,
  type Group,
  type Material,
  type Scene,
  type Texture,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BOUNDARY, GATE, LANTERN_LOOP, PATH, PATH_LANTERNS, ROCKS, type Vec2 } from "@santinh/shared";
import { registerCameraPreset } from "../debug/params.ts";
import type { Assets } from "./assets.ts";
import type { MaterialKey, Materials } from "./materials.ts";
import { GeometryBatch, disposeGroupGeometry } from "./merge.ts";
import { gardenRegionOf, type GardenRegion, type Regions } from "./regions.ts";
import { createRoofGeometry } from "./roof.ts";
import { seeded } from "./random.ts";
import { attachAncientTreeToWishingTree } from "./wishing-tree.ts";

type Key = MaterialKey | "gravel" | "rock" | "lanternPaper" | "lotusLamp";

/** Lantern emissive: faint by day, glowing at night. */
const GLOW_DAY = 0.22;
const GLOW_NIGHT = 2.4;
/** Stone lantern light box: centre height, used for the halo. */
const STONE_LIGHT_Y = 1.04;
const LOTUS_LIGHT_Y = 0.28;
/** Path slabs sit this far proud of the ground (walkers' feet sink by as much: invisible). */
export const SLAB_TOP = 0.05;
/** Loop ribbon height above the ground; polygonOffset keeps it from z-fighting. */
const LOOP_Y = 0.02;

/** Normalised base height (metres) for `cothu.glb` before per-instance scale variation. */
const ANCIENT_BASE_HEIGHT = 7.6;

/**
 * 4-tier staggered configuration for ancient trees (`models/cothu.glb`).
 * Each outer tier scales its tree count with circumference and uses a locked phase offset
 * (0.0 -> 0.5 -> 0.25 -> 0.75) with tight angular jitter so every gap is brick-interlocked.
 */
interface AncientTierConfig {
  readonly count: number;
  readonly ring: readonly [number, number];
  readonly scale: readonly [number, number];
  readonly spread: readonly [number, number];
  readonly phaseOffset: number;
  readonly gateGapFactor: number;
}

const ANCIENT_TIERS: readonly AncientTierConfig[] = [
  // Tier 1: Courtyard perimeter ring (frames the temple grounds)
  {
    count: 24,
    ring: [1.03, 1.12],
    scale: [1.02, 1.32],
    spread: [1.08, 1.22],
    phaseOffset: 0.0,
    gateGapFactor: 1.0,
  },
  // Tier 2: Half-step staggered ring directly filling spaces between Tier 1 trees
  {
    count: 28,
    ring: [1.15, 1.34],
    scale: [1.15, 1.48],
    spread: [1.12, 1.28],
    phaseOffset: 0.5,
    gateGapFactor: 0.82,
  },
  // Tier 3: Quarter-step staggered mid-woodland canopy layer
  {
    count: 32,
    ring: [1.36, 1.66],
    scale: [1.28, 1.68],
    spread: [1.15, 1.32],
    phaseOffset: 0.25,
    gateGapFactor: 0.62,
  },
  // Tier 4: Three-quarter staggered deep ancient forest wall eliminating horizon gaps
  {
    count: 36,
    ring: [1.68, 2.12],
    scale: [1.45, 1.96],
    spread: [1.18, 1.36],
    phaseOffset: 0.75,
    gateGapFactor: 0.42,
  },
];

const ANCIENT_TREE_COUNT = ANCIENT_TIERS.reduce((sum, t) => sum + t.count, 0);

/** Deep-toned broad-canopy trees beyond Tier 4: overlaps radially at 2.02 so no seam appears. */
const FAR_TREE_COUNT = 220;
const FAR_RING = [2.02, 2.95] as const;
const FAR_HEIGHT = [12, 22] as const;
/** Gate sector (around +z) stays open so the gate reads against the sky. */
const GATE_GAP_RAD = 0.24;

const GATE_Z = (GATE.zMin + GATE.zMax) / 2;
const GATE_PILLAR_X = 3.4;
const GATE_WALL_X = 18;

const m4 = new Matrix4();
const q = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();
const UP = new Vector3(0, 1, 0);

function box(batch: GeometryBatch<Key>, key: Key, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tile = 1, castShadow = true): void {
  const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  batch.add(key, g, m4.makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), { worldUV: tile, castShadow });
  g.dispose();
}

function place(x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1): Matrix4 {
  return m4.compose(v3.set(x, y, z), q.setFromAxisAngle(UP, yaw), s3.set(sx, sy, sz));
}

/** Paint a solid vertex color onto a geometry. */
function colorGeo(g: BufferGeometry, hex: number): BufferGeometry {
  const c = new Color(hex);
  const count = g.getAttribute("position").count;
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(arr, 3));
  return g;
}

interface PreparedAncientTree {
  geometry: BufferGeometry;
  material: MeshStandardMaterial;
  textures: Texture[];
}

type Object3DLike = {
  updateMatrixWorld(force?: boolean): void;
  traverse(cb: (node: unknown) => void): void;
};

/**
 * Extracts meshes from `cothu.glb`, shifts the bottom of the trunk (`min.y ≈ -0.4409`)
 * to sit flush on `y = 0`, scales the tree to `ANCIENT_BASE_HEIGHT` (7.6 m), and fixes
 * the PBR material (`metalness = 0`, `roughness = 0.86`, `DoubleSide`) while preserving its texture.
 */
function prepareAncientTreeModel(
  root: Object3DLike,
  uTime: { value: number },
): PreparedAncientTree {
  const parts: BufferGeometry[] = [];
  const textures: Texture[] = [];
  let baseMap: Texture | null = null;
  let baseColor = new Color(0xffffff);

  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const geom = (node.geometry as BufferGeometry).clone();
    geom.applyMatrix4(node.matrixWorld);
    parts.push(geom);

    const srcMat = (Array.isArray(node.material) ? node.material[0] : node.material) as
      | MeshStandardMaterial
      | undefined;
    if (srcMat) {
      if (srcMat.map && !baseMap) {
        baseMap = srcMat.map;
        textures.push(srcMat.map);
      }
      if (srcMat.metalnessMap && !textures.includes(srcMat.metalnessMap)) {
        textures.push(srcMat.metalnessMap);
      }
      if (srcMat.roughnessMap && !textures.includes(srcMat.roughnessMap)) {
        textures.push(srcMat.roughnessMap);
      }
      if (srcMat.normalMap && !textures.includes(srcMat.normalMap)) {
        textures.push(srcMat.normalMap);
      }
      if (srcMat.color) {
        baseColor = srcMat.color.clone();
      }
      srcMat.dispose();
    }
    (node.geometry as BufferGeometry).dispose();
  });

  const merged = parts.length === 1 ? parts[0]! : mergeGeometries(parts);
  if (parts.length > 1) {
    for (const p of parts) p.dispose();
  }
  if (!merged) throw new Error("cothu.glb: no mesh geometry found");

  // Align bottom (`min.y`) to y = 0, centre X/Z at 0, and scale height to ANCIENT_BASE_HEIGHT (7.6 m).
  merged.computeBoundingBox();
  const bbox = merged.boundingBox ?? new Box3();
  const cx = (bbox.min.x + bbox.max.x) * 0.5;
  const cz = (bbox.min.z + bbox.max.z) * 0.5;
  const rawHeight = Math.max(0.01, bbox.max.y - bbox.min.y);
  const normalizeScale = ANCIENT_BASE_HEIGHT / rawHeight;

  merged.translate(-cx, -bbox.min.y, -cz);
  merged.scale(normalizeScale, normalizeScale, normalizeScale);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();

  const material = new MeshStandardMaterial({
    map: baseMap,
    color: baseColor,
    roughness: 0.86,
    metalness: 0.0,
    emissive: new Color(0x09170b),
    emissiveIntensity: 0.06,
    side: DoubleSide,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 treePos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 treePos = vec2(modelMatrix[3][0], modelMatrix[3][2]);
        #endif
        float swayWeight = clamp((transformed.y - 2.4) * 0.25, 0.0, 1.0);
        float leafPhase = transformed.x * 0.85 + transformed.z * 0.75 + treePos.x * 0.18 + treePos.y * 0.14;
        float leafSway = swayWeight * (0.045 * sin(uTime * 1.55 + leafPhase) + 0.02 * cos(uTime * 2.7 - leafPhase * 1.2));
        transformed.x += leafSway;
        transformed.y += leafSway * 0.2;
        transformed.z += leafSway * 0.6;`,
      );
  };

  return { geometry: merged, material, textures };
}

/** Distant broad-canopy tree (unit height) for the outer forest ring. */
function createFarCanopyTreeGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const trunk = colorGeo(new CylinderGeometry(0.042, 0.072, 0.38, 6).translate(0, 0.19, 0), 0x2b1d12);
  const subShade = colorGeo(new SphereGeometry(0.38, 8, 6).scale(1.32, 0.52, 1.32).translate(0, 0.44, 0), 0x102413);
  const lowL = colorGeo(new SphereGeometry(0.36, 8, 6).scale(1.25, 0.58, 1.25).translate(-0.12, 0.54, 0.07), 0x152e19);
  const lowR = colorGeo(new SphereGeometry(0.36, 8, 6).scale(1.28, 0.6, 1.28).translate(0.12, 0.6, -0.06), 0x1a381f);
  const top = colorGeo(new SphereGeometry(0.34, 8, 6).scale(1.2, 0.62, 1.2).translate(0, 0.75, 0), 0x214226);
  parts.push(trunk, subShade, lowL, lowR, top);
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  if (!merged) throw new Error("merge: far canopy trees");
  return merged;
}

/** Two columns of irregular flagstones along the stone path. */
function addPath(batch: GeometryBatch<Key>, rand: () => number): void {
  const half = PATH.width / 2;
  const gap = 0.06;
  let z = PATH.from.z;
  while (z < PATH.to.z - 0.2) {
    const len = Math.min(0.8 + rand() * 0.5, PATH.to.z - z);
    const split = (rand() - 0.5) * 0.7;
    for (const [x0, x1] of [[-half, split], [split, half]] as const) {
      const g = new BoxGeometry(x1 - x0 - gap, 0.1, len - gap);
      batch.add("stone", g, place((x0 + x1) / 2, SLAB_TOP - 0.05, z + len / 2, (rand() - 0.5) * 0.03), { worldUV: 2.6 });
      g.dispose();
    }
    z += len;
  }
}

/** A flat 2 m ribbon along LANTERN_LOOP. Indexed, with up normals and metre UVs (GeometryBatch contract). */
function loopRibbon(points: readonly Vec2[], width: number): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const dir = new Vector2();
  points.forEach((p, i) => {
    const a = points[Math.max(0, i - 1)] ?? p;
    const b = points[Math.min(points.length - 1, i + 1)] ?? p;
    dir.set(b.x - a.x, b.z - a.z).normalize();
    const ox = -dir.y * (width / 2);
    const oz = dir.x * (width / 2);
    pos.push(p.x + ox, LOOP_Y, p.z + oz, p.x - ox, LOOP_Y, p.z - oz);
    nrm.push(0, 1, 0, 0, 1, 0);
    uv.push(0, 0, 0, 0);
    if (i > 0) {
      const k = (i - 1) * 2;
      const e1x = pos[(k + 1) * 3]! - pos[k * 3]!;
      const e1z = pos[(k + 1) * 3 + 2]! - pos[k * 3 + 2]!;
      const e2x = pos[(k + 2) * 3]! - pos[k * 3]!;
      const e2z = pos[(k + 2) * 3 + 2]! - pos[k * 3 + 2]!;
      const up = e1z * e2x - e1x * e2z > 0;
      if (up) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      else idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function addStoneLantern(batch: GeometryBatch<Key>, x: number, z: number): void {
  box(batch, "rock", x - 0.31, x + 0.31, 0, 0.16, z - 0.31, z + 0.31, 3);
  box(batch, "rock", x - 0.12, x + 0.12, 0.16, 0.78, z - 0.12, z + 0.12, 3);
  box(batch, "rock", x - 0.25, x + 0.25, 0.78, 0.86, z - 0.25, z + 0.25, 3);
  box(batch, "lanternPaper", x - 0.17, x + 0.17, 0.86, 1.22, z - 0.17, z + 0.17, 0.5);
  for (const dx of [-0.19, 0.19]) for (const dz of [-0.19, 0.19]) box(batch, "rock", x + dx - 0.035, x + dx + 0.035, 0.86, 1.22, z + dz - 0.035, z + dz + 0.035, 3);
  const cap = new ConeGeometry(0.42, 0.26, 4, 1);
  batch.add("rock", cap, place(x, 1.35, z, Math.PI / 4), { worldUV: 3 });
  cap.dispose();
  const knob = new SphereGeometry(0.07, 8, 6);
  batch.add("rock", knob, place(x, 1.5, z), { worldUV: 3 });
  knob.dispose();
}

/** Lotus-bud lamp sitting on the grass: a lathe with scalloped petals. */
function lotusLampGeometry(): BufferGeometry {
  const profile = [
    [0.001, 0],
    [0.14, 0.01],
    [0.24, 0.08],
    [0.27, 0.18],
    [0.23, 0.29],
    [0.12, 0.37],
    [0.001, 0.4],
  ].map(([r, y]) => new Vector2(r, y));
  const g = new LatheGeometry(profile, 24);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const k = 1 + 0.1 * Math.cos(8 * Math.atan2(z, x));
    pos.setXYZ(i, x * k, pos.getY(i), z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Largest outward push of rockGeometry's noise; dividing by it keeps the rock inside its collider circle. */
const ROCK_BULGE = 1.24;

/** Lumpy rock: a sphere pushed in/out by a few sines (same position → same offset, so UV seams stay closed). */
function rockGeometry(seed: number): BufferGeometry {
  const g = new SphereGeometry(1, 10, 7);
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = (1 + 0.16 * Math.sin(3.1 * x + seed) * Math.cos(2.3 * z + seed * 1.7) + 0.08 * Math.sin(5.3 * y + seed * 2.1)) / ROCK_BULGE;
    pos.setXYZ(i, x * n, Math.max(y, -0.35) * n, z * n);
  }
  g.computeVertexNormals();
  return g;
}

function addGate(batch: GeometryBatch<Key>): void {
  const z0 = GATE.zMin;
  const z1 = GATE.zMax;
  const pillar = new CylinderGeometry(0.26, 0.3, 4.2, 14);
  const plinth = new CylinderGeometry(0.42, 0.48, 0.3, 14);
  for (const x of [-GATE_PILLAR_X, GATE_PILLAR_X]) {
    batch.add("stone", plinth, place(x, 0.15, GATE_Z), { worldUV: 0.8 });
    batch.add("paintRed", pillar, place(x, 0.3 + 2.1, GATE_Z), { uvScale: [2, 4] });
  }
  pillar.dispose();
  plinth.dispose();
  box(batch, "paintRed", -GATE_PILLAR_X - 0.5, GATE_PILLAR_X + 0.5, 3.4, 3.62, GATE_Z - 0.16, GATE_Z + 0.16, 1);
  box(batch, "darkWood", -GATE_PILLAR_X - 0.7, GATE_PILLAR_X + 0.7, 4.1, 4.5, GATE_Z - 0.22, GATE_Z + 0.22, 1);
  const roof = createRoofGeometry({
    cx: 0,
    cz: GATE_Z,
    halfX: GATE_PILLAR_X + 1.5,
    halfZ: (z1 - z0) / 2 + 0.9,
    ridgeHalf: GATE_PILLAR_X,
    eaveY: 4.5,
    rise: 1.2,
    sag: 1.6,
    cornerLift: 0.35,
    thickness: 0.16,
  }, 3);
  batch.add("roof", roof.top);
  batch.add("wood", roof.bottom);
  batch.add("roofTrim", roof.fascia);
  roof.top.dispose();
  roof.bottom.dispose();
  roof.fascia.dispose();
  for (const s of [-1, 1]) {
    const xa = s * (GATE_PILLAR_X + 0.4);
    const xb = s * GATE_WALL_X;
    const [x0, x1] = xa < xb ? [xa, xb] : [xb, xa];
    box(batch, "stone", x0, x1, 0, 0.5, GATE_Z - 0.28, GATE_Z + 0.28, 1.2);
    box(batch, "plaster", x0, x1, 0.5, 1.55, GATE_Z - 0.22, GATE_Z + 0.22, 1.5);
    box(batch, "roofTrim", x0 - 0.1, x1 + 0.1, 1.55, 1.75, GATE_Z - 0.4, GATE_Z + 0.4, 1);
  }
}

/** Point on the boundary ellipse at angle a, scaled outwards by s. */
function ringPoint(a: number, s: number): Vec2 {
  return { x: BOUNDARY.x + Math.cos(a) * BOUNDARY.rx * s, z: BOUNDARY.z + Math.sin(a) * BOUNDARY.rz * s };
}

export interface LanternSpots {
  stone: readonly Vector3[];
  lotus: readonly Vector3[];
}

export interface Garden {
  readonly lanterns: LanternSpots;
  update(daylight: number): void;
  dispose(): void;
}

export async function createGarden(scene: Scene, assets: Assets, materials: Materials, regions: Regions): Promise<Garden> {
  const cothuGltf = await assets.model("models/cothu.glb");
  const rand = seeded(0x5a7d);

  const owned: Material[] = [];
  const own = <M extends Material>(m: M): M => {
    owned.push(m);
    return m;
  };
  const gravel = own(
    new MeshStandardMaterial({
      map: materials.stone.map,
      normalMap: materials.stone.normalMap,
      roughnessMap: materials.stone.roughnessMap,
      color: 0xa69f90,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  );
  const rock = own(
    new MeshStandardMaterial({ normalMap: materials.stone.normalMap, roughnessMap: materials.stone.roughnessMap, color: 0x827d73, metalness: 0 }),
  );
  const lanternPaper = own(new MeshStandardMaterial({ color: 0xf5e9cc, roughness: 0.9, emissive: 0xffc680, emissiveIntensity: GLOW_DAY }));
  const lotusLamp = own(new MeshStandardMaterial({ color: 0xf7dcd8, roughness: 0.85, emissive: 0xffbe92, emissiveIntensity: GLOW_DAY }));
  const batchMaterials = { ...materials, gravel, rock, lanternPaper, lotusLamp };

  const batches = new Map<GardenRegion | "gate", GeometryBatch<Key>>();
  const batchOf = (r: GardenRegion | "gate"): GeometryBatch<Key> => {
    let b = batches.get(r);
    if (!b) batches.set(r, (b = new GeometryBatch<Key>()));
    return b;
  };

  // Stone path + its lanterns.
  addPath(batchOf("garden-near"), rand);
  const stone = PATH_LANTERNS.map((p) => {
    addStoneLantern(batchOf(gardenRegionOf(p.x, p.z)), p.x, p.z);
    return new Vector3(p.x, STONE_LIGHT_Y, p.z);
  });

  // Lotus-lantern loop.
  const ribbon = loopRibbon(LANTERN_LOOP.points, LANTERN_LOOP.width);
  batchOf("garden-west").add("gravel", ribbon, undefined, { worldUV: 1.5, castShadow: false });
  ribbon.dispose();
  const lampGeo = lotusLampGeometry().scale(1.4, 1.4, 1.4);
  const lotus = LANTERN_LOOP.lanterns.map((p) => {
    batchOf(gardenRegionOf(p.x, p.z)).add("lotusLamp", lampGeo, place(p.x, 0, p.z, rand() * Math.PI), { castShadow: false });
    return new Vector3(p.x, LOTUS_LIGHT_Y, p.z);
  });
  lampGeo.dispose();

  // Rocks: footprint r, about half as tall, sunk a little.
  ROCKS.forEach((r, i) => {
    const g = rockGeometry(i * 2.37 + 1);
    batchOf(gardenRegionOf(r.x, r.z)).add("rock", g, place(r.x, r.r * 0.12, r.z, rand() * Math.PI * 2, r.r, r.r * (0.45 + rand() * 0.2), r.r * 0.82), { worldUV: 4 });
    g.dispose();
  });

  addGate(batchOf("gate"));

  const built: Group[] = [];
  for (const [region, batch] of batches) {
    const group = batch.build(`garden:${region}`, batchMaterials);
    regions.group(region).add(group);
    built.push(group);
  }

  // 120 ancient trees (`models/cothu.glb`) in 4 brick-staggered rings + shared with Wishing Tree.
  const uTreeTime = { value: 0 };
  const preparedTree = prepareAncientTreeModel(cothuGltf.scene, uTreeTime);
  own(preparedTree.material);
  attachAncientTreeToWishingTree(preparedTree.geometry, preparedTree.material);

  const ancientTrees = new InstancedMesh(preparedTree.geometry, preparedTree.material, ANCIENT_TREE_COUNT);
  let treeIdx = 0;

  for (const tier of ANCIENT_TIERS) {
    const gap = GATE_GAP_RAD * tier.gateGapFactor;
    const tierArc = Math.PI * 2 - 2 * gap;
    for (let k = 0; k < tier.count; k++) {
      // Controlled jitter (±0.11 of a slot) around a deterministic staggered phase prevents clumping/gaps
      const slot = k + 0.5 + tier.phaseOffset + (rand() - 0.5) * 0.22;
      const wrappedSlot = ((slot % tier.count) + tier.count) % tier.count;
      const a = Math.PI / 2 + gap + (wrappedSlot / tier.count) * tierArc;

      // Stratified radial placement within the tier band
      const radialT = (k % 2) * 0.45 + rand() * 0.55;
      const r = tier.ring[0] + radialT * (tier.ring[1] - tier.ring[0]);
      const p = ringPoint(a, r);

      const sc = tier.scale[0] + rand() * (tier.scale[1] - tier.scale[0]);
      const spreadFactor = tier.spread[0] + rand() * (tier.spread[1] - tier.spread[0]);
      const sx = sc * spreadFactor;
      const sz = sc * (spreadFactor * (0.94 + rand() * 0.12));
      const yaw = (k * 1.6180339 + rand() * 0.65) * Math.PI * 2;

      ancientTrees.setMatrixAt(treeIdx++, place(p.x, 0, p.z, yaw, sx, sc, sz));
    }
  }

  ancientTrees.castShadow = true;
  ancientTrees.receiveShadow = true;
  ancientTrees.computeBoundingSphere();
  ancientTrees.name = "ancient-trees";

  // Distant broad-canopy forest ring beyond Tier 4 with darkened, non-glowing PBR foliage.
  const farGeo = createFarCanopyTreeGeometry();
  const farMat = own(
    new MeshStandardMaterial({
      vertexColors: true,
      color: new Color(0x829985),
      roughness: 0.94,
      metalness: 0.0,
    }),
  );
  const far = new InstancedMesh(farGeo, farMat, FAR_TREE_COUNT);
  const farGap = GATE_GAP_RAD * 0.3;
  const farArc = Math.PI * 2 - 2 * farGap;
  for (let i = 0; i < FAR_TREE_COUNT; i++) {
    const slot = i + (i % 3) * 0.33 + (rand() - 0.5) * 0.28;
    const a = Math.PI / 2 + farGap + (((slot % FAR_TREE_COUNT) + FAR_TREE_COUNT) % FAR_TREE_COUNT / FAR_TREE_COUNT) * farArc;
    const p = ringPoint(a, FAR_RING[0] + rand() * (FAR_RING[1] - FAR_RING[0]));
    const h = FAR_HEIGHT[0] + rand() * (FAR_HEIGHT[1] - FAR_HEIGHT[0]);
    const w = h * (1.05 + rand() * 0.38);
    far.setMatrixAt(i, place(p.x, 0, p.z, rand() * Math.PI * 2, w, h, w));
  }
  far.computeBoundingSphere();
  far.name = "far-trees";

  const forest: InstancedMesh[] = [ancientTrees, far];
  for (const o of forest) {
    o.matrixAutoUpdate = false;
    o.updateMatrix();
    scene.add(o);
  }

  registerCameraPreset("gate", { position: [0, 2.4, 36], target: [0, 2.6, 46] });
  registerCameraPreset("overview", { position: [0, 75, 100], target: [0, 0, 10] });

  return {
    lanterns: { stone, lotus },
    update(daylight) {
      uTreeTime.value = performance.now() * 0.001;
      const k = GLOW_DAY + (GLOW_NIGHT - GLOW_DAY) * (1 - daylight);
      lanternPaper.emissiveIntensity = k;
      lotusLamp.emissiveIntensity = k;
      preparedTree.material.emissiveIntensity = 0.04 + 0.05 * daylight;
    },
    dispose() {
      for (const g of built) {
        g.removeFromParent();
        disposeGroupGeometry(g);
      }
      for (const o of forest) {
        scene.remove(o);
        o.dispose();
      }
      preparedTree.geometry.dispose();
      for (const tex of preparedTree.textures) tex.dispose();
      farGeo.dispose();
      for (const m of owned) m.dispose();
    },
  };
}
