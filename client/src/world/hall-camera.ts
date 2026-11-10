import { MathUtils } from "three";
import { COLUMNS, HALL, ROOF, STEPS, WALL_THICKNESS } from "@santinh/shared";
import { COLUMN_TOP, HALL_ROOF, WALL_TOP } from "./hall-exterior.ts";
import { roofHeightAt } from "./roof.ts";
import type { CameraSolids } from "./spaces.ts";

/** Visual column radius (collision radius is wider) — clicks on a column must not pass through it. */
const COLUMN_PICK_R = 0.45;
const halfWall = WALL_THICKNESS / 2;

function nearSegment(x: number, z: number, ax: number, az: number, bx: number, bz: number, r: number): boolean {
  const dx = bx - ax;
  const dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq === 0 ? 0 : MathUtils.clamp(((x - ax) * dx + (z - az) * dz) / lenSq, 0, 1);
  const px = ax + t * dx - x;
  const pz = az + t * dz - z;
  return px * px + pz * pz < r * r;
}

/** Hall walls (front has the full-height door between the steps) and the roof volume above the ceiling. */
function hitsHall(x: number, y: number, z: number, pad: number): boolean {
  if (x >= ROOF.xMin && x <= ROOF.xMax && z >= ROOF.zMin && z <= ROOF.zMax) {
    if (y >= WALL_TOP - pad && y <= roofHeightAt(HALL_ROOF, x, z) + pad) return true;
  }
  if (y > WALL_TOP + pad) return false;
  const r = halfWall + pad;
  const { xMin, xMax, zMin, zMax } = HALL;
  return (
    nearSegment(x, z, xMin, zMin, xMax, zMin, r) ||
    nearSegment(x, z, xMin, zMin, xMin, zMax, r) ||
    nearSegment(x, z, xMax, zMin, xMax, zMax, r) ||
    nearSegment(x, z, xMin, zMax, STEPS.xMin, zMax, r) ||
    nearSegment(x, z, STEPS.xMax, zMax, xMax, zMax, r)
  );
}

function hitsColumn(x: number, y: number, z: number): boolean {
  if (y > COLUMN_TOP) return false;
  for (const c of COLUMNS) {
    const dx = x - c.x;
    const dz = z - c.z;
    if (dx * dx + dz * dz < COLUMN_PICK_R * COLUMN_PICK_R) return true;
  }
  return false;
}

/** What the camera and floor clicks treat as solid in tich-mac-duong (besides the ground). */
export const HALL_CAMERA_SOLIDS: CameraSolids = {
  blocksView: hitsHall,
  blocksPick: (x, y, z) => hitsHall(x, y, z, 0) || hitsColumn(x, y, z),
};
