import {
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Uint16BufferAttribute,
  Vector2,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { IS_MOBILE, maxAnisotropy } from "../engine/renderer.ts";
import { BONE, JOINT, createRig, type BoneName, type Rig } from "./rig.ts";

export type MonkDetail = "full" | "remote";

const SKIN = 0xd99d6c;
const SASH = 0xd9962e;
const SHOE = 0xd9d3c4;
/** Pants are the robe colour, a shade darker. */
const PANTS_SHADE = 0.82;

const HEAD_R = 0.23;
/** Head centre: sits on the neck joint, big and round (~40% of the 1.19 m height). */
const HEAD_Y = JOINT.head.y + 0.2;
/** Face patch radius over the head's. Its facets lie on the head's own grid, so a hair's gap is enough. */
const FACE_LIFT = 1.006;
/** Face patch size (radians): ~109° across, ~83° down from 45° below the crown. */
const FACE_SPAN_PHI = 1.9;
const FACE_SPAN_THETA = 1.45;
const FACE_THETA_START = 0.78;
/** Every non-face vertex samples this UV: a white texel of the face canvas, so vertex colour shows as is. */
const WHITE_UV = [0.02, 0.98] as const;

/** Robe silhouette (radius, height): wide hem, slight waist, rounded shoulders closing at the neck. */
const ROBE_PROFILE: readonly (readonly [number, number])[] = [
  [0.2, 0.27],
  [0.19, 0.34],
  [0.168, 0.44],
  [0.155, 0.52],
  [0.15, 0.6],
  [0.146, 0.66],
  [0.12, 0.71],
  [0.07, 0.745],
  [0.001, 0.752],
];

function robeRadiusAt(y: number): number {
  for (let i = 1; i < ROBE_PROFILE.length; i++) {
    const [r0, y0] = ROBE_PROFILE[i - 1] ?? [0, 0];
    const [r1, y1] = ROBE_PROFILE[i] ?? [0, 0];
    if (y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0 || 1);
  }
  return 0;
}

type Influence = readonly [BoneName, number];

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** Two-bone blend: t = 0 → a, t = 1 → b. */
function blend(a: BoneName, b: BoneName, t: number): Influence[] {
  const k = clamp01(t);
  return [[a, 1 - k], [b, k]];
}

/** Torso cloth (robe, sash) follows the spine by height; the hem also follows the thigh on its side. */
function robeWeights(x: number, y: number): Influence[] {
  if (y >= JOINT.chest.y + 0.04) return [["chest", 1]];
  if (y >= JOINT.spine.y + 0.04) return blend("spine", "chest", (y - (JOINT.spine.y + 0.04)) / 0.08);
  if (y >= JOINT.hips.y) return blend("hips", "spine", (y - JOINT.hips.y) / 0.1);
  // The skirt reaches the knees: its lower part swings with the thighs, the front/back middle with both
  // (a hard left/right split tears the hem open when both thighs fold forward to kneel).
  const legAmount = 0.6 * clamp01((JOINT.hips.y - y) / 0.16);
  const left = clamp01(0.5 + x / 0.28);
  return [
    ["hips", 1 - legAmount],
    ["thigh.L", legAmount * left],
    ["thigh.R", legAmount * (1 - left)],
  ];
}

interface Part {
  geometry: BufferGeometry;
  color: Color;
  weights: (x: number, y: number, z: number) => Influence[];
  /** Keep the geometry's own UVs (the face); others sample WHITE_UV. */
  keepUV?: boolean;
}

/** Fills color / skinIndex / skinWeight (and flattens UVs) so every part merges into one skinned geometry. */
function finishPart(p: Part): BufferGeometry {
  const g = p.geometry;
  const pos = g.getAttribute("position");
  const n = pos.count;
  const color = new Float32Array(n * 3);
  const skinIndex = new Uint16Array(n * 4);
  const skinWeight = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    color.set([p.color.r, p.color.g, p.color.b], i * 3);
    const inf = p.weights(pos.getX(i), pos.getY(i), pos.getZ(i)).filter(([, w]) => w > 0).slice(0, 4);
    const total = inf.reduce((s, [, w]) => s + w, 0) || 1;
    inf.forEach(([bone, w], k) => {
      skinIndex[i * 4 + k] = BONE[bone];
      skinWeight[i * 4 + k] = w / total;
    });
  }
  g.setAttribute("color", new Float32BufferAttribute(color, 3));
  g.setAttribute("skinIndex", new Uint16BufferAttribute(skinIndex, 4));
  g.setAttribute("skinWeight", new Float32BufferAttribute(skinWeight, 4));
  if (!p.keepUV) {
    const uv = g.getAttribute("uv");
    for (let i = 0; i < uv.count; i++) uv.setXY(i, WHITE_UV[0], WHITE_UV[1]);
  }
  return g;
}

