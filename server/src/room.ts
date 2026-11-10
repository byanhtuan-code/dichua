import type { WebSocket } from "ws";
import {
  CROWDED_AT,
  DEFAULT_POPULATION,
  IDLE_TIMEOUT_MS,
  PING_EVERY_MS,
  RENAME_COOLDOWN_MS,
  RESUME_GRACE_MS,
  SPAM_MSGS_PER_S,
  TICK_MS,
  TICK_MS_CROWDED,
  VISITOR_COLORS,
  cushionOf,
  encodeDelta,
  makeName,
  normalizeVisitorName,
  parseClientMsg,
  pickSpawn,
  residentsFor,
  roomNumber,
  spaceOf,
  uniqueName,
  type DeltaFrame,
  type DeltaRecord,
  type Pose,
  type PopulationConfig,
  type RoomInfo,
  type ServerMsg,
  type SpaceDef,
  type Visitor,
  type VisitorEvent,
  type WireVisitor,
  DEFAULT_ROOM_NAMES,
  roomNameOf,
  CHAT_HISTORY,
  maskProfanity,
  normalizeChatText,
  roomAllowsChat,
  type AccountView,
  type ChatDeniedReason,
  type ChatLine,
  type ChatThrottle,
  type ChatTier,
} from "@santinh/shared";
import type { Accounts } from "./accounts.ts";
import { FakePeople } from "./fake-people.ts";
import { RoomState, SlidingWindow, type Entry, type JoinResult, type MoveInput } from "./room-state.ts";

/** The four resident NPCs hold the first slots; real visitors start after them. */
const RESIDENT_BOW_STAGGER_MS = 1100;
/** Extra token `auth`s inside this window are ignored (each one is a DB lookup); sign-out is never limited. */
const AUTH_EVERY_MS = 1000;

/** What a room needs for accounts and chat; the hub owns both so they outlive a room change. */
export interface ChatDeps {
  accounts: Pick<Accounts, "bySession" | "setDisplayName">;
  /** One throttle per account, shared by every room (P4-D6). */
  throttleFor(accountId: number): ChatThrottle;
}

export interface AdminVisitorView {
  visitorId: string;
  name: string;
  color: string;
  pose: Pose;
  cushion: number | null;
  asleep: boolean;
  joinedAt: number;
  x: number;
  z: number;
  accountId: number | null;
  username: string | null;
  tier: ChatTier | null;
}

export interface AdminRoomView {
  id: string;
  number: number;
  name: string;
  chatAllowed: boolean;
  realCount: number;
  botCount: number;
  shownCount: number;
  capacity: number;
  visitors: AdminVisitorView[];
  chatLines: ChatLine[];
}

/** A room built on its own (tests) knows no accounts: every `auth` is refused, so nobody can chat. */
const NO_ACCOUNTS: ChatDeps = {
  accounts: { bySession: () => null, setDisplayName: () => false },
  throttleFor: () => {
    throw new Error("no accounts");
  },
};

interface Member {
  ws: WebSocket;
  visitor: Visitor;
  slot: number;
  lastSeen: number;
  spam: SlidingWindow;
  /** Latest move since the last tick: a newer one overwrites it. */
  pendingMove: MoveInput | null;
  /** Secret that lets this socket's owner come back as the same visitor (new one per join). */
  token: string;
  /** Last applied rename (cooldown); -Infinity until the first one. */
  renamedAt: number;
  /** Newest rename that arrived inside the cooldown, applied by the tick once it ends (kept, not dropped: P3-D2). */
  pendingName: string | null;
  /** Signed-in account (P4-D4); null = guest, can read chat but not send. */
  account: { id: number; view: AccountView } | null;
  /** Last handled token `auth`; -Infinity until the first one. */
  authAt: number;
}

/** Someone who left recently, kept for `?resume=` until `until`. */
interface Away {
  visitor: Visitor;
  until: number;
}

