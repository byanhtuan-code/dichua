import type { IncomingMessage, ServerResponse } from "node:http";
import { LOGIN_FAILS_PER_MIN, LOGIN_FAIL_WINDOW_MS, REGISTER_WINDOW_MS, SESSION_TOKEN, isRecord } from "@santinh/shared";
import { BodyTooLarge, readBody } from "./admin.ts";
import type { Accounts } from "./accounts.ts";

export const ACCOUNT_MAX_BODY_BYTES = 2048;
/** Above this many tracked IPs, expired ones are swept. */
const MAX_TRACKED_IPS = 10_000;
const SWEEP_EVERY_MS = 1000;

/**
 * Hits per IP in a sliding window. Not `SlidingWindow` (room-state.ts): that one records on every check and
 * cannot say when the oldest hit leaves, and here only some outcomes count and a 429 must carry `retryAfterMs`.
 */
export class IpWindow {
  private readonly hits = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private lastSweep = 0;

  /** `limit` 0 = no limit. */
  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  /** ms until the next hit is allowed; 0 = allowed now. */
  retryAfterMs(ip: string, now: number): number {
    if (this.limit === 0) return 0;
    const recent = this.recent(ip, now);
    if (recent.length < this.limit) return 0;
    const oldest = recent[recent.length - this.limit] ?? now;
    return Math.max(1, oldest + this.windowMs - now);
  }

  record(ip: string, now: number): void {
    if (this.limit === 0) return;
    // Throttled: a flood from many IPs must not cost a full scan per request.
    if (this.hits.size > MAX_TRACKED_IPS && now - this.lastSweep >= SWEEP_EVERY_MS) {
      this.lastSweep = now;
      for (const [key, times] of this.hits) {
        if (now - (times[times.length - 1] ?? 0) >= this.windowMs) this.hits.delete(key);
      }
    }
    // Only the last `limit` hits can matter for the answer.
    this.hits.set(ip, [...this.recent(ip, now), now].slice(-this.limit));
  }

  /** Takes back one hit recorded at `at` (a reserved slot that ended up not counting). */
  forget(ip: string, at: number): void {
    const times = this.hits.get(ip);
    const i = times?.lastIndexOf(at) ?? -1;
    if (!times || i < 0) return;
    times.splice(i, 1);
    if (times.length === 0) this.hits.delete(ip);
  }

  private recent(ip: string, now: number): number[] {
    return (this.hits.get(ip) ?? []).filter((t) => now - t < this.windowMs);
  }
}

export interface AccountHttpDeps {
  accounts: Accounts;
  clientIp: (req: IncomingMessage) => string;
  /** From `config.registerPerIpPerDay`; 0 = no limit. */
  registerPerIpPerDay: number;
  clock?: () => number;
}

type Cors = Record<string, string>;

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string>): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function bearer(req: IncomingMessage): string | null {
  const m = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? "");
  const token = m?.[1];
  return token !== undefined && SESSION_TOKEN.test(token) ? token : null;
}

/**
 * `/api/account/*` (P4-D5). Returns false when the path is not ours. `OPTIONS` is answered by the caller.
 * Bodies are never logged: they hold passwords.
 */
export function createAccountHandler(
  deps: AccountHttpDeps,
): (req: IncomingMessage, res: ServerResponse, path: string, cors: Cors) => Promise<boolean> {
  const clock = deps.clock ?? Date.now;
  const registers = new IpWindow(deps.registerPerIpPerDay, REGISTER_WINDOW_MS);
  const loginFails = new IpWindow(LOGIN_FAILS_PER_MIN, LOGIN_FAIL_WINDOW_MS);

  /** Parsed JSON object, or null after answering 413 / 400. */
  async function body(req: IncomingMessage, res: ServerResponse, cors: Cors): Promise<Record<string, unknown> | null> {
    let raw: unknown;
    try {
      raw = JSON.parse(await readBody(req, ACCOUNT_MAX_BODY_BYTES));
    } catch (err) {
      if (err instanceof BodyTooLarge) json(res, 413, { error: "too-large" }, { ...cors, connection: "close" });
      else json(res, 400, { error: "bad-json" }, cors);
      return null;
    }
    if (!isRecord(raw)) {
      json(res, 400, { error: "bad-input" }, cors);
      return null;
    }
    return raw;
  }

  function limited(res: ServerResponse, cors: Cors, retryAfterMs: number): void {
    json(res, 429, { error: "rate-limit", retryAfterMs }, { ...cors, "retry-after": String(Math.ceil(retryAfterMs / 1000)) });
  }

  return async (req, res, path, cors) => {
    if (path !== "/api/account" && !path.startsWith("/api/account/")) return false;
    const route = path.slice("/api/account/".length);
    const method = route === "me" ? "GET" : route === "register" || route === "login" || route === "logout" ? "POST" : null;
    if (method === null) {
      json(res, 404, { error: "not-found" }, cors);
      return true;
    }
    if (req.method !== method) {
      json(res, 405, { error: "method-not-allowed" }, { ...cors, allow: method });
      return true;
    }
    const ip = deps.clientIp(req);

    if (route === "register" || route === "login") {
      // - Register counts successes, login counts failures; both reserve the slot *before* the async hash and give it back
      //   if it ends up not counting — checking after would let parallel requests from one IP all pass.
      // - Login is locked out even with the right password: otherwise the 429 tells a guesser nothing.
      const window = route === "register" ? registers : loginFails;
      const at = clock();
      const wait = window.retryAfterMs(ip, at);
      if (wait > 0) return (limited(res, cors, wait), true);
      window.record(ip, at);
      let counted = false;
      try {
        const b = await body(req, res, cors);
        if (!b) return true;
        if (route === "register") {
          const result = await deps.accounts.register(b["username"], b["password"], b["displayName"]);
          if (result === "bad-input") json(res, 400, { error: "bad-input" }, cors);
          else if (result === "taken") json(res, 409, { error: "username-taken" }, cors);
          else {
            counted = true;
            json(res, 201, result, cors);
          }
        } else {
          const result = await deps.accounts.login(b["username"], b["password"]);
          if (result) json(res, 200, result, cors);
          else {
            counted = true;
            json(res, 401, { error: "bad-credentials" }, cors);
          }
        }
      } finally {
        if (!counted) window.forget(ip, at);
      }
      return true;
    }

    const token = bearer(req);
    if (route === "logout") {
      // Idempotent: an unknown or expired token is already logged out.
      if (token !== null) deps.accounts.logout(token);
      res.writeHead(204, { ...cors, "cache-control": "no-store" }).end();
      return true;
    }

    const session = token === null ? null : deps.accounts.bySession(token);
    if (!session) json(res, 401, { error: "unauthorized" }, { ...cors, "www-authenticate": "Bearer" });
    else json(res, 200, { account: session.account }, cors);
    return true;
  };
}