/** Diagonal saffron sash over the robe front: a straight-edged band from the left shoulder down to the right hip. */
function sashGeometry(cols: number, rows: number): BufferGeometry {
  // Band in (u, y): u = -1 right side … +1 left side of the front; centre line rises towards the left shoulder.
  const centre = (u: number): number => 0.53 + 0.17 * u;
  const halfWidth = 0.08;
  const halfArc = Math.PI * 0.55;
  const top = 0.735;
  const pos: number[] = [];
  const clamped: boolean[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= cols; i++) {
    const u = -1 + (2 * i) / cols;
    const phi = u * halfArc;
    for (let j = 0; j <= rows; j++) {
      // Clamp to the robe (the band must not run past the neck or below the hem).
      const raw = centre(u) - halfWidth + (2 * halfWidth * j) / rows;
      const y = Math.min(top, raw);
      clamped.push(raw >= top);
      const r = robeRadiusAt(y) + 0.008;
      pos.push(r * Math.sin(phi), y, r * Math.cos(phi));
    }
  }
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j;
      const b = a + rows + 1;
      // Both rows squashed onto the neckline: the cell has no area.
      if (clamped[a] && clamped[b] && clamped[a + 1] && clamped[b + 1]) continue;
      // a → b runs towards +x (left), a → a+1 upwards: counter-clockwise seen from the front.
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Limb segment from joint a down to joint b (bind pose is straight down). */
function limb(radiusTop: number, radiusBottom: number, x: number, yTop: number, yBottom: number, seg: number): BufferGeometry {
  const g = new CylinderGeometry(radiusTop, radiusBottom, yTop - yBottom, seg, 1);
  g.translate(x, (yTop + yBottom) / 2, 0);
  return g;
}

function paintGeometry(g: BufferGeometry, hex: number): BufferGeometry {
  const c = new Color(hex);
  const n = g.getAttribute("position").count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return g;
}

/** Handheld wooden temple block ("Cái mõ") cradled on top of the left palm (`hand.L`). */
function createWoodblockPropGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];

  // Brocade cushion ring resting in the upturned left palm.
  const pad = new TorusGeometry(0.044, 0.014, 8, 18);
  pad.rotateX(Math.PI / 2);
  pad.translate(-0.02, -0.04, 0.032);
  parts.push(paintGeometry(pad, 0x9e2b22));

  // Carved hollow wooden body sitting clearly above the cushion.
  const body = new SphereGeometry(0.068, 18, 14);
  body.scale(1.18, 0.88, 0.92);
  body.translate(-0.02, -0.045, 0.078);
  parts.push(paintGeometry(body, 0xa45729));

  // Upper strike dome (warm polished wood).
  const crest = new SphereGeometry(0.052, 14, 10);
  crest.scale(1.08, 0.78, 0.75);
  crest.translate(-0.02, -0.048, 0.105);
  parts.push(paintGeometry(crest, 0xc26e38));

  // Acoustic slit groove + side eyes of the traditional fish woodblock (Mõ cá).
  const slit = new CylinderGeometry(0.014, 0.014, 0.115, 8);
  slit.rotateZ(Math.PI / 2);
  slit.scale(1, 0.35, 0.65);
  slit.translate(-0.02, -0.095, 0.075);
  parts.push(paintGeometry(slit, 0x261109));

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: woodblock prop");
  merged.computeVertexNormals();
  return merged;
}

/** Handheld wooden striker ("Dùi mõ") gripped in the right hand (`hand.R`) and angled to strike down & inward. */
function createMalletPropGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];

  // Wooden shaft extending forward (-Y in hand bone space) and inward (+X toward left hand).
  const shaft = new CylinderGeometry(0.011, 0.014, 0.17, 10);
  shaft.rotateZ(0.62);
  shaft.rotateX(0.28);
  shaft.translate(0.045, -0.075, 0.035);
  parts.push(paintGeometry(shaft, 0x5c2e14));

  // Gold pommel cap at the grip end.
  const pommel = new SphereGeometry(0.017, 8, 8);
  pommel.translate(-0.005, -0.012, 0.015);
  parts.push(paintGeometry(pommel, 0xd9962e));

  // Rounded red-lacquered striker head at the tip of the mallet.
  const head = new SphereGeometry(0.026, 12, 10);
  head.scale(1.2, 1.0, 1.0);
  head.translate(0.095, -0.138, 0.055);
  parts.push(paintGeometry(head, 0xb83723));

  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: mallet prop");
  merged.computeVertexNormals();
  return merged;
}

/**
 * The novice's body as one skinned geometry (vertex colours + face UVs), in the bind pose of createRig().
 * `remote` uses ≥ 3× fewer segments for other people.
 */
