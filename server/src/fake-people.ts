import {
  DEFAULT_POPULATION,
  RESUME_GRACE_MS,
  VISITOR_COLORS,
  BotBrain,
  botTarget,
  makeBotName,
  roomNumber,
  seeded,
  type Bot,
  type PopulationConfig,
  type SpaceDef,
  type Vec2,
  type Visitor,
  type VisitorEvent,
} from "@santinh/shared";
import type { Entry, RoomState } from "./room-state.ts";

/** Population changes by at most one bot per 20-40 s (P-D6). */
const RESIZE_MIN_MS = 20_000;
const RESIZE_SPAN_MS = 20_000;
/** About a third of the bots are already kneeling when the first visitor walks in. */
const SEATED_SHARE = 1 / 3;

/** What the bots need from the room that owns them. */
export interface FakeHost {
  freeSlot(): number;
  /** Names already used in the room (residents + real people + bots). */
  takenNames(): Set<string>;
  /** Tell the sockets a bot walked in. */
  announce(entry: Entry): void;
  /** Tell the sockets a bot is gone. */
  dismiss(id: string): void;
  emit(event: VisitorEvent): void;
}

/** The fake visitors of one room. They are ordinary visitors inside `RoomState`, so clients cannot tell them apart. */
export class FakePeople {
  private readonly roomId: string;
  private readonly capacity: number;
  private readonly state: RoomState;
  private readonly host: FakeHost;
  private readonly population: () => PopulationConfig;
  private readonly brain: BotBrain;
  private readonly rng: () => number;
  private readonly bots = new Map<string, Bot>();
  private readonly seedBase: number;
  private spawned = 0;
  private nextResizeAt = 0;
  private running = false;
  private stoppedAt = -Infinity;

  constructor(
    roomId: string,
    space: SpaceDef,
    capacity: number,
    state: RoomState,
    host: FakeHost,
    population: () => PopulationConfig = () => DEFAULT_POPULATION,
  ) {
    this.roomId = roomId;
    this.capacity = capacity;
    this.state = state;
    this.host = host;
    this.population = population;
    this.seedBase = (roomNumber(roomId) ?? 1) * 1000;
    this.rng = seeded(this.seedBase + 999);
    this.brain = new BotBrain(space, this.rng, state.seatMap);
  }

  /**
   * Before a join into an empty room, decides what happens to the frozen bots:
   * - someone resuming within RESUME_GRACE_MS → the same bots carry on, deadlines moved past the freeze;
   * - anyone else → cleared, so they meet the crowd `/api/rooms` promised.
   */
  wake(now: number, returning: boolean): void {
    if (this.running || this.bots.size === 0) return;
    const frozen = now - this.stoppedAt;
    if (!returning || frozen >= RESUME_GRACE_MS) {
      this.clear();
      return;
    }
    for (const bot of this.bots.values()) this.brain.shift(bot, frozen);
  }

  /** First real visitor in: frozen bots kept by `wake` carry on, else a fresh set "was already here" (nobody to tell). */
  start(now: number): void {
    if (this.running) return;
    this.running = true;
    this.nextResizeAt = now + this.resizeDelay();
    if (this.bots.size > 0) return;
    const want = botTarget(this.roomId, now, this.capacity, this.state.realCount, this.population());
    for (let i = 0; i < want; i++) this.spawn(now, { seated: this.rng() < SEATED_SHARE, atGate: false }, false);
  }

  /** The last real visitor left: freeze the bots (no ticks, P-D8); see `wake`. */
  stop(now: number): void {
    this.running = false;
    this.stoppedAt = now;
  }

  tick(now: number, tickMs: number): void {
    if (!this.running) return;
    for (const [id, bot] of [...this.bots]) {
      const res = this.brain.step(bot, now, tickMs);
      if (res.changed) this.state.markDirty(id);
      if (res.event) {
        const ev = res.event === "hello" ? this.state.hello(id, now) : this.state.bow(id, now);
        if (ev) this.host.emit(ev);
      }
      if (res.gone) this.drop(id, true);
    }
    if (now >= this.nextResizeAt) {
      this.nextResizeAt = now + this.resizeDelay();
      this.resize(now);
    }
  }

  /** A real visitor waved: bots within earshot may wave back. */
  onHello(from: Vec2, now: number): void {
    for (const bot of this.bots.values()) this.brain.greetBack(bot, now, from);
  }

  /**
   * The room is at capacity: the bot nearest the gate steps out at once so a real visitor fits (P-D7).
   * `force`: someone resuming their place; then even the last `minBots` give way.
   */
  yieldOne(force = false): boolean {
    const gate = this.brain.space.spawn;
    let pick: string | null = null;
    let best = Infinity;
    for (const [id, bot] of this.bots) {
      const p = bot.v.position;
      const d = Math.hypot(p.x - gate.x, p.z - gate.z);
      if (d < best) {
        best = d;
        pick = id;
      }
    }
    if (pick === null || (!force && this.bots.size <= this.population().minBots)) return false;
    this.drop(pick, true);
    return true;
  }

  private resize(now: number): void {
    const staying = [...this.bots.values()].filter((b) => !b.leaving);
    const want = botTarget(this.roomId, now, this.capacity, this.state.realCount, this.population());
    if (staying.length < want && this.state.headCount < this.capacity) {
      this.spawn(now, { atGate: true }, true);
    } else if (staying.length > want) {
      const bot = staying[Math.floor(this.rng() * staying.length)];
      if (bot) this.brain.leave(bot, now);
    }
  }

  private spawn(now: number, opts: { seated?: boolean; atGate?: boolean }, announce: boolean): void {
    const idx = this.spawned++;
    const nameRng = seeded(this.seedBase + idx);
    const visitor: Visitor = {
      id: this.newId(),
      name: makeBotName(nameRng, this.host.takenNames()),
      color: VISITOR_COLORS[Math.floor(nameRng() * VISITOR_COLORS.length)] ?? "#b9c3c7",
      joinedAt: now,
      pose: "walk",
      cushion: null,
      position: { x: 0, z: 0, yaw: 0 },
    };
    const bot = this.brain.spawn(visitor, now, opts);
    const entry = this.state.addBot(bot.v, this.host.freeSlot(), now);
    this.bots.set(visitor.id, bot);
    if (announce) this.host.announce(entry);
  }

  private drop(id: string, announce: boolean): void {
    const bot = this.bots.get(id);
    if (!bot) return;
    this.brain.release(bot);
    this.bots.delete(id);
    this.state.remove(id);
    if (announce) this.host.dismiss(id);
  }

  private clear(): void {
    for (const id of [...this.bots.keys()]) this.drop(id, false);
  }

  private newId(): string {
    let id: string;
    do {
      id = "v:" + Array.from({ length: 10 }, () => Math.floor(this.rng() * 36).toString(36)).join("");
    } while (this.state.get(id));
    return id;
  }

  private resizeDelay(): number {
    return RESIZE_MIN_MS + this.rng() * RESIZE_SPAN_MS;
  }
}
