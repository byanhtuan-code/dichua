// Fake visitor behaviour (P-D5): wander, take a cushion, greet, leave by the gate.
// No timers, no DOM: the caller (mock driver or server room) calls `step` once per tick.
import { isWalkable, segmentClear } from "./collision.ts";
import { findPath } from "./path.ts";
import { cushionOf, type SpaceDef } from "./spaces/index.ts";
import { BOW_PERIOD_MS } from "./protocol.ts";
import type { Vec2, Visitor } from "./types.ts";
import { MOVE_SPEED, WALK_RADIUS } from "./world.ts";

export const BOT_SPEED = MOVE_SPEED * 0.6;
/** Leaving bots walk at player pace so most reach the gate before LEAVE_TIMEOUT_MS. */
export const LEAVE_SPEED = MOVE_SPEED;
/** How long a bot holds the hello pose. */
export const BOT_HELLO_MS = 2000;
/** A leaving bot that cannot reach the gate in time just vanishes. */
export const LEAVE_TIMEOUT_MS = 25_000;
/** Bots only greet back people this close. */
export const GREET_RADIUS = 6;
const GREET_CHANCE = 0.5;

/** Cushion → visitor id; a plain Map fits. The brain reserves and frees cushions through it. */
export interface SeatMap {
  get(cushion: number): string | undefined;
  has(cushion: number): boolean;
  set(cushion: number, visitorId: string): unknown;
  delete(cushion: number): boolean;
}

export interface Bot {
  /** Mutated in place; callers copy it before sending. */
  v: Visitor;
  target: Vec2 | null;
  /** Cushion reserved while walking to it. */
  seatOnArrive: number | null;
  waitUntil: number;
  sitUntil: number;
  /** Set by the farewell bow at `sitUntil`: the bot keeps kneeling until then, so others see the whole bow. */
  riseAt: number | null;
  helloUntil: number;
  nextHelloAt: number;
  /** Pending greet-back hello. */
  greetAt: number | null;
  leaving: boolean;
  leaveBy: number;
  /** Waypoints to the gate while leaving; null = no clear path, wait for the timeout. */
  route: Vec2[] | null;
}

export interface BotStep {
  /** Position, pose or cushion changed: send the bot this tick. */
  changed: boolean;
  /** Event for the whole room. */
  event?: "hello" | "bow";
  /** Left through the gate (or timed out): remove the bot. */
  gone?: boolean;
}

export interface SpawnOptions {
  /** Start kneeling on a free cushion (falls back to wandering when none is free). */
  seated?: boolean;
  /** Walk in from the gate instead of appearing somewhere in the garden. */
  atGate?: boolean;
}

export class BotBrain {
  readonly space: SpaceDef;
  private readonly rng: () => number;
  private readonly seats: SeatMap;
  private readonly seatCenter: Vec2;

  // No parameter properties: the server runs shared/ through Node's type stripping.
  constructor(space: SpaceDef, rng: () => number, seats: SeatMap) {
    this.space = space;
    this.rng = rng;
    this.seats = seats;
    const n = Math.max(1, space.cushions.length);
    this.seatCenter = {
      x: space.cushions.reduce((s, c) => s + c.x, 0) / n,
      z: space.cushions.reduce((s, c) => s + c.z, 0) / n,
    };
  }

  /** Wraps `v` (id, name, colour, joinedAt already set) in a bot and places it. */
  spawn(v: Visitor, now: number, opts: SpawnOptions = {}): Bot {
    const bot: Bot = {
      v,
      target: null,
      seatOnArrive: null,
      waitUntil: now + this.rng() * 3000,
      sitUntil: 0,
      riseAt: null,
      helloUntil: 0,
      nextHelloAt: now + 8000 + this.rng() * 30_000,
      greetAt: null,
      leaving: false,
      leaveBy: 0,
      route: null,
    };
    v.cushion = null;
    v.pose = "walk";
    delete v.bowAt;
    const seat = opts.seated ? this.freeCushionNear(this.seatCenter) : null;
    if (seat !== null) this.sit(bot, seat, now - Math.floor(this.rng() * 4000));
    else if (opts.atGate) v.position = { ...this.gateSpot(), yaw: this.space.spawn.yaw };
    else v.position = { ...this.randomSpot(), yaw: this.rng() * Math.PI * 2 };
    return bot;
  }

