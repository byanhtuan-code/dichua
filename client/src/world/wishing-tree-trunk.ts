import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { maxAnisotropy } from "../engine/renderer.ts";
import { seeded } from "./random.ts";

const m4 = new Matrix4();
const q = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();
const tmpEuler = new Euler();
const UP = new Vector3(0, 1, 0);

/** Anchor point directly on the underside of a low or mid bough where plaques/lanterns/chimes hang. */
export interface BoughHangAnchor {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly branchRadius: number;
  readonly branchYaw: number;
  readonly tier: "low" | "mid";
}

export function paintGeom(g: BufferGeometry, hex: number): BufferGeometry {
  const c = new Color(hex);
  const pos = g.getAttribute("position");
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return g;
}

// ============================================================================
// 1. PROCEDURAL PBR TEXTURES: ANCIENT MOSSY BARK & SACRED BODHI/BANYAN FOLIAGE
// ============================================================================

/**
 * Draws a high-detail 1024x1024 seamless ancient bark texture with deep vertical fissures,
 * peeling bark plates, natural knot scars, and lush green moss in the crevices.
 */
export function drawAncientBarkTexture(size = 1024): {
  colorMap: CanvasTexture;
  bumpMap: CanvasTexture;
} {
  const cCanvas = document.createElement("canvas");
  const bCanvas = document.createElement("canvas");
  cCanvas.width = bCanvas.width = size;
  cCanvas.height = bCanvas.height = size;
  const ctx = cCanvas.getContext("2d");
  const btx = bCanvas.getContext("2d");
  if (!ctx || !btx) throw new Error("2d canvas unavailable");

  const rand = seeded(0x88b0de1);

  // Base bark gradient (deep wood brown, weathered grey-brown, warm reddish-brown)
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, "#3b2618");
  bg.addColorStop(0.35, "#4d3628");
  bg.addColorStop(0.7, "#453830");
  bg.addColorStop(1, "#382216");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  btx.fillStyle = "#808080";
  btx.fillRect(0, 0, size, size);

  // Vertical bark ridges & deep irregular crevices
  for (let i = 0; i < 140; i++) {
    const x0 = rand() * size;
    const w = 4 + rand() * 18;
    const isCrevice = i % 3 === 0;
    ctx.strokeStyle = isCrevice
      ? "rgba(22, 12, 7, 0.78)"
      : i % 2 === 0
        ? "rgba(92, 66, 48, 0.42)"
        : "rgba(110, 88, 72, 0.35)";
    ctx.lineWidth = w;
    ctx.lineCap = "round";

    btx.strokeStyle = isCrevice ? "rgba(20, 20, 20, 0.85)" : "rgba(225, 225, 225, 0.55)";
    btx.lineWidth = w;
    btx.lineCap = "round";

    ctx.beginPath();
    btx.beginPath();
    let cx = x0;
    ctx.moveTo(cx, 0);
    btx.moveTo(cx, 0);
    for (let y = 0; y <= size; y += 64) {
      cx += (rand() - 0.5) * 22;
      ctx.lineTo(cx, y);
      btx.lineTo(cx, y);
    }
    ctx.stroke();
    btx.stroke();
  }

  // Peeling bark scales & natural tree scars / knots (vết sẹo gỗ cổ thụ)
  for (let k = 0; k < 18; k++) {
    const kx = rand() * size;
    const ky = rand() * size;
    const rx = 18 + rand() * 34;
    const ry = 28 + rand() * 56;

    ctx.save();
    ctx.translate(kx, ky);
    ctx.rotate((rand() - 0.5) * 0.4);
    ctx.strokeStyle = "rgba(20, 11, 6, 0.82)";
    ctx.lineWidth = 4.5;
    ctx.fillStyle = k % 2 === 0 ? "rgba(68, 42, 28, 0.65)" : "rgba(78, 64, 52, 0.58)";
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = "rgba(32, 18, 10, 0.6)";
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 0.55, ry * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Velvet green moss colonizing the bark crevices & lower root hollows
  for (let m = 0; m < 65; m++) {
    const mx = rand() * size;
    const my = rand() * size;
    const mr = 14 + rand() * 44;
    const mg = ctx.createRadialGradient(mx, my, mr * 0.1, mx, my, mr);
    mg.addColorStop(0, "rgba(62, 115, 42, 0.72)");
    mg.addColorStop(0.55, "rgba(45, 88, 32, 0.48)");
    mg.addColorStop(1, "rgba(35, 68, 24, 0.0)");
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.ellipse(mx, my, mr * 0.65, mr * 1.35, (rand() - 0.5) * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  const aniso = maxAnisotropy();
  const colorMap = new CanvasTexture(cCanvas);
  colorMap.colorSpace = SRGBColorSpace;
  colorMap.wrapS = colorMap.wrapT = RepeatWrapping;
  colorMap.anisotropy = aniso;

  const bumpMap = new CanvasTexture(bCanvas);
  bumpMap.wrapS = bumpMap.wrapT = RepeatWrapping;
  bumpMap.anisotropy = aniso;

  return { colorMap, bumpMap };
}

/**
 * Draws a 1024x1024 botanical branchlet of sacred Bodhi / Ancient Banyan leaves
 * (heart-ovate leaves with acuminate drip-tips, fine lateral veins, and woody twigs).
 */
export function drawSacredCanopyTexture(size = 1024): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.clearRect(0, 0, size, size);

  const rand = seeded(0xb0de777);

  // Branchlet twigs
  ctx.strokeStyle = "#422918";
  ctx.lineCap = "round";
  const twigs: readonly [number, number, number, number, number, number, number][] = [
    [0.5, 0.94, 0.49, 0.56, 0.5, 0.14, 0.011],
    [0.49, 0.75, 0.31, 0.64, 0.14, 0.5, 0.0075],
    [0.5, 0.7, 0.69, 0.6, 0.86, 0.46, 0.0075],
    [0.49, 0.5, 0.32, 0.39, 0.17, 0.25, 0.0062],
    [0.5, 0.46, 0.68, 0.35, 0.83, 0.23, 0.0062],
  ];
  for (const [x0, y0, cx, cy, x1, y1, w] of twigs) {
    ctx.lineWidth = size * w;
    ctx.beginPath();
    ctx.moveTo(size * x0, size * y0);
    ctx.quadraticCurveTo(size * cx, size * cy, size * x1, size * y1);
    ctx.stroke();
  }

  /** Draws one sacred heart-shaped Bodhi leaf with a long drip-tip and pinnate veins. */
  const drawSacredBodhiLeaf = (
    cx: number,
    cy: number,
    radius: number,
    rot: number,
    brightness: number,
  ): void => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    ctx.strokeStyle = "#54341e";
    ctx.lineWidth = Math.max(1.4, radius * 0.04);
    ctx.beginPath();
    ctx.moveTo(0, radius * 0.48);
    ctx.quadraticCurveTo(radius * 0.03, radius * 0.28, 0, radius * 0.12);
    ctx.stroke();

    const w = radius * 0.72;
    const h = radius * 1.18;

    ctx.beginPath();
    ctx.moveTo(0, radius * 0.18);
    ctx.bezierCurveTo(-w * 0.55, radius * 0.32, -w * 1.08, -h * 0.05, -w * 0.85, -h * 0.46);
    ctx.bezierCurveTo(-w * 0.62, -h * 0.76, -w * 0.14, -h * 0.88, 0, -h * 1.14);
    ctx.bezierCurveTo(w * 0.14, -h * 0.88, w * 0.62, -h * 0.76, w * 0.85, -h * 0.46);
    ctx.bezierCurveTo(w * 1.08, -h * 0.05, w * 0.55, radius * 0.32, 0, radius * 0.18);
    ctx.closePath();

    const b0 = Math.round(206 * brightness);
    const b1 = Math.round(238 * brightness);
    const b2 = Math.min(255, Math.round(252 * brightness));

    const grad = ctx.createRadialGradient(0, -h * 0.25, radius * 0.08, 0, -h * 0.38, radius * 1.1);
    grad.addColorStop(0, `rgb(${b0}, ${b0 - 2}, ${b0 - 8})`);
    grad.addColorStop(0.65, `rgb(${b1}, ${b1}, ${b1 - 4})`);
    grad.addColorStop(1, `rgb(${b2}, ${b2}, ${b2})`);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = Math.max(1.3, radius * 0.025);
    ctx.strokeStyle = `rgba(${Math.round(125 * brightness)}, ${Math.round(118 * brightness)}, ${Math.round(98 * brightness)}, 0.55)`;
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 253, 236, 0.62)";
    ctx.lineWidth = Math.max(1.3, radius * 0.024);
    ctx.beginPath();
    ctx.moveTo(0, radius * 0.16);
    ctx.lineTo(0, -h * 1.02);
    ctx.stroke();

    ctx.lineWidth = Math.max(0.9, radius * 0.015);
    for (let v = 1; v <= 5; v++) {
      const t = v / 5.8;
      const vy = radius * 0.08 - t * h * 0.82;
      const vw = w * Math.sin((1 - t * 0.72) * Math.PI * 0.5) * 0.78;
      ctx.beginPath();
      ctx.moveTo(0, vy);
      ctx.quadraticCurveTo(-vw * 0.55, vy - h * 0.04, -vw, vy - h * 0.15);
      ctx.moveTo(0, vy);
      ctx.quadraticCurveTo(vw * 0.55, vy - h * 0.04, vw, vy - h * 0.15);
      ctx.stroke();
    }

    ctx.restore();
  };

  const underLeaves: readonly [number, number, number, number, number][] = [
    [0.5, 0.52, 0.145, 0.0, 0.86],
    [0.35, 0.46, 0.14, -0.48, 0.85],
    [0.65, 0.46, 0.14, 0.48, 0.85],
    [0.34, 0.64, 0.14, -0.82, 0.84],
    [0.66, 0.64, 0.14, 0.82, 0.84],
    [0.5, 0.34, 0.14, -0.08, 0.88],
    [0.25, 0.38, 0.135, -0.7, 0.87],
    [0.75, 0.36, 0.135, 0.7, 0.87],
    [0.42, 0.68, 0.13, -1.35, 0.85],
    [0.58, 0.68, 0.13, 1.35, 0.85],
  ];
  for (const [x, y, r, rot, br] of underLeaves) {
    drawSacredBodhiLeaf(x * size, y * size, r * size, rot + (rand() - 0.5) * 0.12, br);
  }

  const outerLeaves: readonly [number, number, number, number, number][] = [
    [0.5, 0.15, 0.145, 0.0, 1.0],
    [0.37, 0.21, 0.135, -0.42, 0.98],
    [0.63, 0.21, 0.135, 0.42, 0.98],
    [0.18, 0.24, 0.14, -0.68, 0.99],
    [0.82, 0.22, 0.14, 0.68, 0.99],
    [0.29, 0.34, 0.135, -0.48, 0.96],
    [0.71, 0.32, 0.135, 0.48, 0.96],
    [0.15, 0.41, 0.135, -1.05, 0.95],
    [0.85, 0.39, 0.135, 1.05, 0.95],
    [0.15, 0.55, 0.14, -1.15, 0.96],
    [0.85, 0.52, 0.14, 1.15, 0.96],
    [0.27, 0.54, 0.135, -0.72, 0.97],
    [0.73, 0.52, 0.135, 0.72, 0.97],
    [0.26, 0.69, 0.13, -1.52, 0.93],
    [0.74, 0.67, 0.13, 1.52, 0.93],
    [0.5, 0.42, 0.14, 0.1, 1.0],
  ];
  for (const [x, y, r, rot, br] of outerLeaves) {
    drawSacredBodhiLeaf(x * size, y * size, r * size, rot + (rand() - 0.5) * 0.1, br);
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAnisotropy();
  return tex;
}