export type { JoinResult };

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return "v:" + Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

function newToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url");
}

function recordOf(v: Visitor, slot: number): DeltaRecord {
  const rec: DeltaRecord = { slot, cushion: v.cushion, pose: v.pose, x: v.position.x, z: v.position.z, yaw: v.position.yaw };
  if (v.bowAt !== undefined) rec.bowAt = v.bowAt;
  if (v.asleep) rec.asleep = true;
  return rec;
}

/** One populated copy of a space: who is in, snapshots, join / leave frames, heartbeat. */
export class Room {
  readonly id: string;
  readonly number: number;
  readonly space: SpaceDef;
  private readonly capacity: number;
  private readonly clock: () => number;
  private readonly members = new Map<WebSocket, Member>();
  /** By resume token. */
  private readonly away = new Map<string, Away>();
  private readonly residents;
  private readonly state: RoomState;
  private readonly fake: FakePeople | null;
  private revision = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private tickTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly names: () => readonly string[];
  private readonly chat: ChatDeps;
  /** Last CHAT_HISTORY lines, oldest first. Memory only: a restart forgets them (P4-D8). */
  private readonly chatLines: ChatLine[] = [];
  private chatSeq = 0;

  constructor(
    id: string,
    capacity: number,
    clock: () => number = Date.now,
    fakePopulation = false,
    population: () => PopulationConfig = () => DEFAULT_POPULATION,
    /** D26: read on every use, so an admin rename shows in the next list / snapshot. */
    names: () => readonly string[] = () => DEFAULT_ROOM_NAMES,
    chat: ChatDeps = NO_ACCOUNTS,
  ) {
    this.names = names;
    this.chat = chat;
    const number = roomNumber(id);
    if (number === null) throw new RangeError(`room ${id}`);
    this.id = id;
    this.number = number;
    this.space = spaceOf(id);
    this.capacity = capacity;
    this.clock = clock;
    this.residents = residentsFor(id);
    this.state = new RoomState(id, this.space, { capacity, fake: fakePopulation, population });
    // The NPCs keep their cushions in the shared seat map so nobody (player or bot) is seated on top of them.
    for (const r of this.residents) this.state.seatMap.set(r.cushion, r.id);
    this.fake = fakePopulation
      ? new FakePeople(id, this.space, capacity, this.state, {
          freeSlot: () => this.freeSlot(),
          takenNames: () => this.takenNames(),
          announce: (e) => this.announceEntry(e),
          dismiss: (botId) => this.broadcast({ profiles: [], removed: [botId], records: [] }),
          emit: (ev) => this.emit(ev),
        }, population)
      : null;
  }

  /** One rule for "can someone walk in": the join uses it, `/api/rooms` counts from it. */
  admit(now: number = this.clock(), returning = false): JoinResult {
    return this.state.admit(now, returning);
  }

  info(now: number = this.clock()): RoomInfo {
    return { id: this.id, number: this.number, name: this.name, count: this.state.count(now), capacity: this.capacity };
  }

  get name(): string {
    return roomNameOf(this.names(), this.number);
  }

  get size(): number {
    return this.members.size;
  }

  // ============================================================================
  // ADMIN ROOM INSPECTION & MODERATION METHODS
  // ============================================================================

  /** Live snapshot of this room for `/api/admin/overview`. */
  adminInspect(now: number = this.clock()): AdminRoomView {
    const visitors: AdminVisitorView[] = [];
    for (const m of this.members.values()) {
      const v = m.visitor;
      visitors.push({
        visitorId: v.id,
        name: v.name,
        color: v.color,
        pose: v.pose,
        cushion: v.cushion,
        asleep: Boolean(v.asleep),
        joinedAt: v.joinedAt,
        x: Math.round(v.position.x * 10) / 10,
        z: Math.round(v.position.z * 10) / 10,
        accountId: m.account?.id ?? null,
        username: m.account?.view.username ?? null,
        tier: m.account?.view.tier ?? null,
      });
    }
    return {
      id: this.id,
      number: this.number,
      name: this.name,
      chatAllowed: roomAllowsChat(this.id),
      realCount: this.state.realCount,
      botCount: this.state.botCount,
      shownCount: this.state.count(now),
      capacity: this.capacity,
      visitors,
      chatLines: [...this.chatLines],
    };
  }

