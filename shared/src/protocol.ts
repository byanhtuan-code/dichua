import type { AccountView } from "./account.ts";
import type { ChatLine } from "./chat.ts";
import { isFiniteNumber, isRecord } from "./guards.ts";
import { normalizeVisitorName } from "./names.ts";
import type { Pose, Visitor, VisitorEvent } from "./types.ts";

// Network constants: client and server read these, never their own copies.

/** Server tick: one delta frame per room. */
export const TICK_MS = 200;
/** Slower tick once a room holds this many people (bandwidth). */
export const TICK_MS_CROWDED = 500;
export const CROWDED_AT = 24;
export const PING_EVERY_MS = 5000;
/** No message (ping included) for this long → the server drops the socket. */
export const IDLE_TIMEOUT_MS = 15000;
export const HELLO_COOLDOWN_MS = 3000;
/** Clients batch `bead` to one per second; other people never see single beads. */
export const BEAD_EVERY_MS = 1000;
/** Above this many messages in a sliding second the socket is closed (1008). */
export const SPAM_MSGS_PER_S = 30;
/** m/s the server accepts; the client walks at MOVE_SPEED. */
export const MAX_SPEED = 4;
/** Slack on top of MAX_SPEED × elapsed before a move is corrected (jitter, batching). */
export const SPEED_TOLERANCE_M = 1.5;
/** Largest JSON text a client may send. */
export const MAX_FRAME_BYTES = 2048;
/** One applied `rename` per visitor per this long; a later one waits and the newest wins (P3-D2). */
export const RENAME_COOLDOWN_MS = 5000;
/** One bow cycle; a seated visitor's `bow` is accepted at most once per cycle (spam must not ring the room's bell). */
export const BOW_PERIOD_MS = 4000;

/** Raw chat text a client may send; the server normalises it to the account's limit afterwards. */
export const MAX_CHAT_RAW_CHARS = 1000;
/** Session token (32 random bytes, base64url). Travels in `auth`, never in a URL (P4-D4). */
export const SESSION_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** Wire order of poses: the STN1 frame stores the index. */
export const WIRE_POSES: readonly Pose[] = ["walk", "kneel", "beads", "hello"];

/** A visitor as the server sends it: `slot` keys the binary records. */
export type WireVisitor = Visitor & { slot: number };

export type ClientMsg =
  | { type: "move"; x: number; z: number; yaw: number; pose: Pose }
  | { type: "seat"; requestId: number }
  | { type: "stand" }
  | { type: "hello" }
  | { type: "bead" }
  | { type: "sync" }
  | { type: "ping"; clientTime: number }
  // Bow once more before standing (P3-D11); the client sends `stand` itself when the bow is over.
  | { type: "bow" }
  // Already normalised by parseClientMsg; the server still makes it unique in the room.
  | { type: "rename"; name: string }
  // D25: the visitor went inactive (dozes in place) or came back. The client decides; the server only stores and relays it.
  | { type: "sleep"; asleep: boolean }
  // P4-D4: first message after every socket open when signed in; null = sign out on this socket (keeps id and seat).
  | { type: "auth"; token: string | null }
  // Raw text: the server normalises it with the sender's tier.
  | { type: "chat"; text: string };

export type ChatDeniedReason = "login" | "quiet-room" | "too-fast" | "too-long" | "duplicate" | "empty";

const CHAT_DENIED_REASONS: readonly ChatDeniedReason[] = ["login", "quiet-room", "too-fast", "too-long", "duplicate", "empty"];

export function isChatDeniedReason(v: unknown): v is ChatDeniedReason {
  return typeof v === "string" && (CHAT_DENIED_REASONS as readonly string[]).includes(v);
}

// `too-many`: this client IP already has MAX_CONN_PER_IP_ROOM people in that room (the socket is then closed with 4002).
export type ErrorCode = "room-full" | "invalid-room" | "rate-limit" | "bad-message" | "too-many";

