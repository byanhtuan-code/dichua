import { MathUtils } from "three";
import {
  MOVE_SPEED,
  TICK_MS,
  WALK_RADIUS,
  clampToWalkable,
  isWalkable,
  type Circle,
  type SpaceDef,
  type Vec2,
  type Vec2Yaw,
} from "@santinh/shared";

/** One move per server tick keeps headroom under the rate limit for actions (L2.2). */
export const MOVE_SEND_INTERVAL_MS = TICK_MS;
/** A click that would move us less than this is treated as "nowhere to go". */
const MIN_TRAVEL = 0.15;
/** Turn rate towards the walking direction (1/s, MathUtils.damp). */
const TURN_DAMP = 12;
const EPS = 1e-4;

export interface MovementEvents {
  /** Throttled position for the NetDriver (≤ 5/s). */
  move: Vec2Yaw;
  /** Click on something that is not free floor (L2.3). */
  "invalid-floor": Vec2 | null;
  /** Walking started / stopped (walk chip). */
  walking: boolean;
}

type Listener<T> = (value: T) => void;

/** Shortest-way angle damp so turning never spins the long way round. */
export function dampAngle(from: number, to: number, lambda: number, dt: number): number {
  const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + diff * (1 - Math.exp(-lambda * dt));
}

/**
 * The player's own walking: click target (straight line, stop before obstacles — no pathfinding, stack §3),
 * a precomputed route (`followPath`, the walk to a cushion)
 * or a held direction (WASD) that slides along whatever blocks it. Collision is the shared function.
 */
export class Movement {
  readonly position: Vec2Yaw;
  /** Ground speed shown last update (m/s) — drives the walk cycle. */
  speed = 0;
  private target: Vec2 | null = null;
  /** Legs left after `target` on a followPath walk. */
  private route: Vec2[] = [];
  private dirX = 0;
  private dirZ = 0;
  private obstacles: readonly Circle[] = [];
  private walkingNow = false;
  private lastSentAt = -Infinity;
  private readonly sent: Vec2Yaw;
  /** Reused step target (no allocation per frame). */
  private readonly scratch: Vec2 = { x: 0, z: 0 };
  private readonly listeners: { [K in keyof MovementEvents]: Set<Listener<MovementEvents[K]>> } = {
    move: new Set(),
    "invalid-floor": new Set(),
    walking: new Set(),
  };

  constructor(
    private readonly space: SpaceDef,
    start: Vec2Yaw,
  ) {
    this.position = { ...start };
    this.sent = { ...start };
  }

  on<K extends keyof MovementEvents>(type: K, fn: Listener<MovementEvents[K]>): () => void {
    const set = this.listeners[type] as Set<Listener<MovementEvents[K]>>;
    set.add(fn);
    return () => set.delete(fn);
  }

  get walking(): boolean {
    return this.walkingNow;
  }

  /** Heading of a click walk (camera eases behind it); null when walking by keys or standing. */
  get heading(): number | null {
    return this.target ? this.position.yaw : null;
  }

  /** People sitting on cushions etc. (T9/T10). */
  setObstacles(circles: readonly Circle[]): void {
    this.obstacles = circles;
  }

  /** Walk straight to a clicked floor point; `null` = the click hit no floor. Returns false when refused. */
  walkTo(point: Vec2 | null): boolean {
    if (!point || !isWalkable(this.space.collision, point.x, point.z, WALK_RADIUS, this.obstacles)) {
      this.emit("invalid-floor", point);
      return false;
    }
    const end = clampToWalkable(this.space.collision, this.position, point, WALK_RADIUS, this.obstacles);
    if (Math.hypot(end.x - this.position.x, end.z - this.position.z) < MIN_TRAVEL) {
      this.emit("invalid-floor", point);
      return false;
    }
    this.target = end;
    this.route = [];
    return true;
  }

  /**
   * Walk through `points` in order without stopping between legs (a route from `findPath`, already checked clear).
   * Returns false for an empty route.
   */
  followPath(points: readonly Vec2[]): boolean {
    const [first, ...rest] = points;
    if (!first) return false;
    this.target = { x: first.x, z: first.z };
    this.route = rest.map((p) => ({ x: p.x, z: p.z }));
    this.dirX = 0;
    this.dirZ = 0;
    return true;
  }

  /** World-space direction from the keys (any length; 0,0 = no key). Overrides a click target. */
  setDirection(x: number, z: number): void {
    const len = Math.hypot(x, z);
    this.dirX = len > EPS ? x / len : 0;
    this.dirZ = len > EPS ? z / len : 0;
    if (len > EPS) {
      this.target = null;
      this.route = [];
    }
  }

