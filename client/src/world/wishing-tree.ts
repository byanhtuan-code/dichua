import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  SphereGeometry,
  Vector2,
  Vector3,
  type Material,
  type Object3D,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { GATE } from "@santinh/shared";
import { registerCameraPreset } from "../debug/params.ts";
import { maxAnisotropy } from "../engine/renderer.ts";
import { seeded } from "./random.ts";
import {
  createAncientWishingTreeAsset,
  paintGeom,
  type BoughHangAnchor,
} from "./wishing-tree-trunk.ts";

const GATE_Z = (GATE.zMin + GATE.zMax) / 2;
const GATE_WALL_X = 18;

/**
 * Placed INSIDE the temple courtyard garden (z = GATE_Z - 4.2),
 * standing parallel in front of the left perimeter wall (x = -11.5)
 * so players can walk directly onto the stepping stones and prayer platform.
 */
export const WISH_TREE_POS = {
  x: -11.5,
  z: GATE_Z - 4.2,
} as const;

/** Interactive plaques that swing strongly when `hangWish()` is triggered. */
const MAX_PLAQUES = 36;
const INITIAL_PLAQUES = 18;
/** Abundant static/breeze-swaying 3D wishing plaques clustered across the boughs (~168 plaques + 36 interactive = 204 total). */
const STATIC_CLUSTER_PLAQUES = 168;

const m4 = new Matrix4();
const q = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();
const tmpEuler = new Euler();

/**
 * Kept for 100% backward compatibility with `maple-forest.ts` / `garden.ts`.
 * The Wishing Tree now uses its own dedicated Sacred Ancient Wishing Tree 3D model.
 */
export function attachAncientTreeToWishingTree(
  _geometry: BufferGeometry,
  _material: Material | Material[],
): void {
  // No-op: the Wishing Tree now builds its own bespoke ancient tree via `wishing-tree-trunk.ts`.
}

// ============================================================================
// 1. HIGH-RES WISHING PLAQUE TEXTURE ATLAS (WOOD GRAIN, DO PAPER, LOTUS & CALLIGRAPHY)
// ============================================================================

/**
 * Draws a 1024x1024 4-column x 2-row texture atlas for the wishing plaques:
 * - Finishes: Natural Wood (`Nâu gỗ sáng`), Traditional Dó Paper (`Vàng kem`),
 *   Vermilion Lacquer (`Đỏ son`), Deep Crimson (`Đỏ đô`), and Imperial Gold (`Vàng kim`).
 * - Details: Wood grain / paper fibers, pierced cord hole with brass eyelet,
 *   traditional corner fretwork, sacred Lotus flower emblem, and balanced Vietnamese wishes.
 */