  step(bot: Bot, now: number, tickMs: number): BotStep {
    if (bot.leaving) return this.stepLeaving(bot, now, tickMs);
    const v = bot.v;
    if (v.cushion !== null) {
      if (now < bot.sitUntil) return { changed: false };
      if (bot.riseAt === null) {
        bot.riseAt = now + BOW_PERIOD_MS;
        v.bowAt = now;
        return { changed: true, event: "bow" };
      }
      if (now < bot.riseAt) return { changed: false };
      bot.riseAt = null;
      this.seats.delete(v.cushion);
      v.cushion = null;
      v.pose = "walk";
      delete v.bowAt;
      bot.waitUntil = now + 1000 + this.rng() * 2000;
      return { changed: true };
    }
    let changed = false;
    if (v.pose === "hello" && now >= bot.helloUntil) {
      v.pose = "walk";
      changed = true;
    }
    if (bot.greetAt !== null && now >= bot.greetAt) {
      bot.greetAt = null;
      if (v.pose === "walk") return this.sayHello(bot, now);
    }

    const t = bot.target;
    // The hello pose is a standing gesture: finish it before walking on.
    if (t && v.pose !== "hello") {
      const moved = this.walk(bot, t, BOT_SPEED, tickMs);
      if (moved === "blocked") {
        this.abandonTarget(bot, now);
        return { changed: true };
      }
      if (moved === "arrived") {
        bot.target = null;
        bot.waitUntil = now + 1500 + this.rng() * 4000;
        if (bot.seatOnArrive !== null) {
          const seat = bot.seatOnArrive;
          const holder = this.seats.get(seat);
          if (holder === undefined || holder === v.id) {
            this.sit(bot, seat, now);
            return { changed: true, event: "bow" };
          }
          bot.seatOnArrive = null;
        }
      }
      return { changed: true };
    }

    if (now >= bot.nextHelloAt && v.pose === "walk") return this.sayHello(bot, now);
    if (now >= bot.waitUntil && v.pose === "walk") this.planWalk(bot);
    return { changed };
  }

  /** Stand up, give back any cushion and walk to the gate; `step` then reports `gone`. */
  leave(bot: Bot, now: number): void {
    if (bot.leaving) return;
    this.release(bot);
    const v = bot.v;
    v.cushion = null;
    v.pose = "walk";
    delete v.bowAt;
    bot.target = null;
    bot.greetAt = null;
    bot.riseAt = null;
    bot.leaving = true;
    bot.leaveBy = now + LEAVE_TIMEOUT_MS;
    bot.route = this.routeToGate(v.position);
  }

  /** Someone at `from` said hello: maybe bow back 1–3 s later. Returns true when a greeting is scheduled. */
  greetBack(bot: Bot, now: number, from: Vec2): boolean {
    const v = bot.v;
    if (bot.leaving || v.cushion !== null || bot.greetAt !== null || v.pose === "hello") return false;
    if (Math.hypot(v.position.x - from.x, v.position.z - from.z) > GREET_RADIUS) return false;
    if (this.rng() >= GREET_CHANCE) return false;
    bot.greetAt = now + 1000 + this.rng() * 2000;
    return true;
  }

  /** Moves every pending deadline `ms` later: the bot was frozen that long and must not catch up all at once. */
  shift(bot: Bot, ms: number): void {
    bot.waitUntil += ms;
    bot.sitUntil += ms;
    if (bot.riseAt !== null) bot.riseAt += ms;
    bot.helloUntil += ms;
    bot.nextHelloAt += ms;
    bot.leaveBy += ms;
    if (bot.greetAt !== null) bot.greetAt += ms;
  }

  /** Frees the cushion the bot sits on or walks to (call before dropping a bot without `leave`). */
  release(bot: Bot): void {
    const c = bot.v.cushion;
    if (c !== null && this.seats.get(c) === bot.v.id) this.seats.delete(c);
    if (bot.seatOnArrive !== null && this.seats.get(bot.seatOnArrive) === bot.v.id) this.seats.delete(bot.seatOnArrive);
    bot.seatOnArrive = null;
  }

  private stepLeaving(bot: Bot, now: number, tickMs: number): BotStep {
    if (now >= bot.leaveBy) return { changed: false, gone: true };
    let changed = false;
    if (bot.v.pose === "hello" && now >= bot.helloUntil) {
      bot.v.pose = "walk";
      changed = true;
    }
    const route = bot.route;
    if (!route) return { changed };
    const next = route[0];
    if (!next) return { changed, gone: true };
    const moved = this.walk(bot, next, LEAVE_SPEED, tickMs);
    if (moved === "blocked") {
      bot.route = this.routeToGate(bot.v.position);
      return { changed: true };
    }
    if (moved === "arrived") {
      route.shift();
      if (route.length === 0) return { changed: true, gone: true };
    }
    return { changed: true };
  }

  private sayHello(bot: Bot, now: number): BotStep {
    // Any hello answers a pending greeting and counts as this round's hello.
    bot.greetAt = null;
    bot.nextHelloAt = now + 20_000 + this.rng() * 30_000;
    bot.helloUntil = now + BOT_HELLO_MS;
    bot.v.pose = "hello";
    return { changed: true, event: "hello" };
  }

