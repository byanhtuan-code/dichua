import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector2,
  Vector3,
  type Material,
  type Scene,
} from "three";
import { BOUNDARY, type Vec2 } from "@santinh/shared";
import { IS_MOBILE } from "../engine/renderer.ts";
import type { Materials } from "./materials.ts";
import { attachAncientTreeToWishingTree } from "./wishing-tree.ts";
import {
  ARCHETYPE_SPECS,
  TREE_VISUAL_CONFIG,
  attachMapleBarkShader,
  attachMapleFoliageShader,
  buildArchetypeGeometry,
  buildWishingTreeGeometry,
  drawBotanicalBranchletTexture,
} from "./maple-tree.ts";

/** Gate sector (around +z) stays open so the gate reads against the sky. */
const GATE_GAP_RAD = 0.23;

const m4 = new Matrix4();
const q = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();
const tmpEuler = new Euler();
const UP = new Vector3(0, 1, 0);
const tmpHsl = { h: 0, s: 0, l: 0 };

function place(x: number, y: number, z: number, yaw = 0, sx = 1, sy = 1, sz = 1): Matrix4 {
  return m4.compose(v3.set(x, y, z), q.setFromAxisAngle(UP, yaw), s3.set(sx, sy, sz));
}

function ringPoint(a: number, s: number): Vec2 {
  return { x: BOUNDARY.x + Math.cos(a) * BOUNDARY.rx * s, z: BOUNDARY.z + Math.sin(a) * BOUNDARY.rz * s };
}

function pickTreeFoliageColor(index: number, ringTier: number, out: Color): Color {
  const palette = TREE_VISUAL_CONFIG.foliagePalette;
  const step = (index * 5 + ringTier * 3) % palette.length;
  const baseHex = palette[step] ?? 0xd12219;
  out.setHex(baseHex);

  const satBoost = TREE_VISUAL_CONFIG.colorSaturationBoost;
  const lumBoost = TREE_VISUAL_CONFIG.colorBrightnessBoost;
  out.getHSL(tmpHsl);
  tmpHsl.s = Math.min(0.96, tmpHsl.s * satBoost);
  tmpHsl.l = Math.max(0.28, Math.min(0.76, tmpHsl.l * lumBoost));
  out.setHSL(tmpHsl.h, tmpHsl.s, tmpHsl.l);
  return out;
}

// ============================================================================
// 4-LAYER STEPPED FOREST LAYOUT (ALL TRUNKS GROUNDED AT Y = -0.08m!)
// ============================================================================

interface TreeInstanceRecord {
  variantIndex: number;
  matrix: Matrix4;
  color: Color;
}

interface SteppedRingConfig {
  readonly tier: number;
  readonly count: number;
  readonly ring: readonly [number, number];
  readonly heightRange: readonly [number, number];
  readonly spreadRange: readonly [number, number];
  readonly baseY: number;
  readonly phaseOffset: number;
  readonly gateGapFactor: number;
  readonly variants: readonly number[];
}

export const STEPPED_RINGS: readonly SteppedRingConfig[] = [
  {
    tier: 4,
    count: IS_MOBILE ? 34 : 40,
    ring: [1.35, 1.54],
    heightRange: [17.5, 23.5],
    spreadRange: [1.06, 1.2],
    baseY: -0.08,
    phaseOffset: 0.5,
    gateGapFactor: 0.42,
    variants: [0, 1, 2],
  },
  {
    tier: 3,
    count: IS_MOBILE ? 30 : 36,
    ring: [1.2, 1.33],
    heightRange: [12.5, 16.5],
    spreadRange: [1.02, 1.16],
    baseY: -0.08,
    phaseOffset: 0.0,
    gateGapFactor: 0.64,
    variants: [0, 1, 2, 3],
  },
  {
    tier: 2,
    count: IS_MOBILE ? 26 : 32,
    ring: [1.08, 1.19],
    heightRange: [8.2, 11.2],
    spreadRange: [1.0, 1.12],
    baseY: -0.08,
    phaseOffset: 0.5,
    gateGapFactor: 0.84,
    variants: [1, 2, 3, 4],
  },
  {
    tier: 1,
    count: IS_MOBILE ? 22 : 28,
    ring: [0.99, 1.07],
    heightRange: [5.4, 7.4],
    spreadRange: [0.96, 1.08],
    baseY: -0.08,
    phaseOffset: 0.25,
    gateGapFactor: 1.0,
    variants: [2, 3, 4, 5],
  },
];