export function createMonkGeometry(robeColor: Color, detail: MonkDetail): BufferGeometry {
  const s = (n: number): number => (detail === "full" ? n : Math.max(3, Math.round(n / 3)));
  const skin = new Color(SKIN);
  const sash = new Color(SASH);
  const shoe = new Color(SHOE);
  const pants = robeColor.clone().multiplyScalar(PANTS_SHADE);
  const parts: Part[] = [];
  const head = (): Influence[] => [["head", 1]];

  // Head + face patch (front cap carrying the face canvas) + ears.
  // The patch reuses the head's grid lines: with its own (coarser) grid, head vertices poke through its flat facets
  // (5 mm on the remote LOD).
  const headW = s(28);
  const headH = s(20);
  const stepPhi = (Math.PI * 2) / headW;
  const stepTheta = Math.PI / headH;
  const faceW = Math.max(2, Math.round(FACE_SPAN_PHI / stepPhi));
  const faceH = Math.max(2, Math.round(FACE_SPAN_THETA / stepTheta));
  const facePhi0 = Math.PI / 2 - (faceW * stepPhi) / 2;
  const faceTheta0 = Math.round(FACE_THETA_START / stepTheta) * stepTheta;
  parts.push({ geometry: new SphereGeometry(HEAD_R, headW, headH, facePhi0).translate(0, HEAD_Y, 0), color: skin, weights: head });
  const face = new SphereGeometry(HEAD_R * FACE_LIFT, faceW, faceH, facePhi0, faceW * stepPhi, faceTheta0, faceH * stepTheta);
  parts.push({ geometry: face.translate(0, HEAD_Y, 0), color: skin, weights: head, keepUV: true });
  for (const side of [1, -1]) {
    const ear = new SphereGeometry(0.045, s(10), s(7));
    ear.scale(0.6, 1, 0.8).translate(side * HEAD_R * 0.97, HEAD_Y - 0.01, -0.01);
    parts.push({ geometry: ear, color: skin, weights: head });
  }

  // Robe + sash.
  const robe = new LatheGeometry(ROBE_PROFILE.map(([r, y]) => new Vector2(r, y)), s(24));
  parts.push({ geometry: robe, color: robeColor, weights: (x, y) => robeWeights(x, y) });
  parts.push({ geometry: sashGeometry(s(24), s(3)), color: sash, weights: (x, y) => robeWeights(x, y) });

  for (const side of [1, -1] as const) {
    const L = side === 1;
    const sx = side * JOINT.shoulder.x;
    const upper: BoneName = L ? "upper_arm.L" : "upper_arm.R";
    const fore: BoneName = L ? "forearm.L" : "forearm.R";
    const hand: BoneName = L ? "hand.L" : "hand.R";
    const thigh: BoneName = L ? "thigh.L" : "thigh.R";
    const shin: BoneName = L ? "shin.L" : "shin.R";
    const foot: BoneName = L ? "foot.L" : "foot.R";

    // Wide sleeves; the elbow bends smoothly over ±3 cm.
    const elbowBlend = (_x: number, y: number): Influence[] => blend(upper, fore, (JOINT.elbow.y + 0.03 - y) / 0.06);
    // Rounded shoulder so the sleeve does not end in a flat cap above the robe.
    const shoulder = new SphereGeometry(0.048, s(12), s(8)).translate(sx, JOINT.shoulder.y, 0);
    parts.push({ geometry: shoulder, color: robeColor, weights: () => blend("chest", upper, 0.7) });
    parts.push({ geometry: limb(0.046, 0.055, sx, JOINT.shoulder.y, JOINT.elbow.y, s(12)), color: robeColor, weights: elbowBlend });
    parts.push({ geometry: limb(0.055, 0.06, sx, JOINT.elbow.y, JOINT.wrist.y + 0.02, s(12)), color: robeColor, weights: elbowBlend });
    const palm = new SphereGeometry(0.042, s(12), s(9));
    palm.scale(0.9, 1.1, 0.9).translate(sx, JOINT.wrist.y - 0.02, 0);
    parts.push({ geometry: palm, color: skin, weights: () => [[hand, 1]] });

    // Pants and cloth shoes.
    const hx = side * JOINT.hip.x;
    const kneeBlend = (_x: number, y: number): Influence[] => blend(thigh, shin, (JOINT.knee.y + 0.03 - y) / 0.06);
    parts.push({ geometry: limb(0.07, 0.066, hx, JOINT.hip.y, JOINT.knee.y, s(12)), color: pants, weights: kneeBlend });
    parts.push({ geometry: limb(0.066, 0.058, hx, JOINT.knee.y, JOINT.ankle.y - 0.01, s(12)), color: pants, weights: kneeBlend });
    const shoeGeo = new SphereGeometry(1, s(12), s(9));
    shoeGeo.scale(0.066, 0.047, 0.1).translate(hx, 0.045, 0.025);
    parts.push({ geometry: shoeGeo, color: shoe, weights: () => [[foot, 1]] });
  }

  const finished = parts.map(finishPart);
  const merged = mergeGeometries(finished);
  for (const g of finished) g.dispose();
  if (!merged) throw new Error("merge: monk parts");
  merged.computeBoundingSphere();
  return merged;
}

