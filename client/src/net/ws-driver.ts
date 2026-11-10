import {
  BEAD_EVERY_MS,
  CHAT_HISTORY,
  MAX_CHAT_RAW_CHARS,
  SESSION_TOKEN,
  PING_EVERY_MS,
  TICK_MS,
  WIRE_POSES,
  decodeDelta,
  isFiniteNumber,
  isChatDeniedReason,
  isRecord,
  normalizeRoomName,
  normalizeVisitorName,
  parseAccountView,
  parseChatLine,
  roomNameOf,
  parseResumeToken,
  roomNumber,
  spaceOf,
  type ChatLine,
  type ConnectionStatus,
  type DeltaFrame,
  type ErrorCode,
  type Pose,
  type RoomInfo,
  type ServerMsg,
  type Vec2Yaw,
  type Visitor,
  type VisitorEvent,
  type WireProfile,
  type WireVisitor,
} from "@santinh/shared";
import { NetEmitter, type NetDriver, type NetDriverEvents, type NetListener } from "./net-driver.ts";
import { apiUrl, wsUrl } from "./server-url.ts";

const OPEN = 1;
const BACKOFF_BASE_MS = 700;
const BACKOFF_MAX_MS = 15_000;
const FULL_RETRY_MS = 8000;
const FULL_RETRY_SPREAD_MS = 4000;
const SWITCH_TIMEOUT_MS = 6000;
const SEAT_TIMEOUT_MS = 5000;
const OFFSET_SAMPLES = 5;
/**
 * Nothing heard for this long → the socket is dead even if the browser still calls it open (Wi-Fi ↔ 4G, weak signal: no
 * close may come for minutes). The server answers our ping every PING_EVERY_MS, so a live link is never this quiet.
 */
const SILENCE_MS = 12_000;
const ROOMS_TIMEOUT_MS = 8000;

/** One socket plus what we learned from it. A room switch briefly holds two. */
interface Link {
  ws: WebSocket;
  room: string;
  /** Set once the link is finished (closed by us or handled after a drop); late events are ignored. */
  done: boolean;
  full: boolean;
  /** Turned away: this network (IP) already has too many people in the room. */
  limited: boolean;
  fatal: boolean;
  /** Date.now() of the last message (or of the socket's creation). */
  lastHeard: number;
  /** Last revision applied; deltas must be exactly +1. */
  revision: number;
  /** After a revision gap we wait for the snapshot a `sync` brings. */
  awaitingSync: boolean;
  profiles: Map<number, WireProfile>;
  /** Name sent in this socket's URL; a later `setName` must follow as a rename once it is ours. */
  name: string | null;
}

