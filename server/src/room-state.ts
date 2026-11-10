import {
  BEAD_EVERY_MS,
  BOW_PERIOD_MS,
  HELLO_COOLDOWN_MS,
  DEFAULT_POPULATION,
  MAX_SPEED,
  ROOM_CAPACITY,
  SPEED_TOLERANCE_M,
  botTarget,
  isWalkable,
  segmentClear,
  tierOf,
  type Pose,
  type PopulationConfig,
  type SpaceDef,
  type Vec2,
  type Vec2Yaw,
  type Visitor,
  type VisitorEvent,
} from "@santinh/shared";

/** A long silence must not buy an unbounded jump: elapsed time is capped here. */
const MAX_MOVE_DT_MS = 2000;

const NEAR_ANGLES = 12;
const NEAR_MIN_M = 1.2;
const NEAR_MAX_M = 2;

export interface Entry {
  visitor: Visitor;
  slot: number;
  lastMoveAt: number;
  /** Speed slack left (m): a budget that bursts spend and slower walking refills, never a fresh bonus per step. */
  slack: number;
  /**
   * Cushion granted but not reached yet. Kept off `visitor.cushion`: clients place anyone with a cushion straight onto it,
   * so others would see the walker jump there.
   */
  reserved: number | null;
  lastHelloAt: number;
  lastBeadAt: number;
}

export interface MoveInput {
  x: number;
  z: number;
  yaw: number;
  pose: Pose;
}

/** Capacity and whether fake visitors exist; with `fake` off there are no room tiers at all. */
export interface RoomRules {
  capacity: number;
  fake: boolean;
  /** Read on every call: an admin change applies at once (P3-D8). Default `DEFAULT_POPULATION`. */
  population?: () => PopulationConfig;
}

export type JoinResult = "ok" | "full";

export interface SeatResult {
  cushion: number;
}

/** `fix`: position to send back (move refused). `bow`: the visitor just sat down on its reserved cushion. */
export interface MoveResult {
  fix: Vec2Yaw | null;
  bow: VisitorEvent | null;
}

/** A non-kneel pose this close to the reserved cushion also counts as arriving (a later pose can overwrite `kneel`). */
const ARRIVE_M = 0.3;

/** At most `limit` hits in any `windowMs`; more → `hit` returns true (over the limit). */
export class SlidingWindow {
  private readonly times: number[] = [];
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  hit(now: number): boolean {
    this.times.push(now);
    while (this.times.length > 0 && now - (this.times[0] ?? now) >= this.windowMs) this.times.shift();
    return this.times.length > this.limit;
  }
}

/** Who is in a room, who holds which cushion, and which moves are legal. No sockets, no timers: tests drive it with a fake `now`. */
export class RoomState {
  private readonly roomId: string;
  private readonly space: SpaceDef;
  private readonly entries = new Map<string, Entry>();
  private readonly seats = new Map<number, string>();
  private readonly dirty = new Set<string>();
  private readonly bots = new Set<string>();
  private readonly rules: RoomRules;
  private readonly population: () => PopulationConfig;
  private eventSeq = 0;

  constructor(roomId: string, space: SpaceDef, rules: RoomRules = { capacity: ROOM_CAPACITY, fake: false }) {
    this.roomId = roomId;
    this.space = space;
    this.rules = rules;
    this.population = rules.population ?? (() => DEFAULT_POPULATION);
  }

  /** Cushion → visitor id. Shared with `BotBrain` (and the residents) so everyone avoids the same cushions. */
  get seatMap(): Map<number, string> {
    return this.seats;
  }

  /** Real visitors plus bots (the residents are not counted). */
  get headCount(): number {
    return this.entries.size;
  }

  get realCount(): number {
    return this.entries.size - this.bots.size;
  }

  get botCount(): number {
    return this.bots.size;
  }

  /**
   * Head count for `/api/rooms`, derived from `admit` so the list never disagrees with the join:
   * - refused → `capacity`; joinable → at most `capacity − 1` (a bot steps aside);
   * - nobody inside → computed (frozen bots only come back for a resume, see `FakePeople.wake`).
   */
  count(now: number): number {
    const { capacity, fake } = this.rules;
    if (this.admit(now) === "full") return capacity;
    if (!fake) return this.realCount;
    const people = this.realCount > 0 ? this.entries.size : botTarget(this.roomId, now, capacity, 0, this.population());
    return Math.min(people, capacity - 1);
  }

  /**
   * The one entry rule (P-D7), behind both the join and `count`.
   * - `returning`: back with a valid resume token = already inside; tiers and `minBots` do not apply.
   */
  admit(now: number, returning = false): JoinResult {
    const { capacity, fake } = this.rules;
    if (this.realCount >= capacity) return "full";
    if (!fake || returning) return "ok";
    const cfg = this.population();
    if (tierOf(this.roomId, now, cfg) === "full") return "full";
    if (this.realCount === 0) return "ok";
    return this.entries.size < capacity || this.botCount > cfg.minBots ? "ok" : "full";
  }