// ============================================================================
// 2. GNARLED SPLINE TUBES FOR ANCIENT TRUNK, TWISTING ROOTS & BOUGHS
// ============================================================================

export function sampleSpline(controlPts: readonly Vector3[], subdivisions: number): Vector3[] {
  const n = controlPts.length;
  if (n < 2) return [...controlPts];
  const out: Vector3[] = [];
  for (let i = 0; i <= subdivisions; i++) {
    const tGlobal = (i / subdivisions) * (n - 1);
    const seg = Math.min(n - 2, Math.floor(tGlobal));
    const t = tGlobal - seg;

    const p0 = controlPts[Math.max(0, seg - 1)]!;
    const p1 = controlPts[seg]!;
    const p2 = controlPts[seg + 1]!;
    const p3 = controlPts[Math.min(n - 1, seg + 2)]!;

    const t2 = t * t;
    const t3 = t2 * t;

    const x =
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
    const y =
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
    const z =
      0.5 *
      (2 * p1.z +
        (-p0.z + p2.z) * t +
        (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 +
        (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3);

    out.push(new Vector3(x, y, z));
  }
  return out;
}

export function buildGnarledWoodTube(
  controlPts: readonly Vector3[],
  rStart: number,
  rEnd: number,
  lengthSegs: number,
  radialSegs: number,
  baseHex: number,
  topHex: number,
  gnarlAmp = 0.14,
  flareBase = false,
): BufferGeometry {
  const points = sampleSpline(controlPts, lengthSegs);
  const rings = points.length;
  const cols = radialSegs + 1;
  const vCount = rings * cols;
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const col = new Float32Array(vCount * 3);

  const c0 = new Color(baseHex);
  const c1 = new Color(topHex);
  const cMoss = new Color(0x3f6b2c);
  const cTmp = new Color();

  const tangent = new Vector3();
  const normal = new Vector3();
  const binormal = new Vector3();
  let vDist = 0;

  for (let i = 0; i < rings; i++) {
    const curr = points[i]!;
    if (i > 0) {
      vDist += curr.distanceTo(points[i - 1]!);
    }
    const prev = points[Math.max(0, i - 1)]!;
    const next = points[Math.min(rings - 1, i + 1)]!;
    tangent.subVectors(next, prev).normalize();

    const ref = Math.abs(tangent.y) > 0.92 ? new Vector3(1, 0, 0) : UP;
    binormal.crossVectors(tangent, ref).normalize();
    normal.crossVectors(binormal, tangent).normalize();

    const tFrac = i / Math.max(1, rings - 1);
    const flare = flareBase && tFrac < 0.28 ? 1 + 0.46 * Math.pow(1 - tFrac / 0.28, 2) : 1.0;
    const baseR = (rStart * Math.pow(1 - tFrac, 0.82) + rEnd * tFrac) * flare;

    for (let j = 0; j <= radialSegs; j++) {
      const uFrac = j / radialSegs;
      const theta = uFrac * Math.PI * 2;
      const ca = Math.cos(theta);
      const sa = Math.sin(theta);

      const flute5 = Math.sin(theta * 5 + tFrac * 3.8);
      const flute3 = Math.cos(theta * 3 - tFrac * 5.2);
      const gnarl = 1 + gnarlAmp * (0.65 * flute5 + 0.35 * flute3);
      const r = baseR * gnarl;

      const nx = normal.x * ca + binormal.x * sa;
      const ny = normal.y * ca + binormal.y * sa;
      const nz = normal.z * ca + binormal.z * sa;

      const idx = i * cols + j;
      pos[idx * 3] = curr.x + nx * r;
      pos[idx * 3 + 1] = curr.y + ny * r;
      pos[idx * 3 + 2] = curr.z + nz * r;

      nrm[idx * 3] = nx;
      nrm[idx * 3 + 1] = ny;
      nrm[idx * 3 + 2] = nz;

      uv[idx * 2] = uFrac * 2.5;
      uv[idx * 2 + 1] = vDist * 0.55;

      cTmp.lerpColors(c0, c1, tFrac);
      if (flute5 < -0.25 && curr.y < 3.8) {
        cTmp.lerp(cMoss, Math.min(0.45, (-flute5 - 0.25) * 0.55));
      }
      col[idx * 3] = cTmp.r;
      col[idx * 3 + 1] = cTmp.g;
      col[idx * 3 + 2] = cTmp.b;
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setIndex(indices);
  return g;
}
// ============================================================================
// 3. MULTI-TIERED ASYMMETRIC CANOPY WITH 5 NATURAL COLOR ZONES (NO SPHERES!)
// ============================================================================

const CANOPY_ZONE_COLORS = [
  0x2b6329, // 1. Xanh rêu đậm (Deep Moss Green)
  0x2e7d67, // 2. Xanh ngọc (Sacred Jade Green)
  0x80a62e, // 3. Xanh vàng (Chartreuse Olive)
  0xe09b22, // 4. Vàng hổ phách (Warm Amber Gold)
  0xe87a28, // 5. Vàng cam nhẹ (Soft Autumn Apricot)
] as const;

function buildSacredFoliageCard(
  ax: number,
  ay: number,
  az: number,
  width: number,
  length: number,
  arch: number,
  yaw: number,
  pitch: number,
  roll: number,
  innerColor: Color,
  outerColor: Color,
  clusterCenter: Vector3,
): BufferGeometry {
  const segs = 2;
  const cols = segs + 1;
  const vCount = cols * cols;
  const pos = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const col = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const cTmp = new Color();
  const uvPt = new Vector2();

  tmpEuler.set(pitch, yaw, roll, "YXZ");
  q.setFromEuler(tmpEuler);

  for (let iy = 0; iy <= segs; iy++) {
    const v = iy / segs;
    const lz = (0.24 - v) * length;
    for (let ix = 0; ix <= segs; ix++) {
      const u = ix / segs;
      uvPt.set(u, v);
      const lx = (uvPt.x - 0.5) * width;
      const archCurve = Math.sin(uvPt.y * Math.PI) * arch - (uvPt.x - 0.5) * (uvPt.x - 0.5) * arch * 0.85;

      v3.set(lx, archCurve, lz).applyQuaternion(q);
      const wx = ax + v3.x;
      const wy = ay + v3.y;
      const wz = az + v3.z;

      const idx = iy * cols + ix;
      pos[idx * 3] = wx;
      pos[idx * 3 + 1] = wy;
      pos[idx * 3 + 2] = wz;

      uv[idx * 2] = uvPt.x;
      uv[idx * 2 + 1] = uvPt.y;

      cTmp.lerpColors(innerColor, outerColor, uvPt.y);
      col[idx * 3] = cTmp.r;
      col[idx * 3 + 1] = cTmp.g;
      col[idx * 3 + 2] = cTmp.b;

      const nx = wx - clusterCenter.x;
      const ny = wy - clusterCenter.y + 0.55;
      const nz = wz - clusterCenter.z;
      const len = Math.hypot(nx, ny, nz) || 1;
      nrm[idx * 3] = nx / len;
      nrm[idx * 3 + 1] = ny / len;
      nrm[idx * 3 + 2] = nz / len;
    }
  }

  const indices: number[] = [];
  for (let iy = 0; iy < segs; iy++) {
    for (let ix = 0; ix < segs; ix++) {
      const a = iy * cols + ix;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new Float32BufferAttribute(nrm, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  g.setIndex(indices);
  return g;
}

function buildSacredCanopySpray(
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  droop: number,
  frondCount: number,
  zoneIdx: number,
  rand: () => number,
): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const center = new Vector3(cx, cy, cz);

  const baseHex = CANOPY_ZONE_COLORS[zoneIdx % CANOPY_ZONE_COLORS.length]!;
  const nextHex = CANOPY_ZONE_COLORS[(zoneIdx + 1) % CANOPY_ZONE_COLORS.length]!;

  const innerCol = new Color(baseHex).multiplyScalar(0.84);
  const midCol = new Color(baseHex).lerp(new Color(nextHex), 0.35);
  const outerCol = new Color(baseHex).lerp(new Color(nextHex), 0.65).multiplyScalar(1.12);

  for (let i = 0; i < 2; i++) {
    const a = i * 1.57 + rand() * 0.45;
    const w = radius * (0.92 + rand() * 0.14);
    const len = radius * (0.96 + rand() * 0.14);
    parts.push(
      buildSacredFoliageCard(cx, cy - 0.03, cz, w, len, 0.2, a, 0.26 + droop * 0.18, (rand() - 0.5) * 0.2, innerCol, midCol, center),
    );
  }

  for (let i = 0; i < frondCount; i++) {
    const a = (i / frondCount) * Math.PI * 2 + (rand() - 0.5) * 0.26;
    const baseOffset = radius * 0.12;
    const w = radius * (0.96 + rand() * 0.18);
    const len = radius * (1.05 + (i % 2) * 0.15);
    const pitch = 0.22 + droop * 0.26 + (i % 2) * 0.12 + (rand() - 0.5) * 0.08;
    const roll = (rand() - 0.5) * 0.2;

    parts.push(
      buildSacredFoliageCard(
        cx + Math.cos(a) * baseOffset,
        cy + (i % 2 === 0 ? 0.04 : -0.04),
        cz + Math.sin(a) * baseOffset,
        w,
        len,
        0.22,
        a,
        pitch,
        roll,
        midCol,
        outerCol,
        center,
      ),
    );
  }

  parts.push(
    buildSacredFoliageCard(
      cx,
      cy + 0.14,
      cz,
      radius * 0.9,
      radius * 0.94,
      0.22,
      rand() * Math.PI * 2,
      -0.08 + droop * 0.14,
      (rand() - 0.5) * 0.18,
      midCol,
      outerCol,
      center,
    ),
  );

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: sacred canopy spray");
  return merged;
}

// ============================================================================
// 4. SACRED BASE SANCTUARY (WALKABLE SLAB HEIGHTS MATCHING `SLAB_TOP = 0.05m`)
// ============================================================================

const PRAY_ANGLE = -1.22;

/**
 * Keeps all roots & earth within `localZ <= 3.45m` so nothing pokes through the gate wall.
 */
function clampClearOfGateWall(g: BufferGeometry): BufferGeometry {
  const pos = g.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    if (z > 3.45) {
      pos.setZ(i, 3.45);
    }
  }
  return g;
}

function buildMossyBoulder(rx: number, ry: number, rz: number, seed: number, hex: number): BufferGeometry {
  const g = new SphereGeometry(1, 10, 7);
  const pos = g.getAttribute("position");
  const cBase = new Color(hex);
  const cMoss = new Color(0x3a6e28);
  const cTmp = new Color();
  const cols = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = 1 + 0.18 * Math.sin(3.2 * x + seed) * Math.cos(2.7 * z + seed * 1.4) + 0.09 * Math.cos(4.5 * y + seed);
    const ny = Math.max(-0.42, y);
    pos.setXYZ(i, x * rx * n, ny * ry * n, z * rz * n);

    const mossFactor = Math.max(0, Math.min(1, (y + 0.15) * 0.75));
    cTmp.lerpColors(cBase, cMoss, mossFactor * 0.65);
    cols[i * 3] = cTmp.r;
    cols[i * 3 + 1] = cTmp.g;
    cols[i * 3 + 2] = cTmp.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

function buildBurlGeometry(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, seed: number): BufferGeometry {
  const g = new SphereGeometry(1, 8, 6);
  const pos = g.getAttribute("position");
  const cols = new Float32Array(pos.count * 3);
  const cKnot = new Color(0x4a2f1d);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ripple = 1 + 0.15 * Math.sin(x * 4 + seed) * Math.cos(y * 4 - seed);
    pos.setXYZ(i, cx + x * rx * ripple, cy + y * ry * ripple, cz + z * rz * ripple);
    cols[i * 3] = cKnot.r;
    cols[i * 3 + 1] = cKnot.g;
    cols[i * 3 + 2] = cKnot.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

function buildSacredBaseSanctuary(): BufferGeometry {
  const rand = seeded(0x77b0de);
  const solidParts: BufferGeometry[] = [];
  const glowParts: BufferGeometry[] = [];

  // 1. Compact earth mound & velvet moss beds tightly hugging the trunk base (r <= 2.15m)
  //    so they never spill onto the walkable prayer platform or stepping stones.
  const earthMound = new CylinderGeometry(1.65, 2.2, 0.14, 20);
  earthMound.translate(0, 0.03, 0);
  solidParts.push(paintGeom(clampClearOfGateWall(earthMound), 0x423122));

  for (let m = 0; m < 8; m++) {
    const a = (m / 8) * Math.PI * 2 + 0.35;
    const rad = 0.95 + (m % 2) * 0.48;
    const mossPad = new SphereGeometry(0.52 + (m % 2) * 0.18, 10, 6);
    mossPad.scale(1.15, 0.08, 1.0);
    mossPad.translate(Math.cos(a) * rad, 0.06, Math.sin(a) * rad);
    solidParts.push(paintGeom(clampClearOfGateWall(mossPad), m % 2 === 0 ? 0x356b26 : 0x467a2c));
  }

  // 2. Seven mossy stones nestled right against the trunk collar (clear of the front prayer approach)
  const rockAngles = [0.15, 0.85, 1.62, 2.38, 3.12, 3.85, 5.75] as const;
  rockAngles.forEach((a, idx) => {
    const r = 1.42 + (idx % 2) * 0.32;
    const boulder = buildMossyBoulder(
      0.34 + (idx % 2) * 0.1,
      0.22 + (idx % 3) * 0.05,
      0.3 + (idx % 2) * 0.08,
      idx * 3.1 + 1,
      idx % 2 === 0 ? 0x6e6a61 : 0x5e5a52,
    );
    boulder.rotateY(a + 0.4);
    boulder.translate(Math.cos(a) * r, 0.14, Math.sin(a) * r);
    solidParts.push(clampClearOfGateWall(boulder));
  });

  // 3. Walkable Sacred Stone Prayer Platform & Stepping Stones
  //    Top surfaces sit at y = 0.036m..0.052m (matching `SLAB_TOP = 0.05m` in `garden.ts`)
  //    so chibi characters walk cleanly ON TOP of the stones and red mat without clipping!
  const prayDist = 2.95;
  const px = Math.cos(PRAY_ANGLE) * prayDist;
  const pz = Math.sin(PRAY_ANGLE) * prayDist;

  const addTransformedBox = (w: number, h: number, d: number, lx: number, ly: number, lz: number, hex: number): void => {
    const g = new BoxGeometry(w, h, d);
    tmpEuler.set(0, -PRAY_ANGLE + Math.PI * 0.5, 0);
    q.setFromEuler(tmpEuler);
    v3.set(lx, 0, lz).applyQuaternion(q);
    v3.x += px;
    v3.y = ly;
    v3.z += pz;
    m4.compose(v3, q, s3.set(1, 1, 1));
    g.applyMatrix4(m4);
    solidParts.push(paintGeom(g, hex));
  };

  // Outer carved stone border slab (top at y = 0.034m)
  addTransformedBox(1.68, 0.068, 1.28, 0, 0.0, 0, 0x78736a);
  // Inner raised stone dais slab (top at y = 0.044m)
  addTransformedBox(1.42, 0.068, 1.04, 0, 0.01, 0, 0x8c867b);
  // Gold border trim of prayer mat (top at y = 0.049m)
  addTransformedBox(1.02, 0.068, 0.74, 0, 0.015, 0, 0xd4a438);
  // Warm crimson temple prayer mat (top at y = 0.052m == SLAB_TOP)
  addTransformedBox(0.92, 0.068, 0.64, 0, 0.018, 0, 0xa83226);

  // 3 walkable stepping stone slabs leading from the courtyard walkway onto the prayer platform (top at y = 0.042m)
  for (let s = 1; s <= 3; s++) {
    const stepR = prayDist + s * 0.68;
    const slab = new CylinderGeometry(0.34, 0.36, 0.064, 8);
    slab.scale(1.22, 1, 0.9);
    slab.rotateY(PRAY_ANGLE + s * 0.2);
    slab.translate(Math.cos(PRAY_ANGLE) * stepR, 0.01, Math.sin(PRAY_ANGLE) * stepR);
    solidParts.push(paintGeom(slab, 0x857f74));
  }

  // 4. Three low stone garden lanterns flanking the side of the sanctuary (clear of the walkway)
  const lowLanternAngles = [-2.25, -0.35, 2.75] as const;
  for (const la of lowLanternAngles) {
    const lr = 2.75;
    const lx = Math.cos(la) * lr;
    const lz = Math.sin(la) * lr;

    const lBase = new CylinderGeometry(0.22, 0.26, 0.1, 6);
    lBase.translate(lx, 0.05, lz);
    solidParts.push(paintGeom(lBase, 0x736e65));

    const lPost = new CylinderGeometry(0.09, 0.11, 0.26, 6);
    lPost.translate(lx, 0.23, lz);
    solidParts.push(paintGeom(lPost, 0x7d786e));

    const lBox = new BoxGeometry(0.2, 0.22, 0.2);
    lBox.translate(lx, 0.45, lz);
    glowParts.push(paintGeom(lBox, 0xffe4a8));

    const lRoof = new CylinderGeometry(0.04, 0.32, 0.18, 6);
    lRoof.translate(lx, 0.63, lz);
    solidParts.push(paintGeom(lRoof, 0x635e56));
  }

  // 5. Fallen dry autumn maple leaves & small grass tufts around the roots (kept clear of the prayer mat)
  const leafPalette = [0xc8321a, 0xe06818, 0xe8a824, 0x9e2414, 0x8a5229] as const;
  for (let f = 0; f < 38; f++) {
    const fa = rand() * Math.PI * 2;
    if (Math.cos(fa - PRAY_ANGLE) > 0.78) continue;
    const maxLeafR = Math.sin(fa) > 0.5 ? 2.2 : 2.9;
    const fr = 0.85 + rand() * (maxLeafR - 0.85);
    const fx = Math.cos(fa) * fr;
    const fz = Math.sin(fa) * fr;
    const fy = 0.06 * Math.max(0, 1 - fr / 2.2) + 0.012;

    const leafGeo = new CylinderGeometry(0.065, 0.065, 0.008, 5);
    leafGeo.rotateX((rand() - 0.5) * 0.2);
    leafGeo.rotateY(rand() * Math.PI * 2);
    leafGeo.translate(fx, fy, fz);
    solidParts.push(paintGeom(leafGeo, leafPalette[f % leafPalette.length]!));
  }

  for (let gr = 0; gr < 20; gr++) {
    const ga = rand() * Math.PI * 2;
    if (Math.cos(ga - PRAY_ANGLE) > 0.72) continue;
    const maxGrassR = Math.sin(ga) > 0.5 ? 2.0 : 2.35;
    const gRad = 1.05 + rand() * (maxGrassR - 1.05);
    const gx = Math.cos(ga) * gRad;
    const gz = Math.sin(ga) * gRad;
    const gy = 0.05 * Math.max(0, 1 - gRad / 2.2);

    const blade = new CylinderGeometry(0.006, 0.028, 0.2 + rand() * 0.1, 4);
    blade.rotateZ((rand() - 0.5) * 0.35);
    blade.rotateY(rand() * Math.PI * 2);
    blade.translate(gx, gy + 0.09, gz);
    solidParts.push(paintGeom(blade, gr % 2 === 0 ? 0x457d2c : 0x5c8f32));
  }

  const mergedSolid = mergeGeometries(solidParts, false);
  const mergedGlow = mergeGeometries(glowParts, false);
  for (const p of solidParts) p.dispose();
  for (const p of glowParts) p.dispose();
  if (!mergedSolid || !mergedGlow) throw new Error("merge: sacred base sanctuary");

  const combined = mergeGeometries([mergedSolid, mergedGlow], true);
  mergedSolid.dispose();
  mergedGlow.dispose();
  if (!combined) throw new Error("merge: sacred base combined");
  return combined;
}

// ============================================================================
// 5. COMPLETE ANCIENT WISHING TREE BUILDER (PARALLEL TO WALL, FACING COURTYARD)
// ============================================================================

export interface AncientWishingTreeAsset {
  readonly treeGeometry: BufferGeometry;
  readonly treeMaterials: MeshStandardMaterial[];
  readonly sanctuaryGeometry: BufferGeometry;
  readonly sanctuaryMaterials: MeshStandardMaterial[];
  readonly hangAnchors: readonly BoughHangAnchor[];
  update(t: number, daylight: number): void;
  dispose(): void;
}

export function createAncientWishingTreeAsset(): AncientWishingTreeAsset {
  const rand = seeded(0x99b0de);
  const barkParts: BufferGeometry[] = [];
  const leafParts: BufferGeometry[] = [];
  const hangAnchors: BoughHangAnchor[] = [];

  // 1. Massive Gnarled Ancient Trunk (leaning slightly toward the courtyard & parallel to the wall)
  const mainTrunkPts = [
    new Vector3(0.0, -0.25, 0.0),
    new Vector3(0.16, 0.95, -0.06),
    new Vector3(-0.18, 2.15, -0.12),
    new Vector3(-0.05, 3.35, -0.04),
    new Vector3(0.14, 4.65, -0.08),
    new Vector3(0.04, 6.1, -0.02),
  ];
  barkParts.push(buildGnarledWoodTube(mainTrunkPts, 0.84, 0.32, 14, 14, 0x3b2416, 0x543b2a, 0.15, true));

  const twinTrunkPts = [
    new Vector3(-0.32, -0.2, -0.18),
    new Vector3(-0.38, 1.1, -0.22),
    new Vector3(-0.24, 2.35, -0.12),
    new Vector3(0.2, 3.65, -0.14),
  ];
  barkParts.push(buildGnarledWoodTube(twinTrunkPts, 0.48, 0.22, 10, 10, 0x382214, 0x4f3726, 0.16, true));

  const burlSpecs: readonly [number, number, number, number, number, number][] = [
    [0.68, 1.15, -0.22, 0.26, 0.32, 0.24],
    [-0.64, 1.75, -0.34, 0.24, 0.28, 0.22],
    [0.42, 2.45, -0.48, 0.22, 0.26, 0.2],
    [-0.45, 3.05, -0.32, 0.2, 0.24, 0.18],
    [0.35, 1.5, -0.56, 0.22, 0.25, 0.22],
  ];
  burlSpecs.forEach(([bx, by, bz, rx, ry, rz], idx) => {
    barkParts.push(buildBurlGeometry(bx, by, bz, rx, ry, rz, idx * 5.7 + 1));
  });

  // 2. Elaborate Surface & Buttress Root System (diving underground before reaching the prayer platform)
  for (let r = 0; r < 10; r++) {
    const a = (r / 10) * Math.PI * 2 + (rand() - 0.5) * 0.18;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const twistA = a + (r % 2 === 0 ? 0.16 : -0.16);
    const towardPrayer = Math.cos(twistA - PRAY_ANGLE) > 0.62;
    const towardWall = Math.sin(twistA) > 0.45;
    const reach = towardPrayer ? 1.95 : towardWall ? 2.45 : 2.85 + (r % 3) * 0.35;

    const rootPts = [
      new Vector3(ca * 0.48, 1.02 + (r % 2) * 0.2, sa * 0.48),
      new Vector3(ca * (reach * 0.42), 0.42 + (r % 3) * 0.06, sa * (reach * 0.42)),
      new Vector3(Math.cos(twistA) * (reach * 0.74), 0.16, Math.sin(twistA) * (reach * 0.74)),
      new Vector3(Math.cos(twistA) * reach, -0.14, Math.sin(twistA) * reach),
    ];
    barkParts.push(clampClearOfGateWall(buildGnarledWoodTube(rootPts, 0.32, 0.05, 9, 8, 0x3b2618, 0x473628, 0.18, false)));

    const forkA = twistA + (r % 2 === 0 ? 0.28 : -0.28);
    const forkTowardPrayer = Math.cos(forkA - PRAY_ANGLE) > 0.62;
    const forkTowardWall = Math.sin(forkA) > 0.45;
    const forkReach = forkTowardPrayer ? 1.98 : forkTowardWall ? 2.5 : reach + 0.22;
    const forkPts = [
      rootPts[1]!,
      new Vector3(Math.cos(forkA) * (forkReach * 0.68), 0.2, Math.sin(forkA) * (forkReach * 0.68)),
      new Vector3(Math.cos(forkA) * forkReach, -0.16, Math.sin(forkA) * forkReach),
    ];
    barkParts.push(clampClearOfGateWall(buildGnarledWoodTube(forkPts, 0.18, 0.04, 7, 6, 0x3b2618, 0x453a2a, 0.16, false)));
  }

  // 3. Seven Major Spreading Boughs (widest boughs stretched parallel to the wall along X and forward into the courtyard -Z)
  interface BoughSpec {
    readonly angle: number;
    readonly startY: number;
    readonly midR: number;
    readonly midY: number;
    readonly endR: number;
    readonly endY: number;
    readonly rStart: number;
    readonly rEnd: number;
    readonly zoneIdx: number;
  }

  const majorBoughs: readonly BoughSpec[] = [
    { angle: 0.06, startY: 2.68, midR: 3.15, midY: 3.35, endR: 6.15, endY: 3.15, rStart: 0.33, rEnd: 0.08, zoneIdx: 0 },
    { angle: -0.78, startY: 2.85, midR: 2.95, midY: 3.55, endR: 5.65, endY: 3.25, rStart: 0.31, rEnd: 0.075, zoneIdx: 1 },
    { angle: -1.62, startY: 2.75, midR: 2.9, midY: 3.45, endR: 5.55, endY: 3.18, rStart: 0.32, rEnd: 0.08, zoneIdx: 2 },
    { angle: -2.42, startY: 3.1, midR: 3.0, midY: 3.85, endR: 5.75, endY: 3.5, rStart: 0.3, rEnd: 0.075, zoneIdx: 3 },
    { angle: 3.08, startY: 2.78, midR: 3.15, midY: 3.48, endR: 6.1, endY: 3.22, rStart: 0.33, rEnd: 0.08, zoneIdx: 1 },
    { angle: 2.25, startY: 3.45, midR: 2.75, midY: 4.35, endR: 5.15, endY: 4.15, rStart: 0.28, rEnd: 0.07, zoneIdx: 4 },
    { angle: 0.88, startY: 3.35, midR: 2.75, midY: 4.25, endR: 5.15, endY: 4.05, rStart: 0.29, rEnd: 0.075, zoneIdx: 3 },
  ];

  majorBoughs.forEach((b, bIdx) => {
    const ca = Math.cos(b.angle);
    const sa = Math.sin(b.angle);
    const lateralCurve = b.angle + (bIdx % 2 === 0 ? 0.12 : -0.12);

    const p0 = new Vector3(ca * 0.35, b.startY, sa * 0.35);
    const p1 = new Vector3(Math.cos(lateralCurve) * b.midR, b.midY, Math.sin(lateralCurve) * b.midR);
    const p2 = new Vector3(ca * b.endR, b.endY, sa * b.endR);

    barkParts.push(buildGnarledWoodTube([p0, p1, p2], b.rStart, b.rEnd, 9, 8, 0x3d2618, 0x593e2c, 0.13));

    const boughSamples = sampleSpline([p0, p1, p2], 12);
    for (let s = 3; s <= 11; s++) {
      const pt = boughSamples[s]!;
      const tFrac = s / 12;
      const br = b.rStart * Math.pow(1 - tFrac, 0.82) + b.rEnd * tFrac;
      hangAnchors.push({
        x: pt.x,
        y: pt.y - br * 0.72,
        z: pt.z,
        branchRadius: br,
        branchYaw: b.angle,
        tier: s <= 7 && pt.z < 1.5 ? "low" : "mid",
      });
    }

    leafParts.push(
      buildSacredCanopySpray(p1.x * 1.08, p1.y + 0.68, p1.z * 1.08, 2.25, 0.08, 4, b.zoneIdx, rand),
      buildSacredCanopySpray(p2.x, p2.y + 0.45, p2.z, 2.55, 0.14, 5, (b.zoneIdx + 1) % 5, rand),
    );

    for (const side of [-1, 1] as const) {
      const subAngle = b.angle + side * (0.42 + (bIdx % 2) * 0.08);
      const subStart = boughSamples[side < 0 ? 5 : 7]!;
      const subReach = b.endR * (0.78 + (side > 0 ? 0.14 : 0.06));
      const subEndY = b.endY + (side > 0 ? 0.65 : -0.18);
      const subMid = new Vector3(
        (subStart.x + Math.cos(subAngle) * subReach) * 0.52,
        (subStart.y + subEndY) * 0.54 + 0.22,
        (subStart.z + Math.sin(subAngle) * subReach) * 0.52,
      );
      const subEnd = new Vector3(Math.cos(subAngle) * subReach, subEndY, Math.sin(subAngle) * subReach);

      barkParts.push(buildGnarledWoodTube([subStart, subMid, subEnd], b.rStart * 0.52, 0.055, 6, 6, 0x452b1c, 0x5e4230, 0.12));

      const subSamples = sampleSpline([subStart, subMid, subEnd], 6);
      for (let ss = 2; ss <= 5; ss++) {
        const spt = subSamples[ss]!;
        const stFrac = ss / 6;
        const sbr = b.rStart * 0.52 * (1 - stFrac) + 0.055 * stFrac;
        hangAnchors.push({
          x: spt.x,
          y: spt.y - sbr * 0.72,
          z: spt.z,
          branchRadius: sbr,
          branchYaw: subAngle,
          tier: side < 0 && spt.z < 1.5 ? "low" : "mid",
        });
      }

      leafParts.push(
        buildSacredCanopySpray(
          subEnd.x,
          subEnd.y + 0.38,
          subEnd.z,
          2.15 + (side > 0 ? 0.2 : 0),
          0.12,
          4,
          (b.zoneIdx + (side > 0 ? 2 : 0)) % 5,
          rand,
        ),
      );
    }
  });

  // 4. Upper Crown Boughs & Multi-Tiered Canopy Top (Reaching 10.6m total height)
  const crownTopOrigin = mainTrunkPts[mainTrunkPts.length - 1]!;
  for (let c = 0; c < 6; c++) {
    const ca = (c / 6) * Math.PI * 2 + 0.35;
    const cReach = 2.85 + (c % 2) * 0.85;
    const cTopY = 7.45 + (c % 3) * 0.55;
    const cMid = new Vector3(Math.cos(ca) * (cReach * 0.5), 6.55, Math.sin(ca) * (cReach * 0.5));
    const cEnd = new Vector3(Math.cos(ca) * cReach, cTopY, Math.sin(ca) * cReach);

    barkParts.push(buildGnarledWoodTube([crownTopOrigin, cMid, cEnd], 0.24, 0.06, 6, 6, 0x452b1c, 0x614532, 0.11));
    leafParts.push(buildSacredCanopySpray(cEnd.x, cEnd.y + 0.45, cEnd.z, 2.45, 0.06, 5, (c + 2) % 5, rand));
  }

  leafParts.push(
    buildSacredCanopySpray(0.0, 8.85, 0.0, 2.75, 0.04, 5, 3, rand),
    buildSacredCanopySpray(-1.35, 8.2, -0.45, 2.35, 0.05, 4, 4, rand),
    buildSacredCanopySpray(1.35, 8.3, -0.45, 2.35, 0.05, 4, 2, rand),
  );

  const mergedBark = mergeGeometries(barkParts, false);
  const mergedLeaves = mergeGeometries(leafParts, false);
  for (const g of barkParts) g.dispose();
  for (const g of leafParts) g.dispose();
  if (!mergedBark || !mergedLeaves) throw new Error("merge: ancient wishing tree");

  const treeGeometry = mergeGeometries([mergedBark, mergedLeaves], true);
  mergedBark.dispose();
  mergedLeaves.dispose();
  if (!treeGeometry) throw new Error("merge: ancient wishing tree combined");
  treeGeometry.computeBoundingBox();
  treeGeometry.computeBoundingSphere();

  const sanctuaryGeometry = buildSacredBaseSanctuary();
  sanctuaryGeometry.computeBoundingBox();
  sanctuaryGeometry.computeBoundingSphere();

  // 5. PBR Materials & Gentle Breeze Shader
  const uTime = { value: 0 };
  const barkTextures = drawAncientBarkTexture(1024);
  const canopyTex = drawSacredCanopyTexture(1024);

  const barkMat = new MeshStandardMaterial({
    map: barkTextures.colorMap,
    bumpMap: barkTextures.bumpMap,
    bumpScale: 0.045,
    vertexColors: true,
    roughness: 0.9,
    metalness: 0.02,
  });

  const foliageMat = new MeshStandardMaterial({
    map: canopyTex,
    vertexColors: true,
    alphaTest: 0.32,
    roughness: 0.66,
    metalness: 0.0,
    emissive: new Color(0x1f1406),
    emissiveIntensity: 0.06,
    side: DoubleSide,
  });

  foliageMat.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nvarying float vSunGrad;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float hNorm = clamp((transformed.y - 2.5) / 6.5, 0.0, 1.0);
        float sunDot = clamp(dot(normalize(normal), vec3(0.45, 0.82, 0.35)), 0.0, 1.0);
        vSunGrad = clamp(hNorm * 0.48 + sunDot * 0.52, 0.0, 1.0);
        float sway = clamp((transformed.y - 2.2) * 0.12, 0.0, 1.0);
        float phase = transformed.x * 0.7 + transformed.z * 0.7 + transformed.y * 0.4;
        transformed.x += sway * 0.022 * sin(uTime * 1.05 + phase);
        transformed.z += sway * 0.018 * cos(uTime * 0.92 + phase * 1.1);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vSunGrad;")
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
        normal = normalize(vNormal);`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        vec3 shade = diffuseColor.rgb * vec3(0.68, 0.65, 0.60);
        vec3 sunlit = mix(diffuseColor.rgb * 1.22, vec3(1.0, 0.94, 0.68), 0.16);
        diffuseColor.rgb = mix(shade, sunlit, vSunGrad);`,
      )
      .replace(
        "#include <opaque_fragment>",
        `outgoingLight = mix(outgoingLight, diffuseColor.rgb * 1.02, 0.34) + diffuseColor.rgb * (0.08 + vSunGrad * 0.14);
        #include <opaque_fragment>`,
      );
  };

  const sanctuarySolidMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.88,
    metalness: 0.04,
  });

  const sanctuaryGlowMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.4,
    emissive: new Color(0xffb84d),
    emissiveIntensity: 0.9,
  });

  return {
    treeGeometry,
    treeMaterials: [barkMat, foliageMat],
    sanctuaryGeometry,
    sanctuaryMaterials: [sanctuarySolidMat, sanctuaryGlowMat],
    hangAnchors,
    update(t, daylight) {
      uTime.value = t;
      const night = Math.max(0, Math.min(1, 1 - daylight));
      foliageMat.emissiveIntensity = 0.05 + 0.07 * daylight;
      sanctuaryGlowMat.emissiveIntensity = 0.75 + night * 1.75 + 0.08 * Math.sin(t * 2.4);
    },
    dispose() {
      treeGeometry.dispose();
      sanctuaryGeometry.dispose();
      barkTextures.colorMap.dispose();
      barkTextures.bumpMap.dispose();
      canopyTex.dispose();
      barkMat.dispose();
      foliageMat.dispose();
      sanctuarySolidMat.dispose();
      sanctuaryGlowMat.dispose();
    },
  };
}
