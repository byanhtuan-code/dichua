import {
  BOW_PERIOD_MS,
  BotBrain,
  ChatThrottle,
  HELLO_COOLDOWN_MS,
  ROOM_CAPACITY,
  ROOM_COUNT,
  TICK_MS,
  VISITOR_COLORS,
  cushionOf,
  isWalkable,
  makeBotName,
  makeName,
  maskProfanity,
  normalizeChatText,
  normalizeVisitorName,
  residentsFor,
  roomId,
  roomAllowsChat,
  roomNameOf,
  roomNumber,
  SESSION_TOKEN,
  seeded,
  spaceOf,
  uniqueName,
  type AccountView,
  type Bot,
  type ChatDeniedReason,
  type ConnectionStatus,
  type Pose,
  type RoomInfo,
  type Vec2,
  type Vec2Yaw,
  type Visitor,
  type VisitorEvent,
} from "@santinh/shared";
import { NetEmitter, type NetDriver, type NetDriverEvents, type NetListener } from "./net-driver.ts";

const LATENCY_MS = 120;
const CONNECT_MS = 450;
export const MAX_BOTS = ROOM_CAPACITY - 1;
export const DEFAULT_BOTS = 3;
/** Fake head counts of the other rooms (room 7 is full so the "full" state is reachable). */
const FAKE_COUNTS: readonly number[] = [0, 7, 12, 1, 0, 18, ROOM_CAPACITY, 5, 9, 2];

/** Every mock session is this one account; its character name is whatever name we go by. */
const MOCK_USERNAME = "ban.mock";

export type MockMode = "normal" | "offline" | "full";

export interface MockConfig {
  mode: MockMode;
  bots: number;
}

/** `?mock=offline` · `?mock=full` · `?mock=bots=N` (0…29); anything else → 3 bots, normal. */
export function parseMock(value: string | null): MockConfig {
  if (value === "offline" || value === "full") return { mode: value, bots: DEFAULT_BOTS };
  const m = value ? /^bots=(\d{1,2})$/.exec(value) : null;
  const bots = m ? Math.min(MAX_BOTS, Number(m[1])) : DEFAULT_BOTS;
  return { mode: "normal", bots };
}

export interface MockOptions extends Partial<MockConfig> {
  /** Bots that start on a cushion (default: 1 when there is a bot). */
  seated?: number;
  seed?: number;
}

function copyVisitor(v: Visitor): Visitor {
  return { ...v, position: { ...v.position } };
}

/**
 * Pretend server: bots run the shared `BotBrain` (same as the real server), cushions are granted
 * one person each, hello/bow events, 10 rooms with fixed fake head counts.
 */
export class MockNetDriver implements NetDriver {
  readonly clockOffset = 0;
  private readonly emitter = new NetEmitter();
  private readonly mode: MockMode;
  private readonly botCount: number;
  private readonly seatedCount: number;
  private readonly seed: number;
  private rng: () => number;
  private status: ConnectionStatus = "offline";
  private room: string | null = null;
  /** Bot behaviour for the room we are in (map, cushions, bot spots); rebuilt on join. */
  private brain: BotBrain;
  /** `?mock=full`: the room that turned us away (shown full in `listRooms`); later joins elsewhere succeed. */
  private rejected: string | null = null;
  private self: Visitor | null = null;
  /** Name from `setName`; null → the random one. */
  private wantedName: string | null = null;
  private asleep = false;
  /** Any well-formed token counts as signed in (the mock account API keeps the real list). */
  private session: string | null = null;
  /** Per account like the server's, so a room switch does not reset it. */
  private readonly chatThrottle = new ChatThrottle();
  private chatSeq = 0;
  private bots: Bot[] = [];
  private readonly seats = new Map<number, string>();
  private selfDirty = false;
  private lastHelloAt = -Infinity;
  private eventSeq = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Delayed replies; flushed on disconnect so no promise hangs. */
  private readonly pending = new Map<ReturnType<typeof setTimeout>, () => void>();

