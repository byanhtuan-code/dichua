import {
  Box3,
  BufferGeometry,
  CanvasTexture,
  Color,
  Euler,
  Float32BufferAttribute,
  MeshStandardMaterial,
  Quaternion,
  SRGBColorSpace,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { maxAnisotropy } from "../engine/renderer.ts";
import { seeded } from "./random.ts";

// ============================================================================
// BẢNG TÙY CHỈNH ĐỘ THOÁNG TÁN LÁ & ĐỘ TƯƠI SÁNG MÀU LÁ (CHỈNH SỬA TẠI ĐÂY)
// ============================================================================
export const TREE_VISUAL_CONFIG = {
  /**
   * Hệ số độ rộng của từng chòm nhánh lá (giữ mức thoáng -40%):
   */
  padSizeMultiplier: 0.84,

  /**
   * Hệ số kích thước từng chiếc lá phong 7 thùy trên cành con:
   */
  leafDetailScale: 0.88,

  /**
   * Hệ số độ đậm màu sắc lá cây (đã giảm 10% từ 1.40 xuống 1.26):
   */
  colorSaturationBoost: 1.26,

  /**
   * Hệ số tăng độ tươi sáng cho lá cây (1.08 = tươi sáng, rạng rỡ dưới nắng):
   */
  colorBrightnessBoost: 1.08,

  /**
   * Hệ số chiều cao tổng thể của cây (1.0 = chuẩn theo 4 tầng từ cao xuống thấp).
   */
  treeHeightMultiplier: 1.0,

  /**
   * Màu lá của Cây Bồ Đề Ước Nguyện ngoài cổng tam quan (vàng cam tươi sáng).
   */
  wishTreeColor: 0xf2a21e,

  /**
   * BẢNG MÀU LÁ CÂY ĐAN XEN TRONG RỪNG (Tươi sáng hơn & giảm 10% độ trầm tối):
   */
  foliagePalette: [
    0xd12219, // 1. Đỏ phong tươi sáng (Bright Maple Crimson)
    0xf05218, // 2. Đỏ cam / Cam thu tươi (Vibrant Autumn Orange)
    0xf5b21b, // 3. Vàng thu rực sáng (Luminous Golden Yellow)
    0x389c2c, // 4. Xanh lá cây tươi (Fresh Lush Green)
    0xb01814, // 5. Đỏ rượu vang vừa phải (Rich Wine Red)
    0xe8741b, // 6. Vàng cam hổ phách tươi (Bright Amber Orange)
    0x8cc924, // 7. Vàng nõn chuối / Xanh cốm tươi (Fresh Chartreuse)
    0xdc331e, // 8. Đỏ son tươi (Bright Scarlet Maple)
    0xf7c62b, // 9. Vàng nắng ấm (Sunlit Gold)
    0x2e8526, // 10. Xanh cổ thụ thanh tịnh (Temple Foliage Green)
    0xc94218, // 11. Cam cháy tươi (Warm Burnt Orange)
    0xe5981c, // 12. Vàng đồng mùa thu sáng (Warm Golden Ochre)
  ] as const,
} as const;

/** Base height for the Wishing Tree outside the gate (matches wishing-tree.ts hang spots). */
const WISH_TREE_BASE_HEIGHT = 7.6;

const q = new Quaternion();
const v3 = new Vector3();
const tmpEuler = new Euler();
const UP = new Vector3(0, 1, 0);

// ============================================================================
// SHADERS: NATURAL BARK & BRIGHT, FRESH SUN-FILTERED FOLIAGE
// ============================================================================

export function attachMapleBarkShader(material: MeshStandardMaterial, uTime: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <color_vertex>",
        `#if defined( USE_COLOR_ALPHA )
          vColor = vec4( 1.0 );
        #elif defined( USE_COLOR )
          vColor = vec3( 1.0 );
        #endif
        #ifdef USE_COLOR
          vColor.xyz *= color.xyz;
        #endif`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 treePos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 treePos = vec2(modelMatrix[3][0], modelMatrix[3][2]);
        #endif
        float branchWeight = clamp((transformed.y - 1.5) * 0.14, 0.0, 1.0);
        float treePhase = treePos.x * 0.37 + treePos.y * 0.53;
        float boughSway = branchWeight * 0.015 * sin(uTime * 0.9 + treePhase + transformed.x * 0.4);
        transformed.x += boughSway;
        transformed.z += boughSway * 0.7;`,
      );
  };
}

/**
 * Botanical Foliage Shader (Bright & Fresh, -10% color heaviness):
 * - Preserves outward-domed normals on both sides of `DoubleSide` leaf cards.
 * - Uses a gentle, luminous contrast curve (`pow(diffuseColor.rgb, vec3(1.12)) * 1.08`)
 *   and warm sunlit translucency so leaves look vibrant, fresh, and radiant.
 */
export function attachMapleFoliageShader(material: MeshStandardMaterial, uTime: { value: number }): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = uTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nvarying float vCanopyGrad;\nvarying float vRimLight;",
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 treePos = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        #else
          vec2 treePos = vec2(modelMatrix[3][0], modelMatrix[3][2]);
        #endif
        float heightNorm = clamp((transformed.y - 1.4) / 4.8, 0.0, 1.0);
        float sunSide = clamp(dot(normalize(normal), vec3(0.45, 0.80, 0.38)), 0.0, 1.0);
        vCanopyGrad = clamp(heightNorm * 0.50 + sunSide * 0.50, 0.0, 1.0);
        vRimLight = pow(sunSide, 1.5) * heightNorm;

        float swayWeight = clamp((transformed.y - 1.2) * 0.18, 0.0, 1.0);
        float treePhase = treePos.x * 0.41 + treePos.y * 0.59;
        float clusterPhase = transformed.x * 0.95 + transformed.z * 0.9 + transformed.y * 0.55;
        float swayX = swayWeight * (0.022 * sin(uTime * 1.0 + treePhase + clusterPhase) + 0.008 * cos(uTime * 1.85 - clusterPhase));
        float swayZ = swayWeight * (0.018 * cos(uTime * 0.9 + treePhase * 1.2 + clusterPhase));
        transformed.x += swayX;
        transformed.y += (swayX + swayZ) * 0.08;
        transformed.z += swayZ;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nvarying float vCanopyGrad;\nvarying float vRimLight;",
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>
        normal = normalize(vNormal);`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        diffuseColor.rgb = pow(max(diffuseColor.rgb, vec3(0.001)), vec3(1.12)) * 1.08;
        vec3 lowerShade = diffuseColor.rgb * vec3(0.68, 0.65, 0.60);
        vec3 upperSun = mix(diffuseColor.rgb * 1.24, vec3(1.0, 0.95, 0.68), 0.18);
        diffuseColor.rgb = mix(lowerShade, upperSun, vCanopyGrad);`,
      )
      .replace(
        "#include <opaque_fragment>",
        `outgoingLight = mix(outgoingLight, diffuseColor.rgb * 1.04, 0.36) + diffuseColor.rgb * (0.09 + vRimLight * 0.18);
        #include <opaque_fragment>`,
      );
  };
}