// Every JSON message the server sends carries serverTime (clock sync, ordering).
export type ServerMsg =
  // `reserved`: cushion granted to us but not reached yet (server-only state, not in `visitors`).
  // `resume`: secret for reconnecting to this room as the same visitor (`?resume=`), see RESUME_GRACE_MS.
  | {
      type: "snapshot";
      room: string;
      selfId: string;
      revision: number;
      serverTime: number;
      visitors: WireVisitor[];
      reserved: number | null;
      resume: string;
      /** D26: display name of this room (older servers leave it out). */
      roomName?: string;
    }
  | { type: "seat-granted"; requestId: number; cushion: number; serverTime: number }
  | { type: "seat-unavailable"; requestId: number; serverTime: number }
  | { type: "position-corrected"; x: number; z: number; yaw: number; serverTime: number }
  // Wrapped: VisitorEvent has its own `type` (hello / bow / bead).
  | { type: "event"; event: VisitorEvent; serverTime: number }
  | { type: "pong"; clientTime: number; serverTime: number }
  // To the inviter only: someone just joined through their `?near=` link (the server placed them alongside).
  | { type: "invite-arrived"; visitorId: string; name: string; serverTime: number }
  | { type: "error"; code: ErrorCode; serverTime: number }
  // Reply to `auth`, to that socket only: the username never goes to anyone else. null = signed out / token refused.
  | { type: "account"; account: AccountView | null; serverTime: number }
  | { type: "chat"; line: ChatLine; serverTime: number }
  // Right after `snapshot`, chat rooms only (oldest first, ≤ CHAT_HISTORY).
  | { type: "chat-history"; lines: ChatLine[]; serverTime: number }
  // To the sender only. `retryInMs` with `too-fast`.
  | { type: "chat-denied"; reason: ChatDeniedReason; retryInMs?: number; serverTime: number };

function isPose(v: unknown): v is Pose {
  return typeof v === "string" && (WIRE_POSES as readonly string[]).includes(v);
}

/**
 * Client message from untrusted input: the raw text (≤ MAX_FRAME_BYTES) or an already parsed value.
 * Anything malformed → null. The result is rebuilt field by field, so extra keys never reach the server logic.
 */
export function parseClientMsg(raw: unknown): ClientMsg | null {
  let v = raw;
  if (typeof raw === "string") {
    // UTF-16 length ≤ byte length, so this is a cheap pre-check; the server also caps the socket frame.
    if (raw.length > MAX_FRAME_BYTES) return null;
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(v) || typeof v["type"] !== "string") return null;

  switch (v["type"]) {
    case "move": {
      const { x, z, yaw, pose } = v;
      if (!isFiniteNumber(x) || !isFiniteNumber(z) || !isFiniteNumber(yaw) || !isPose(pose)) return null;
      // Wrapped to (-π, π]: a yaw of 1e300 would otherwise be stored and sent to everyone.
      return { type: "move", x, z, yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)), pose };
    }
    case "seat": {
      // The server seats from its own position; a `near` sent by older clients is ignored.
      const { requestId } = v;
      if (!Number.isSafeInteger(requestId) || (requestId as number) < 0) return null;
      return { type: "seat", requestId: requestId as number };
    }
    case "stand":
    case "hello":
    case "bead":
    case "sync":
    case "bow":
      return { type: v["type"] };
    case "ping": {
      const { clientTime } = v;
      if (!isFiniteNumber(clientTime)) return null;
      return { type: "ping", clientTime };
    }
    case "sleep": {
      const { asleep } = v;
      return typeof asleep === "boolean" ? { type: "sleep", asleep } : null;
    }
    case "rename": {
      const { name } = v;
      if (typeof name !== "string" || name.length > MAX_FRAME_BYTES) return null;
      const clean = normalizeVisitorName(name);
      return clean === null ? null : { type: "rename", name: clean };
    }
    case "auth": {
      const { token } = v;
      if (token === null) return { type: "auth", token: null };
      return typeof token === "string" && SESSION_TOKEN.test(token) ? { type: "auth", token } : null;
    }
    case "chat": {
      const { text } = v;
      return typeof text === "string" && text.length <= MAX_CHAT_RAW_CHARS ? { type: "chat", text } : null;
    }
    default:
      return null;
  }
}

/** A visitor who left keeps their id this long: reconnecting with the snapshot's `resume` token gets it back. */
export const RESUME_GRACE_MS = 2 * 60_000;

const RESUME_TOKEN = /^[A-Za-z0-9_-]{22}$/;

/** `resume` query value / snapshot field → token, or null when absent / malformed. */
export function parseResumeToken(raw: unknown): string | null {
  return typeof raw === "string" && RESUME_TOKEN.test(raw) ? raw : null;
}

const NEAR_ID = /^v:[a-z0-9]{1,16}$/;

/** `near` query value → visitor id, or null when absent / malformed (callers then ignore it). */
export function parseNearId(raw: string | null | undefined): string | null {
  return typeof raw === "string" && NEAR_ID.test(raw) ? raw : null;
}