  /** One tick of straight walking towards `t`. */
  private walk(bot: Bot, t: Vec2, speed: number, tickMs: number): "moving" | "arrived" | "blocked" {
    const p = bot.v.position;
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const dist = Math.hypot(dx, dz);
    const step = Math.min(dist, speed * (tickMs / 1000));
    const nx = dist > 0 ? p.x + (dx / dist) * step : p.x;
    const nz = dist > 0 ? p.z + (dz / dist) * step : p.z;
    if (dist > 0) p.yaw = Math.atan2(dx, dz);
    // The line was checked when planning; re-check each step anyway (never end up in a wall).
    if (!isWalkable(this.space.collision, nx, nz, WALK_RADIUS)) return "blocked";
    p.x = nx;
    p.z = nz;
    return step >= dist ? "arrived" : "moving";
  }

  private sit(bot: Bot, cushion: number, at: number): void {
    const v = bot.v;
    this.seats.set(cushion, v.id);
    v.cushion = cushion;
    v.pose = "kneel";
    v.bowAt = at;
    v.position = { ...cushionOf(this.space, cushion) };
    bot.sitUntil = at + 20_000 + this.rng() * 25_000;
    bot.riseAt = null;
    bot.target = null;
    bot.seatOnArrive = null;
    // A pending greet-back would fire as an unprompted hello when the bot stands up.
    bot.greetAt = null;
  }

  private freeCushionNear(p: Vec2, mustReach = false): number | null {
    let best: number | null = null;
    let bestD = Infinity;
    for (const [i, c] of this.space.cushions.entries()) {
      // Resident cushions are skipped here too, so a caller that forgot to seat the NPCs cannot put a bot on them.
      if (this.seats.has(i) || this.space.residentCushions.includes(i)) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z) + this.rng() * 3;
      if (d >= bestD) continue;
      if (mustReach && !segmentClear(this.space.collision, p, c)) continue;
      bestD = d;
      best = i;
    }
    return best;
  }

  private randomSpot(): Vec2 {
    const spots = this.space.botSpots;
    for (let i = 0; i < 20; i++) {
      const s = spots[Math.floor(this.rng() * spots.length)] ?? spots[0];
      if (!s) break;
      const x = s.x + (this.rng() - 0.5) * 6;
      const z = s.z + (this.rng() - 0.5) * 6;
      if (isWalkable(this.space.collision, x, z)) return { x, z };
    }
    return { x: this.space.spawn.x, z: this.space.spawn.z };
  }

  private gateSpot(): Vec2 {
    const { spawn, spawnJitter } = this.space;
    for (let i = 0; i < 10; i++) {
      const x = spawn.x + (this.rng() - 0.5) * 2 * spawnJitter;
      const z = spawn.z + (this.rng() - 0.5) * 2 * spawnJitter;
      if (isWalkable(this.space.collision, x, z)) return { x, z };
    }
    return { x: spawn.x, z: spawn.z };
  }

  /** Picks a straight, clear walk from where the bot stands (no pathfinding, like the player). */
  private planWalk(bot: Bot): void {
    const p = bot.v.position;
    if (this.space.zoneOf(p.x, p.z) === this.space.seatZone && this.rng() < 0.3) {
      const seat = this.freeCushionNear(p, true);
      if (seat !== null) {
        this.seats.set(seat, bot.v.id);
        bot.seatOnArrive = seat;
        bot.target = cushionOf(this.space, seat);
        return;
      }
    }
    const spots = this.space.botSpots;
    for (let i = 0; i < 8; i++) {
      const near = i % 2 === 0;
      const base = near ? p : (spots[Math.floor(this.rng() * spots.length)] ?? p);
      const spread = near ? 16 : 6;
      const t = { x: base.x + (this.rng() - 0.5) * spread, z: base.z + (this.rng() - 0.5) * spread };
      if (Math.hypot(t.x - p.x, t.z - p.z) > 1.5 && segmentClear(this.space.collision, p, t)) {
        bot.target = t;
        return;
      }
    }
  }

  private abandonTarget(bot: Bot, now: number): void {
    if (bot.seatOnArrive !== null) this.seats.delete(bot.seatOnArrive);
    bot.seatOnArrive = null;
    bot.target = null;
    bot.waitUntil = now + 1000;
  }

  /** Leaving is the one walk that must cross the hall door, so a single straight line is not enough. */
  private routeToGate(from: Vec2): Vec2[] | null {
    const gate: Vec2 = { x: this.space.spawn.x, z: this.space.spawn.z };
    return findPath(this.space.collision, this.space.navPoints, from, gate);
  }
}
