import type {
  AccountView,
  ChatDeniedReason,
  ChatLine,
  ConnectionStatus,
  Pose,
  RoomInfo,
  Vec2,
  Vec2Yaw,
  Visitor,
  VisitorEvent,
} from "@santinh/shared";

/** Full room state: on join, room switch and resync. `visitors` includes us (`selfId`) and the residents. */
export interface RoomSnapshot {
  selfId: string;
  room: string;
  visitors: Visitor[];
  serverTime: number;
  /** Cushion granted to us but not reached yet (still walking to it); null otherwise. */
  reserved: number | null;
  /** D26: display name of `room`. */
  roomName: string;
}

/** Delta since the last snapshot/update: changed or new visitors, ids that left. */
export interface VisitorsUpdate {
  serverTime: number;
  visitors: Visitor[];
  removed: string[];
}

export interface NetDriverEvents {
  status: ConnectionStatus;
  snapshot: RoomSnapshot;
  update: VisitorsUpdate;
  event: VisitorEvent;
  /** The server moved us back (speed / collision check failed). */
  corrected: Vec2Yaw;
  /** Someone joined through our invite link (the server placed them next to us). */
  inviteArrived: { visitorId: string; name: string };
  /** Reply to our session (P4-D4): the signed-in account, or null (signed out / token refused). Private to us. */
  account: AccountView | null;
  /** A line said in our room (ours included: the server echoes it back). */
  chat: ChatLine;
  /** Recent lines of a chat room, oldest first; arrives after the snapshot. */
  chatHistory: ChatLine[];
  /** Our line was refused; `retryInMs` only with `too-fast`. */
  chatDenied: { reason: ChatDeniedReason; retryInMs?: number };
}

export type NetListener<T> = (value: T) => void;

/**
 * The only way the client talks to the network (contract with phase 02: mock and WebSocket share it).
 * Times are server ms; `clockOffset` = server time − Date.now().
 */
export interface NetDriver {
  readonly clockOffset: number;
  connect(roomId: string): void;
  disconnect(): void;
  /** Resolves false when the room is full / invalid / unreachable (we stay where we were). */
  switchRoom(roomId: string): Promise<boolean>;
  listRooms(): Promise<RoomInfo[]>;
  sendMove(pos: Vec2Yaw, pose: Pose): void;
  /** Nearest free cushion to `near`, or null when none is free. */
  requestSeat(near: Vec2): Promise<number | null>;
  stand(): void;
  hello(): void;
  bead(): void;
  /** One bow while seated, before standing up (the server takes at most one per BOW_PERIOD_MS). */
  bow(): void;
  /**
   * Name we want to be shown as: sent with every later connect, and as a rename when already in a room.
   * The server may adjust it (normalised, "An 2" when taken); the room's frames carry the result.
   */
  setName(name: string): void;
  /** D25: dozing (inactive) or awake; kept across reconnects and sent again whenever the server's copy differs. */
  setAsleep(asleep: boolean): void;
  /**
   * Session token (P4-D4): sent as `auth` now if connected and first thing on every later socket.
   * null signs out on the open socket (no reconnect) and stops sending `auth`.
   */
  setSession(token: string | null): void;
  /** Raw text; the server normalises and may answer `chatDenied` instead of echoing a `chat`. */
  sendChat(text: string): void;
  on<K extends keyof NetDriverEvents>(event: K, cb: NetListener<NetDriverEvents[K]>): () => void;
}

/** Listener sets shared by every driver implementation. */
export class NetEmitter {
  private readonly sets: { [K in keyof NetDriverEvents]: Set<NetListener<NetDriverEvents[K]>> } = {
    status: new Set(),
    snapshot: new Set(),
    update: new Set(),
    event: new Set(),
    corrected: new Set(),
    inviteArrived: new Set(),
    account: new Set(),
    chat: new Set(),
    chatHistory: new Set(),
    chatDenied: new Set(),
  };

  on<K extends keyof NetDriverEvents>(event: K, cb: NetListener<NetDriverEvents[K]>): () => void {
    const set = this.sets[event] as Set<NetListener<NetDriverEvents[K]>>;
    set.add(cb);
    return () => set.delete(cb);
  }

  emit<K extends keyof NetDriverEvents>(event: K, value: NetDriverEvents[K]): void {
    for (const cb of this.sets[event] as Set<NetListener<NetDriverEvents[K]>>) cb(value);
  }

  clear(): void {
    for (const set of Object.values(this.sets)) set.clear();
  }
}
