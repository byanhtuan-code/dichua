import type { Vec2 } from "../types.ts";
import {
  ALTAR,
  BOUNDARY,
  COLUMNS,
  COLUMN_RADIUS,
  CUSHION_COUNT,
  GATE_Z,
  HALL,
  POND,
  PROP_COLLIDERS,
  RESIDENT_CUSHIONS,
  SPAWN,
  SPAWN_JITTER,
  STEPS,
  WALL_THICKNESS,
  ZONES,
  cushionPosition,
  type Zone,
} from "../world.ts";
import type { CollisionMap, SpaceDef } from "./types.ts";

// Hall walls; the front wall leaves a door as wide as the steps.
const collision: CollisionMap = {
  boundary: { x: BOUNDARY.x, z: BOUNDARY.z, rx: BOUNDARY.rx, rz: BOUNDARY.rz },
  maxZ: GATE_Z,
  blocked: [{ x: POND.x, z: POND.z, rx: POND.rx, rz: POND.rz }],
  walls: [
    { ax: HALL.xMin, az: HALL.zMin, bx: HALL.xMax, bz: HALL.zMin },
    { ax: HALL.xMin, az: HALL.zMin, bx: HALL.xMin, bz: HALL.zMax },
    { ax: HALL.xMax, az: HALL.zMin, bx: HALL.xMax, bz: HALL.zMax },
    { ax: HALL.xMin, az: HALL.zMax, bx: STEPS.xMin, bz: HALL.zMax },
    { ax: STEPS.xMax, az: HALL.zMax, bx: HALL.xMax, bz: HALL.zMax },
  ],
  wallThickness: WALL_THICKNESS,
  circles: [...COLUMNS.map((c) => ({ x: c.x, z: c.z, r: COLUMN_RADIUS })), ...PROP_COLLIDERS],
  boxes: [{ xMin: ALTAR.xMin, xMax: ALTAR.xMax, zMin: ALTAR.zMin, zMax: ALTAR.zMax }],
};

const BOT_SPOTS: readonly Vec2[] = [
  { x: 0, z: -1 },
  { x: -8, z: 6 },
  { x: 8, z: 6 },
  { x: 0, z: 11 },
  { x: 0, z: 21 },
  { x: 0, z: 30 },
  { x: -10, z: 26 },
  { x: 10, z: 30 },
  { x: -22, z: 22 },
  { x: 14, z: 2 },
  { x: -18, z: 2 },
];

// Row gaps between cushion rows (cushions at z = -6 … 6, every CUSHION_SPACING).
const ROW_GAPS = [-7.2, -4.8, -2.4, 0, 2.4, 4.8, 7.2];
const NAV_POINTS: readonly Vec2[] = [
  ...BOT_SPOTS,
  // Either side of the door, on the steps' centre line (the door is as wide as the steps).
  { x: 0, z: HALL.zMax - 2 },
  { x: 0, z: STEPS.zMax + 1 },
  // Side aisles at every row gap, so a walk can reach a back cushion without crossing seated people.
  ...ROW_GAPS.flatMap((z) => [
    { x: -8.5, z },
    { x: 8.5, z },
  ]),
];

function inHall(x: number, z: number): boolean {
  return x >= HALL.xMin && x <= HALL.xMax && z >= HALL.zMin && z <= HALL.zMax;
}

/** Walking surface height: hall floor, the front ramp, or bare ground. */
function groundY(x: number, z: number): number {
  if (inHall(x, z)) return HALL.floorY;
  if (x >= STEPS.xMin && x <= STEPS.xMax && z > STEPS.zMin && z < STEPS.zMax) {
    return HALL.floorY * (STEPS.zMax - z) / (STEPS.zMax - STEPS.zMin);
  }
  return 0;
}

function zoneOf(x: number, z: number): Zone {
  return inHall(x, z) ? "hall" : "garden";
}

/** Named spots tests aim at (array order in `collision` is not a contract). */
export const TICH_MAC_DUONG_LANDMARKS = {
  hallBackZ: HALL.zMin,
  pond: { x: POND.x, z: POND.z, rx: POND.rx, rz: POND.rz },
  columns: COLUMNS,
} as const;

/** Tịch Mặc Đường: the hall with 30 cushions, the garden, the pond, the gate. */
export const TICH_MAC_DUONG: SpaceDef = {
  id: "tich-mac-duong",
  theme: "tich-mac-duong",
  collision,
  cushions: Array.from({ length: CUSHION_COUNT }, (_, i) => cushionPosition(i)),
  residentCushions: RESIDENT_CUSHIONS,
  spawn: SPAWN,
  spawnJitter: SPAWN_JITTER,
  botSpots: BOT_SPOTS,
  navPoints: NAV_POINTS,
  zones: ZONES,
  seatZone: "hall" satisfies Zone,
  groundY,
  zoneOf,
};
