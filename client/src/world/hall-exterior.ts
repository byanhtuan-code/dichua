import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Group,
  type Scene,
} from "three";
import { COLUMNS, HALL, ROOF, STEPS, WALL_THICKNESS } from "@santinh/shared";
import { registerCameraPreset } from "../debug/params.ts";
import { vi } from "../i18n/vi.ts";
import type { MaterialKey, Materials } from "./materials.ts";
import { GeometryBatch, disposeGroupGeometry } from "./merge.ts";
import { createRoofGeometry, roofHeightAt, type RoofParams } from "./roof.ts";

// Heights (metres). Floor and walls come from shared/world.ts; the rest is look, not collision.
// The hall is tall enough for the 5.35 m Buddha and the 16.8 × 8.4 m mural inside (D15).
const FOUNDATION_TOP = 0.45;
/** Stays under the walker's wall clearance (radius + half wall) so nobody stands on the stone lip. */
const FOUNDATION_MARGIN = 0.35;
export const COLUMN_TOP = 9.8;
const BEAM_H = 0.42;
const BEAM_W = 0.36;
export const WALL_TOP = COLUMN_TOP + BEAM_H;
const COLUMN_R = 0.4;
const PLINTH_R = 0.62;
const PLINTH_H = 0.28;
/** Plaster below and above the lattice band on lattice walls. */
const SILL_TOP = HALL.floorY + 0.9;
/** Lattice doors are door height; plaster with a timber rail fills the tall wall above. */
const LATTICE_TOP = HALL.floorY + 4.2;
const RAIL_Y = LATTICE_TOP + 2.6;
/** High window band between the door lattice and the rail. */
const HIGH_BOTTOM = LATTICE_TOP + 0.9;
const HIGH_TOP = RAIL_Y - 0.4;
const BAR = 0.05;
const BAR_STEP_V = 0.32;
const BAR_STEP_H = 0.64;
const STEP_COUNT = 4;
/** Red frame posts set into the wall line: from outside they give the hall its column rhythm (COLUMNS sit behind the walls). */
const POST_R = 0.28;
const SIDE_POSTS = 7;
const BACK_POSTS = 6;
// Beam lines follow the outer column rows from shared/world.ts.
const COL_X = Math.max(...COLUMNS.map((c) => Math.abs(c.x)));
const COL_Z_FRONT = Math.max(...COLUMNS.map((c) => c.z));
const COL_Z_BACK = Math.min(...COLUMNS.map((c) => c.z));

export const HALL_ROOF: RoofParams = {
  cx: (ROOF.xMin + ROOF.xMax) / 2,
  cz: (ROOF.zMin + ROOF.zMax) / 2,
  halfX: (ROOF.xMax - ROOF.xMin) / 2,
  halfZ: (ROOF.zMax - ROOF.zMin) / 2,
  ridgeHalf: 8,
  eaveY: 10.55,
  rise: 6.2,
  sag: 1.6,
  cornerLift: 1.1,
  thickness: 0.32,
};

const SIGN = { w: 5.2, h: 1.6, y: COLUMN_TOP - 0.15, tex: [768, 238] as const };

const m4 = new Matrix4();

type Key = MaterialKey;

function box(batch: GeometryBatch<Key>, key: Key, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tile = 1): void {
  const g = new BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
  batch.add(key, g, m4.makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), { worldUV: tile });
  g.dispose();
}

