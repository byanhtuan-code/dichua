import type { Circle, Vec2 } from "./types.ts";
import type { CollisionMap, Segment } from "./spaces/types.ts";
import { WALK_RADIUS } from "./world.ts";

/** Path checks sample every this many metres — well under WALK_RADIUS so nothing thin slips between samples. */
const SAMPLE_STEP = 0.1;

function distToSegmentSq(x: number, z: number, s: Segment): number {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const lenSq = dx * dx + dz * dz;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / lenSq));
  const px = s.ax + t * dx - x;
  const pz = s.az + t * dz - z;
  return px * px + pz * pz;
}

function insideEllipse(x: number, z: number, cx: number, cz: number, rx: number, rz: number): boolean {
  const u = (x - cx) / rx;
  const v = (z - cz) / rz;
  return u * u + v * v <= 1;
}

function hitsCircle(x: number, z: number, r: number, c: Circle): boolean {
  const dx = x - c.x;
  const dz = z - c.z;
  const min = r + c.r;
  return dx * dx + dz * dz < min * min;
}

/** True when a walker of radius r standing at (x, z) overlaps nothing solid. */
export function isWalkable(
  map: CollisionMap,
  x: number,
  z: number,
  r: number = WALK_RADIUS,
  extraCircles: readonly Circle[] = [],
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (z > map.maxZ - r) return false;
  const b = map.boundary;
  if (!insideEllipse(x, z, b.x, b.z, b.rx - r, b.rz - r)) return false;
  for (const e of map.blocked) if (insideEllipse(x, z, e.x, e.z, e.rx + r, e.rz + r)) return false;

  const wallMin = r + map.wallThickness / 2;
  for (const w of map.walls) if (distToSegmentSq(x, z, w) < wallMin * wallMin) return false;

  for (const c of map.circles) if (hitsCircle(x, z, r, c)) return false;

  // Circle vs axis-aligned box.
  for (const box of map.boxes) {
    const ax = Math.max(box.xMin, Math.min(x, box.xMax)) - x;
    const az = Math.max(box.zMin, Math.min(z, box.zMax)) - z;
    if (ax * ax + az * az < r * r) return false;
  }

  for (const c of extraCircles) if (hitsCircle(x, z, r, c)) return false;
  return true;
}

/**
 * Farthest point on the straight line from → to that can be reached without hitting anything.
 * Returns `from` itself when the first step is already blocked.
 * Extra circles already overlapping `from` are ignored so the walker can step out of them.
 */
export function clampToWalkable(
  map: CollisionMap,
  from: Vec2,
  to: Vec2,
  r: number = WALK_RADIUS,
  extraCircles: readonly Circle[] = [],
): Vec2 {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz);
  if (len === 0) return { x: from.x, z: from.z };

  // Avoid allocating a new array unless `from` actually overlaps one of `extraCircles`.
  let obstacles: readonly Circle[] = extraCircles;
  for (let i = 0; i < extraCircles.length; i++) {
    const c = extraCircles[i];
    if (c && hitsCircle(from.x, from.z, r, c)) {
      obstacles = extraCircles.filter((item) => !hitsCircle(from.x, from.z, r, item));
      break;
    }
  }

  const steps = Math.ceil(len / SAMPLE_STEP);
  let lastX = from.x;
  let lastZ = from.z;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = i === steps ? to.x : from.x + dx * t;
    const z = i === steps ? to.z : from.z + dz * t;
    if (!isWalkable(map, x, z, r, obstacles)) return { x: lastX, z: lastZ };
    lastX = x;
    lastZ = z;
  }
  return { x: lastX, z: lastZ };
}

/** True when the whole straight walk from → to is clear. */
export function segmentClear(
  map: CollisionMap,
  from: Vec2,
  to: Vec2,
  r: number = WALK_RADIUS,
  extraCircles: readonly Circle[] = [],
): boolean {
  if (!isWalkable(map, to.x, to.z, r, extraCircles)) return false;
  const end = clampToWalkable(map, from, to, r, extraCircles);
  return end.x === to.x && end.z === to.z;
}