function drawWishingPlaqueAtlasTexture(size = 1024): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");

  const cols = 4;
  const rows = 2;
  const cellW = size / cols;
  const cellH = size / rows;
  const rand = seeded(0x5a71c0de);

  interface CardTheme {
    readonly bgTop: string;
    readonly bgBot: string;
    readonly border: string;
    readonly text: string;
    readonly lotus: string;
    readonly title: string;
    readonly sub: string;
  }

  const themes: readonly CardTheme[] = [
    { bgTop: "#d8a86e", bgBot: "#ba854a", border: "#5c3618", text: "#3b1e0a", lotus: "#b8321a", title: "BÌNH AN", sub: "Tâm Tịnh An Nhiên" },
    { bgTop: "#f7ecd0", bgBot: "#e8d5a8", border: "#9e6b2e", text: "#7a1812", lotus: "#c93822", title: "AN LẠC", sub: "Vạn Sự Cát Tường" },
    { bgTop: "#c92a1d", bgBot: "#9e1910", border: "#f2c96d", text: "#fff4d2", lotus: "#ffd470", title: "HẠNH PHÚC", sub: "Gia Đạo Bình An" },
    { bgTop: "#7d1416", bgBot: "#590c0e", border: "#e5b44c", text: "#ffeaad", lotus: "#f5c258", title: "PHÚC LỘC", sub: "Thiện Tâm Viên Mãn" },
    { bgTop: "#e8bd56", bgBot: "#c79228", border: "#613612", text: "#4a1208", lotus: "#a81e12", title: "SỨC KHỎE", sub: "Thân Tâm Thường Lạc" },
    { bgTop: "#f2e2ba", bgBot: "#dec692", border: "#8a2418", text: "#6e140c", lotus: "#c42b1c", title: "TÂM TỊNH", sub: "Trí Tuệ Sáng Suốt" },
    { bgTop: "#b82218", bgBot: "#8c140c", border: "#f5ce72", text: "#fff6db", lotus: "#ffda78", title: "CÁT TƯỜNG", sub: "Ước Nguyện Thành Tựu" },
    { bgTop: "#cfa063", bgBot: "#ab783e", border: "#4d2b12", text: "#2e1506", lotus: "#9e2416", title: "NHƯ Ý", sub: "Bình Yên Hạnh Phúc" },
  ];

  const drawLotusEmblem = (cx: number, cy: number, r: number, color: string): void => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;

    const petals = [-1.1, -0.58, 0, 0.58, 1.1] as const;
    for (const a of petals) {
      ctx.save();
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-r * 0.34, -r * 0.55, 0, -r);
      ctx.quadraticCurveTo(r * 0.34, -r * 0.55, 0, 0);
      ctx.fill();
      ctx.restore();
    }

    // Lotus base cup line
    ctx.beginPath();
    ctx.arc(0, r * 0.08, r * 0.55, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.restore();
  };

  themes.forEach((th, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x0 = col * cellW;
    const y0 = row * cellH;
    const cx = x0 + cellW * 0.5;

    // 1. Base wood or Dó paper gradient
    const g = ctx.createLinearGradient(x0, y0, x0, y0 + cellH);
    g.addColorStop(0, th.bgTop);
    g.addColorStop(1, th.bgBot);
    ctx.fillStyle = g;
    ctx.fillRect(x0, y0, cellW, cellH);

    // 2. Subtle wood grain striations & paper fibers
    ctx.strokeStyle = "rgba(40, 20, 8, 0.10)";
    ctx.lineWidth = 2.0;
    for (let s = 0; s < 28; s++) {
      const gx = x0 + ((s + 0.5) / 28) * cellW;
      ctx.beginPath();
      ctx.moveTo(gx, y0);
      ctx.quadraticCurveTo(gx + (rand() - 0.5) * 14, y0 + cellH * 0.5, gx + (rand() - 0.5) * 10, y0 + cellH);
      ctx.stroke();
    }

    // 3. Traditional double decorative border with slightly weathered inner corners
    const pad = 18;
    ctx.strokeStyle = th.border;
    ctx.lineWidth = 4.5;
    ctx.strokeRect(x0 + pad, y0 + pad, cellW - pad * 2, cellH - pad * 2);

    ctx.lineWidth = 2.0;
    ctx.strokeRect(x0 + pad + 8, y0 + pad + 8, cellW - (pad + 8) * 2, cellH - (pad + 8) * 2);

    // Corner auspicious fretwork squares
    const cSize = 14;
    for (const [dx, dy] of [
      [pad + 8, pad + 8],
      [cellW - pad - 8 - cSize, pad + 8],
      [pad + 8, cellH - pad - 8 - cSize],
      [cellW - pad - 8 - cSize, cellH - pad - 8 - cSize],
    ] as const) {
      ctx.strokeRect(x0 + dx, y0 + dy, cSize, cSize);
    }

    // 4. Top pierced hole with brass/wood rim for the hanging cord
    const holeY = y0 + 52;
    ctx.fillStyle = "#26170c";
    ctx.beginPath();
    ctx.arc(cx, holeY, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = th.border;
    ctx.lineWidth = 3.5;
    ctx.stroke();

    // 5. Sacred Lotus Emblem above the calligraphy
    drawLotusEmblem(cx, y0 + 132, 34, th.lotus);

    // 6. Crisp, balanced Calligraphy Wish Title & Sub-prayer
    ctx.fillStyle = th.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 34px 'Noto Serif', 'Times New Roman', serif";
    ctx.fillText(th.title, cx, y0 + 235);

    // Decorative divider diamond
    ctx.fillStyle = th.lotus;
    ctx.beginPath();
    ctx.moveTo(cx, y0 + 278);
    ctx.lineTo(cx + 8, y0 + 286);
    ctx.lineTo(cx, y0 + 294);
    ctx.lineTo(cx - 8, y0 + 286);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = th.text;
    ctx.font = "italic 20px 'Noto Serif', 'Times New Roman', serif";
    ctx.fillText(th.sub, cx, y0 + 345);

    // Bottom lotus scroll motif
    drawLotusEmblem(cx, y0 + 432, 22, th.border);
  });

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAnisotropy();
  return tex;
}

// ============================================================================
// 2. FOUR 3D PLAQUE SHAPES + INDIVIDUAL KNOTTED HANGING CORDS
// ============================================================================

type PlaqueShapeKind = "rect" | "rounded" | "leaf" | "drop";

const CORD_COLORS = [
  0xc91e18, // 1. Đỏ thắm (Crimson Red)
  0x7d1214, // 2. Đỏ đô (Deep Burgundy)
  0xe5b53d, // 3. Vàng kim (Imperial Gold)
  0xc95b24, // 4. Cam đất (Terracotta Orange)
] as const;

/**
 * Remaps the planar UVs of a 3D plaque body into one of the 8 cells `(col 0..3, row 0..1)`
 * of the 1024x1024 Wishing Plaque Atlas texture.
 */