/** Grid of thin bars in a wall plane. `axis` is the wall's long direction. */
function lattice(batch: GeometryBatch<Key>, axis: "x" | "z", fixed: number, from: number, to: number, y0: number, y1: number): void {
  const t = BAR / 2;
  const len = to - from;
  const verticals = Math.max(1, Math.round(len / BAR_STEP_V));
  for (let i = 0; i <= verticals; i++) {
    const a = from + (len * i) / verticals;
    if (axis === "x") box(batch, "darkWood", a - t, a + t, y0, y1, fixed - t, fixed + t, 0.5);
    else box(batch, "darkWood", fixed - t, fixed + t, y0, y1, a - t, a + t, 0.5);
  }
  const rows = Math.max(1, Math.round((y1 - y0) / BAR_STEP_H));
  for (let j = 0; j <= rows; j++) {
    const y = y0 + ((y1 - y0) * j) / rows;
    if (axis === "x") box(batch, "darkWood", from, to, y - t, y + t, fixed - t, fixed + t, 0.5);
    else box(batch, "darkWood", fixed - t, fixed + t, y - t, y + t, from, to, 0.5);
  }
}

/** Plaster sill + paper-backed lattice + plaster lintel between `from` and `to` along one wall line. */
function latticeWall(batch: GeometryBatch<Key>, axis: "x" | "z", line: number, from: number, to: number): void {
  const h = WALL_THICKNESS / 2;
  const [a0, a1] = axis === "x" ? [from, to] : [line - h, line + h];
  const [b0, b1] = axis === "x" ? [line - h, line + h] : [from, to];
  box(batch, "plaster", a0, a1, HALL.floorY, SILL_TOP, b0, b1);
  box(batch, "plaster", a0, a1, LATTICE_TOP, WALL_TOP, b0, b1);
  const r = h + 0.04;
  const [c0, c1] = axis === "x" ? [from, to] : [line - r, line + r];
  const [d0, d1] = axis === "x" ? [line - r, line + r] : [from, to];
  box(batch, "darkWood", c0, c1, LATTICE_TOP - 0.08, LATTICE_TOP + 0.12, d0, d1, 1.5);
  box(batch, "darkWood", c0, c1, RAIL_Y - 0.1, RAIL_Y + 0.1, d0, d1, 1.5);
  const mid = (from + to) / 2;
  for (const [y0, y1] of [[SILL_TOP, LATTICE_TOP], [HIGH_BOTTOM, HIGH_TOP]] as const) {
    // Paper sits flush with the plaster faces' centre; the plaster boxes behind are cut by it visually.
    const paper = new PlaneGeometry(to - from, y1 - y0);
    const cy = (y0 + y1) / 2;
    for (const side of [-1, 1]) {
      const at = line + side * (h + 0.005);
      if (axis === "x") m4.makeTranslation(mid, cy, at);
      else m4.makeRotationY(Math.PI / 2).setPosition(at, cy, mid);
      batch.add("paper", paper, m4, { worldUV: 2, castShadow: false });
      // Bars sit on both faces so the hall reads the same from inside (T5).
      lattice(batch, axis, line + side * (h + BAR / 2 + 0.01), from, to, y0, y1);
    }
    paper.dispose();
  }
}