// ============================================================================
// REALISTIC 24-LEAF BOTANICAL MAPLE BRANCHLET TEXTURE (`1024x1024` — BRIGHT & CRISP)
// ============================================================================

const LOBE_ANGLES = [-1.96, -1.32, -0.64, 0, 0.64, 1.32, 1.96] as const;
const LOBE_LENGTHS = [0.46, 0.79, 0.98, 1.14, 0.98, 0.79, 0.46] as const;
const LOBE_WIDTHS = [0.13, 0.18, 0.21, 0.23, 0.21, 0.18, 0.13] as const;
const LOBE_TEETH: readonly [number, number][] = [
  [0.34, -0.74],
  [0.38, -0.6],
  [0.58, -0.95],
  [0.63, -0.72],
  [0.8, -0.52],
  [1.0, 0.0],
  [0.8, 0.52],
  [0.63, 0.72],
  [0.58, 0.95],
  [0.38, 0.6],
  [0.34, 0.74],
];

export function drawBotanicalBranchletTexture(size = 1024): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.clearRect(0, 0, size, size);

  const rand = seeded(0x5a71e99);
  const leafScale = TREE_VISUAL_CONFIG.leafDetailScale;

  // 1. Draw the woody branchlet and secondary twigs
  ctx.strokeStyle = "#472917";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const branches: readonly [number, number, number, number, number, number, number][] = [
    [0.5, 0.94, 0.49, 0.58, 0.5, 0.16, 0.0105],
    [0.49, 0.74, 0.32, 0.64, 0.15, 0.52, 0.0072],
    [0.5, 0.7, 0.68, 0.6, 0.85, 0.48, 0.0072],
    [0.49, 0.5, 0.33, 0.4, 0.18, 0.27, 0.006],
    [0.5, 0.46, 0.67, 0.36, 0.82, 0.25, 0.006],
  ];
  for (const [x0, y0, cx, cy, x1, y1, w] of branches) {
    ctx.lineWidth = size * w;
    ctx.beginPath();
    ctx.moveTo(size * x0, size * y0);
    ctx.quadraticCurveTo(size * cx, size * cy, size * x1, size * y1);
    ctx.stroke();
  }

  /** Draws one 7-lobed Japanese Maple leaf with serrated teeth and lateral veins. */
  const drawRealisticMapleLeaf = (
    cx: number,
    cy: number,
    baseRadius: number,
    rot: number,
    brightness: number,
  ): void => {
    const radius = baseRadius * leafScale;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);

    ctx.strokeStyle = "#59321b";
    ctx.lineWidth = Math.max(1.4, radius * 0.036);
    ctx.beginPath();
    ctx.moveTo(0, radius * 0.46);
    ctx.quadraticCurveTo(radius * 0.03, radius * 0.25, 0, radius * 0.06);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, radius * 0.12);

    for (let i = 0; i < LOBE_ANGLES.length; i++) {
      const a = LOBE_ANGLES[i]! - Math.PI * 0.5;
      const len = radius * LOBE_LENGTHS[i]!;
      const wid = radius * LOBE_WIDTHS[i]!;
      const perp = a + Math.PI * 0.5;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const cp = Math.cos(perp);
      const sp = Math.sin(perp);

      for (const [lf, wf] of LOBE_TEETH) {
        ctx.lineTo(ca * (len * lf) + cp * (wid * wf), sa * (len * lf) + sp * (wid * wf));
      }

      if (i < LOBE_ANGLES.length - 1) {
        const nextA = LOBE_ANGLES[i + 1]! - Math.PI * 0.5;
        const midA = (a + nextA) * 0.5;
        const notchR = radius * 0.25;
        ctx.lineTo(Math.cos(midA) * notchR, Math.sin(midA) * notchR);
      }
    }

    ctx.closePath();

    const b0 = Math.round(212 * brightness);
    const b1 = Math.round(244 * brightness);
    const b2 = Math.min(255, Math.round(255 * brightness));

    const grad = ctx.createRadialGradient(0, 0, radius * 0.06, 0, -radius * 0.16, radius * 1.08);
    grad.addColorStop(0, `rgb(${b0}, ${b0 - 4}, ${b0 - 10})`);
    grad.addColorStop(0.62, `rgb(${b1}, ${b1 - 2}, ${b1 - 6})`);
    grad.addColorStop(1, `rgb(${b2}, ${b2}, ${b2 - 2})`);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.lineWidth = Math.max(1.3, radius * 0.022);
    ctx.strokeStyle = `rgba(${Math.round(142 * brightness)}, ${Math.round(128 * brightness)}, ${Math.round(114 * brightness)}, 0.50)`;
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 252, 238, 0.62)";
    ctx.lineCap = "round";
    for (let i = 0; i < LOBE_ANGLES.length; i++) {
      const a = LOBE_ANGLES[i]! - Math.PI * 0.5;
      const len = radius * LOBE_LENGTHS[i]!;
      const wid = radius * LOBE_WIDTHS[i]!;
      const perp = a + Math.PI * 0.5;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const cp = Math.cos(perp);
      const sp = Math.sin(perp);

      ctx.lineWidth = Math.max(1.2, radius * 0.022);
      ctx.beginPath();
      ctx.moveTo(0, radius * 0.06);
      ctx.lineTo(ca * (len * 0.88), sa * (len * 0.88));
      ctx.stroke();

      if (i >= 1 && i <= 5) {
        ctx.lineWidth = Math.max(0.8, radius * 0.013);
        for (const frac of [0.38, 0.62] as const) {
          const vx = ca * (len * frac);
          const vy = sa * (len * frac);
          const vSpan = wid * (1 - frac * 0.35) * 0.68;
          const vFwd = len * 0.12;
          ctx.beginPath();
          ctx.moveTo(vx, vy);
          ctx.lineTo(vx + ca * vFwd - cp * vSpan, vy + sa * vFwd - sp * vSpan);
          ctx.moveTo(vx, vy);
          ctx.lineTo(vx + ca * vFwd + cp * vSpan, vy + sa * vFwd + sp * vSpan);
          ctx.stroke();
        }
      }
    }

    ctx.restore();
  };

  // Layer 1: 8 shaded under-leaves
  const underLeaves: readonly [number, number, number, number, number][] = [
    [0.5, 0.5, 0.15, 0.0, 0.88],
    [0.36, 0.45, 0.145, -0.48, 0.86],
    [0.64, 0.45, 0.145, 0.48, 0.86],
    [0.36, 0.64, 0.145, -0.82, 0.86],
    [0.64, 0.64, 0.145, 0.82, 0.86],
    [0.5, 0.32, 0.145, -0.1, 0.9],
    [0.26, 0.38, 0.14, -0.72, 0.89],
    [0.74, 0.36, 0.14, 0.72, 0.89],
  ];
  for (const [x, y, r, rot, br] of underLeaves) {
    drawRealisticMapleLeaf(x * size, y * size, r * size, rot + (rand() - 0.5) * 0.14, br);
  }

  // Layer 2: 9 mid-branch leaves fanning along the 5 twigs
  const midLeaves: readonly [number, number, number, number, number][] = [
    [0.5, 0.16, 0.145, 0.0, 0.97],
    [0.19, 0.25, 0.14, -0.7, 0.96],
    [0.81, 0.23, 0.14, 0.7, 0.96],
    [0.15, 0.42, 0.135, -1.08, 0.94],
    [0.85, 0.4, 0.135, 1.08, 0.94],
    [0.16, 0.57, 0.14, -1.18, 0.95],
    [0.84, 0.54, 0.14, 1.18, 0.95],
    [0.28, 0.7, 0.13, -1.55, 0.93],
    [0.72, 0.68, 0.13, 1.55, 0.93],
  ];
  for (const [x, y, r, rot, br] of midLeaves) {
    drawRealisticMapleLeaf(x * size, y * size, r * size, rot + (rand() - 0.5) * 0.12, br);
  }

  // Layer 3: 7 crisp sunlit foreground maple leaves
  const topLeaves: readonly [number, number, number, number, number][] = [
    [0.37, 0.22, 0.14, -0.42, 1.0],
    [0.63, 0.22, 0.14, 0.42, 1.0],
    [0.31, 0.36, 0.135, -0.52, 0.99],
    [0.69, 0.34, 0.135, 0.52, 0.99],
    [0.27, 0.53, 0.135, -0.78, 0.98],
    [0.73, 0.51, 0.135, 0.78, 0.98],
    [0.5, 0.4, 0.14, 0.12, 1.0],
  ];
  for (const [x, y, r, rot, br] of topLeaves) {
    drawRealisticMapleLeaf(x * size, y * size, r * size, rot, br);
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAnisotropy();
  return tex;
}