  get(id: string): Entry | undefined {
    return this.entries.get(id);
  }

  all(): IterableIterator<Entry> {
    return this.entries.values();
  }

  add(visitor: Visitor, slot: number, now: number): Entry {
    const entry: Entry = {
      visitor,
      slot,
      lastMoveAt: now,
      slack: SPEED_TOLERANCE_M,
      reserved: null,
      lastHelloAt: -Infinity,
      lastBeadAt: -Infinity,
    };
    this.entries.set(visitor.id, entry);
    return entry;
  }

  addBot(visitor: Visitor, slot: number, now: number): Entry {
    this.bots.add(visitor.id);
    return this.add(visitor, slot, now);
  }

  markDirty(id: string): void {
    if (this.entries.has(id)) this.dirty.add(id);
  }

  /** D25: stored and relayed as is; a cushion is kept while asleep (an unreached reservation is freed). */
  setAsleep(id: string, asleep: boolean): void {
    const entry = this.entries.get(id);
    const v = entry?.visitor;
    if (!entry || !v || Boolean(v.asleep) === asleep) return;
    if (asleep) {
      v.asleep = true;
      if (entry.reserved !== null) {
        if (this.seats.get(entry.reserved) === id) this.seats.delete(entry.reserved);
        entry.reserved = null;
      }
    } else {
      delete v.asleep;
    }
    this.dirty.add(id);
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.release(entry);
    this.entries.delete(id);
    this.bots.delete(id);
    this.dirty.delete(id);
  }

  /** Legal move → applied. Illegal → state untouched, `fix` = the last valid position to send back. */
  move(id: string, msg: MoveInput, now: number): MoveResult {
    const none: MoveResult = { fix: null, bow: null };
    const entry = this.entries.get(id);
    if (!entry) return none;
    const v = entry.visitor;
    // Measured from the last accepted move: a refused one must not use up time, or the moves already in flight get refused too.
    const dt = Math.min(Math.max(now - entry.lastMoveAt, 0), MAX_MOVE_DT_MS);

    if (entry.reserved !== null && this.arrives(entry.reserved, msg)) {
      // The client kneels when it reaches the cushion, or snaps onto it when the walk is too long / stalls; either way the
      // cushion was granted from where the server had it, so sitting is always allowed here.
      entry.lastMoveAt = now;
      return { fix: null, bow: this.sit(entry, entry.reserved, now) };
    }

    if (v.cushion !== null) {
      entry.lastMoveAt = now;
      // Seated: the body stays on the cushion; only heading and a non-walking pose change.
      const pose = msg.pose === "walk" ? v.pose : msg.pose;
      if (v.position.yaw !== msg.yaw || v.pose !== pose) {
        v.position = { ...v.position, yaw: msg.yaw };
        v.pose = pose;
        this.dirty.add(id);
      }
      return none;
    }

    const from: Vec2 = v.position;
    // A fixed tolerance per step let a client chain 2.3 m every 200 ms tick (11.5 m/s).
    const reach = (MAX_SPEED * dt) / 1000 + entry.slack;
    const dist = Math.hypot(msg.x - from.x, msg.z - from.z);
    const map = this.space.collision;
    // Standing up leaves the walker on a cushion that may itself be blocked: then only the destination is checked.
    const pathOk = isWalkable(map, from.x, from.z) ? segmentClear(map, from, msg) : isWalkable(map, msg.x, msg.z);
    if (dist > reach || !pathOk) return { fix: { ...v.position }, bow: null };
    entry.lastMoveAt = now;
    entry.slack = Math.min(SPEED_TOLERANCE_M, reach - dist);

    // Kneeling needs a cushion; hello / beads / walk are free postures.
    const pose = msg.pose === "kneel" ? "walk" : msg.pose;
    v.position = { x: msg.x, z: msg.z, yaw: msg.yaw };
    v.pose = pose;
    this.dirty.add(id);
    return none;
  }

  private arrives(cushion: number, msg: MoveInput): boolean {
    if (msg.pose === "kneel") return true;
    const c = this.space.cushions[cushion];
    return msg.pose !== "walk" && c !== undefined && Math.hypot(c.x - msg.x, c.z - msg.z) < ARRIVE_M;
  }