function drawSign(text: string): CanvasTexture {
  const [w, h] = SIGN.tex;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.fillStyle = "#1c2a36";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#c9a85a";
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, w - 28, h - 28);
  ctx.lineWidth = 3;
  ctx.strokeRect(30, 30, w - 60, h - 60);
  ctx.fillStyle = "#e7c56d";
  ctx.font = `600 ${Math.round(h * 0.58)}px "Songti SC", "Noto Serif CJK TC", "Noto Serif TC", "PMingLiU", serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Temple boards read right to left.
  const glyphs = [...text].reverse();
  const step = (w - 120) / glyphs.length;
  glyphs.forEach((g, i) => ctx.fillText(g, 60 + step * (i + 0.5), h / 2 + 4));
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export interface HallExterior {
  readonly group: Group;
  dispose(): void;
}

export function createHallExterior(scene: Scene, materials: Materials): HallExterior {
  const batch = new GeometryBatch<Key>();
  const fy = HALL.floorY;

  // Stone foundation, timber deck.
  const fm = FOUNDATION_MARGIN;
  box(batch, "stone", HALL.xMin - fm, HALL.xMax + fm, 0, FOUNDATION_TOP, HALL.zMin - fm, HALL.zMax + fm, 1.5);
  box(batch, "wood", HALL.xMin, HALL.xMax, FOUNDATION_TOP, fy, HALL.zMin, HALL.zMax, 2);

  // Front steps: STEPS spans the ramp; each tread is a solid block down to the ground.
  const depth = (STEPS.zMax - STEPS.zMin) / STEP_COUNT;
  for (let i = 0; i < STEP_COUNT; i++) {
    const top = fy * (STEP_COUNT - i) / (STEP_COUNT + 1);
    box(batch, "stone", STEPS.xMin, STEPS.xMax, 0, top, STEPS.zMin + i * depth - (i === 0 ? fm : 0), STEPS.zMin + (i + 1) * depth, 1.5);
  }

  // Columns on stone plinths.
  const plinth = new CylinderGeometry(PLINTH_R * 0.85, PLINTH_R, PLINTH_H, 16);
  const shaft = new CylinderGeometry(COLUMN_R * 0.92, COLUMN_R, COLUMN_TOP - fy - PLINTH_H, 20);
  const shaftH = COLUMN_TOP - fy - PLINTH_H;
  for (const c of COLUMNS) {
    batch.add("stone", plinth, m4.makeTranslation(c.x, fy + PLINTH_H / 2, c.z), { uvScale: [2.2, 0.3] });
    batch.add("paintRed", shaft, m4.makeTranslation(c.x, fy + PLINTH_H + shaftH / 2, c.z), { uvScale: [2, shaftH] });
  }
  plinth.dispose();
  shaft.dispose();

  // Beams tie the column tops (front row, back row, both sides).
  const zFront = COL_Z_FRONT;
  const bw = BEAM_W / 2;
  box(batch, "darkWood", -COL_X - bw, COL_X + bw, COLUMN_TOP, WALL_TOP, zFront - bw, zFront + bw, 1.5);
  box(batch, "darkWood", -COL_X - bw, COL_X + bw, COLUMN_TOP, WALL_TOP, COL_Z_BACK - bw, COL_Z_BACK + bw, 1.5);
  for (const x of [-COL_X, COL_X]) box(batch, "darkWood", x - bw, x + bw, COLUMN_TOP, WALL_TOP, COL_Z_BACK - bw, zFront + bw, 1.5);

  // Frame posts along every wall line, plus both door jambs.
  const postH = WALL_TOP - fy;
  const post = new CylinderGeometry(POST_R, POST_R, postH, 14);
  const posts = new Map<string, [number, number]>();
  // Posts are thicker than the wall: shift them outward so nothing pokes into the hall (the mural sits on the back wall).
  const out = POST_R - WALL_THICKNESS / 2;
  const addPost = (x: number, z: number): void => {
    const px = x <= HALL.xMin ? x - out : x >= HALL.xMax ? x + out : x;
    const pz = z <= HALL.zMin ? z - out : z >= HALL.zMax ? z + out : z;
    posts.set(`${px.toFixed(2)},${pz.toFixed(2)}`, [px, pz]);
  };
  for (let i = 0; i < SIDE_POSTS; i++) {
    const z = HALL.zMin + ((HALL.zMax - HALL.zMin) * i) / (SIDE_POSTS - 1);
    addPost(HALL.xMin, z);
    addPost(HALL.xMax, z);
  }
  for (let i = 0; i < BACK_POSTS; i++) addPost(HALL.xMin + ((HALL.xMax - HALL.xMin) * i) / (BACK_POSTS - 1), HALL.zMin);
  for (const x of [STEPS.xMin, STEPS.xMax, (HALL.xMin + STEPS.xMin) / 2, (HALL.xMax + STEPS.xMax) / 2]) addPost(x, HALL.zMax);
  for (const [x, z] of posts.values()) {
    batch.add("paintRed", post, m4.makeTranslation(x, fy + postH / 2, z), { uvScale: [1.5, postH] });
  }
  post.dispose();

  // Walls: plaster back wall, lattice sides, lattice front either side of the 8 m door.
  const h = WALL_THICKNESS / 2;
  box(batch, "plaster", HALL.xMin, HALL.xMax, fy, WALL_TOP, HALL.zMin - h, HALL.zMin + h, 2);
  for (const x of [HALL.xMin, HALL.xMax]) latticeWall(batch, "z", x, HALL.zMin + h, HALL.zMax - h);
  latticeWall(batch, "x", HALL.zMax, HALL.xMin, STEPS.xMin);
  latticeWall(batch, "x", HALL.zMax, STEPS.xMax, HALL.xMax);
  // Wall plates close the gap between wall tops and the roof all round.
  for (const x of [HALL.xMin, HALL.xMax]) box(batch, "darkWood", x - h, x + h, WALL_TOP, WALL_TOP + 0.3, HALL.zMin - h, HALL.zMax + h, 1.5);
  box(batch, "darkWood", HALL.xMin - h, HALL.xMax + h, WALL_TOP, WALL_TOP + 0.3, HALL.zMin - h, HALL.zMin + h, 1.5);
  box(batch, "darkWood", HALL.xMin - h, HALL.xMax + h, WALL_TOP, WALL_TOP + 0.3, HALL.zMax - h, HALL.zMax + h, 1.5);

  // Roof: tiled top, dark soffit and fascia, ridge cap.
  const roof = createRoofGeometry(HALL_ROOF);
  batch.add("roof", roof.top, undefined, { uvScale: [0.8, 0.8] });
  batch.add("roofTrim", roof.bottom, undefined, { uvScale: [0.5, 0.5] });
  batch.add("roofTrim", roof.fascia);
  roof.top.dispose();
  roof.bottom.dispose();
  roof.fascia.dispose();
  const ridgeY = HALL_ROOF.eaveY + HALL_ROOF.rise;
  box(batch, "roofTrim", HALL_ROOF.cx - HALL_ROOF.ridgeHalf - 0.4, HALL_ROOF.cx + HALL_ROOF.ridgeHalf + 0.4, ridgeY - 0.3, ridgeY + 0.28, HALL_ROOF.cz - 0.26, HALL_ROOF.cz + 0.26, 1);

  const group = batch.build("hall-exterior", materials);

  // Signboard under the front eave, on the face of the front beam.
  const signTex = drawSign(vi.hall.sign);
  const signMat = new MeshStandardMaterial({ map: signTex, roughness: 0.6, metalness: 0, emissiveMap: signTex, emissive: 0x2a2010 });
  const signGeo = new BoxGeometry(SIGN.w, SIGN.h, 0.12);
  const sign = new Mesh(signGeo, [materials.darkWood, materials.darkWood, materials.darkWood, materials.darkWood, signMat, materials.darkWood]);
  const signZ = zFront + bw + 0.08;
  // Sit just under the soffit, never through it.
  const signTop = Math.min(roofHeightAt(HALL_ROOF, 0, signZ) - HALL_ROOF.thickness - 0.08, SIGN.y + SIGN.h);
  sign.position.set(0, signTop - SIGN.h / 2, signZ);
  sign.name = "hall-sign";
  sign.castShadow = true;
  sign.matrixAutoUpdate = false;
  sign.updateMatrix();
  group.add(sign);
  group.updateMatrixWorld(true);
  scene.add(group);

  registerCameraPreset("hall", { position: [0, 3.2, 44], target: [0, 7, 6] });
  registerCameraPreset("hall-side", { position: [-34, 8, 40], target: [0, 6.5, 0] });

  return {
    group,
    dispose() {
      scene.remove(group);
      disposeGroupGeometry(group);
      signMat.dispose();
      signTex.dispose();
    },
  };
}