function buildSteppedForestLayout(rand: () => number): TreeInstanceRecord[] {
  const records: TreeInstanceRecord[] = [];
  const tmpColor = new Color();
  let colorCounter = 0;
  let prevVariant = -1;
  const hMult = TREE_VISUAL_CONFIG.treeHeightMultiplier;

  const pickNonRepeatingVariant = (pool: readonly number[]): number => {
    let pick = pool[Math.floor(rand() * pool.length)] ?? 0;
    if (pool.length > 1 && pick === prevVariant) {
      pick = pool[(pool.indexOf(pick) + 1) % pool.length] ?? 0;
    }
    prevVariant = pick;
    return pick;
  };

  for (const cfg of STEPPED_RINGS) {
    const gap = GATE_GAP_RAD * cfg.gateGapFactor;
    const arc = Math.PI * 2 - 2 * gap;

    for (let k = 0; k < cfg.count; k++) {
      const slotPos = k + 0.5 + cfg.phaseOffset + (rand() - 0.5) * 0.24;
      const u = (((slotPos % cfg.count) + cfg.count) % cfg.count) / cfg.count;
      const a = Math.PI / 2 + gap + u * arc;

      const r = cfg.ring[0] + rand() * (cfg.ring[1] - cfg.ring[0]);
      const p = ringPoint(a, r);

      const vIdx = pickNonRepeatingVariant(cfg.variants);
      const spec = ARCHETYPE_SPECS[vIdx]!;

      const targetHeight = (cfg.heightRange[0] + rand() * (cfg.heightRange[1] - cfg.heightRange[0])) * hMult;
      const sy = targetHeight / spec.baseHeight;
      const spread = cfg.spreadRange[0] + rand() * (cfg.spreadRange[1] - cfg.spreadRange[0]);
      const sx = sy * spread * (0.95 + rand() * 0.1);
      const sz = sy * spread * (0.95 + rand() * 0.1);
      const yaw = (k * 1.6180339 + cfg.tier * 0.9 + rand() * 0.4) * Math.PI * 2;

      pickTreeFoliageColor(colorCounter++, cfg.tier, tmpColor);

      records.push({
        variantIndex: vIdx,
        matrix: place(p.x, cfg.baseY, p.z, yaw, sx, sy, sz).clone(),
        color: tmpColor.clone(),
      });
    }
  }

  return records;
}

// ============================================================================
// DIAGONAL GOLDEN SUNLIGHT SHAFTS ("GOD RAYS")
// ============================================================================

function createForestSunbeams(scene: Scene, rand: () => number): {
  mesh: InstancedMesh;
  material: MeshBasicMaterial;
  dispose(): void;
} {
  const beamCount = IS_MOBILE ? 14 : 22;
  const geo = new PlaneGeometry(3.8, 20.0);
  geo.translate(0, 8.5, 0);

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, "rgba(255, 228, 155, 0.0)");
    g.addColorStop(0.22, "rgba(255, 212, 128, 0.30)");
    g.addColorStop(0.65, "rgba(255, 188, 95, 0.15)");
    g.addColorStop(1, "rgba(255, 170, 75, 0.0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 256);

    ctx.globalCompositeOperation = "destination-in";
    const hg = ctx.createLinearGradient(0, 0, 128, 0);
    hg.addColorStop(0, "rgba(0,0,0,0)");
    hg.addColorStop(0.5, "rgba(0,0,0,1)");
    hg.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, 128, 256);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;

  const material = new MeshBasicMaterial({
    map: tex,
    color: new Color(0xffcc70),
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });

  const mesh = new InstancedMesh(geo, material, beamCount);
  const arc = Math.PI * 2 - 2 * GATE_GAP_RAD;
  for (let i = 0; i < beamCount; i++) {
    const u = (i + 0.5) / beamCount;
    const a = Math.PI / 2 + GATE_GAP_RAD + u * arc;
    const p = ringPoint(a, 1.0 + (i % 3) * 0.12);
    tmpEuler.set(-0.18, a + Math.PI * 0.25, -0.36, "YXZ");
    q.setFromEuler(tmpEuler);
    const sc = 0.85 + rand() * 0.45;
    mesh.setMatrixAt(i, m4.compose(v3.set(p.x, 0, p.z), q, s3.set(sc, sc, sc)));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  mesh.renderOrder = 2;
  mesh.name = "forest-sunbeams";
  scene.add(mesh);

  return {
    mesh,
    material,
    dispose() {
      scene.remove(mesh);
      mesh.dispose();
      geo.dispose();
      material.dispose();
      tex.dispose();
    },
  };
}