function mapPlaqueUVToAtlas(g: BufferGeometry, halfW: number, yTop: number, yBot: number, cellIdx: number): void {
  const pos = g.getAttribute("position");
  const nrm = g.getAttribute("normal");
  const uv = g.getAttribute("uv");
  const col = cellIdx % 4;
  const row = Math.floor(cellIdx / 4) % 2;

  const uMin = (col + 0.06) / 4;
  const uMax = (col + 0.94) / 4;
  const vMin = 1 - (row + 0.96) / 2;
  const vMax = 1 - (row + 0.04) / 2;

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const nz = nrm.getZ(i);

    if (Math.abs(nz) > 0.45) {
      const uNorm = Math.max(0, Math.min(1, (x + halfW) / (halfW * 2)));
      const vNorm = Math.max(0, Math.min(1, (y - yBot) / (yTop - yBot)));
      uv.setXY(i, uMin + uNorm * (uMax - uMin), vMin + vNorm * (vMax - vMin));
    } else {
      // Side thickness edges sample the warm wood/gold border strip of the cell
      uv.setXY(i, uMin + 0.01, (vMin + vMax) * 0.5);
    }
  }
}

/**
 * Builds one complete 3D Wishing Plaque + its individual hanging cord:
 * - Branch knot ring (`nút thắt tại điểm nối với cành`) at `y = 0`.
 * - Slender twisted cord of length `cordLen` (`0.22m – 0.54m`) with an auspicious decorative knot.
 * - Cord threading through the top hole of the 3D plaque (`rect`, `rounded`, `leaf`, or `drop`).
 */
function build3DPlaqueWithCord(
  shape: PlaqueShapeKind,
  cordLen: number,
  cordHex: number,
  atlasCell: number,
): { cordGeo: BufferGeometry; bodyGeo: BufferGeometry } {
  const cordParts: BufferGeometry[] = [];
  const bodyParts: BufferGeometry[] = [];

  // 1. Knot wrapped around the branch at y = 0 (`nút thắt tại điểm nối với cành`)
  const branchWrap = new CylinderGeometry(0.016, 0.016, 0.022, 8);
  branchWrap.rotateZ(Math.PI * 0.5);
  cordParts.push(paintGeom(branchWrap, cordHex));

  const topKnot = new SphereGeometry(0.015, 7, 6);
  topKnot.translate(0, -0.016, 0);
  cordParts.push(paintGeom(topKnot, cordHex));

  // 2. Individual hanging cord from y = -0.016 down to the plaque hole at y = -cordLen
  const mainCord = new CylinderGeometry(0.0048, 0.0048, cordLen, 6);
  mainCord.translate(0, -cordLen * 0.5, 0);
  cordParts.push(paintGeom(mainCord, cordHex));

  // Decorative Chinese/Buddhist Pan-Chang auspicious knot at 62% of the cord length
  const knotY = -cordLen * 0.62;
  const decoKnot = new BoxGeometry(0.024, 0.024, 0.012);
  decoKnot.rotateZ(Math.PI * 0.25);
  decoKnot.translate(0, knotY, 0);
  cordParts.push(paintGeom(decoKnot, 0xf2c252));

  // Loop threading through the hole at the top of the plaque
  const holeY = -cordLen - 0.024;
  const eyeLoop = new CylinderGeometry(0.009, 0.009, 0.022, 6);
  eyeLoop.rotateX(Math.PI * 0.5);
  eyeLoop.translate(0, holeY, 0);
  cordParts.push(paintGeom(eyeLoop, cordHex));

  // 3. Build the 3D Plaque Body with real thickness (0.016m) hanging below y = -cordLen
  const pTop = -cordLen;
  const pHeight = 0.25;
  const pBot = pTop - pHeight;
  const halfW = 0.068;
  const thickness = 0.016;

  if (shape === "rect") {
    // Shape 1: Classic standing rectangular wooden/lacquer tablet with top cap
    const tablet = new BoxGeometry(halfW * 2, pHeight, thickness, 2, 4, 1);
    tablet.translate(0, pTop - pHeight * 0.5, 0);
    mapPlaqueUVToAtlas(tablet, halfW, pTop, pBot, atlasCell);
    bodyParts.push(paintGeom(tablet, 0xffffff));

    const roofBar = new BoxGeometry(halfW * 2.12, 0.018, thickness * 1.25);
    roofBar.translate(0, pTop - 0.008, 0);
    cordParts.push(paintGeom(roofBar, 0xd99b38));
  } else if (shape === "rounded") {
    // Shape 2: Chamfered / rounded-corner Ema-style tablet
    const tablet = new BoxGeometry(halfW * 2, pHeight, thickness, 4, 6, 1);
    const pos = tablet.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const yn = (y + pHeight * 0.5) / pHeight; // 0..1
      const cornerPinch = yn > 0.82 ? 1 - (yn - 0.82) * 1.45 : yn < 0.12 ? 0.88 + yn : 1.0;
      pos.setX(i, x * cornerPinch);
    }
    tablet.computeVertexNormals();
    tablet.translate(0, pTop - pHeight * 0.5, 0);
    mapPlaqueUVToAtlas(tablet, halfW, pTop, pBot, atlasCell);
    bodyParts.push(paintGeom(tablet, 0xffffff));
  } else if (shape === "leaf") {
    // Shape 3: Sacred Bodhi-leaf shaped 3D plaque with pointed drip-tip at bottom
    const tablet = new BoxGeometry(halfW * 2.15, pHeight * 1.06, thickness * 0.9, 6, 8, 1);
    const pos = tablet.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const yn = (y + pHeight * 0.53) / (pHeight * 1.06); // 0 at drip tip, 1 at top stem
      const leafProfile = Math.sin(Math.pow(yn, 0.68) * Math.PI) * 1.08;
      pos.setX(i, x * Math.max(0.06, leafProfile));
    }
    tablet.computeVertexNormals();
    tablet.translate(0, pTop - pHeight * 0.53, 0);
    mapPlaqueUVToAtlas(tablet, halfW * 1.05, pTop, pBot - 0.015, atlasCell);
    bodyParts.push(paintGeom(tablet, 0xffffff));
  } else {
    // Shape 4: Water-drop / Teardrop shaped 3D plaque
    const tablet = new BoxGeometry(halfW * 2.05, pHeight, thickness * 0.95, 6, 8, 1);
    const pos = tablet.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const yn = (y + pHeight * 0.5) / pHeight; // 0 at bottom round bulb, 1 at top apex
      const dropProfile = Math.sin((1 - yn * 0.82) * Math.PI * 0.85);
      pos.setX(i, x * Math.max(0.12, dropProfile));
    }
    tablet.computeVertexNormals();
    tablet.translate(0, pTop - pHeight * 0.5, 0);
    mapPlaqueUVToAtlas(tablet, halfW, pTop, pBot, atlasCell);
    bodyParts.push(paintGeom(tablet, 0xffffff));
  }

  // 4. Delicate silk tassel hanging below the plaque
  const tasselTop = pBot - 0.008;
  const tasselBead = new SphereGeometry(0.011, 6, 5);
  tasselBead.translate(0, tasselTop, 0);
  cordParts.push(paintGeom(tasselBead, 0xe8b948));

  const tasselFringe = new ConeGeometry(0.016, 0.075, 6);
  tasselFringe.translate(0, tasselTop - 0.042, 0);
  cordParts.push(paintGeom(tasselFringe, cordHex));

  const mergedCord = mergeGeometries(cordParts, false);
  const mergedBody = mergeGeometries(bodyParts, false);
  for (const p of cordParts) p.dispose();
  for (const p of bodyParts) p.dispose();
  if (!mergedCord || !mergedBody) throw new Error("merge: 3d plaque with cord");

  return { cordGeo: mergedCord, bodyGeo: mergedBody };
}