  /** Broadcasts an official temple announcement into the room's chat & head bubble. */
  adminBroadcast(rawText: string, senderName = "📢 Ban Quản Tự"): ChatLine | null {
    const norm = normalizeChatText(rawText, "pro");
    if (!norm.ok) return null;
    const now = this.clock();
    const cleanSender = normalizeVisitorName(senderName) ?? "📢 Ban Quản Tự";
    const line: ChatLine = {
      id: `admin-${++this.chatSeq}`,
      visitorId: "resident:1",
      name: cleanSender,
      text: norm.text,
      at: now,
    };
    if (roomAllowsChat(this.id)) {
      this.chatLines.push(line);
      if (this.chatLines.length > CHAT_HISTORY) {
        this.chatLines.splice(0, this.chatLines.length - CHAT_HISTORY);
      }
    }
    const payload = JSON.stringify({ type: "chat", line, serverTime: now } satisfies ServerMsg);
    for (const m of this.members.values()) {
      if (m.ws.readyState === m.ws.OPEN) m.ws.send(payload);
    }
    return line;
  }

  /** Kicks a visitor by `visitorId` and invalidates their resume token. */
  adminKick(visitorId: string): boolean {
    for (const m of this.members.values()) {
      if (m.visitor.id !== visitorId) continue;
      const tok = m.token;
      this.leave(m.ws);
      this.away.delete(tok);
      m.ws.close(4003, "admin-kick");
      return true;
    }
    return false;
  }

  /** Kicks all active sockets belonging to `accountId` in this room. */
  adminKickAccount(accountId: number): number {
    let count = 0;
    for (const m of [...this.members.values()]) {
      if (m.account?.id !== accountId) continue;
      const tok = m.token;
      this.leave(m.ws);
      this.away.delete(tok);
      m.ws.close(4003, "admin-kick");
      count++;
    }
    return count;
  }

  /** Force-renames an active visitor in this room. */
  adminRenameVisitor(visitorId: string, rawName: unknown): string | null {
    const clean = normalizeVisitorName(rawName);
    if (clean === null) return null;
    for (const m of this.members.values()) {
      if (m.visitor.id !== visitorId) continue;
      this.rename(m, clean, this.clock());
      return m.visitor.name;
    }
    return null;
  }

  /** Clears chat history in this room and syncs an empty history to connected clients. */
  adminClearChat(): number {
    const removed = this.chatLines.length;
    this.chatLines.length = 0;
    if (roomAllowsChat(this.id)) {
      const now = this.clock();
      const payload = JSON.stringify({ type: "chat-history", lines: [], serverTime: now } satisfies ServerMsg);
      for (const m of this.members.values()) {
        if (m.ws.readyState === m.ws.OPEN) m.ws.send(payload);
      }
    }
    return removed;
  }

