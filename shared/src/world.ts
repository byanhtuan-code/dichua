import type { Circle, Vec2, Vec2Yaw } from "./types.ts";

// Data of the tich-mac-duong space (spaces/tich-mac-duong.ts); only that file and its 3D scene read these.
// All numbers mirror design/world-map.html (metres; x right, z towards viewer, y up).

export const HALL = { xMin: -14, xMax: 14, zMin: -18, zMax: 14, floorY: 0.6 } as const;
/** Roof footprint: overhangs the walls by 2 m. */
export const ROOF = { xMin: -16, xMax: 16, zMin: -20, zMax: 16 } as const;
export const WALL_THICKNESS = 0.3;

export const COLUMN_RADIUS = 0.7;
export const COLUMNS: readonly Vec2[] = [
  ...[-16.5, -4, 8, 13.3].flatMap((z) => [
    { x: -12.5, z },
    { x: 12.5, z },
  ]),
  { x: -5, z: 13.3 },
  { x: 5, z: 13.3 },
];

/** Altar table footprint; the Buddha sits at (x, z). */
export const ALTAR = { x: 0, z: -15.5, xMin: -5, xMax: 5, zMin: -17, zMax: -14 } as const;

export const CUSHION_COUNT = 30;
export const CUSHION_SPACING = 2.4;
/** Cushions face the altar. */
export const CUSHION_YAW = Math.PI;
export const RESIDENT_CUSHIONS: readonly number[] = [0, 5, 24, 29];
/** Cushion thickness on the hall floor; a kneeling body rests its knees on top. */
export const CUSHION_HEIGHT = 0.14;
export const CUSHION_TOP = HALL.floorY + CUSHION_HEIGHT;

export function cushionPosition(i: number): Vec2Yaw {
  if (!Number.isInteger(i) || i < 0 || i >= CUSHION_COUNT) throw new RangeError(`cushion ${i}`);
  return { x: -6 + (i % 6) * CUSHION_SPACING, z: -6 + Math.floor(i / 6) * CUSHION_SPACING, yaw: CUSHION_YAW };
}

/** Front steps: ramp from hall floor (z=14) down to the ground (z=18). */
export const STEPS = { xMin: -4, xMax: 4, zMin: 14, zMax: 18 } as const;

export const PATH = { from: { x: 0, z: 18 }, to: { x: 0, z: 44 }, width: 3, lanternEvery: 6 } as const;

// Western lotus-lantern loop: cubic Béziers from the SVG, sampled into a polyline.
const LOOP_BEZIERS: readonly (readonly [Vec2, Vec2, Vec2, Vec2])[] = [
  [{ x: 0, z: 30 }, { x: -12, z: 30 }, { x: -26, z: 30 }, { x: -30, z: 20 }],
  [{ x: -30, z: 20 }, { x: -34, z: 10 }, { x: -26, z: 4 }, { x: -22, z: 8 }],
  [{ x: -22, z: 8 }, { x: -18, z: 12 }, { x: -20, z: 24 }, { x: -8, z: 30 }],
];

function sampleBeziers(curves: typeof LOOP_BEZIERS, stepsPerCurve: number): Vec2[] {
  const out: Vec2[] = [];
  curves.forEach(([p0, p1, p2, p3], ci) => {
    for (let s = ci === 0 ? 0 : 1; s <= stepsPerCurve; s++) {
      const t = s / stepsPerCurve;
      const u = 1 - t;
      const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      out.push({ x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, z: a * p0.z + b * p1.z + c * p2.z + d * p3.z });
    }
  });
  return out;
}

export const LANTERN_LOOP = {
  points: sampleBeziers(LOOP_BEZIERS, 16) as readonly Vec2[],
  width: 2,
  lanterns: [
    { x: -12, z: 31.4 },
    { x: -25, z: 29 },
    { x: -32, z: 16 },
    { x: -26, z: 5.4 },
    { x: -17.6, z: 14 },
    { x: -13, z: 27 },
  ] as readonly Vec2[],
} as const;

/** Square stone lanterns flanking the stone path, every PATH.lanternEvery metres from the foot of the steps. */
export const PATH_LANTERN_X = 2.3;
export const PATH_LANTERNS: readonly Vec2[] = [20, 26, 32, 38].flatMap((z) => [
  { x: -PATH_LANTERN_X, z },
  { x: PATH_LANTERN_X, z },
]);
/** Covers the widest lantern footprint (stone base diagonal ≈ 0.44 m, lotus lamp ≈ 0.42 m). */
export const LANTERN_RADIUS = 0.45;