// ============================================================================
// 3. TRADITIONAL HEXAGONAL/CYLINDRICAL LANTERNS & BRONZE WIND CHIMES
// ============================================================================

function buildLanternsAndChimes(anchors: readonly BoughHangAnchor[]): {
  frameGeo: BufferGeometry;
  glowGeo: BufferGeometry;
} {
  const frameParts: BufferGeometry[] = [];
  const glowParts: BufferGeometry[] = [];

  // Select 10 well-spaced bough anchors for traditional lanterns (alternating hexagonal & cylindrical)
  const lanternStep = Math.max(1, Math.floor(anchors.length / 10));
  for (let i = 0; i < 10; i++) {
    const a = anchors[(i * lanternStep + 2) % anchors.length]!;
    const cordLen = 0.34 + (i % 3) * 0.1;
    const isHex = i % 2 === 0;
    const sides = isHex ? 6 : 12;

    // Metal hook & hanging cord
    const hookRing = new CylinderGeometry(0.02, 0.02, 0.025, 8);
    hookRing.rotateZ(Math.PI * 0.5);
    hookRing.translate(a.x, a.y, a.z);
    frameParts.push(paintGeom(hookRing, 0x5c3a21));

    const cord = new CylinderGeometry(0.006, 0.006, cordLen, 6);
    cord.translate(a.x, a.y - cordLen * 0.5, a.z);
    frameParts.push(paintGeom(cord, 0x8a1e14));

    const bodyTopY = a.y - cordLen;
    const bodyH = 0.28;
    const bodyMidY = bodyTopY - bodyH * 0.5;
    const bodyBotY = bodyTopY - bodyH;

    // Reddish-brown wooden top roof & bottom base rim
    const topCap = new ConeGeometry(0.18, 0.1, sides);
    topCap.translate(a.x, bodyTopY + 0.02, a.z);
    frameParts.push(paintGeom(topCap, 0x542616));

    const botRim = new CylinderGeometry(0.13, 0.11, 0.04, sides);
    botRim.translate(a.x, bodyBotY - 0.01, a.z);
    frameParts.push(paintGeom(botRim, 0x542616));

    // Wooden corner struts around the lantern paper
    for (let s = 0; s < 4; s++) {
      const sa = (s / 4) * Math.PI * 2 + i * 0.3;
      const strut = new CylinderGeometry(0.008, 0.008, bodyH, 4);
      strut.translate(a.x + Math.cos(sa) * 0.125, bodyMidY, a.z + Math.sin(sa) * 0.125);
      frameParts.push(paintGeom(strut, 0x4a2012));
    }

    // Cream paper glowing core (`vách giấy màu vàng kem phát sáng dịu`)
    const paperCore = new CylinderGeometry(0.118, 0.118, bodyH * 0.88, sides);
    paperCore.translate(a.x, bodyMidY, a.z);
    glowParts.push(paintGeom(paperCore, 0xffe6b0));

    // Bottom tassel (`tua trang trí phía dưới`)
    const tasselCord = new CylinderGeometry(0.005, 0.005, 0.08, 4);
    tasselCord.translate(a.x, bodyBotY - 0.06, a.z);
    frameParts.push(paintGeom(tasselCord, 0xd9a036));

    const tasselCone = new ConeGeometry(0.026, 0.12, 6);
    tasselCone.translate(a.x, bodyBotY - 0.14, a.z);
    frameParts.push(paintGeom(tasselCone, 0xc42418));
  }

  // Select 6 outer bough anchors for delicate Bronze Wind Chimes (`chuông gió nhỏ bằng đồng`)
  const bellProfile = [
    new Vector2(0.001, 0.09),
    new Vector2(0.022, 0.082),
    new Vector2(0.038, 0.05),
    new Vector2(0.046, 0.01),
    new Vector2(0.052, 0.0),
  ];
  const baseBellGeo = new LatheGeometry(bellProfile, 10);

  for (let c = 0; c < 6; c++) {
    const a = anchors[(c * 9 + 5) % anchors.length]!;
    const cord = new CylinderGeometry(0.004, 0.004, 0.24, 4);
    cord.translate(a.x, a.y - 0.12, a.z);
    frameParts.push(paintGeom(cord, 0x6e4720));

    const bell = baseBellGeo.clone();
    bell.translate(a.x, a.y - 0.32, a.z);
    frameParts.push(paintGeom(bell, 0xc89b42));

    // Wind-catching calligraphy slip hanging under the bronze bell
    const windSlip = new BoxGeometry(0.036, 0.14, 0.004);
    windSlip.rotateY(c * 0.7);
    windSlip.translate(a.x, a.y - 0.45, a.z);
    frameParts.push(paintGeom(windSlip, 0xf2dfb3));
  }
  baseBellGeo.dispose();

  const frameGeo = mergeGeometries(frameParts, false);
  const glowGeo = mergeGeometries(glowParts, false);
  for (const p of frameParts) p.dispose();
  for (const p of glowParts) p.dispose();
  if (!frameGeo || !glowGeo) throw new Error("merge: wishing tree lanterns and chimes");

  return { frameGeo, glowGeo };
}
// ============================================================================
// 4. SACRED SUNBEAMS & FLOATING GOLDEN LIGHT MOTES AROUND THE ROOTS
// ============================================================================