  /** `name`: wanted name, already normalised; it beats the old name on a resume (they may have renamed while away). */
  join(ws: WebSocket, near: string | null = null, resume: string | null = null, name: string | null = null): JoinResult {
    const now = this.clock();
    const live = resume ? this.memberByToken(resume) : undefined;
    // Someone already inside is not turned away by a tier flip or `minBots` (P-D7); judged before the old socket goes.
    const returning = live !== undefined || (resume !== null && this.peekAway(resume, now) !== null);
    if (live) {
      // The token's owner is back on a new socket before we noticed the old one die (network switch): the new one wins.
      this.leave(live.ws);
      live.ws.terminate();
    }
    if (this.admit(now, returning) === "full") {
      this.send(ws, { type: "error", code: "room-full", serverTime: now });
      ws.close(4000, "room-full");
      return "full";
    }
    // Settle the frozen bots before slots, `near` and yielding look at them.
    this.fake?.wake(now, returning);
    const back = resume ? this.takeAway(resume, now) : null;
    const placed = !back && near ? this.state.placeNear(near) : null;
    let visitor: Visitor;
    if (back) {
      // Same id / colour (invite links keep working); back on foot where we last had them. The URL name wins over the old one.
      const v = back.visitor;
      visitor = {
        id: v.id,
        // Old name re-checked too: someone may have picked it while we were away.
        name: uniqueName(name ?? v.name, this.takenNames()),
        color: v.color,
        joinedAt: v.joinedAt,
        pose: "walk",
        cushion: null,
        position: v.position,
      };
    } else {
      visitor = {
        id: newId(),
        name: name !== null ? uniqueName(name, this.takenNames()) : makeName(Math.random, this.takenNames()),
        color: VISITOR_COLORS[Math.floor(Math.random() * VISITOR_COLORS.length)] ?? "#b9c3c7",
        joinedAt: now,
        pose: "walk",
        cushion: null,
        position: placed ?? pickSpawn(this.space),
      };
    }
    // At capacity: the bot nearest the gate steps out first (the slot is freed before we take it).
    if (this.fake && this.state.headCount >= this.capacity) this.fake.yieldOne(returning);
    const member: Member = {
      ws,
      visitor,
      slot: this.freeSlot(),
      lastSeen: now,
      spam: new SlidingWindow(SPAM_MSGS_PER_S, 1000),
      pendingMove: null,
      token: newToken(),
      renamedAt: -Infinity,
      pendingName: null,
      account: null,
      authAt: -Infinity,
    };
    this.members.set(ws, member);
    this.state.add(visitor, member.slot, now);
    this.fake?.start(now);

    this.broadcast(
      {
        profiles: [{ slot: member.slot, id: visitor.id, name: visitor.name, color: visitor.color, joinedAt: visitor.joinedAt }],
        removed: [],
        records: [recordOf(visitor, member.slot)],
      },
      ws,
    );
    // After the join frame: it skips us but still bumps the revision, so our first delta is snapshot.revision + 1.
    this.send(ws, {
      type: "snapshot",
      room: this.id,
      selfId: visitor.id,
      revision: this.revision,
      serverTime: now,
      visitors: this.wireVisitors(),
      reserved: null,
      resume: member.token,
      roomName: this.name,
    });
    // Right after the snapshot, empty or not, so the chat panel starts from the room's real state.
    if (roomAllowsChat(this.id)) this.send(ws, { type: "chat-history", lines: [...this.chatLines], serverTime: now });
    // After the join frame, so the inviter already has our name and slot.
    if (placed && near) this.tellInviter(near, visitor, now);

    ws.on("message", (data, isBinary) => this.onMessage(member, data, isBinary));
    ws.on("pong", () => {
      member.lastSeen = this.clock();
    });
    ws.on("close", () => this.leave(ws));
    ws.on("error", () => this.leave(ws));
    this.startHeartbeat();
    this.scheduleTick();
    return "ok";
  }

  /** A live socket in this room holds `token` (a resume would replace it, not add a person). */
  holds(token: string): boolean {
    return this.memberByToken(token) !== undefined;
  }

  /** Close every socket (shutdown). */
  closeAll(code: number): void {
    for (const ws of [...this.members.keys()]) ws.close(code);
  }