  /**
   * First spot 1.2–2 m around real visitor / bot `id` with a clear line to them, facing them; null when absent or boxed in.
   * - A host on a blocked cushion cell: only the spot is checked (same rule as `move`).
   */
  placeNear(id: string, rng: () => number = Math.random): Vec2Yaw | null {
    const host = this.entries.get(id)?.visitor.position;
    if (!host) return null;
    const map = this.space.collision;
    // A walkable cell behind a wall or across the pond is "near" but out of reach.
    const needLine = isWalkable(map, host.x, host.z);
    const start = rng() * Math.PI * 2;
    for (let i = 0; i < NEAR_ANGLES; i++) {
      const a = start + (i / NEAR_ANGLES) * Math.PI * 2;
      const r = NEAR_MIN_M + (NEAR_MAX_M - NEAR_MIN_M) * rng();
      const x = host.x + Math.cos(a) * r;
      const z = host.z + Math.sin(a) * r;
      if (!isWalkable(map, x, z) || (needLine && !segmentClear(map, host, { x, z }))) continue;
      return { x, z, yaw: Math.atan2(host.x - x, host.z - z) };
    }
    return null;
  }

  /**
   * Reserves the nearest free cushion to where the server has the visitor (residents' and other people's are skipped); the
   * visitor sits when it gets there (see `move`). Never a client-given point: that let one message jump to any cushion.
   * Already reserved / seated → the same cushion again, no new bow (a spammed `seat` must not ring the bell for the room).
   * Null when none is left.
   */
  seat(id: string): SeatResult | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    const held = entry.visitor.cushion ?? entry.reserved;
    if (held !== null) return { cushion: held };
    const near: Vec2 = entry.visitor.position;
    let best: number | null = null;
    let bestD = Infinity;
    for (const [i, c] of this.space.cushions.entries()) {
      if (this.space.residentCushions.includes(i) || this.seats.has(i)) continue;
      const d = Math.hypot(c.x - near.x, c.z - near.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best === null) return null;
    this.seats.set(best, id);
    entry.reserved = best;
    return { cushion: best };
  }

  stand(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const v = entry.visitor;
    if (v.cushion === null && entry.reserved === null && v.pose === "walk" && v.bowAt === undefined) return;
    this.release(entry);
    v.pose = "walk";
    delete v.bowAt;
    this.dirty.add(id);
  }

  /** Too soon after the last hello → null (dropped silently). */
  hello(id: string, now: number): VisitorEvent | null {
    const entry = this.entries.get(id);
    if (!entry || now - entry.lastHelloAt < HELLO_COOLDOWN_MS) return null;
    entry.lastHelloAt = now;
    return this.event(id, "hello", now);
  }

  /**
   * A seated visitor bows once more before standing (P3-D11): restarts the bow cycle for everyone.
   * Null when not on a cushion (walking to one included) or the last bow is still running.
   */
  bowAgain(id: string, now: number): VisitorEvent | null {
    const v = this.entries.get(id)?.visitor;
    if (!v || v.cushion === null) return null;
    if (v.bowAt !== undefined && now - v.bowAt < BOW_PERIOD_MS) return null;
    v.bowAt = now;
    this.dirty.add(id);
    return this.event(id, "bow", now);
  }

  /** A bot bowed: on reaching its cushion or before leaving it (its brain already set `bowAt`). */
  bow(id: string, now: number): VisitorEvent | null {
    return this.entries.has(id) ? this.event(id, "bow", now) : null;
  }

  bead(id: string, now: number): VisitorEvent | null {
    const entry = this.entries.get(id);
    if (!entry || now - entry.lastBeadAt < BEAD_EVERY_MS) return null;
    entry.lastBeadAt = now;
    return this.event(id, "bead", now);
  }

  /** Visitors changed since the last call. */
  takeDirty(): Entry[] {
    const out: Entry[] = [];
    for (const id of this.dirty) {
      const e = this.entries.get(id);
      if (e) out.push(e);
    }
    this.dirty.clear();
    return out;
  }

  private event(visitorId: string, type: VisitorEvent["type"], at: number): VisitorEvent {
    return { eventId: `${this.roomId}:${++this.eventSeq}`, visitorId, type, at };
  }

  private sit(entry: Entry, cushion: number, now: number): VisitorEvent | null {
    const spot = this.space.cushions[cushion];
    if (!spot) return null;
    const v = entry.visitor;
    this.seats.set(cushion, v.id);
    entry.reserved = null;
    v.cushion = cushion;
    v.pose = "kneel";
    v.bowAt = now;
    v.position = { ...spot };
    this.dirty.add(v.id);
    return this.event(v.id, "bow", now);
  }

  private release(entry: Entry): void {
    for (const c of [entry.visitor.cushion, entry.reserved]) {
      if (c !== null && this.seats.get(c) === entry.visitor.id) this.seats.delete(c);
    }
    entry.visitor.cushion = null;
    entry.reserved = null;
  }
}