  constructor(opts: MockOptions = {}) {
    this.mode = opts.mode ?? "normal";
    this.botCount = Math.max(0, Math.min(MAX_BOTS, opts.bots ?? DEFAULT_BOTS));
    this.seatedCount = Math.min(this.botCount, opts.seated ?? Math.min(1, this.botCount));
    this.seed = opts.seed ?? 7;
    this.rng = seeded(this.seed);
    this.brain = new BotBrain(spaceOf(roomId(1)), this.rng, this.seats);
  }

  on<K extends keyof NetDriverEvents>(event: K, cb: NetListener<NetDriverEvents[K]>): () => void {
    return this.emitter.on(event, cb);
  }

  connect(id: string): void {
    this.stopRoom();
    this.setStatus("connecting");
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.mode === "offline") this.setStatus("reconnecting");
      else if (this.mode === "full" && (this.rejected === null || this.rejected === id)) {
        this.rejected = id;
        this.setStatus("full");
      } else this.join(roomNumber(id) === null ? roomId(1) : id);
    }, CONNECT_MS);
  }

  disconnect(): void {
    const was = this.status;
    this.stopRoom();
    // stopRoom resets silently (it also runs before a reconnect); a real leave must reach the HUD.
    if (was !== "offline") this.emitter.emit("status", "offline");
    for (const [timer, fn] of this.pending) {
      clearTimeout(timer);
      fn();
    }
    this.pending.clear();
  }

  switchRoom(id: string): Promise<boolean> {
    const n = roomNumber(id);
    const ok = this.status === "connected" && n !== null && id !== this.room && (FAKE_COUNTS[n - 1] ?? 0) < ROOM_CAPACITY;
    return this.reply(() => {
      if (!ok || this.status !== "connected") return false;
      this.stopRoom();
      this.setStatus("connecting");
      this.join(id);
      return true;
    });
  }

  listRooms(): Promise<RoomInfo[]> {
    if (this.status === "reconnecting" || this.status === "connecting") {
      return new Promise((_, reject) => this.later(LATENCY_MS, () => reject(new Error("mock: not connected"))));
    }
    return this.reply(() =>
      Array.from({ length: ROOM_COUNT }, (_, i) => {
        const id = roomId(i + 1);
        return { id, number: i + 1, name: roomNameOf(null, i + 1), count: id === this.room ? this.realCount() : id === this.rejected ? ROOM_CAPACITY : (FAKE_COUNTS[i] ?? 0), capacity: ROOM_CAPACITY };
      }),
    );
  }

  sendMove(pos: Vec2Yaw, pose: Pose): void {
    const self = this.self;
    if (!self || this.status !== "connected") return;
    // A seated visitor sits on the cushion itself; anyone else must stand on free floor.
    if (self.cushion === null && !isWalkable(this.brain.space.collision, pos.x, pos.z)) {
      this.emitter.emit("corrected", { ...self.position });
      return;
    }
    self.position = { x: pos.x, z: pos.z, yaw: pos.yaw };
    self.pose = pose;
    this.selfDirty = true;
  }

  requestSeat(near: Vec2): Promise<number | null> {
    const self = this.self;
    if (!self || this.status !== "connected") return this.reply(() => null);
    let best: number | null = null;
    let bestD = Infinity;
    for (const [i, c] of this.brain.space.cushions.entries()) {
      const holder = this.seats.get(i);
      if (holder !== undefined && holder !== self.id) continue;
      const d = Math.hypot(c.x - near.x, c.z - near.z);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best !== null) {
      if (self.cushion !== null) this.seats.delete(self.cushion);
      this.seats.set(best, self.id);
      self.cushion = best;
      self.pose = "kneel";
      self.bowAt = this.now();
      self.position = { ...cushionOf(this.brain.space, best) };
      this.selfDirty = true;
    }
    const granted = best;
    return this.reply(() => granted);
  }

  stand(): void {
    const self = this.self;
    if (!self) return;
    if (self.cushion !== null) this.seats.delete(self.cushion);
    self.cushion = null;
    self.pose = "walk";
    delete self.bowAt;
    this.selfDirty = true;
  }

  hello(): void {
    const self = this.self;
    if (!self || this.status !== "connected") return;
    const now = this.now();
    if (now - this.lastHelloAt < HELLO_COOLDOWN_MS) return;
    this.lastHelloAt = now;
    this.sendEvent(self.id, "hello");
    for (const bot of this.bots) this.brain.greetBack(bot, now, self.position);
  }

  bead(): void {
    if (this.self && this.status === "connected") this.sendEvent(this.self.id, "bead");
  }

  /** Like the server's bowAgain: seated, and the previous bow is over. */
  bow(): void {
    const self = this.self;
    if (!self || this.status !== "connected" || self.cushion === null) return;
    const now = this.now();
    if (self.bowAt !== undefined && now - self.bowAt < BOW_PERIOD_MS) return;
    self.bowAt = now;
    this.selfDirty = false;
    this.emitter.emit("update", { serverTime: now, visitors: [copyVisitor(self)], removed: [] });
    this.sendEvent(self.id, "bow");
  }

  setName(name: string): void {
    const clean = normalizeVisitorName(name);
    if (clean === null) return;
    this.wantedName = clean;
    const self = this.self;
    if (!self || this.status !== "connected") return;
    const next = this.nameInRoom(clean);
    if (next === self.name) return;
    self.name = next;
    this.selfDirty = false;
    this.emitter.emit("update", { serverTime: this.now(), visitors: [copyVisitor(self)], removed: [] });
  }

  setAsleep(asleep: boolean): void {
    this.asleep = asleep;
    const self = this.self;
    if (!self || Boolean(self.asleep) === asleep) return;
    if (asleep) self.asleep = true;
    else delete self.asleep;
    this.selfDirty = true;
  }

  setSession(token: string | null): void {
    const next = token !== null && SESSION_TOKEN.test(token) ? token : null;
    if (next === this.session) return;
    this.session = next;
    if (this.status !== "connected") return;
    const room = this.room;
    this.later(LATENCY_MS, () => {
      if (this.self && this.status === "connected" && this.room === room) this.emitter.emit("account", this.accountView(this.self));
    });
  }

  /** Same checks in the same order as the server (T3); bots never chat. */
  sendChat(raw: string): void {
    const self = this.self;
    const room = this.room;
    if (!self || room === null || this.status !== "connected") return;
    const answer = this.judgeChat(self, room, raw, this.now());
    this.later(LATENCY_MS, () => {
      if (this.status === "connected" && this.room === room) answer();
    });
  }

  /** Decides now (the throttle books the send time), answers after the fake round trip. */
  private judgeChat(self: Visitor, room: string, raw: string, now: number): () => void {
    const deny = (reason: ChatDeniedReason, retryInMs?: number): (() => void) => () =>
      this.emitter.emit("chatDenied", retryInMs === undefined ? { reason } : { reason, retryInMs });
    if (!roomAllowsChat(room)) return deny("quiet-room");
    if (this.session === null) return deny("login");
    const tier = "free";
    const norm = normalizeChatText(raw, tier);
    if (!norm.ok) return deny(norm.reason);
    const ok = this.chatThrottle.check(norm.text, now, tier);
    if (!ok.ok) return deny(ok.reason, ok.retryInMs);
    this.chatThrottle.record(norm.text, now);
    this.chatSeq += 1;
    const line = { id: String(this.chatSeq), visitorId: self.id, name: self.name, text: maskProfanity(norm.text), at: now };
    return () => this.emitter.emit("chat", line);
  }

  /** Advances the bots one server tick. Public so tests can drive it without timers. */
  tick(): void {
    if (this.status !== "connected") return;
    const now = this.now();
    const changed: Visitor[] = [];
    for (const bot of this.bots) {
      const step = this.brain.step(bot, now, TICK_MS);
      if (step.event) this.sendEvent(bot.v.id, step.event);
      if (step.changed) changed.push(copyVisitor(bot.v));
    }
    if (this.self && this.selfDirty) changed.push(copyVisitor(this.self));
    this.selfDirty = false;
    if (changed.length > 0) this.emitter.emit("update", { serverTime: now, visitors: changed, removed: [] });
  }

  /** Bot visitors (tests). */
  get botVisitors(): readonly Visitor[] {
    return this.bots.map((b) => b.v);
  }

  private accountView(self: Visitor): AccountView | null {
    return this.session === null ? null : { username: MOCK_USERNAME, displayName: self.name, tier: "free" };
  }

  private now(): number {
    return Date.now() + this.clockOffset;
  }

  private setStatus(s: ConnectionStatus): void {
    if (s === this.status) return;
    this.status = s;
    this.emitter.emit("status", s);
  }

  private realCount(): number {
    return (this.self ? 1 : 0) + this.bots.length;
  }

  private later(ms: number, fn: () => void): void {
    const timer = setTimeout(() => {
      this.pending.delete(timer);
      fn();
    }, ms);
    this.pending.set(timer, fn);
  }

  /** Resolves with `make()` after the fake round trip. */
  private reply<T>(make: () => T): Promise<T> {
    return new Promise((resolve) => this.later(LATENCY_MS, () => resolve(make())));
  }

  private stopRoom(): void {
    if (this.connectTimer !== null) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.status = "offline";
    this.room = null;
    this.self = null;
    this.bots = [];
    this.seats.clear();
  }

  private join(id: string): void {
    const now = this.now();
    // Same room → same bots on every load (screenshots repeat).
    this.rng = seeded(this.seed * 31 + (roomNumber(id) ?? 1));
    this.room = id;
    const space = spaceOf(id);
    this.brain = new BotBrain(space, this.rng, this.seats);
    const residents = residentsFor(id);
    for (const r of residents) this.seats.set(r.cushion, r.id);

    const taken = new Set<string>();
    const selfName = makeName(this.rng, taken);
    taken.add(selfName);
    this.self = {
      id: `v:${Math.floor(this.rng() * 1e9).toString(36)}`,
      name: selfName,
      color: VISITOR_COLORS[0] ?? "#b9c3c7",
      joinedAt: now,
      pose: "walk",
      cushion: null,
      position: { ...space.spawn },
      ...(this.asleep ? { asleep: true } : {}),
    };
    this.bots = [];
    for (let i = 0; i < this.botCount; i++) {
      const name = makeBotName(this.rng, taken);
      taken.add(name);
      const v: Visitor = {
        id: `bot:${i + 1}`,
        name,
        color: VISITOR_COLORS[(i + 1) % VISITOR_COLORS.length] ?? "#c9a46a",
        joinedAt: now - Math.floor(this.rng() * 600_000),
        pose: "walk",
        cushion: null,
        position: { x: 0, z: 0, yaw: 0 },
      };
      this.bots.push(this.brain.spawn(v, now, { seated: i < this.seatedCount }));
    }

    // The random name above is still drawn: skipping it would shift the seeded sequence (other bots, positions).
    if (this.wantedName !== null) this.self.name = this.nameInRoom(this.wantedName);

    const visitors: Visitor[] = [copyVisitor(this.self), ...this.bots.map((b) => copyVisitor(b.v))];
    for (const [i, r] of residents.entries()) {
      visitors.push({
        id: r.id,
        name: r.name,
        color: r.color,
        joinedAt: 0,
        pose: "kneel",
        cushion: r.cushion,
        position: { ...cushionOf(space, r.cushion) },
        // Staggered so the four do not bow as one.
        bowAt: now - i * 1100,
      });
    }
    this.setStatus("connected");
    this.emitter.emit("snapshot", { selfId: this.self.id, room: id, visitors, serverTime: now, reserved: null, roomName: roomNameOf(null, roomNumber(id) ?? 0) });
    // Server order: snapshot, chat-history (chat rooms only), then the reply to the socket's `auth`.
    if (roomAllowsChat(id)) this.emitter.emit("chatHistory", []);
    if (this.session !== null) this.emitter.emit("account", this.accountView(this.self));
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  /** Like the server: a name someone else in the room has gets a number. */
  private nameInRoom(want: string): string {
    const taken = new Set<string>(this.bots.map((b) => b.v.name));
    if (this.room !== null) for (const r of residentsFor(this.room)) taken.add(r.name);
    return uniqueName(want, taken);
  }

  private sendEvent(visitorId: string, type: VisitorEvent["type"]): void {
    this.eventSeq += 1;
    this.emitter.emit("event", { eventId: `mock:${this.eventSeq}`, visitorId, type, at: this.now() });
  }
}