  private onMessage(member: Member, data: unknown, isBinary: boolean): void {
    try {
      if (member.ws.readyState !== member.ws.OPEN) return;
      const now = this.clock();
      member.lastSeen = now;
      if (member.spam.hit(now)) {
        this.send(member.ws, { type: "error", code: "rate-limit", serverTime: now });
        member.ws.close(1008, "rate-limit");
        return;
      }
      if (isBinary) return;
      const msg = parseClientMsg(String(data));
      if (!msg) return;
      const id = member.visitor.id;
      switch (msg.type) {
        case "ping":
          this.send(member.ws, { type: "pong", clientTime: msg.clientTime, serverTime: now });
          break;
        case "sync":
          this.send(member.ws, this.snapshotFor(member));
          break;
        case "move":
          member.pendingMove = { x: msg.x, z: msg.z, yaw: msg.yaw, pose: msg.pose };
          break;
        case "seat": {
          // Apply a queued move first so the seat is judged from where the player really is.
          this.applyPendingMove(member, now);
          const res = this.state.seat(id);
          if (res) {
            // The bow goes out when the visitor reaches the cushion (state.move), not at the grant.
            this.send(member.ws, { type: "seat-granted", requestId: msg.requestId, cushion: res.cushion, serverTime: now });
          } else {
            this.send(member.ws, { type: "seat-unavailable", requestId: msg.requestId, serverTime: now });
          }
          break;
        }
        case "stand":
          this.state.stand(id);
          break;
        case "hello": {
          // Bots turn to where the player is now, not where the last tick left it.
          this.applyPendingMove(member, now);
          const ev = this.state.hello(id, now);
          if (ev) {
            this.emit(ev);
            this.fake?.onHello(member.visitor.position, now);
          }
          break;
        }
        case "bow": {
          const ev = this.state.bowAgain(id, now);
          if (ev) this.emit(ev);
          break;
        }
        case "bead": {
          const ev = this.state.bead(id, now);
          if (ev) this.emit(ev);
          break;
        }
        case "sleep":
          this.state.setAsleep(id, msg.asleep);
          break;
        case "rename":
          if (now - member.renamedAt < RENAME_COOLDOWN_MS) member.pendingName = msg.name;
          else this.rename(member, msg.name, now);
          break;
        case "auth":
          this.auth(member, msg.token, now);
          break;
        case "chat":
          this.onChat(member, msg.text, now);
          break;
      }
    } catch (err) {
      console.error(`room ${this.id}: message handler failed`, err);
    }
  }

  /**
   * Sign in (token) or out (null) on the open socket: id, seat and shown name stay (P4-D4).
   * Signing in puts on the account's character name through the normal rename path.
   */
  private auth(member: Member, token: string | null, now: number): void {
    // A dropped sign-out would leave the server chatting as someone the client thinks is gone.
    if (token !== null) {
      if (now - member.authAt < AUTH_EVERY_MS) return;
      member.authAt = now;
    }
    const found = token === null ? null : this.chat.accounts.bySession(token);
    member.account = found ? { id: found.id, view: found.account } : null;
    this.send(member.ws, { type: "account", account: found ? found.account : null, serverTime: now });
    if (found) this.rename(member, found.account.displayName, now);
  }

  private onChat(member: Member, raw: string, now: number): void {
    const deny = (reason: ChatDeniedReason, retryInMs?: number): void => {
      this.send(member.ws, retryInMs === undefined
        ? { type: "chat-denied", reason, serverTime: now }
        : { type: "chat-denied", reason, retryInMs, serverTime: now });
    };
    if (!roomAllowsChat(this.id)) return deny("quiet-room");
    const account = member.account;
    if (!account) return deny("login");
    const tier = account.view.tier;
    const norm = normalizeChatText(raw, tier);
    if (!norm.ok) return deny(norm.reason);
    // Unmasked text: two different rude words must not look like the same line to the duplicate check.
    const throttle = this.chat.throttleFor(account.id);
    const ok = throttle.check(norm.text, now, tier);
    if (!ok.ok) return deny(ok.reason, ok.retryInMs);
    throttle.record(norm.text, now);
    const line: ChatLine = {
      id: String(++this.chatSeq),
      visitorId: member.visitor.id,
      name: member.visitor.name,
      text: maskProfanity(norm.text),
      at: now,
    };
    this.chatLines.push(line);
    if (this.chatLines.length > CHAT_HISTORY) this.chatLines.splice(0, this.chatLines.length - CHAT_HISTORY);
    const text = JSON.stringify({ type: "chat", line, serverTime: now } satisfies ServerMsg);
    for (const m of this.members.values()) {
      if (m.ws.readyState === m.ws.OPEN) m.ws.send(text);
    }
  }