  stop(): void {
    this.target = null;
    this.route = [];
    this.dirX = 0;
    this.dirZ = 0;
  }

  /** Puts us somewhere without walking (seat, room change). */
  teleport(p: Vec2Yaw): void {
    this.stop();
    this.position.x = p.x;
    this.position.z = p.z;
    this.position.yaw = p.yaw;
    this.lastSentAt = -Infinity;
  }

  /** `nowMs` is any monotonic clock — only used to throttle `move`. */
  update(dt: number, nowMs: number): void {
    const p = this.position;
    const x0 = p.x;
    const z0 = p.z;
    let moving = false;

    if (this.dirX !== 0 || this.dirZ !== 0) {
      moving = this.stepKeys(dt);
      p.yaw = dampAngle(p.yaw, Math.atan2(this.dirX, this.dirZ), TURN_DAMP, dt);
    } else if (this.target) {
      moving = this.stepTarget(dt);
    }

    this.speed = dt > 0 ? Math.hypot(p.x - x0, p.z - z0) / dt : 0;
    const walking = moving || this.target !== null;
    if (walking !== this.walkingNow) {
      this.walkingNow = walking;
      this.emit("walking", walking);
    }
    this.maybeSend(nowMs);
  }

  private stepTarget(dt: number): boolean {
    const p = this.position;
    while (this.target) {
      const dx0 = this.target.x - p.x;
      const dz0 = this.target.z - p.z;
      if (Math.hypot(dx0, dz0) >= EPS) break;
      this.target = this.route.shift() ?? null;
    }
    const t = this.target;
    if (!t) return false;
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const dist = Math.hypot(dx, dz);
    p.yaw = dampAngle(p.yaw, Math.atan2(dx, dz), TURN_DAMP, dt);
    const step = Math.min(dist, MOVE_SPEED * dt);
    const next = this.scratch;
    next.x = p.x + (dx / dist) * step;
    next.z = p.z + (dz / dist) * step;
    // Someone may have sat down on the line since the click: stop in front of them.
    const end = clampToWalkable(this.space.collision, p, next, WALK_RADIUS, this.obstacles);
    const moved = Math.hypot(end.x - p.x, end.z - p.z) > EPS;
    p.x = end.x;
    p.z = end.z;
    if (end.x !== next.x || end.z !== next.z) {
      // Blocked mid-route (someone sat down on it): the whole route is off.
      this.target = null;
      this.route = [];
    } else if (step === dist) {
      this.target = this.route.shift() ?? null;
    }
    return moved;
  }

  /** Full step, else slide along x or z only (walls / columns don't stop us dead). */
  private stepKeys(dt: number): boolean {
    const p = this.position;
    const step = MOVE_SPEED * dt;
    const next = this.scratch;
    // 0 = full step, 1 = x only, 2 = z only.
    for (let i = 0; i < 3; i++) {
      const sx = i === 2 ? 0 : this.dirX * step;
      const sz = i === 1 ? 0 : this.dirZ * step;
      if (Math.abs(sx) < EPS && Math.abs(sz) < EPS) continue;
      next.x = p.x + sx;
      next.z = p.z + sz;
      const end = clampToWalkable(this.space.collision, p, next, WALK_RADIUS, this.obstacles);
      if (Math.hypot(end.x - p.x, end.z - p.z) > EPS) {
        p.x = end.x;
        p.z = end.z;
        return true;
      }
    }
    return false;
  }

  private maybeSend(nowMs: number): void {
    const p = this.position;
    const s = this.sent;
    const changed = Math.abs(p.x - s.x) > 0.01 || Math.abs(p.z - s.z) > 0.01 || Math.abs(MathUtils.euclideanModulo(p.yaw - s.yaw + Math.PI, Math.PI * 2) - Math.PI) > 0.02;
    if (!changed || nowMs - this.lastSentAt < MOVE_SEND_INTERVAL_MS) return;
    this.lastSentAt = nowMs;
    s.x = p.x;
    s.z = p.z;
    s.yaw = p.yaw;
    this.emit("move", { x: p.x, z: p.z, yaw: p.yaw });
  }

  private emit<K extends keyof MovementEvents>(type: K, value: MovementEvents[K]): void {
    for (const fn of this.listeners[type] as Set<Listener<MovementEvents[K]>>) fn(value);
  }
}
