import { segmentClear } from "./collision.ts";
import type { CollisionMap } from "./spaces/types.ts";
import type { Circle, Vec2 } from "./types.ts";
import { WALK_RADIUS } from "./world.ts";

/**
 * Shortest walk from → to over straight clear legs that may turn only at `nodes` (Dijkstra on the visibility graph).
 * Returns the points to walk through, ending with `to` (empty when already there), or null when no route exists.
 * Edges are tested lazily: the search stops as soon as `to` is settled, so most of the graph is never checked.
 */
export function findPath(
  map: CollisionMap,
  nodes: readonly Vec2[],
  from: Vec2,
  to: Vec2,
  r: number = WALK_RADIUS,
  extraCircles: readonly Circle[] = [],
): Vec2[] | null {
  if (from.x === to.x && from.z === to.z) return [];
  // 0 = from, 1 = to, then the nodes.
  const pts: Vec2[] = [from, to, ...nodes];
  const dist = new Array<number>(pts.length).fill(Infinity);
  const prev = new Array<number>(pts.length).fill(-1);
  const done = new Array<boolean>(pts.length).fill(false);
  dist[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < pts.length; i++) if (!done[i] && dist[i]! < (u < 0 ? Infinity : dist[u]!)) u = i;
    if (u < 0) return null;
    if (u === 1) break;
    done[u] = true;
    const a = pts[u]!;
    for (let v = 1; v < pts.length; v++) {
      if (done[v]) continue;
      const b = pts[v]!;
      const d = dist[u]! + Math.hypot(b.x - a.x, b.z - a.z);
      if (d >= dist[v]! || !segmentClear(map, a, b, r, extraCircles)) continue;
      dist[v] = d;
      prev[v] = u;
    }
  }
  const out: Vec2[] = [];
  for (let at = 1; at !== 0; at = prev[at]!) out.unshift({ x: pts[at]!.x, z: pts[at]!.z });
  return out;
}

/** Length of walking from `from` through `path` in order. */
export function pathLength(from: Vec2, path: readonly Vec2[]): number {
  let len = 0;
  let a = from;
  for (const b of path) {
    len += Math.hypot(b.x - a.x, b.z - a.z);
    a = b;
  }
  return len;
}