  /** Unique among everyone else in the room; the frame goes to the renamer too, so their own label follows the server. */
  private rename(member: Member, want: string, now: number): void {
    member.pendingName = null;
    const acc = member.account;
    // The account keeps the wanted name, not the numbered one this room may show (P4-D2).
    if (acc && want !== acc.view.displayName && this.chat.accounts.setDisplayName(acc.id, want)) {
      acc.view = { ...acc.view, displayName: want };
    }
    const v = member.visitor;
    const next = uniqueName(want, this.takenNames(v.id));
    if (next === v.name) return;
    v.name = next;
    member.renamedAt = now;
    // Profile with a record: clients only create / update a visitor from a frame that also carries its slot's record.
    this.broadcast({
      profiles: [{ slot: member.slot, id: v.id, name: v.name, color: v.color, joinedAt: v.joinedAt }],
      removed: [],
      records: [recordOf(v, member.slot)],
    });
  }

  private applyPendingMove(member: Member, now: number): void {
    const move = member.pendingMove;
    if (!move) return;
    member.pendingMove = null;
    const { fix, bow } = this.state.move(member.visitor.id, move, now);
    if (fix) this.send(member.ws, { type: "position-corrected", x: fix.x, z: fix.z, yaw: fix.yaw, serverTime: now });
    if (bow) this.emit(bow);
  }

  private emit(event: VisitorEvent): void {
    const text = JSON.stringify({ type: "event", event, serverTime: this.clock() } satisfies ServerMsg);
    for (const m of this.members.values()) {
      if (m.ws.readyState === m.ws.OPEN) m.ws.send(text);
    }
  }

