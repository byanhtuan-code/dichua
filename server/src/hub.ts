import { ChatThrottle, DEFAULT_POPULATION, DEFAULT_ROOM_NAMES, ROOMS, type PopulationConfig, type RoomInfo } from "@santinh/shared";
import type { WebSocket } from "ws";
import { Accounts } from "./accounts.ts";
import { Room, type AdminRoomView, type JoinResult } from "./room.ts";

/** Throttles idle this long are dropped once the map grows past THROTTLE_PRUNE_AT (their windows are long over). */
const THROTTLE_IDLE_MS = 10 * 60_000;
const THROTTLE_PRUNE_AT = 5000;

export interface AdminHubOverview {
  serverTime: number;
  totalReal: number;
  totalBots: number;
  rooms: AdminRoomView[];
}

/** The ten rooms of this process. */
export class RoomHub {
  private readonly rooms = new Map<string, Room>();

  private readonly clock: () => number;
  /** By account id, across rooms: a room change or reconnect does not reset the cooldown (P4-D6). */
  private readonly throttles = new Map<number, ChatThrottle>();

  /** `population` is read on every use, so an admin change reaches `/api/rooms` and the next bot resize (P3-D8). */
  constructor(
    capacity: number,
    clock: () => number = Date.now,
    fakePopulation = false,
    population: () => PopulationConfig = () => DEFAULT_POPULATION,
    names: () => readonly string[] = () => DEFAULT_ROOM_NAMES,
    accounts: Accounts = new Accounts(""),
  ) {
    this.clock = clock;
    const chat = { accounts, throttleFor: (id: number) => this.throttleFor(id) };
    for (const def of ROOMS) this.rooms.set(def.id, new Room(def.id, capacity, clock, fakePopulation, population, names, chat));
  }

  private throttleFor(accountId: number): ChatThrottle {
    let t = this.throttles.get(accountId);
    if (t) return t;
    if (this.throttles.size >= THROTTLE_PRUNE_AT) {
      const cutoff = this.clock() - THROTTLE_IDLE_MS;
      for (const [id, old] of this.throttles) if (old.lastAt < cutoff) this.throttles.delete(id);
    }
    t = new ChatThrottle();
    this.throttles.set(accountId, t);
    return t;
  }

  has(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  list(now: number = this.clock()): RoomInfo[] {
    return [...this.rooms.values()].map((r) => r.info(now));
  }

  /** `name`: already normalised (`normalizeVisitorName`); null = random. */
  join(
    roomId: string,
    ws: WebSocket,
    near: string | null = null,
    resume: string | null = null,
    name: string | null = null,
  ): JoinResult {
    const room = this.rooms.get(roomId);
    if (!room) throw new RangeError(`room ${roomId}`);
    return room.join(ws, near, resume, name);
  }

  holds(roomId: string, token: string): boolean {
    return this.rooms.get(roomId)?.holds(token) ?? false;
  }

  closeAll(code: number): void {
    for (const room of this.rooms.values()) room.closeAll(code);
  }

  // ============================================================================
  // ADMIN HUB OVERVIEW & MODERATION METHODS
  // ============================================================================

  /** Full live overview of all 10 rooms and connected players. */
  adminOverview(now: number = this.clock()): AdminHubOverview {
    const rooms = [...this.rooms.values()].map((r) => r.adminInspect(now));
    let totalReal = 0;
    let totalBots = 0;
    for (const r of rooms) {
      totalReal += r.realCount;
      totalBots += r.botCount;
    }
    return { serverTime: now, totalReal, totalBots, rooms };
  }

  /** Broadcasts an announcement to a single room or to all 10 rooms (`targetRoom` = null / "all"). */
  adminBroadcast(text: string, targetRoom: string | null = null, senderName?: string): number {
    if (targetRoom && targetRoom !== "all") {
      const r = this.rooms.get(targetRoom);
      if (!r) return 0;
      return r.adminBroadcast(text, senderName) ? 1 : 0;
    }
    let sent = 0;
    for (const r of this.rooms.values()) {
      if (r.adminBroadcast(text, senderName)) sent++;
    }
    return sent;
  }

  /** Kicks a visitor from a specific room. */
  adminKick(roomId: string, visitorId: string): boolean {
    return this.rooms.get(roomId)?.adminKick(visitorId) ?? false;
  }

  /** Kicks all active connections belonging to `accountId` across all 10 rooms. */
  adminKickAccount(accountId: number): number {
    let total = 0;
    for (const r of this.rooms.values()) total += r.adminKickAccount(accountId);
    return total;
  }

  /** Renames a connected visitor in a specific room. */
  adminRenameVisitor(roomId: string, visitorId: string, newName: unknown): string | null {
    return this.rooms.get(roomId)?.adminRenameVisitor(visitorId, newName) ?? null;
  }

  /** Clears chat history in one room or across all rooms (`targetRoom` = null / "all"). */
  adminClearChat(targetRoom: string | null = null): number {
    if (targetRoom && targetRoom !== "all") {
      return this.rooms.get(targetRoom)?.adminClearChat() ?? 0;
    }
    let total = 0;
    for (const r of this.rooms.values()) total += r.adminClearChat();
    return total;
  }
}