// ============================================================================
// SMOOTH CATMULL-ROM TRUNKS & BALANCED BOTANICAL LEAF SPRAYS
// ============================================================================

function sampleSmoothCurve(controlPts: readonly Vector3[], subdivisions: number): Vector3[] {
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

function buildSmoothBranchTube(
  controlPts: readonly Vector3[],
  rStart: number,
  rEnd: number,
  lengthSegs: number,
  radialSegs: number,
  baseHex: number,
  topHex: number,
  flareBase = false,
): BufferGeometry {
  const points = sampleSmoothCurve(controlPts, lengthSegs);
  const rings = points.length;
  const cols = radialSegs + 1;
  const vCount = rings * cols;
  const pos = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const col = new Float32Array(vCount * 3);

  const c0 = new Color(baseHex);
  const c1 = new Color(topHex);
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
    const flare = flareBase && tFrac < 0.25 ? 1 + 0.42 * Math.pow(1 - tFrac / 0.25, 2) : 1.0;
    const r = (rStart * Math.pow(1 - tFrac, 0.85) + rEnd * tFrac) * flare;
    cTmp.lerpColors(c0, c1, tFrac);

    for (let j = 0; j <= radialSegs; j++) {
      const uFrac = j / radialSegs;
      const theta = uFrac * Math.PI * 2;
      const ca = Math.cos(theta);
      const sa = Math.sin(theta);

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

      uv[idx * 2] = uFrac * 2.0;
      uv[idx * 2 + 1] = vDist * 0.75;

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

function buildCurvedBranchletCard(
  ax: number,
  ay: number,
  az: number,
  width: number,
  length: number,
  arch: number,
  yaw: number,
  pitch: number,
  roll: number,
  innerHex: number,
  outerHex: number,
  clusterCenter: Vector3,
): BufferGeometry {
  const segs = 2;
  const cols = segs + 1;
  const vCount = cols * cols;
  const pos = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const col = new Float32Array(vCount * 3);
  const nrm = new Float32Array(vCount * 3);

  const cIn = new Color(innerHex);
  const cOut = new Color(outerHex);
  const cTmp = new Color();

  tmpEuler.set(pitch, yaw, roll, "YXZ");
  q.setFromEuler(tmpEuler);

  for (let iy = 0; iy <= segs; iy++) {
    const v = iy / segs;
    const lz = (0.24 - v) * length;
    for (let ix = 0; ix <= segs; ix++) {
      const u = ix / segs;
      const lx = (u - 0.5) * width;
      const archCurve = Math.sin(v * Math.PI) * arch - (u - 0.5) * (u - 0.5) * arch * 0.85;

      v3.set(lx, archCurve, lz).applyQuaternion(q);
      const wx = ax + v3.x;
      const wy = ay + v3.y;
      const wz = az + v3.z;

      const idx = iy * cols + ix;
      pos[idx * 3] = wx;
      pos[idx * 3 + 1] = wy;
      pos[idx * 3 + 2] = wz;

      uv[idx * 2] = u;
      uv[idx * 2 + 1] = v;

      cTmp.lerpColors(cIn, cOut, v);
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

function buildAiryBotanicalSpray(
  cx: number,
  cy: number,
  cz: number,
  rawRadius: number,
  droop: number,
  frondCount: number,
  rand: () => number,
): BufferGeometry {
  const radius = rawRadius * TREE_VISUAL_CONFIG.padSizeMultiplier;
  const parts: BufferGeometry[] = [];
  const center = new Vector3(cx, cy, cz);

  const shHex = 0xdad3c6;
  const mdHex = 0xf2eee6;
  const brHex = 0xffffff;

  for (let i = 0; i < 2; i++) {
    const a = i * 1.57 + rand() * 0.45;
    const w = radius * (0.94 + rand() * 0.12);
    const len = radius * (0.98 + rand() * 0.12);
    parts.push(
      buildCurvedBranchletCard(
        cx,
        cy - 0.03,
        cz,
        w,
        len,
        0.2,
        a,
        0.28 + droop * 0.18,
        (rand() - 0.5) * 0.2,
        shHex,
        mdHex,
        center,
      ),
    );
  }

  for (let i = 0; i < frondCount; i++) {
    const a = (i / frondCount) * Math.PI * 2 + (rand() - 0.5) * 0.25;
    const baseOffset = radius * 0.12;
    const w = radius * (0.98 + rand() * 0.16);
    const len = radius * (1.04 + (i % 2) * 0.14);
    const pitch = 0.24 + droop * 0.26 + (i % 2) * 0.12 + (rand() - 0.5) * 0.08;
    const roll = (rand() - 0.5) * 0.2;

    parts.push(
      buildCurvedBranchletCard(
        cx + Math.cos(a) * baseOffset,
        cy + (i % 2 === 0 ? 0.04 : -0.04),
        cz + Math.sin(a) * baseOffset,
        w,
        len,
        0.2,
        a,
        pitch,
        roll,
        mdHex,
        brHex,
        center,
      ),
    );
  }

  parts.push(
    buildCurvedBranchletCard(
      cx,
      cy + 0.15,
      cz,
      radius * 0.92,
      radius * 0.95,
      0.22,
      rand() * Math.PI * 2,
      -0.08 + droop * 0.14,
      (rand() - 0.5) * 0.18,
      mdHex,
      brHex,
      center,
    ),
  );

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error("merge: airy botanical spray");
  return merged;
}

export type MapleArchetypeId =
  | "ancient"
  | "spreading"
  | "rounded"
  | "weeping"
  | "curved"
  | "small";

export interface ArchetypeSpec {
  readonly id: MapleArchetypeId;
  readonly baseHeight: number;
  readonly trunkBaseR: number;
  readonly trunkTopR: number;
  readonly barkColors: readonly [number, number];
  readonly trunkCurve: readonly [number, number, number][];
  readonly boughs: readonly {
    readonly angle: number;
    readonly startY: number;
    readonly midR: number;
    readonly midY: number;
    readonly endR: number;
    readonly endY: number;
    readonly radius: number;
    readonly padWidth: number;
    readonly droop: number;
  }[];
  readonly crownPads: readonly {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly width: number;
    readonly droop: number;
  }[];
}

export const ARCHETYPE_SPECS: readonly ArchetypeSpec[] = [
  {
    id: "ancient",
    baseHeight: 10.0,
    trunkBaseR: 0.31,
    trunkTopR: 0.095,
    barkColors: [0x3d2518, 0x593926],
    trunkCurve: [
      [0, -0.25, 0],
      [0.08, 1.3, -0.05],
      [-0.1, 2.7, 0.06],
      [-0.03, 4.1, 0.02],
      [0.04, 5.5, -0.03],
    ],
    boughs: [
      { angle: 0.2, startY: 2.3, midR: 1.5, midY: 3.3, endR: 2.85, endY: 4.0, radius: 0.13, padWidth: 2.35, droop: 0.08 },
      { angle: 1.45, startY: 2.7, midR: 1.45, midY: 3.8, endR: 2.75, endY: 4.6, radius: 0.12, padWidth: 2.25, droop: 0.06 },
      { angle: 2.75, startY: 2.4, midR: 1.55, midY: 3.5, endR: 2.95, endY: 4.2, radius: 0.13, padWidth: 2.4, droop: 0.08 },
      { angle: 4.0, startY: 3.0, midR: 1.4, midY: 4.2, endR: 2.65, endY: 5.0, radius: 0.11, padWidth: 2.2, droop: 0.05 },
      { angle: 5.25, startY: 3.3, midR: 1.35, midY: 4.5, endR: 2.55, endY: 5.4, radius: 0.1, padWidth: 2.15, droop: 0.05 },
    ],
    crownPads: [
      { x: 0.0, y: 6.5, z: 0.0, width: 2.55, droop: 0.04 },
      { x: -1.3, y: 5.7, z: 0.9, width: 2.2, droop: 0.05 },
      { x: 1.3, y: 5.8, z: -0.9, width: 2.2, droop: 0.05 },
    ],
  },
  {
    id: "spreading",
    baseHeight: 8.0,
    trunkBaseR: 0.24,
    trunkTopR: 0.08,
    barkColors: [0x452a1c, 0x633e2b],
    trunkCurve: [
      [0, -0.25, 0],
      [-0.07, 1.0, 0.05],
      [0.1, 2.1, -0.05],
      [0.05, 3.2, -0.02],
      [-0.03, 4.3, 0.02],
    ],
    boughs: [
      { angle: 0.1, startY: 1.9, midR: 1.4, midY: 2.5, endR: 2.7, endY: 3.0, radius: 0.1, padWidth: 2.1, droop: 0.06 },
      { angle: 1.65, startY: 2.2, midR: 1.35, midY: 2.9, endR: 2.55, endY: 3.5, radius: 0.095, padWidth: 2.05, droop: 0.06 },
      { angle: 3.15, startY: 2.0, midR: 1.45, midY: 2.7, endR: 2.8, endY: 3.2, radius: 0.1, padWidth: 2.15, droop: 0.06 },
      { angle: 4.7, startY: 2.45, midR: 1.3, midY: 3.2, endR: 2.45, endY: 3.85, radius: 0.09, padWidth: 2.0, droop: 0.05 },
    ],
    crownPads: [
      { x: 0.0, y: 5.0, z: 0.0, width: 2.3, droop: 0.04 },
      { x: -1.05, y: 4.3, z: -0.7, width: 1.95, droop: 0.05 },
      { x: 1.05, y: 4.4, z: 0.7, width: 1.95, droop: 0.05 },
    ],
  },
  {
    id: "rounded",
    baseHeight: 7.2,
    trunkBaseR: 0.21,
    trunkTopR: 0.07,
    barkColors: [0x402d20, 0x5c4230],
    trunkCurve: [
      [0, -0.25, 0],
      [0.05, 0.9, 0.03],
      [-0.06, 1.9, -0.04],
      [0.02, 2.9, 0.02],
      [0.0, 3.9, 0.0],
    ],
    boughs: [
      { angle: 0.4, startY: 1.8, midR: 1.15, midY: 2.4, endR: 2.15, endY: 3.0, radius: 0.09, padWidth: 1.95, droop: 0.08 },
      { angle: 1.95, startY: 2.05, midR: 1.1, midY: 2.75, endR: 2.05, endY: 3.35, radius: 0.085, padWidth: 1.9, droop: 0.08 },
      { angle: 3.5, startY: 1.9, midR: 1.2, midY: 2.55, endR: 2.2, endY: 3.15, radius: 0.09, padWidth: 1.95, droop: 0.08 },
      { angle: 5.05, startY: 2.25, midR: 1.05, midY: 2.95, endR: 2.0, endY: 3.6, radius: 0.08, padWidth: 1.85, droop: 0.07 },
    ],
    crownPads: [
      { x: 0.0, y: 4.6, z: 0.0, width: 2.15, droop: 0.05 },
      { x: -0.85, y: 4.0, z: 0.65, width: 1.85, droop: 0.06 },
      { x: 0.85, y: 4.1, z: -0.65, width: 1.85, droop: 0.06 },
    ],
  },
  {
    id: "weeping",
    baseHeight: 6.8,
    trunkBaseR: 0.2,
    trunkTopR: 0.068,
    barkColors: [0x452a1e, 0x5e3b2b],
    trunkCurve: [
      [0, -0.25, 0],
      [0.08, 0.95, -0.04],
      [0.15, 2.0, -0.08],
      [0.06, 3.0, -0.03],
      [-0.04, 3.85, 0.02],
    ],
    boughs: [
      { angle: 0.25, startY: 1.9, midR: 1.25, midY: 2.8, endR: 2.3, endY: 2.45, radius: 0.085, padWidth: 1.9, droop: 0.22 },
      { angle: 1.8, startY: 2.15, midR: 1.2, midY: 3.05, endR: 2.2, endY: 2.7, radius: 0.08, padWidth: 1.85, droop: 0.22 },
      { angle: 3.35, startY: 2.0, midR: 1.3, midY: 2.9, endR: 2.35, endY: 2.55, radius: 0.085, padWidth: 1.95, droop: 0.24 },
      { angle: 4.9, startY: 2.3, midR: 1.15, midY: 3.15, endR: 2.15, endY: 2.8, radius: 0.08, padWidth: 1.85, droop: 0.2 },
    ],
    crownPads: [
      { x: 0.0, y: 4.4, z: 0.0, width: 2.05, droop: 0.14 },
      { x: -0.85, y: 3.8, z: 0.55, width: 1.8, droop: 0.18 },
      { x: 0.85, y: 3.9, z: -0.55, width: 1.8, droop: 0.18 },
    ],
  },
  {
    id: "curved",
    baseHeight: 6.2,
    trunkBaseR: 0.19,
    trunkTopR: 0.062,
    barkColors: [0x473225, 0x634736],
    trunkCurve: [
      [0, -0.25, 0],
      [-0.18, 0.85, 0.1],
      [-0.25, 1.8, 0.14],
      [0.1, 2.7, -0.06],
      [0.18, 3.65, -0.1],
    ],
    boughs: [
      { angle: 0.5, startY: 1.7, midR: 1.1, midY: 2.2, endR: 2.0, endY: 2.65, radius: 0.08, padWidth: 1.8, droop: 0.08 },
      { angle: 2.4, startY: 2.1, midR: 1.05, midY: 2.7, endR: 1.95, endY: 3.15, radius: 0.075, padWidth: 1.75, droop: 0.06 },
      { angle: 4.3, startY: 2.45, midR: 1.1, midY: 3.05, endR: 2.0, endY: 3.5, radius: 0.07, padWidth: 1.75, droop: 0.06 },
    ],
    crownPads: [
      { x: 0.15, y: 4.2, z: -0.08, width: 1.95, droop: 0.05 },
      { x: -0.7, y: 3.6, z: 0.45, width: 1.7, droop: 0.06 },
    ],
  },
  {
    id: "small",
    baseHeight: 5.2,
    trunkBaseR: 0.15,
    trunkTopR: 0.05,
    barkColors: [0x452e20, 0x61422e],
    trunkCurve: [
      [0, -0.25, 0],
      [0.05, 0.7, -0.03],
      [-0.05, 1.5, 0.03],
      [0.02, 2.35, -0.02],
    ],
    boughs: [
      { angle: 0.3, startY: 1.25, midR: 0.82, midY: 1.7, endR: 1.5, endY: 2.15, radius: 0.06, padWidth: 1.55, droop: 0.06 },
      { angle: 2.4, startY: 1.45, midR: 0.78, midY: 1.9, endR: 1.45, endY: 2.35, radius: 0.055, padWidth: 1.5, droop: 0.06 },
      { angle: 4.5, startY: 1.65, midR: 0.8, midY: 2.1, endR: 1.42, endY: 2.5, radius: 0.055, padWidth: 1.5, droop: 0.06 },
    ],
    crownPads: [
      { x: 0.0, y: 3.05, z: 0.0, width: 1.75, droop: 0.04 },
    ],
  },
];

export function buildArchetypeGeometry(spec: ArchetypeSpec, seed: number): BufferGeometry {
  const rand = seeded(seed);
  const barkParts: BufferGeometry[] = [];
  const leafParts: BufferGeometry[] = [];

  const trunkPts = spec.trunkCurve.map(([x, y, z]) => new Vector3(x, y, z));
  const topPt = trunkPts[trunkPts.length - 1]!;
  barkParts.push(
    buildSmoothBranchTube(trunkPts, spec.trunkBaseR, spec.trunkTopR, 8, 7, spec.barkColors[0], spec.barkColors[1], true),
  );

  spec.boughs.forEach((b, bIdx) => {
    const ca = Math.cos(b.angle);
    const sa = Math.sin(b.angle);
    const p0 = new Vector3(ca * spec.trunkTopR * 0.5, b.startY, sa * spec.trunkTopR * 0.5);
    const p1 = new Vector3(ca * b.midR, b.midY, sa * b.midR);
    const p2 = new Vector3(ca * b.endR, b.endY, sa * b.endR);

    barkParts.push(
      buildSmoothBranchTube([p0, p1, p2], b.radius, b.radius * 0.26, 5, 5, spec.barkColors[0], spec.barkColors[1]),
    );

    leafParts.push(
      buildAiryBotanicalSpray(p2.x, p2.y + 0.06, p2.z, b.padWidth, b.droop, 4, rand),
    );

    if (bIdx % 2 === 0) {
      leafParts.push(
        buildAiryBotanicalSpray(p1.x * 1.05, p1.y + 0.12, p1.z * 1.05, b.padWidth * 0.76, b.droop, 3, rand),
      );
    }

    const side = bIdx % 2 === 0 ? 1 : -1;
    const fAngle = b.angle + side * (0.54 + rand() * 0.12);
    const fReach = b.endR * (0.84 + rand() * 0.12);
    const fEndY = b.endY + 0.28 - b.droop * 0.18;
    const fp2 = new Vector3(Math.cos(fAngle) * fReach, fEndY, Math.sin(fAngle) * fReach);

    barkParts.push(
      buildSmoothBranchTube([p1, fp2], b.radius * 0.52, b.radius * 0.18, 4, 4, spec.barkColors[0], spec.barkColors[1]),
    );

    leafParts.push(
      buildAiryBotanicalSpray(fp2.x, fp2.y + 0.05, fp2.z, b.padWidth * 0.82, b.droop, 4, rand),
    );
  });

  for (const cp of spec.crownPads) {
    const leaderEnd = new Vector3(cp.x, cp.y, cp.z);
    const leaderMid = new Vector3((topPt.x + cp.x) * 0.5, (topPt.y + cp.y) * 0.5, (topPt.z + cp.z) * 0.5);
    barkParts.push(
      buildSmoothBranchTube([topPt, leaderMid, leaderEnd], spec.trunkTopR * 0.85, spec.trunkTopR * 0.22, 4, 4, spec.barkColors[0], spec.barkColors[1]),
    );
    leafParts.push(buildAiryBotanicalSpray(cp.x, cp.y, cp.z, cp.width, cp.droop, 4, rand));
  }

  const mergedBark = mergeGeometries(barkParts, false);
  const mergedLeaves = mergeGeometries(leafParts, false);
  for (const g of barkParts) g.dispose();
  for (const g of leafParts) g.dispose();
  if (!mergedBark || !mergedLeaves) throw new Error(`merge: archetype ${spec.id}`);

  const combined = mergeGeometries([mergedBark, mergedLeaves], true);
  mergedBark.dispose();
  mergedLeaves.dispose();
  if (!combined) throw new Error(`merge: combined archetype ${spec.id}`);

  combined.computeBoundingBox();
  const bbox = combined.boundingBox ?? new Box3();
  const rawH = Math.max(0.01, bbox.max.y);
  const scale = spec.baseHeight / rawH;
  combined.scale(scale, scale, scale);
  combined.computeBoundingBox();
  combined.computeBoundingSphere();
  return combined;
}

export function buildWishingTreeGeometry(): BufferGeometry {
  const rand = seeded(0xb0de99);
  const barkParts: BufferGeometry[] = [];
  const leafParts: BufferGeometry[] = [];

  const trunkPts = [
    new Vector3(0.0, 0.0, 0.0),
    new Vector3(0.06, 0.9, -0.04),
    new Vector3(-0.07, 1.85, 0.05),
    new Vector3(-0.02, 2.8, 0.02),
    new Vector3(0.0, 3.85, 0.0),
  ];
  barkParts.push(buildSmoothBranchTube(trunkPts, 0.32, 0.1, 8, 7, 0x3d2518, 0x593926, true));

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.28;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const p0 = new Vector3(ca * 0.1, 2.35, sa * 0.1);
    const p1 = new Vector3(ca * 1.55, 3.25 + (i % 3) * 0.16, sa * 1.55);
    const p2 = new Vector3(ca * 2.55, 3.85 + (i % 2) * 0.18, sa * 2.55);
    barkParts.push(buildSmoothBranchTube([p0, p1, p2], 0.12, 0.035, 5, 5, 0x452a1c, 0x633e2b));

    leafParts.push(
      buildAiryBotanicalSpray(p1.x, p1.y + 0.48, p1.z, 1.85, 0.05, 4, rand),
      buildAiryBotanicalSpray(p2.x, p2.y + 0.32, p2.z, 1.95, 0.06, 4, rand),
    );
  }

  for (let c = 0; c < 4; c++) {
    const a = (c / 4) * Math.PI * 2 + 0.4;
    const rad = c === 0 ? 0.0 : 1.15;
    const cy = c === 0 ? 6.0 : 5.15;
    leafParts.push(buildAiryBotanicalSpray(Math.cos(a) * rad, cy, Math.sin(a) * rad, 2.1, 0.04, 4, rand));
  }

  const mergedBark = mergeGeometries(barkParts, false);
  const mergedLeaves = mergeGeometries(leafParts, false);
  for (const g of barkParts) g.dispose();
  for (const g of leafParts) g.dispose();
  if (!mergedBark || !mergedLeaves) throw new Error("merge: wishing tree");

  const combined = mergeGeometries([mergedBark, mergedLeaves], true);
  mergedBark.dispose();
  mergedLeaves.dispose();
  if (!combined) throw new Error("merge: wishing tree combined");

  combined.computeBoundingBox();
  const bbox = combined.boundingBox ?? new Box3();
  const rawH = Math.max(0.01, bbox.max.y - bbox.min.y);
  const scale = WISH_TREE_BASE_HEIGHT / rawH;
  combined.translate(0, -bbox.min.y, 0);
  combined.scale(scale, scale, scale);
  combined.computeBoundingBox();
  combined.computeBoundingSphere();
  return combined;
}