  private scheduleTick(): void {
    if (this.tickTimer || this.members.size === 0) return;
    const delay = this.state.headCount >= CROWDED_AT ? TICK_MS_CROWDED : TICK_MS;
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      this.tick(delay);
      this.scheduleTick();
    }, delay);
  }

  private tick(tickMs: number): void {
    try {
      const now = this.clock();
      for (const m of [...this.members.values()]) {
        this.applyPendingMove(m, now);
        if (m.pendingName !== null && now - m.renamedAt >= RENAME_COOLDOWN_MS) this.rename(m, m.pendingName, now);
      }
      this.fake?.tick(now, tickMs);
      const dirty = this.state.takeDirty();
      if (dirty.length === 0) return;
      this.broadcast({ profiles: [], removed: [], records: dirty.map((e) => recordOf(e.visitor, e.slot)) });
    } catch (err) {
      console.error(`room ${this.id}: tick failed`, err);
    }
  }

  private leave(ws: WebSocket): void {
    const member = this.members.get(ws);
    if (!member) return;
    this.members.delete(ws);
    this.state.remove(member.visitor.id);
    const now = this.clock();
    this.dropExpired(now);
    const v = member.visitor;
    this.away.set(member.token, { visitor: { ...v, position: { ...v.position } }, until: now + RESUME_GRACE_MS });
    try {
      this.broadcast({ profiles: [], removed: [member.visitor.id], records: [] }, ws);
    } catch (err) {
      console.error(`room ${this.id}: leave broadcast failed`, err);
    }
    if (this.members.size === 0) {
      this.fake?.stop(now);
      this.stopHeartbeat();
      this.stopTick();
    }
  }

  /** Bots have no socket: only a real inviter hears about the arrival. */
  private tellInviter(inviterId: string, visitor: Visitor, now: number): void {
    for (const m of this.members.values()) {
      if (m.visitor.id !== inviterId) continue;
      this.send(m.ws, { type: "invite-arrived", visitorId: visitor.id, name: visitor.name, serverTime: now });
      return;
    }
  }

  private memberByToken(token: string): Member | undefined {
    for (const m of this.members.values()) if (m.token === token) return m;
    return undefined;
  }

  /** The visitor behind a still-valid token, unless that id is somehow back in the room already. */
  private peekAway(token: string, now: number): Away | null {
    const away = this.away.get(token);
    return away && away.until > now && !this.state.get(away.visitor.id) ? away : null;
  }

  /** `peekAway`, using the token up. */
  private takeAway(token: string, now: number): Away | null {
    this.dropExpired(now);
    const away = this.peekAway(token, now);
    this.away.delete(token);
    return away;
  }

  private dropExpired(now: number): void {
    for (const [token, a] of this.away) if (a.until <= now) this.away.delete(token);
  }

  private freeSlot(): number {
    const used = new Set<number>(this.residents.map((_, i) => i));
    for (const e of this.state.all()) used.add(e.slot);
    let slot = 0;
    while (used.has(slot)) slot++;
    return slot;
  }

  /** Residents', real visitors' and bots' names, except visitor `exceptId`'s own. */
  private takenNames(exceptId?: string): Set<string> {
    const taken = new Set<string>(this.residents.map((r) => r.name));
    for (const e of this.state.all()) if (e.visitor.id !== exceptId) taken.add(e.visitor.name);
    return taken;
  }

  private announceEntry(e: Entry): void {
    const v = e.visitor;
    this.broadcast({
      profiles: [{ slot: e.slot, id: v.id, name: v.name, color: v.color, joinedAt: v.joinedAt }],
      removed: [],
      records: [recordOf(v, e.slot)],
    });
  }

  private snapshotFor(member: Member): ServerMsg {
    return {
      type: "snapshot",
      room: this.id,
      selfId: member.visitor.id,
      revision: this.revision,
      serverTime: this.clock(),
      visitors: this.wireVisitors(),
      reserved: this.state.get(member.visitor.id)?.reserved ?? null,
      resume: member.token,
      roomName: this.name,
    };
  }

  private wireVisitors(): WireVisitor[] {
    const now = this.clock();
    const npcs = this.residents.map<WireVisitor>((r, i) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      joinedAt: 0,
      pose: "kneel",
      cushion: r.cushion,
      position: cushionOf(this.space, r.cushion),
      bowAt: now + i * RESIDENT_BOW_STAGGER_MS,
      slot: i,
    }));
    // Copies: bots are mutated in place by their brain.
    const people = [...this.state.all()].map<WireVisitor>((e) => ({ ...e.visitor, position: { ...e.visitor.position }, slot: e.slot }));
    return [...npcs, ...people];
  }

  /** Encode once, send the same buffer to everyone except `skip`. */
  private broadcast(body: Pick<DeltaFrame, "profiles" | "removed" | "records">, skip?: WebSocket): void {
    this.revision++;
    const buf = Buffer.from(encodeDelta({ revision: this.revision, serverTime: this.clock(), room: this.id, ...body }));
    for (const m of this.members.values()) {
      if (m.ws !== skip && m.ws.readyState === m.ws.OPEN) m.ws.send(buf);
    }
  }

  private send(ws: WebSocket, msg: ServerMsg): void {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  }

  private startHeartbeat(): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      try {
        const now = this.clock();
        for (const m of [...this.members.values()]) {
          if (now - m.lastSeen > IDLE_TIMEOUT_MS) {
            m.ws.terminate();
            this.leave(m.ws);
          } else if (m.ws.readyState === m.ws.OPEN) {
            m.ws.ping();
          }
        }
      } catch (err) {
        console.error(`room ${this.id}: heartbeat failed`, err);
      }
    }, PING_EVERY_MS);
  }

  private stopTick(): void {
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickTimer = null;
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}
