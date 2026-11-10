import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { DEFAULT_POPULATION, DEFAULT_ROOM_NAMES, MAX_MIN_BOTS, MAX_ROOM_NAME_CHARS, ROOM_COUNT } from "@santinh/shared";
import type { Accounts } from "./accounts.ts";
import { ADMIN_PAGE_CSP, ADMIN_PAGE_HTML } from "./admin-page.ts";
import type { RoomHub } from "./hub.ts";
import { isAllowedOrigin } from "./origin.ts";
import type { PopulationStore } from "./population-store.ts";
import type { RoomNamesStore } from "./room-names-store.ts";

export const ADMIN_MAX_BODY_BYTES = 4096;
export const ADMIN_FAIL_WINDOW_MS = 60_000;
export const ADMIN_MAX_FAILS = 10;

export type AuthResult = "ok" | "unauthorized" | "limited";

function sha256(text: string): Buffer {
  return createHash("sha256").update(text, "utf8").digest();
}

/**
 * Username + Password Bearer check + failed attempts per IP in a sliding window.
 * Supports both `new AdminAuth(user, pass, clock)` (production) and `new AdminAuth(pass, clock)` (legacy tests).
 */
export class AdminAuth {
  private readonly expectedUserHash: Buffer;
  private readonly expectedPassHash: Buffer;
  private readonly requireUser: boolean;
  private readonly clock: () => number;
  private readonly fails = new Map<string, number[]>();
  private lastSweep = 0;

  constructor(userOrPass: string, passOrClock?: string | (() => number), clock: () => number = Date.now) {
    if (typeof passOrClock === "string") {
      this.expectedUserHash = sha256(userOrPass);
      this.expectedPassHash = sha256(passOrClock);
      this.requireUser = true;
      this.clock = clock;
    } else {
      this.expectedUserHash = sha256("admin");
      this.expectedPassHash = sha256(userOrPass);
      this.requireUser = false;
      this.clock = passOrClock ?? clock;
    }
  }

  check(ip: string, authorization: string | undefined): AuthResult {
    const now = this.clock();
    // Locked out even with the right password: otherwise the 429 tells a guesser nothing.
    if (this.recentFails(ip, now).length >= ADMIN_MAX_FAILS) return "limited";
    const m = /^Bearer (.+)$/i.exec(authorization ?? "");
    if (!m?.[1]) {
      this.recordFail(ip, now);
      return "unauthorized";
    }
    const raw = m[1];
    const colon = raw.indexOf(":");
    let userPart = "";
    let passPart = raw;
    if (colon !== -1) {
      userPart = raw.slice(0, colon);
      passPart = raw.slice(colon + 1);
    }

    const userOk =
      colon !== -1
        ? timingSafeEqual(sha256(userPart), this.expectedUserHash)
        : !this.requireUser;
    const passOk = timingSafeEqual(sha256(passPart), this.expectedPassHash);

    if (userOk && passOk) return "ok";
    this.recordFail(ip, now);
    return "unauthorized";
  }

  /** Seconds until the oldest counted failure leaves the window. */
  retryAfter(ip: string): number {
    const now = this.clock();
    const oldest = this.recentFails(ip, now)[0] ?? now;
    return Math.max(1, Math.ceil((oldest + ADMIN_FAIL_WINDOW_MS - now) / 1000));
  }

  private recentFails(ip: string, now: number): number[] {
    return (this.fails.get(ip) ?? []).filter((t) => now - t < ADMIN_FAIL_WINDOW_MS);
  }

  private recordFail(ip: string, now: number): void {
    if (now - this.lastSweep >= ADMIN_FAIL_WINDOW_MS) {
      this.lastSweep = now;
      for (const [key, times] of this.fails) {
        const last = times[times.length - 1] ?? 0;
        if (now - last >= ADMIN_FAIL_WINDOW_MS) this.fails.delete(key);
      }
    }
    this.fails.set(ip, [...this.recentFails(ip, now), now]);
  }
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

export class BodyTooLarge extends Error {}

export async function readBody(req: IncomingMessage, max: number): Promise<string> {
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > max) throw new BodyTooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buf.length;
    if (size > max) throw new BodyTooLarge();
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function parseJsonObject(
  req: IncomingMessage,
  res: ServerResponse,
  cors: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readBody(req, ADMIN_MAX_BODY_BYTES));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      json(res, 400, { error: "bad-json" }, cors);
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof BodyTooLarge) {
      json(res, 413, { error: "too-large" }, { ...cors, connection: "close" });
    } else {
      json(res, 400, { error: "bad-json" }, cors);
    }
    return null;
  }
}