function buildSacredSunbeamsAndMotes(rand: () => number): {
  group: Group;
  update(t: number, daylight: number): void;
  dispose(): void;
} {
  const group = new Group();
  group.name = "wishing-tree-atmosphere";

  // 1. Soft diagonal golden sunbeams filtering through the ancient boughs
  const beamCanvas = document.createElement("canvas");
  beamCanvas.width = 64;
  beamCanvas.height = 128;
  const bCtx = beamCanvas.getContext("2d");
  if (bCtx) {
    const g = bCtx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, "rgba(255, 232, 168, 0.0)");
    g.addColorStop(0.28, "rgba(255, 216, 132, 0.26)");
    g.addColorStop(0.7, "rgba(255, 196, 102, 0.12)");
    g.addColorStop(1, "rgba(255, 178, 82, 0.0)");
    bCtx.fillStyle = g;
    bCtx.fillRect(0, 0, 64, 128);

    bCtx.globalCompositeOperation = "destination-in";
    const hg = bCtx.createLinearGradient(0, 0, 64, 0);
    hg.addColorStop(0, "rgba(0,0,0,0)");
    hg.addColorStop(0.5, "rgba(0,0,0,1)");
    hg.addColorStop(1, "rgba(0,0,0,0)");
    bCtx.fillStyle = hg;
    bCtx.fillRect(0, 0, 64, 128);
  }
  const beamTex = new CanvasTexture(beamCanvas);
  beamTex.colorSpace = SRGBColorSpace;

  const beamMat = new MeshBasicMaterial({
    map: beamTex,
    color: new Color(0xffd27d),
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });

  const beamParts: BufferGeometry[] = [];
  for (let b = 0; b < 5; b++) {
    const a = (b / 5) * Math.PI * 2 + 0.4;
    const plane = new PlaneGeometry(1.85, 8.6);
    plane.translate(0, 4.1, 0);
    tmpEuler.set(-0.16, a, -0.32, "YXZ");
    q.setFromEuler(tmpEuler);
    m4.compose(v3.set(Math.cos(a) * 1.4, 0, Math.sin(a) * 1.4), q, s3.set(1, 1, 1));
    plane.applyMatrix4(m4);
    beamParts.push(plane);
  }
  const beamGeo = mergeGeometries(beamParts, false);
  for (const p of beamParts) p.dispose();
  if (!beamGeo) throw new Error("merge: wishing tree sunbeams");
  const beamMesh = new Mesh(beamGeo, beamMat);
  beamMesh.renderOrder = 2;
  group.add(beamMesh);

  // 2. Subtle floating golden light motes & gently drifting leaves around the trunk base
  const moteCount = 28;
  const moteParts: BufferGeometry[] = [];
  for (let m = 0; m < moteCount; m++) {
    const a = rand() * Math.PI * 2;
    const r = 1.1 + rand() * 3.6;
    const y = 0.45 + rand() * 3.4;
    const mote = new SphereGeometry(0.022 + (m % 3) * 0.006, 5, 4);
    const phase = rand() * Math.PI * 2;
    const pos = mote.getAttribute("position");
    const phases = new Float32Array(pos.count);
    phases.fill(phase);
    mote.setAttribute("aPhase", new Float32BufferAttribute(phases, 1));
    mote.translate(Math.cos(a) * r, y, Math.sin(a) * r);
    moteParts.push(paintGeom(mote, m % 3 === 0 ? 0xffdf88 : 0xffb85c));
  }
  const moteGeo = mergeGeometries(moteParts, false);
  for (const p of moteParts) p.dispose();
  if (!moteGeo) throw new Error("merge: wishing tree motes");

  const uMoteTime = { value: 0 };
  const moteMat = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.65,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  moteMat.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = uMoteTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nattribute float aPhase;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        transformed.y += 0.22 * sin(uTime * 0.75 + aPhase);
        transformed.x += 0.12 * cos(uTime * 0.55 + aPhase * 1.3);
        transformed.z += 0.12 * sin(uTime * 0.62 - aPhase);`,
      );
  };
  const moteMesh = new Mesh(moteGeo, moteMat);
  group.add(moteMesh);

  return {
    group,
    update(t, daylight) {
      uMoteTime.value = t;
      const sunFactor = Math.max(0, (daylight - 0.25) / 0.75);
      beamMesh.visible = sunFactor > 0.02;
      beamMat.opacity = sunFactor * 0.16;
      moteMat.opacity = 0.42 + 0.28 * Math.sin(t * 1.4);
    },
    dispose() {
      beamGeo.dispose();
      beamMat.dispose();
      beamTex.dispose();
      moteGeo.dispose();
      moteMat.dispose();
    },
  };
}

// ============================================================================
// 5. MAIN WISHING TREE CONTROLLER (ANCIENT MODEL, 204 PLAQUES, LANTERNS & CHIMES)
// ============================================================================

interface PlaqueState {
  active: boolean;
  x: number;
  y: number;
  z: number;
  baseYaw: number;
  phase: number;
  freq: number;
  scale: number;
  impulse: number;
}

export interface WishingTree {
  /** Activates a new wishing plaque on the sacred tree with a joyful breeze swing. */
  hangWish(): void;
  update(t: number, daylight: number): void;
  dispose(): void;
}

export function createWishingTree(parent: Object3D): WishingTree {
  const rand = seeded(0xb0de);

  const root = new Group();
  root.position.set(WISH_TREE_POS.x, 0, WISH_TREE_POS.z);
  root.name = "wishing-tree";

  // 1. Build & mount the sacred ancient wishing tree asset & base sanctuary
  const ancientAsset = createAncientWishingTreeAsset();
  const treeMesh = new Mesh(ancientAsset.treeGeometry, ancientAsset.treeMaterials);
  treeMesh.castShadow = true;
  treeMesh.receiveShadow = true;
  treeMesh.frustumCulled = false;
  treeMesh.name = "wishing-tree-sacred-ancient";
  treeMesh.matrixAutoUpdate = false;
  treeMesh.updateMatrix();

  const sanctuaryMesh = new Mesh(ancientAsset.sanctuaryGeometry, ancientAsset.sanctuaryMaterials);
  sanctuaryMesh.receiveShadow = true;
  sanctuaryMesh.castShadow = true;
  sanctuaryMesh.frustumCulled = false;
  sanctuaryMesh.name = "wishing-tree-sacred-sanctuary";
  sanctuaryMesh.matrixAutoUpdate = false;
  sanctuaryMesh.updateMatrix();

  // 2. Build traditional lanterns & bronze wind chimes attached along the bough anchors
  const lanternData = buildLanternsAndChimes(ancientAsset.hangAnchors);
  const lanternMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.18,
  });
  const lanternMesh = new Mesh(lanternData.frameGeo, lanternMat);
  lanternMesh.frustumCulled = false;
  lanternMesh.matrixAutoUpdate = false;
  lanternMesh.updateMatrix();

  const glowLanternMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.3,
    emissive: new Color(0xffb84d),
    emissiveIntensity: 1.15,
  });
  const glowLanternMesh = new Mesh(lanternData.glowGeo, glowLanternMat);
  glowLanternMesh.frustumCulled = false;
  glowLanternMesh.matrixAutoUpdate = false;
  glowLanternMesh.updateMatrix();

  // 3. Build 8 Distinct 3D Plaque Variations (4 shapes x 4 cord colors x 8 calligraphy wishes)
  const plaqueAtlasTex = drawWishingPlaqueAtlasTexture(1024);
  const uPlaqueTime = { value: 0 };

  const cordMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.68,
    metalness: 0.08,
  });

  const plaqueMat = new MeshStandardMaterial({
    map: plaqueAtlasTex,
    vertexColors: true,
    roughness: 0.42,
    metalness: 0.12,
    emissive: new Color(0x6e1810),
    emissiveIntensity: 0.18,
  });

  // Gentle breeze pendulum sway shader for the 168 clustered wishing plaques
  const attachPlaqueBreezeShader = (mat: MeshStandardMaterial): void => {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms["uTime"] = uPlaqueTime;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform float uTime;")
        .replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
          float phase = transformed.x * 1.9 + transformed.z * 1.9;
          float breeze = 0.018 * sin(uTime * 1.6 + phase);
          transformed.x += breeze;
          transformed.z += breeze * 0.75;`,
        );
    };
  };
  attachPlaqueBreezeShader(cordMat);
  attachPlaqueBreezeShader(plaqueMat);

  const shapes: readonly PlaqueShapeKind[] = ["rect", "rounded", "leaf", "drop"];
  const cordParts: BufferGeometry[] = [];
  const bodyParts: BufferGeometry[] = [];
  const anchors = ancientAsset.hangAnchors;

  for (let i = 0; i < STATIC_CLUSTER_PLAQUES; i++) {
    const anchor = anchors[i % anchors.length]!;
    const shape = shapes[i % shapes.length]!;
    const cordHex = CORD_COLORS[i % CORD_COLORS.length]!;
    const cordLen = 0.22 + (i % 5) * 0.065 + rand() * 0.04;
    const atlasCell = i % 8;

    const sample = build3DPlaqueWithCord(shape, cordLen, cordHex, atlasCell);

    // Offset slightly along the branch axis so clusters hang naturally along the bough without floating
    const alongBranch = ((i % 3) - 1) * 0.14 + (rand() - 0.5) * 0.08;
    const acrossBranch = (rand() - 0.5) * anchor.branchRadius * 0.45;
    const bx = anchor.x + Math.cos(anchor.branchYaw) * alongBranch - Math.sin(anchor.branchYaw) * acrossBranch;
    const bz = anchor.z + Math.sin(anchor.branchYaw) * alongBranch + Math.cos(anchor.branchYaw) * acrossBranch;
    const by = anchor.y + 0.01;

    const yaw = -anchor.branchYaw + Math.PI * 0.5 + (rand() - 0.5) * 0.65;
    const sc = (anchor.tier === "low" ? 0.96 : 0.88) + rand() * 0.18;

    tmpEuler.set((rand() - 0.5) * 0.08, yaw, (rand() - 0.5) * 0.08, "YXZ");
    q.setFromEuler(tmpEuler);
    m4.compose(v3.set(bx, by, bz), q, s3.setScalar(sc));

    sample.cordGeo.applyMatrix4(m4);
    sample.bodyGeo.applyMatrix4(m4);
    cordParts.push(sample.cordGeo);
    bodyParts.push(sample.bodyGeo);
  }

  const mergedClusterCords = mergeGeometries(cordParts, false);
  const mergedClusterBodies = mergeGeometries(bodyParts, false);
  for (const p of cordParts) p.dispose();
  for (const p of bodyParts) p.dispose();
  if (!mergedClusterCords || !mergedClusterBodies) throw new Error("merge: wishing plaque clusters");

  const clusterPlaqueGeo = mergeGeometries([mergedClusterCords, mergedClusterBodies], true);
  mergedClusterCords.dispose();
  mergedClusterBodies.dispose();
  if (!clusterPlaqueGeo) throw new Error("merge: combined wishing plaque clusters");

  const clusterPlaqueMesh = new Mesh(clusterPlaqueGeo, [cordMat, plaqueMat]);
  clusterPlaqueMesh.frustumCulled = false;
  clusterPlaqueMesh.castShadow = false;
  clusterPlaqueMesh.matrixAutoUpdate = false;
  clusterPlaqueMesh.updateMatrix();
  clusterPlaqueMesh.name = "wishing-plaques-clustered";

  // 4. Interactive Wishing Plaques (36 low-bough plaques triggered via `hangWish()`)
  const lowAnchors = anchors.filter((a) => a.tier === "low");
  const interactivePool = lowAnchors.length > 0 ? lowAnchors : anchors;

  const interactiveSample = build3DPlaqueWithCord("rounded", 0.34, CORD_COLORS[0], 2);
  const cordMesh = new InstancedMesh(interactiveSample.cordGeo, cordMat, MAX_PLAQUES);
  const plaqueBodyMesh = new InstancedMesh(interactiveSample.bodyGeo, plaqueMat, MAX_PLAQUES);
  cordMesh.frustumCulled = false;
  plaqueBodyMesh.frustumCulled = false;
  cordMesh.name = "wishing-plaques-interactive-cords";
  plaqueBodyMesh.name = "wishing-plaques-interactive-bodies";

  const plaques: PlaqueState[] = Array.from({ length: MAX_PLAQUES }, (_, i) => {
    const anchor = interactivePool[i % interactivePool.length]!;
    const along = ((i % 2) - 0.5) * 0.16;
    const px = anchor.x + Math.cos(anchor.branchYaw) * along;
    const pz = anchor.z + Math.sin(anchor.branchYaw) * along;
    const py = anchor.y + 0.01;
    const radialAngle = Math.atan2(pz, px);

    return {
      active: i < INITIAL_PLAQUES,
      x: px,
      y: py,
      z: pz,
      baseYaw: -radialAngle + Math.PI * 0.5 + (rand() - 0.5) * 0.45,
      phase: rand() * Math.PI * 2,
      freq: 1.55 + rand() * 0.65,
      scale: 0.98 + rand() * 0.2,
      impulse: 0,
    };
  });

  let nextSlot = INITIAL_PLAQUES % MAX_PLAQUES;
  let lastT = 0;

  const updateInteractivePlaques = (t: number, dt: number): void => {
    for (let i = 0; i < MAX_PLAQUES; i++) {
      const p = plaques[i];
      if (!p) continue;
      if (!p.active) {
        const hideMat = m4.compose(v3.set(0, -10, 0), q.identity(), s3.setScalar(0));
        cordMesh.setMatrixAt(i, hideMat);
        plaqueBodyMesh.setMatrixAt(i, hideMat);
        continue;
      }
      if (p.impulse > 0) {
        p.impulse = Math.max(0, p.impulse - dt * 0.42);
      }
      const breeze = 0.09 + p.impulse * 0.34;
      const pitch = Math.sin(t * p.freq + p.phase) * breeze;
      const roll = Math.cos(t * (p.freq * 0.76) + p.phase * 1.25) * (breeze * 0.65);
      const yaw = p.baseYaw + Math.sin(t * 0.85 + p.phase) * (0.14 + p.impulse * 0.22);

      tmpEuler.set(pitch, yaw, roll, "YXZ");
      q.setFromEuler(tmpEuler);
      const sc = p.scale * (1 + p.impulse * 0.15);
      const mat = m4.compose(v3.set(p.x, p.y, p.z), q, s3.setScalar(sc));
      cordMesh.setMatrixAt(i, mat);
      plaqueBodyMesh.setMatrixAt(i, mat);
    }
    cordMesh.instanceMatrix.needsUpdate = true;
    plaqueBodyMesh.instanceMatrix.needsUpdate = true;
  };

  updateInteractivePlaques(0, 0);

  // 5. Sacred sunbeams & floating golden light motes
  const atmosphere = buildSacredSunbeamsAndMotes(rand);

  root.add(
    treeMesh,
    sanctuaryMesh,
    lanternMesh,
    glowLanternMesh,
    clusterPlaqueMesh,
    cordMesh,
    plaqueBodyMesh,
    atmosphere.group,
  );
  parent.add(root);

  // 3/4 front camera preset framing the entire 10.6m tree, roots, prayer platform, and hanging wishes
  registerCameraPreset("wishtree", {
    position: [WISH_TREE_POS.x + 8.5, 3.8, WISH_TREE_POS.z - 9.2],
    target: [WISH_TREE_POS.x, 4.2, WISH_TREE_POS.z],
  });

  return {
    hangWish() {
      const p = plaques[nextSlot];
      if (p) {
        p.active = true;
        p.impulse = 1.0;
      }
      nextSlot = (nextSlot + 1) % MAX_PLAQUES;
      updateInteractivePlaques(lastT, 0);
    },
    update(t, daylight) {
      const dt = Math.max(0, Math.min(0.1, t - lastT));
      lastT = t;
      if (!parent.visible) return;

      uPlaqueTime.value = t;
      ancientAsset.update(t, daylight);
      atmosphere.update(t, daylight);

      const night = Math.max(0, Math.min(1, 1 - daylight));
      glowLanternMat.emissiveIntensity = 1.05 + night * 2.1 + 0.1 * Math.sin(t * 2.6);
      plaqueMat.emissiveIntensity = 0.14 + night * 0.38;

      updateInteractivePlaques(t, dt);
    },
    dispose() {
      parent.remove(root);
      ancientAsset.dispose();
      lanternData.frameGeo.dispose();
      lanternData.glowGeo.dispose();
      lanternMat.dispose();
      glowLanternMat.dispose();
      plaqueAtlasTex.dispose();
      cordMat.dispose();
      plaqueMat.dispose();
      clusterPlaqueGeo.dispose();
      interactiveSample.cordGeo.dispose();
      interactiveSample.bodyGeo.dispose();
      cordMesh.dispose();
      plaqueBodyMesh.dispose();
      atmosphere.dispose();
    },
  };
}