/** Garden rocks: footprint circle (r = half the widest side). Kept off the paths, the loop and the spawn area. */
export const ROCKS: readonly Circle[] = [
  { x: -5.5, z: 22, r: 0.9 },
  { x: 6, z: 24.5, r: 1.1 },
  { x: 5.4, z: 33.5, r: 0.6 },
  { x: -6.5, z: 36, r: 0.8 },
  { x: 7.2, z: 40, r: 1.2 },
  { x: -24.5, z: 17, r: 1.3 },
  { x: -26, z: 20.5, r: 0.7 },
  { x: 15.6, z: 6, r: 1.0 },
  { x: 16.4, z: 16.5, r: 1.3 },
  { x: 32, z: 10, r: 0.9 },
  { x: 28.5, z: 22.5, r: 1.0 },
  { x: -19, z: -12, r: 1.6 },
  { x: 19.5, z: -13, r: 1.4 },
  { x: -31, z: -4, r: 1.2 },
  { x: 32, z: 32, r: 1.1 },
];

export const POND = { x: 24, z: 12, rx: 7, rz: 10 } as const;
export const LOTUS_FLOWERS: readonly Vec2[] = [
  { x: 22, z: 8 },
  { x: 26, z: 13 },
  { x: 23, z: 17 },
];

export const BOUNDARY = { x: 0, z: 16, rx: 47, rz: 44 } as const;
/** The gate closes the garden to the south: nothing past it is walkable. */
export const GATE_Z = 44;
export const GATE = { xMin: -5, xMax: 5, zMin: 44, zMax: 45.6 } as const;

/**
 * Colliders for the Ancient Wishing Tree inside the courtyard (`x = -11.5, z = 40.6`):
 * - Main trunk, root collar, and mossy boulders (`r = 1.85m`), leaving the prayer platform (`dist = 2.95m`) walkable.
 * - Three low stone garden lanterns flanking the root sanctuary (`dist = 2.75m`, `r = 0.32m`).
 */
const WISH_TREE_CENTER = {
  x: -11.5,
  z: (GATE.zMin + GATE.zMax) / 2 - 4.2,
} as const;

export const WISHING_TREE_COLLIDERS: readonly Circle[] = [
  { x: WISH_TREE_CENTER.x, z: WISH_TREE_CENTER.z, r: 1.85 },
  ...([-2.25, -0.35, 2.75] as const).map((a) => ({
    x: WISH_TREE_CENTER.x + Math.cos(a) * 2.75,
    z: WISH_TREE_CENTER.z + Math.sin(a) * 2.75,
    r: 0.32,
  })),
];

/** Every static garden prop a walker must go around (path lanterns, lotus lanterns, rocks, wishing tree). */
export const PROP_COLLIDERS: readonly Circle[] = [
  ...PATH_LANTERNS.map((p) => ({ x: p.x, z: p.z, r: LANTERN_RADIUS })),
  ...LANTERN_LOOP.lanterns.map((p) => ({ x: p.x, z: p.z, r: LANTERN_RADIUS })),
  ...ROCKS,
  ...WISHING_TREE_COLLIDERS,
];

export const SPAWN: Vec2Yaw = { x: 0, z: 38, yaw: Math.PI };
export const SPAWN_JITTER = 1.5;

export const CAMERA = {
  distance: 6,
  height: 3,
  minDistance: 3,
  maxDistance: 12,
  minPitchDeg: 10,
  maxPitchDeg: 60,
} as const;

export const ROOM_COUNT = 10;
// More people than cushions (D23): whoever finds none free stands and waits.
export const ROOM_CAPACITY = 100;

export function roomId(n: number): string {
  if (!Number.isInteger(n) || iCheck(n)) throw new RangeError(`room ${n}`);
  return `san-${String(n).padStart(2, "0")}`;
}

function iCheck(n: number): boolean {
  return n < 1 || n > ROOM_COUNT;
}

/** Inverse of roomId; null for anything that is not `san-01`…`san-10`. */
export function roomNumber(id: string): number | null {
  const m = /^san-(\d{2})$/.exec(id);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= ROOM_COUNT ? n : null;
}

export const MOVE_SPEED = 2.2;
export const WALK_RADIUS = 0.34;

export const ZONES = ["hall", "garden"] as const;
export type Zone = (typeof ZONES)[number];
