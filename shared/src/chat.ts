import { isFiniteNumber, isRecord } from "./guards.ts";

// P4-D6: the only place chat limits live. `tier` is internal — never shown to people (no plan talk in the UI).
export type ChatTier = "free" | "pro";

export const CHAT_LIMITS = {
  free: { maxChars: 80, cooldownMs: 3000, burst: 5, burstWindowMs: 30_000 },
  pro: { maxChars: 200, cooldownMs: 1000, burst: 20, burstWindowMs: 30_000 },
} as const;

/** Lines the server keeps per chat room and sends to newcomers. */
export const CHAT_HISTORY = 30;
/** How long a chat bubble stays above the sender's head. */
export const CHAT_BUBBLE_MS = 6000;
/** The same text as the previous line within this long is refused. */
export const CHAT_DUPLICATE_MS = 60_000;

export function isChatTier(v: unknown): v is ChatTier {
  return v === "free" || v === "pro";
}

/** `name` is the character name at send time; the username never travels in a line (P4-D2). */
export interface ChatLine {
  id: string;
  visitorId: string;
  name: string;
  text: string;
  at: number;
}

/** Server-sent line → ChatLine, or null when malformed. Rebuilt field by field. */
export function parseChatLine(raw: unknown): ChatLine | null {
  if (!isRecord(raw)) return null;
  const { id, visitorId, name, text, at } = raw;
  if (typeof id !== "string" || typeof visitorId !== "string" || typeof name !== "string" || typeof text !== "string") return null;
  if (!isFiniteNumber(at)) return null;
  return { id, visitorId, name, text, at };
}

// Format characters except ZWJ (emoji sequences need it), plus control and lone surrogates.
const INVISIBLE = /(?!‍)\p{Cf}|\p{Cc}|\p{Cs}/gu;

export type ChatTextResult = { ok: true; text: string } | { ok: false; reason: "empty" | "too-long" };

/**
 * Untrusted chat text → what gets shown (P4-D7). Too long is refused, never cut silently.
 * Length counts code points, so one emoji is 1 — the client counter must count the same way.
 */
export function normalizeChatText(raw: string, tier: ChatTier): ChatTextResult {
  const max = CHAT_LIMITS[tier].maxChars;
  // Whitespace first: a newline stripped as a control char would glue two words together.
  const text = raw.normalize("NFC").replace(/\s+/gu, " ").replace(INVISIBLE, "").replace(/ {2,}/g, " ").trim();
  if (text === "") return { ok: false, reason: "empty" };
  // UTF-16 length ≥ code points: only count when it could be over.
  if (text.length > max && [...text].length > max) return { ok: false, reason: "too-long" };
  return { ok: true, text };
}

export type ChatThrottleResult = { ok: true } | { ok: false; reason: "too-fast" | "duplicate"; retryInMs?: number };

const MAX_BURST_WINDOW_MS = Math.max(...Object.values(CHAT_LIMITS).map((l) => l.burstWindowMs));

/** Pure per-account send limiter: `check` decides, `record` books an accepted line. Time is passed in. */
export class ChatThrottle {
  private sent: number[] = [];
  private lastText = "";
  private lastTextAt = Number.NEGATIVE_INFINITY;

  check(text: string, now: number, tier: ChatTier): ChatThrottleResult {
    const lim = CHAT_LIMITS[tier];
    let wait = 0;
    const last = this.sent[this.sent.length - 1];
    if (last !== undefined) wait = Math.max(wait, last + lim.cooldownMs - now);
    const inWindow = this.sent.filter((t) => t > now - lim.burstWindowMs);
    if (inWindow.length >= lim.burst) {
      const oldest = inWindow[inWindow.length - lim.burst] ?? now;
      wait = Math.max(wait, oldest + lim.burstWindowMs - now);
    }
    if (wait > 0) return { ok: false, reason: "too-fast", retryInMs: Math.ceil(wait) };
    if (now - this.lastTextAt < CHAT_DUPLICATE_MS && text.toLowerCase() === this.lastText) return { ok: false, reason: "duplicate" };
    return { ok: true };
  }

  record(text: string, now: number): void {
    this.sent = this.sent.filter((t) => t > now - MAX_BURST_WINDOW_MS);
    this.sent.push(now);
    this.lastText = text.toLowerCase();
    this.lastTextAt = now;
  }

  /** Time of the last recorded line (−∞ if none): the server drops idle throttles by it. */
  get lastAt(): number {
    return this.sent[this.sent.length - 1] ?? Number.NEGATIVE_INFINITY;
  }
}