/** Closed, smiling eyes and rosy cheeks on white; multiplied by the skin vertex colour. */
export function drawFace(size = 512): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  const u = size / 256;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  // Cheeks.
  ctx.fillStyle = "rgba(235,120,110,0.35)";
  for (const x of [78, 178]) {
    ctx.beginPath();
    ctx.ellipse(x * u, 150 * u, 20 * u, 12 * u, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Closed eyes: downward arcs (calm, smiling).
  ctx.strokeStyle = "#3b2a22";
  ctx.lineCap = "round";
  ctx.lineWidth = 6 * u;
  for (const x of [92, 164]) {
    ctx.beginPath();
    ctx.arc(x * u, 118 * u, 15 * u, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }
  // Small smile.
  ctx.lineWidth = 4.5 * u;
  ctx.beginPath();
  ctx.arc(128 * u, 154 * u, 13 * u, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAnisotropy();
  return tex;
}

export interface MonkModel {
  readonly mesh: SkinnedMesh;
  readonly rig: Rig;
  setColor(robeColor: string): void;
  setWoodblockVisible?(visible: boolean): void;
  dispose(): void;
}

/**
 * Builds novices. Geometry is cached per (robe colour, detail) and shared between avatars;
 * each avatar gets its own bones + Skeleton. One material and face texture for everyone.
 */
export class MonkFactory {
  private readonly geometries = new Map<string, BufferGeometry>();
  private readonly face = drawFace(IS_MOBILE ? 384 : 512);
  private readonly woodblockPropGeo = createWoodblockPropGeometry();
  private readonly malletPropGeo = createMalletPropGeometry();
  private readonly propMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.52, metalness: 0.08 });
  readonly material = new MeshStandardMaterial({ vertexColors: true, map: this.face, roughness: 0.8, metalness: 0 });

  private getGeometry(robeColor: string, detail: MonkDetail): BufferGeometry {
    const key = `${robeColor}|${detail}`;
    let geometry = this.geometries.get(key);
    if (!geometry) {
      geometry = createMonkGeometry(new Color(robeColor), detail);
      this.geometries.set(key, geometry);
    }
    return geometry;
  }

  create(robeColor: string, detail: MonkDetail): MonkModel {
    let currentColor = robeColor;
    const geometry = this.getGeometry(robeColor, detail);
    const rig = createRig();
    const mesh = new SkinnedMesh(geometry, this.material);
    mesh.name = `monk:${detail}`;
    mesh.add(rig.root);
    mesh.updateMatrixWorld(true);
    const skeleton = new Skeleton([...rig.list]);
    mesh.bind(skeleton);
    mesh.castShadow = detail === "full";
    mesh.receiveShadow = true;

    const woodblockMesh = new Mesh(this.woodblockPropGeo, this.propMaterial);
    woodblockMesh.name = "prop:woodblock";
    woodblockMesh.visible = false;
    woodblockMesh.castShadow = false;
    rig.bones["hand.L"].add(woodblockMesh);

    const malletMesh = new Mesh(this.malletPropGeo, this.propMaterial);
    malletMesh.name = "prop:mallet";
    malletMesh.visible = false;
    malletMesh.castShadow = false;
    rig.bones["hand.R"].add(malletMesh);

    return {
      mesh,
      rig,
      setColor: (nextColor: string) => {
        if (nextColor === currentColor) return;
        currentColor = nextColor;
        const prevSphere = mesh.boundingSphere;
        mesh.geometry = this.getGeometry(nextColor, detail);
        if (prevSphere) mesh.boundingSphere = prevSphere;
      },
      setWoodblockVisible: (visible: boolean) => {
        if (woodblockMesh.visible === visible) return;
        woodblockMesh.visible = visible;
        malletMesh.visible = visible;
      },
      dispose() {
        woodblockMesh.removeFromParent();
        malletMesh.removeFromParent();
        mesh.removeFromParent();
        skeleton.dispose();
      },
    };
  }

  dispose(): void {
    for (const g of this.geometries.values()) g.dispose();
    this.geometries.clear();
    this.woodblockPropGeo.dispose();
    this.malletPropGeo.dispose();
    this.propMaterial.dispose();
    this.material.dispose();
    this.face.dispose();
  }
}