interface PendingSeat {
  room: string;
  resolve: (cushion: number | null) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingSwitch {
  link: Link;
  resolve: (ok: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface WsDriverOptions {
  random?: () => number;
  /** Inviter id from `?near=`; sent on the first connect only, cleared by the first snapshot. */
  near?: string | null;
}

export class WebSocketNetDriver implements NetDriver {
  private readonly emitter = new NetEmitter();
  private readonly random: () => number;
  private near: string | null;
  /**
   * Token from the last snapshot: reconnecting to that room as the same visitor (same id → invite links survive).
   * Memory only: a back/forward-cache restore keeps it; sessionStorage would hand it to a duplicated tab too.
   */
  private resume: { room: string; token: string } | null = null;
  private name: string | null = null;
  /** Session token: never in a URL (Caddy logs URLs), only in the `auth` message (P4-D4). */
  private session: string | null = null;
  private asleep = false;
  private room: string | null = null;
  private main: Link | null = null;
  private pendingSwitch: PendingSwitch | null = null;
  private status: ConnectionStatus | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private moveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingMove: { pos: Vec2Yaw; pose: Pose } | null = null;
  private lastMoveAt = -Infinity;
  private lastBeadAt = -Infinity;
  private nextRequestId = 1;
  private readonly seats = new Map<number, PendingSeat>();
  private offsets: number[] = [];
  private listening = false;
  private pageShowHandler: ((e: Event) => void) | null = null;
  private lastCheckAt = 0;

  constructor(opts: WsDriverOptions = {}) {
    this.random = opts.random ?? Math.random;
    this.near = opts.near ?? null;
  }

  get clockOffset(): number {
    if (this.offsets.length === 0) return 0;
    return this.offsets.reduce((a, b) => a + b, 0) / this.offsets.length;
  }

  on<K extends keyof NetDriverEvents>(event: K, cb: NetListener<NetDriverEvents[K]>): () => void {
    return this.emitter.on(event, cb);
  }

  connect(roomId: string): void {
    this.teardown();
    this.room = roomId;
    this.attempt = 0;
    this.status = null;
    this.listen();
    this.setStatus("connecting");
    this.lastCheckAt = Date.now();
    this.pingTimer = setInterval(() => {
      this.checkAlive();
      this.ping();
    }, PING_EVERY_MS);
    this.openMain();
  }

  disconnect(): void {
    this.teardown();
    this.room = null;
    this.unlisten();
  }

  async switchRoom(roomId: string): Promise<boolean> {
    this.cancelSwitch(false);
    if (roomNumber(roomId) === null) return false;
    if (roomId === this.room && this.isOpen()) return true;
    return new Promise<boolean>((resolve) => {
      const link = this.open(roomId);
      if (!link) {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => {
        if (this.pendingSwitch?.link === link) this.cancelSwitch(false);
      }, SWITCH_TIMEOUT_MS);
      this.pendingSwitch = { link, resolve, timer };
    });
  }

  async listRooms(): Promise<RoomInfo[]> {
    // A dead connection can leave the request hanging: the dialog must get its error, not spin forever.
    // Hand-made timer: AbortSignal.timeout is missing on Safari < 16.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ROOMS_TIMEOUT_MS);
    let body: unknown;
    try {
      const res = await fetch(apiUrl("/api/rooms"), { signal: ac.signal });
      if (!res.ok) throw new Error(`rooms ${res.status}`);
      body = await res.json();
    } finally {
      clearTimeout(timer);
    }
    // The server wraps the list: `{ rooms: [...] }`.
    const list = isRecord(body) ? body["rooms"] : null;
    if (!Array.isArray(list)) throw new Error("rooms: bad body");
    const rooms: RoomInfo[] = [];
    for (const r of list as unknown[]) {
      if (isRecord(r) && typeof r["id"] === "string" && isFiniteNumber(r["number"]) && isFiniteNumber(r["count"]) && isFiniteNumber(r["capacity"])) {
        // `name` is missing on a server older than the client (deployed separately).
        const name = normalizeRoomName(r["name"]) ?? roomNameOf(null, r["number"]);
        rooms.push({ id: r["id"], number: r["number"], name, count: r["count"], capacity: r["capacity"] });
      }
    }
    return rooms;
  }

  sendMove(pos: Vec2Yaw, pose: Pose): void {
    if (!this.isOpen()) return;
    this.pendingMove = { pos: { x: pos.x, z: pos.z, yaw: pos.yaw }, pose };
    if (this.moveTimer) return;
    const wait = this.lastMoveAt + TICK_MS - Date.now();
    if (wait <= 0) this.flushMove();
    else this.moveTimer = setTimeout(() => this.flushMove(), wait);
  }

  // NetDriver passes `near` (the mock seats from it); the server seats from its own copy of our position, so it is unused.
  requestSeat(): Promise<number | null> {
    const link = this.main;
    if (!link || !this.isOpen()) return Promise.resolve(null);
    return new Promise<number | null>((resolve) => {
      const requestId = this.nextRequestId++;
      const timer = setTimeout(() => {
        // We give up, but the grant may still come: tell the server, or it keeps the cushion reserved for us.
        // Same socket, so `stand` always lands after `seat`.
        if (this.main === link) this.stand();
        this.settleSeat(requestId, null);
      }, SEAT_TIMEOUT_MS);
      this.seats.set(requestId, { room: link.room, resolve, timer });
      // Send the throttled move first so the server picks the cushion from where we really are.
      if (this.moveTimer) clearTimeout(this.moveTimer);
      this.flushMove();
      this.send({ type: "seat", requestId });
    });
  }

  stand(): void {
    this.send({ type: "stand" });
  }

  hello(): void {
    this.send({ type: "hello" });
  }

  bow(): void {
    this.send({ type: "bow" });
  }

  /** Beads come in fast; the server wants at most one per BEAD_EVERY_MS. */
  bead(): void {
    const now = Date.now();
    if (now - this.lastBeadAt < BEAD_EVERY_MS) return;
    if (this.send({ type: "bead" })) this.lastBeadAt = now;
  }

  setName(name: string): void {
    const clean = normalizeVisitorName(name);
    if (clean === null || clean === this.name) return;
    this.name = clean;
    const link = this.main;
    if (link && this.isOpen() && this.send({ type: "rename", name: clean })) link.name = clean;
  }

  setAsleep(asleep: boolean): void {
    if (asleep === this.asleep) return;
    this.asleep = asleep;
    if (this.isOpen()) this.send({ type: "sleep", asleep });
  }

  setSession(token: string | null): void {
    // A malformed token would be dropped by the server without a reply: treat it as signed out.
    const next = token !== null && SESSION_TOKEN.test(token) ? token : null;
    if (next === this.session) return;
    this.session = next;
    // Both sockets of a room switch: whichever wins must carry the new state.
    for (const link of [this.main, this.pendingSwitch?.link ?? null]) {
      if (link) this.sendOn(link, { type: "auth", token: next });
    }
  }

  sendChat(text: string): void {
    // The server drops an oversized frame silently; answer like it would for a long line.
    if (text.length > MAX_CHAT_RAW_CHARS) {
      this.emitter.emit("chatDenied", { reason: "too-long" });
      return;
    }
    this.send({ type: "chat", text });
  }

  // --- sockets ---

  private open(room: string, near: string | null = null): Link | null {
    let ws: WebSocket;
    try {
      const resume = this.resume?.room === room ? this.resume.token : null;
      ws = new WebSocket(wsUrl(room, near, resume, this.name));
    } catch {
      return null;
    }
    ws.binaryType = "arraybuffer";
    const link: Link = {
      ws,
      room,
      done: false,
      full: false,
      limited: false,
      fatal: false,
      lastHeard: Date.now(),
      revision: 0,
      awaitingSync: false,
      profiles: new Map(),
      name: this.name,
    };
    ws.onopen = () => {
      if (link.done) return;
      // Before anything else on this socket, so a chat or rename right after the snapshot already counts as signed in.
      if (this.session !== null) this.sendOn(link, { type: "auth", token: this.session });
      if (link === this.main) this.ping();
    };
    ws.onmessage = (e: MessageEvent<unknown>) => this.onMessage(link, e.data);
    ws.onclose = () => this.onClose(link);
    // A failed socket always closes next; `onclose` does the work.
    ws.onerror = () => {};
    return link;
  }

  private openMain(): void {
    this.retryTimer = null;
    if (this.room === null) return;
    const link = this.open(this.room, this.near);
    if (link) this.main = link;
    else this.scheduleReconnect();
  }

  private drop(link: Link): void {
    link.done = true;
    link.ws.onopen = null;
    link.ws.onmessage = null;
    link.ws.onclose = null;
    link.ws.onerror = null;
    try {
      link.ws.close(1000);
    } catch {
      // Already closing: nothing to do.
    }
  }

  private onClose(link: Link): void {
    if (link.done) return;
    link.done = true;
    if (this.pendingSwitch?.link === link) {
      this.cancelSwitch(false);
      return;
    }
    if (link !== this.main) return;
    this.main = null;
    this.failSeats();
    this.clearMove();
    if (link.fatal) {
      this.setStatus("offline");
    } else if (link.full || link.limited) {
      this.setStatus(link.limited ? "limited" : "full");
      this.retryTimer = setTimeout(() => this.openMain(), FULL_RETRY_MS + this.random() * FULL_RETRY_SPREAD_MS);
    } else {
      this.setStatus(typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "reconnecting");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.attempt);
    this.attempt++;
    const jitter = 1 + (this.random() * 0.4 - 0.2);
    this.retryTimer = setTimeout(() => this.openMain(), base * jitter);
  }

  private teardown(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.clearMove();
    this.cancelSwitch(false);
    this.failSeats();
    if (this.main) this.drop(this.main);
    this.main = null;
  }

  private cancelSwitch(ok: boolean): void {
    const p = this.pendingSwitch;
    if (!p) return;
    this.pendingSwitch = null;
    clearTimeout(p.timer);
    if (!ok) this.drop(p.link);
    p.resolve(ok);
  }

  private isOpen(): boolean {
    return this.main !== null && !this.main.done && this.main.ws.readyState === OPEN;
  }

  private send(msg: object): boolean {
    if (!this.isOpen() || !this.main) return false;
    return this.sendOn(this.main, msg);
  }

  private sendOn(link: Link, msg: object): boolean {
    if (link.done || link.ws.readyState !== OPEN) return false;
    try {
      link.ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  // --- browser hooks ---

  private readonly onOnline = (): void => {
    // Waiting out a backoff or a full-room retry: the network is back, try now.
    if (this.retryTimer && this.room !== null && this.status !== "full" && this.status !== "limited") {
      clearTimeout(this.retryTimer);
      this.openMain();
    }
  };

  private readonly onPageHide = (): void => {
    // Closing the socket lets the browser keep the page in its back/forward cache; come back to the same room if it does.
    const room = this.room;
    this.disconnect();
    if (room === null || typeof window === "undefined") return;
    const onShow = (e: Event): void => {
      this.pageShowHandler = null;
      if ((e as PageTransitionEvent).persisted && this.room === null) this.connect(room);
    };
    this.pageShowHandler = onShow;
    window.addEventListener("pageshow", onShow, { once: true });
  };

  private listen(): void {
    if (typeof window !== "undefined" && this.pageShowHandler) {
      window.removeEventListener("pageshow", this.pageShowHandler);
      this.pageShowHandler = null;
    }
    if (this.listening || typeof window === "undefined") return;
    this.listening = true;
    window.addEventListener("online", this.onOnline);
    window.addEventListener("pagehide", this.onPageHide);
  }

  private unlisten(): void {
    if (typeof window !== "undefined" && this.pageShowHandler) {
      window.removeEventListener("pageshow", this.pageShowHandler);
      this.pageShowHandler = null;
    }
    if (!this.listening) return;
    this.listening = false;
    window.removeEventListener("online", this.onOnline);
    window.removeEventListener("pagehide", this.onPageHide);
  }

  // --- incoming ---

  private onMessage(link: Link, data: unknown): void {
    if (link.done) return;
    link.lastHeard = Date.now();
    try {
      if (typeof data === "string") {
        const msg = parseServerMsg(data);
        if (msg) this.onJson(link, msg);
      } else if (data instanceof ArrayBuffer) {
        this.onDelta(link, data);
      }
    } catch {
      // A malformed frame must not take the page down; the next snapshot repairs state.
    }
  }

  private onJson(link: Link, msg: ServerMsg): void {
    const staging = this.pendingSwitch?.link === link;
    if (msg.type === "snapshot") {
      this.onSnapshot(link, msg);
      return;
    }
    if (msg.type === "error") {
      this.onError(link, msg.code);
      return;
    }
    if (staging || link !== this.main) return;
    switch (msg.type) {
      case "seat-granted": {
        const room = this.seats.get(msg.requestId)?.room;
        this.settleSeat(msg.requestId, room !== undefined ? validCushion(room, msg.cushion) : null);
        break;
      }
      case "seat-unavailable":
        this.settleSeat(msg.requestId, null);
        break;
      case "position-corrected":
        this.emitter.emit("corrected", { x: msg.x, z: msg.z, yaw: msg.yaw });
        break;
      case "event":
        this.emitter.emit("event", msg.event);
        break;
      case "pong":
        this.onPong(msg.clientTime, msg.serverTime);
        break;
      case "invite-arrived":
        this.emitter.emit("inviteArrived", { visitorId: msg.visitorId, name: msg.name });
        break;
      case "account":
        this.emitter.emit("account", msg.account);
        break;
      case "chat":
        this.emitter.emit("chat", msg.line);
        break;
      case "chat-history":
        this.emitter.emit("chatHistory", msg.lines);
        break;
      case "chat-denied":
        this.emitter.emit("chatDenied", msg.retryInMs === undefined ? { reason: msg.reason } : { reason: msg.reason, retryInMs: msg.retryInMs });
        break;
    }
  }

  private onError(link: Link, code: ErrorCode): void {
    if (code === "room-full" || code === "too-many") {
      if (this.pendingSwitch?.link === link) {
        this.cancelSwitch(false);
      } else if (link === this.main) {
        if (code === "room-full") link.full = true;
        else link.limited = true;
        this.onClose(link);
        this.drop(link);
      }
    } else if (code === "invalid-room") {
      if (this.pendingSwitch?.link === link) this.cancelSwitch(false);
      else if (link === this.main) {
        link.fatal = true;
        this.onClose(link);
        this.drop(link);
      }
    }
    // rate-limit / bad-message: the server closes the socket, `onClose` reconnects.
  }

  private onSnapshot(link: Link, msg: Extract<ServerMsg, { type: "snapshot" }>): void {
    const visitors: Visitor[] = [];
    link.profiles.clear();
    for (const wv of msg.visitors) {
      link.profiles.set(wv.slot, { slot: wv.slot, id: wv.id, name: wv.name, color: wv.color, joinedAt: wv.joinedAt });
      visitors.push(toVisitor(msg.room, wv));
    }
    link.room = msg.room;
    link.revision = msg.revision;
    link.awaitingSync = false;

    if (this.pendingSwitch?.link === link) {
      const pending = this.pendingSwitch;
      // The new room is ours: the old socket and any retry for the old room are obsolete.
      this.pendingSwitch = null;
      clearTimeout(pending.timer);
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.failSeats();
      this.clearMove();
      if (this.main) this.drop(this.main);
      this.main = link;
      this.room = msg.room;
      pending.resolve(true);
    } else if (link !== this.main) {
      return;
    }
    this.attempt = 0;
    this.near = null;
    this.resume = msg.resume ? { room: msg.room, token: msg.resume } : null;
    this.setStatus("connected");
    // setName ran while this socket was opening (switch, reconnect): its URL still carried the old name.
    if (this.name !== null && link.name !== this.name && this.send({ type: "rename", name: this.name })) link.name = this.name;
    // A resumed visitor keeps the server's old flag; a fresh one starts awake. Either may differ from ours.
    const self = visitors.find((v) => v.id === msg.selfId);
    if (Boolean(self?.asleep) !== this.asleep && this.send({ type: "sleep", asleep: this.asleep }) && self) {
      if (this.asleep) self.asleep = true;
      else delete self.asleep;
    }
    const reserved = msg.reserved === null ? null : validCushion(msg.room, msg.reserved);
    const roomName = msg.roomName ?? roomNameOf(null, roomNumber(msg.room) ?? 0);
    this.emitter.emit("snapshot", { selfId: msg.selfId, room: msg.room, visitors, serverTime: msg.serverTime, reserved, roomName });
    this.ping();
  }

  private onDelta(link: Link, data: ArrayBuffer): void {
    if (link !== this.main || link.awaitingSync) return;
    const frame = decodeDelta(data);
    if (!frame || frame.room !== link.room) return;
    if (frame.revision <= link.revision) return;
    if (frame.revision !== link.revision + 1) {
      link.awaitingSync = true;
      this.send({ type: "sync" });
      return;
    }
    link.revision = frame.revision;
    this.emitter.emit("update", toUpdate(link, frame));
  }

  // --- helpers ---

  private onPong(clientTime: number, serverTime: number): void {
    const now = Date.now();
    const rtt = now - clientTime;
    if (rtt < 0) return;
    this.offsets.push(serverTime + rtt / 2 - now);
    if (this.offsets.length > OFFSET_SAMPLES) this.offsets.shift();
  }

  /** Drops a main link that has gone silent; `onClose` then shows "reconnecting" and retries. */
  private checkAlive(): void {
    const now = Date.now();
    // The timer itself ran late (background tab, a long frame on a slow device): queued messages may not have been read
    // yet, so silence is not evidence this round.
    const late = now - this.lastCheckAt > PING_EVERY_MS * 2;
    this.lastCheckAt = now;
    const link = this.main;
    if (late || !link || link.done || now - link.lastHeard <= SILENCE_MS) return;
    this.onClose(link);
    this.drop(link);
  }

  private ping(): void {
    this.send({ type: "ping", clientTime: Date.now() });
  }

  private flushMove(): void {
    this.moveTimer = null;
    const m = this.pendingMove;
    this.pendingMove = null;
    if (!m) return;
    if (this.send({ type: "move", x: m.pos.x, z: m.pos.z, yaw: m.pos.yaw, pose: m.pose })) this.lastMoveAt = Date.now();
  }

  private clearMove(): void {
    if (this.moveTimer) clearTimeout(this.moveTimer);
    this.moveTimer = null;
    this.pendingMove = null;
  }

  private settleSeat(requestId: number, cushion: number | null): void {
    const p = this.seats.get(requestId);
    if (!p) return;
    this.seats.delete(requestId);
    clearTimeout(p.timer);
    p.resolve(cushion);
  }

  private failSeats(): void {
    for (const id of [...this.seats.keys()]) this.settleSeat(id, null);
  }

  private setStatus(s: ConnectionStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.emitter.emit("status", s);
  }
}

// --- decoding (the server is ours, but a wrong frame must never reach game code) ---

/** Cushion index the room's space really has, else null (never trust a number from the wire). */
function validCushion(room: string, cushion: unknown): number | null {
  if (typeof cushion !== "number" || !Number.isInteger(cushion) || cushion < 0) return null;
  if (roomNumber(room) === null) return null;
  return cushion < spaceOf(room).cushions.length ? cushion : null;
}

function toVisitor(room: string, wv: WireVisitor): Visitor {
  const v: Visitor = {
    id: wv.id,
    name: wv.name,
    color: wv.color,
    joinedAt: wv.joinedAt,
    pose: wv.pose,
    cushion: validCushion(room, wv.cushion),
    position: wv.position,
  };
  if (wv.bowAt !== undefined) v.bowAt = wv.bowAt;
  if (wv.asleep) v.asleep = true;
  return v;
}

function toUpdate(link: Link, frame: DeltaFrame): { serverTime: number; visitors: Visitor[]; removed: string[] } {
  for (const p of frame.profiles) link.profiles.set(p.slot, p);
  const visitors: Visitor[] = [];
  for (const r of frame.records) {
    const p = link.profiles.get(r.slot);
    if (!p) continue;
    const v: Visitor = {
      id: p.id,
      name: p.name,
      color: p.color,
      joinedAt: p.joinedAt,
      pose: r.pose,
      cushion: validCushion(frame.room, r.cushion),
      position: { x: r.x, z: r.z, yaw: r.yaw },
    };
    if (r.bowAt !== undefined) v.bowAt = r.bowAt;
    if (r.asleep) v.asleep = true;
    visitors.push(v);
  }
  if (frame.removed.length > 0) {
    const gone = new Set(frame.removed);
    for (const [slot, p] of link.profiles) if (gone.has(p.id)) link.profiles.delete(slot);
  }
  return { serverTime: frame.serverTime, visitors, removed: frame.removed };
}

function readWireVisitor(v: unknown): WireVisitor | null {
  if (!isRecord(v)) return null;
  const { id, name, color, joinedAt, pose, cushion, position, bowAt, slot, asleep } = v;
  if (typeof id !== "string" || typeof name !== "string" || typeof color !== "string") return null;
  if (!isFiniteNumber(joinedAt) || !isFiniteNumber(slot) || typeof pose !== "string" || !(WIRE_POSES as readonly string[]).includes(pose)) return null;
  if (cushion !== null && !isFiniteNumber(cushion)) return null;
  if (!isRecord(position) || !isFiniteNumber(position["x"]) || !isFiniteNumber(position["z"]) || !isFiniteNumber(position["yaw"])) return null;
  const out: WireVisitor = {
    id,
    name,
    color,
    joinedAt,
    slot,
    pose: pose as Pose,
    cushion: cushion as number | null,
    position: { x: position["x"], z: position["z"], yaw: position["yaw"] },
  };
  if (isFiniteNumber(bowAt)) out.bowAt = bowAt;
  if (asleep === true) out.asleep = true;
  return out;
}

function readEvent(v: unknown): VisitorEvent | null {
  if (!isRecord(v)) return null;
  const { eventId, visitorId, type, at } = v;
  if (typeof eventId !== "string" || typeof visitorId !== "string" || !isFiniteNumber(at)) return null;
  if (type !== "hello" && type !== "bow" && type !== "bead") return null;
  return { eventId, visitorId, type, at };
}

const ERROR_CODES: readonly string[] = ["room-full", "invalid-room", "rate-limit", "bad-message", "too-many"];

export function parseServerMsg(raw: string): ServerMsg | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(v) || typeof v["type"] !== "string" || !isFiniteNumber(v["serverTime"])) return null;
  const serverTime = v["serverTime"];
  switch (v["type"]) {
    case "snapshot": {
      const { room, selfId, revision, visitors } = v;
      if (typeof room !== "string" || typeof selfId !== "string" || !isFiniteNumber(revision) || !Array.isArray(visitors)) return null;
      const list: WireVisitor[] = [];
      for (const raw of visitors as unknown[]) {
        const wv = readWireVisitor(raw);
        if (!wv) return null;
        list.push(wv);
      }
      // Missing on a server older than the client (deployed separately): nothing reserved, no resume.
      const reserved = isFiniteNumber(v["reserved"]) ? v["reserved"] : null;
      const resume = parseResumeToken(v["resume"]) ?? "";
      const roomName = normalizeRoomName(v["roomName"]) ?? roomNameOf(null, roomNumber(room) ?? 0);
      return { type: "snapshot", room, selfId, revision, serverTime, visitors: list, reserved, resume, roomName };
    }
    case "seat-granted":
      return isFiniteNumber(v["requestId"]) && isFiniteNumber(v["cushion"])
        ? { type: "seat-granted", requestId: v["requestId"], cushion: v["cushion"], serverTime }
        : null;
    case "seat-unavailable":
      return isFiniteNumber(v["requestId"]) ? { type: "seat-unavailable", requestId: v["requestId"], serverTime } : null;
    case "position-corrected":
      return isFiniteNumber(v["x"]) && isFiniteNumber(v["z"]) && isFiniteNumber(v["yaw"])
        ? { type: "position-corrected", x: v["x"], z: v["z"], yaw: v["yaw"], serverTime }
        : null;
    case "event": {
      const event = readEvent(v["event"]);
      return event ? { type: "event", event, serverTime } : null;
    }
    case "pong":
      return isFiniteNumber(v["clientTime"]) ? { type: "pong", clientTime: v["clientTime"], serverTime } : null;
    case "invite-arrived": {
      const { visitorId, name } = v;
      return typeof visitorId === "string" && typeof name === "string"
        ? { type: "invite-arrived", visitorId, name, serverTime }
        : null;
    }
    case "account": {
      if (v["account"] === null) return { type: "account", account: null, serverTime };
      const account = parseAccountView(v["account"]);
      return account ? { type: "account", account, serverTime } : null;
    }
    case "chat": {
      const line = parseChatLine(v["line"]);
      return line ? { type: "chat", line, serverTime } : null;
    }
    case "chat-history": {
      const raw = v["lines"];
      if (!Array.isArray(raw)) return null;
      // One bad line costs that line, not the whole history.
      const lines: ChatLine[] = [];
      for (const r of raw as unknown[]) {
        const line = parseChatLine(r);
        if (line) lines.push(line);
      }
      return { type: "chat-history", lines: lines.slice(-CHAT_HISTORY), serverTime };
    }
    case "chat-denied": {
      const { reason, retryInMs } = v;
      if (!isChatDeniedReason(reason)) return null;
      return isFiniteNumber(retryInMs) && retryInMs >= 0
        ? { type: "chat-denied", reason, retryInMs, serverTime }
        : { type: "chat-denied", reason, serverTime };
    }
    case "error": {
      const code = v["code"];
      return typeof code === "string" && ERROR_CODES.includes(code)
        ? { type: "error", code: code as ErrorCode, serverTime }
        : null;
    }
    default:
      return null;
  }
}
