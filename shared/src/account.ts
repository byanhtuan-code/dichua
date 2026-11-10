import { isRecord } from "./guards.ts";
import { isChatTier, type ChatTier } from "./chat.ts";
import { normalizeVisitorName } from "./names.ts";

// P4-D2 / D4 / D5: account rules. Server decides with these; the client uses the same ones to warn early.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
/** Code points; scrypt does not care, the cap only bounds the work per request. */
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 72;

/** Successful registrations per IP per REGISTER_WINDOW_MS (server env may override). */
export const REGISTER_PER_IP_PER_DAY = 3;
export const REGISTER_WINDOW_MS = 24 * 60 * 60_000;
/** Failed logins per IP per LOGIN_FAIL_WINDOW_MS before 429. */
export const LOGIN_FAILS_PER_MIN = 10;
export const LOGIN_FAIL_WINDOW_MS = 60_000;
/** A session unused this long is gone. */
export const SESSION_IDLE_MS = 90 * 24 * 60 * 60_000;
/** `last_seen` is written at most this often. */
export const SESSION_TOUCH_MS = 60 * 60_000;

// No "@": a private login name, not an email (D29) — email comes later as its own field.
const USERNAME = /^[a-z0-9_.-]+$/;

/** Untrusted username → canonical (trimmed, lowercase), or null when it breaks the rules. */
export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim().toLowerCase();
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX || !USERNAME.test(name)) return null;
  if (name.startsWith(".") || name.endsWith(".")) return null;
  return name;
}

/** Length only (code points), no other rules (P4-D2). */
export function isValidPassword(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  // UTF-16 length is 1–2× code points: settle the obvious cases without splitting.
  if (raw.length < PASSWORD_MIN || raw.length > PASSWORD_MAX * 2) return false;
  const n = [...raw].length;
  return n >= PASSWORD_MIN && n <= PASSWORD_MAX;
}

/** What the owner sees about their account. Sent only to that owner — the username is private. */
export interface AccountView {
  username: string;
  displayName: string;
  tier: ChatTier;
}

/** Server-sent account → AccountView, or null when malformed. */
export function parseAccountView(raw: unknown): AccountView | null {
  if (!isRecord(raw)) return null;
  const username = normalizeUsername(raw["username"]);
  const displayName = normalizeVisitorName(raw["displayName"]);
  const tier = raw["tier"];
  if (username === null || displayName === null || !isChatTier(tier)) return null;
  return { username, displayName, tier };
}