// ============================================================================
// PUBLIC MAPLE FOREST CONTROLLER
// ============================================================================

export interface MapleForest {
  update(daylight: number): void;
  dispose(): void;
}

export function createMapleForest(scene: Scene, materials: Materials, rand: () => number): MapleForest {
  const uTreeTime = { value: 0 };

  // 1. Shared PBR Bark & Bright, Fresh 24-Leaf Botanical Branchlet Foliage materials.
  const mapleLeafTex = drawBotanicalBranchletTexture(1024);
  const mapleBarkMat = new MeshStandardMaterial({
    map: materials.wood.map,
    normalMap: materials.wood.normalMap,
    roughnessMap: materials.wood.roughnessMap,
    normalScale: new Vector2(1.25, 1.25),
    vertexColors: true,
    color: new Color(0x94735a),
    roughness: 0.88,
    metalness: 0.0,
  });
  attachMapleBarkShader(mapleBarkMat, uTreeTime);

  const mapleFoliageMat = new MeshStandardMaterial({
    map: mapleLeafTex,
    vertexColors: true,
    color: new Color(0xffffff),
    alphaTest: 0.32,
    transparent: false,
    roughness: 0.68,
    metalness: 0.0,
    emissive: new Color(0x1f1106),
    emissiveIntensity: 0.06,
    side: DoubleSide,
  });
  attachMapleFoliageShader(mapleFoliageMat, uTreeTime);

  const mapleMats: Material[] = [mapleBarkMat, mapleFoliageMat];

  // 2. Build the 6 Botanical Tree Archetypes (grounded at y = 0) + the Wishing Tree geometry.
  const variantGeos = ARCHETYPE_SPECS.map((spec, idx) => buildArchetypeGeometry(spec, 0x800 + idx * 97));
  const wishTreeGeo = buildWishingTreeGeometry();

  // Mount the procedural Wishing Bodhi/Maple Tree outside the gate.
  const wishTreeFoliageMat = mapleFoliageMat.clone();
  wishTreeFoliageMat.color.setHex(TREE_VISUAL_CONFIG.wishTreeColor);
  attachMapleFoliageShader(wishTreeFoliageMat, uTreeTime);
  attachAncientTreeToWishingTree(wishTreeGeo, [mapleBarkMat, wishTreeFoliageMat]);

  // 3. Populate the 4-Tier Stepped Forest (all trunks grounded at baseY = -0.08m).
  const allRecords = buildSteppedForestLayout(rand);
  const byVariant: TreeInstanceRecord[][] = Array.from({ length: ARCHETYPE_SPECS.length }, () => []);
  for (const rec of allRecords) {
    byVariant[rec.variantIndex]?.push(rec);
  }

  const forest: InstancedMesh[] = [];
  variantGeos.forEach((geo, vIdx) => {
    const list = byVariant[vIdx] ?? [];
    if (list.length === 0) return;
    const spec = ARCHETYPE_SPECS[vIdx]!;
    const mesh = new InstancedMesh(geo, mapleMats, list.length);
    list.forEach((item, i) => {
      mesh.setMatrixAt(i, item.matrix);
      mesh.setColorAt(i, item.color);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = !IS_MOBILE && (vIdx === 2 || vIdx === 4 || vIdx === 5);
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    if (mesh.boundingSphere) {
      mesh.boundingSphere.radius += 6.0;
    }
    mesh.frustumCulled = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = `maple-archetype:${spec.id}`;
    scene.add(mesh);
    forest.push(mesh);
  });

  // 4. Diagonal golden sunbeams streaming across the trees and courtyard.
  const sunbeams = createForestSunbeams(scene, rand);

  return {
    update(daylight) {
      uTreeTime.value = performance.now() * 0.001;
      const leafEmissive = 0.05 + 0.07 * daylight;
      mapleFoliageMat.emissiveIntensity = leafEmissive;
      wishTreeFoliageMat.emissiveIntensity = leafEmissive;

      const beamAlpha = Math.max(0, (daylight - 0.3) / 0.7) * 0.18;
      sunbeams.mesh.visible = beamAlpha > 0.01;
      sunbeams.material.opacity = beamAlpha;
    },
    dispose() {
      for (const o of forest) {
        scene.remove(o);
        o.dispose();
      }
      for (const g of variantGeos) g.dispose();
      wishTreeGeo.dispose();
      sunbeams.dispose();
      mapleLeafTex.dispose();
      mapleBarkMat.dispose();
      mapleFoliageMat.dispose();
      wishTreeFoliageMat.dispose();
    },
  };
}