export interface AdminDeps {
  user?: string;
  password: string;
  store: PopulationStore;
  roomNames: RoomNamesStore;
  hub?: RoomHub;
  accounts?: Accounts;
  allowedOrigins?: readonly string[];
  capacity: number;
  clientIp: (req: IncomingMessage) => string;
  clock?: () => number;
}

const LIMITS_FOR = (capacity: number) => ({ rooms: ROOM_COUNT, maxBots: capacity - 1, maxMinBots: MAX_MIN_BOTS });

/**
 * `/admin` + `/api/admin/*` (P3-D9). Returns false when the path is not ours.
 * - empty password = admin off → 404 on both;
 * - same origin or configured `allowedOrigins` only; foreign `Origin` → 403.
 */
export function createAdminHandler(deps: AdminDeps): (req: IncomingMessage, res: ServerResponse, path: string) => Promise<boolean> {
  const auth =
    deps.password === ""
      ? null
      : deps.user !== undefined
        ? new AdminAuth(deps.user, deps.password, deps.clock)
        : new AdminAuth(deps.password, deps.clock);
  const limits = LIMITS_FOR(deps.capacity);
  const allowedOrigins = deps.allowedOrigins ?? [];

  return async (req, res, path) => {
    if (path !== "/admin" && path !== "/api/admin" && !path.startsWith("/api/admin/")) return false;
    if (!auth) {
      json(res, 404, { error: "not-found" });
      return true;
    }
    if (path === "/admin") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { allow: "GET, HEAD" }).end();
        return true;
      }
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": ADMIN_PAGE_CSP,
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      });
      res.end(req.method === "HEAD" ? undefined : ADMIN_PAGE_HTML);
      return true;
    }

    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin, req.headers.host, allowedOrigins)) {
      json(res, 403, { error: "forbidden" });
      return true;
    }
    const cors: Record<string, string> = {};
    if (origin && !isAllowedOrigin(origin, req.headers.host, [])) {
      cors["access-control-allow-origin"] = origin;
      cors.vary = "Origin";
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        ...cors,
        "access-control-allow-methods": "GET, POST, PUT, DELETE, OPTIONS",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-max-age": "600",
      });
      res.end();
      return true;
    }

    const ip = deps.clientIp(req);
    const result = auth.check(ip, req.headers.authorization);
    if (result === "limited") {
      json(res, 429, { error: "too-many-attempts" }, { ...cors, "retry-after": String(auth.retryAfter(ip)) });
      return true;
    }
    if (result === "unauthorized") {
      json(res, 401, { error: "unauthorized" }, { ...cors, "www-authenticate": "Bearer" });
      return true;
    }

    // 1. Live Server & Room Overview + Moderation APIs
    if (deps.hub) {
      if (path === "/api/admin/overview" && req.method === "GET") {
        json(res, 200, deps.hub.adminOverview(), cors);
        return true;
      }
      if (path === "/api/admin/broadcast" && req.method === "POST") {
        const b = await parseJsonObject(req, res, cors);
        if (!b) return true;
        const text = typeof b["text"] === "string" ? b["text"] : "";
        const room = typeof b["room"] === "string" && b["room"] !== "" ? b["room"] : null;
        const sender = typeof b["sender"] === "string" && b["sender"].trim() !== "" ? b["sender"] : undefined;
        const sent = deps.hub.adminBroadcast(text, room, sender);
        if (sent === 0) {
          json(res, 400, { error: "invalid-broadcast" }, cors);
          return true;
        }
        console.log(`admin: broadcast sent to ${sent} room(s) from ${ip}`);
        json(res, 200, { ok: true, sent }, cors);
        return true;
      }
      if (path === "/api/admin/kick" && req.method === "POST") {
        const b = await parseJsonObject(req, res, cors);
        if (!b) return true;
        const room = typeof b["room"] === "string" ? b["room"] : "";
        const visitorId = typeof b["visitorId"] === "string" ? b["visitorId"] : "";
        const ok = deps.hub.adminKick(room, visitorId);
        json(res, ok ? 200 : 404, { ok }, cors);
        return true;
      }
      if (path === "/api/admin/rename-visitor" && req.method === "POST") {
        const b = await parseJsonObject(req, res, cors);
        if (!b) return true;
        const room = typeof b["room"] === "string" ? b["room"] : "";
        const visitorId = typeof b["visitorId"] === "string" ? b["visitorId"] : "";
        const name = deps.hub.adminRenameVisitor(room, visitorId, b["name"]);
        if (name === null) {
          json(res, 400, { error: "bad-name-or-not-found" }, cors);
          return true;
        }
        json(res, 200, { ok: true, name }, cors);
        return true;
      }
      if (path === "/api/admin/clear-chat" && req.method === "POST") {
        const b = await parseJsonObject(req, res, cors);
        if (!b) return true;
        const room = typeof b["room"] === "string" && b["room"] !== "" ? b["room"] : null;
        const cleared = deps.hub.adminClearChat(room);
        console.log(`admin: cleared ${cleared} chat line(s) from ${ip}`);
        json(res, 200, { ok: true, cleared }, cors);
        return true;
      }
    }

    // 2. Registered Accounts Management APIs
    if (deps.accounts) {
      if (path === "/api/admin/accounts" && req.method === "GET") {
        const urlObj = new URL(req.url ?? "/", "http://localhost");
        const search = urlObj.searchParams.get("q") ?? "";
        const rawLimit = Number(urlObj.searchParams.get("limit") ?? 100);
        const limit = Number.isFinite(rawLimit) ? rawLimit : 100;
        const accounts = deps.accounts.listAccounts(search, limit);
        const total = deps.accounts.countAccounts();
        json(res, 200, { total, accounts }, cors);
        return true;
      }

      const accMatch = /^\/api\/admin\/accounts\/(\d+)(?:\/(tier|password|name))?$/.exec(path);
      if (accMatch) {
        const accountId = Number(accMatch[1]);
        const subRoute = accMatch[2];
        if (!subRoute && req.method === "DELETE") {
          const ok = deps.accounts.deleteAccount(accountId);
          const kicked = deps.hub ? deps.hub.adminKickAccount(accountId) : 0;
          console.log(`admin: deleted account #${accountId} (kicked ${kicked}) from ${ip}`);
          json(res, ok ? 200 : 404, { ok, kicked }, cors);
          return true;
        }
        if (subRoute && req.method === "PUT") {
          const b = await parseJsonObject(req, res, cors);
          if (!b) return true;
          if (subRoute === "tier") {
            const ok = deps.accounts.setTier(accountId, b["tier"]);
            if (!ok) {
              json(res, 400, { error: "bad-tier-or-not-found" }, cors);
              return true;
            }
            json(res, 200, { ok: true }, cors);
            return true;
          }
          if (subRoute === "name") {
            const ok = deps.accounts.setDisplayName(accountId, b["displayName"]);
            if (!ok) {
              json(res, 400, { error: "bad-name-or-not-found" }, cors);
              return true;
            }
            json(res, 200, { ok: true }, cors);
            return true;
          }
          if (subRoute === "password") {
            const ok = await deps.accounts.adminResetPassword(accountId, b["password"]);
            if (!ok) {
              json(res, 400, { error: "bad-password-or-not-found" }, cors);
              return true;
            }
            deps.hub?.adminKickAccount(accountId);
            console.log(`admin: reset password for account #${accountId} from ${ip}`);
            json(res, 200, { ok: true }, cors);
            return true;
          }
        }
        json(res, 405, { error: "method-not-allowed" }, cors);
        return true;
      }
    }

    // 3. Population & Room Names Store APIs
    const route =
      path === "/api/admin/population"
        ? { store: deps.store, view: () => ({ config: deps.store.current, defaults: DEFAULT_POPULATION, limits }), hint: { limits }, log: "population" }
        : path === "/api/admin/rooms"
          ? {
              store: deps.roomNames,
              view: () => ({ names: deps.roomNames.current, defaults: DEFAULT_ROOM_NAMES, maxChars: MAX_ROOM_NAME_CHARS }),
              hint: { count: ROOM_COUNT, maxChars: MAX_ROOM_NAME_CHARS },
              log: "room names",
            }
          : null;
    if (!route) {
      json(res, 404, { error: "not-found" }, cors);
      return true;
    }
    if (req.method !== "GET" && req.method !== "PUT") {
      json(res, 405, { error: "method-not-allowed" }, { ...cors, allow: "GET, PUT" });
      return true;
    }

    if (req.method === "GET") {
      json(res, 200, route.view(), cors);
      return true;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await readBody(req, ADMIN_MAX_BODY_BYTES));
    } catch (err) {
      if (err instanceof BodyTooLarge) {
        json(res, 413, { error: "too-large" }, { ...cors, connection: "close" });
      } else {
        json(res, 400, { error: "bad-json" }, cors);
      }
      return true;
    }
    let saved;
    try {
      saved = await route.store.save(raw);
    } catch (err) {
      console.error(`admin: saving ${route.log} failed`, err);
      json(res, 500, { error: "save-failed" }, cors);
      return true;
    }
    if (!saved) {
      json(res, 400, { error: "invalid-config", ...route.hint }, cors);
      return true;
    }
    console.log(`admin: ${route.log} updated from ${ip}`);
    json(res, 200, route.view(), cors);
    return true;
  };
}
