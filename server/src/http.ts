import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { MAX_FRAME_BYTES, normalizeVisitorName, parseNearId, parseResumeToken, roomNumber, type ServerMsg } from "@santinh/shared";
import { WebSocketServer } from "ws";
import { createAccountHandler } from "./account-http.ts";
import { Accounts } from "./accounts.ts";
import { createAdminHandler } from "./admin.ts";
import type { Config } from "./config.ts";
import type { RoomHub } from "./hub.ts";
import { isAllowedOrigin } from "./origin.ts";
import { PopulationStore } from "./population-store.ts";
import { RoomNamesStore } from "./room-names-store.ts";

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

/** Extensions that benefit heavily from Gzip and are small enough to keep pre-compressed in memory. */
const COMPRESSIBLE_EXT = new Set([".html", ".js", ".css", ".json", ".svg", ".txt"]);
/** Vite hashed bundles under `/assets/name-hash.ext` never change and can be cached forever by browsers. */
const IMMUTABLE_ASSET_RE = /^\/assets\/.+-[a-zA-Z0-9_-]{8,}\.[a-z0-9]+$/i;

interface CachedTextAsset {
  etag: string;
  raw: Buffer;
  gzip: Buffer;
}

const staticTextCache = new Map<string, CachedTextAsset>();
const MAX_STATIC_CACHE_ENTRIES = 64;

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

function reject(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

async function serveStatic(root: string, req: IncomingMessage, urlPath: string, res: ServerResponse): Promise<void> {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (rel.includes("\0")) {
    res.writeHead(400).end();
    return;
  }
  const base = resolve(root);
  let file = join(base, normalize(rel));
  if (file !== base && !file.startsWith(base + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    let st = await stat(file);
    if (st.isDirectory()) {
      file = join(file, "index.html");
      st = await stat(file);
    }
    const ext = extname(file).toLowerCase();
    const contentType = MIME[ext] ?? "application/octet-stream";
    const etag = `W/"${st.size.toString(16)}-${Math.trunc(st.mtimeMs).toString(16)}"`;
    const cacheControl =
      ext === ".html"
        ? "no-cache"
        : IMMUTABLE_ASSET_RE.test(rel)
          ? "public, max-age=31536000, immutable"
          : "public, max-age=86400, stale-while-revalidate=604800";

    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, { "cache-control": cacheControl, etag }).end();
      return;
    }

    if (COMPRESSIBLE_EXT.has(ext) && st.size >= 512 && st.size <= 5 * 1024 * 1024) {
      let cached = staticTextCache.get(file);
      if (!cached || cached.etag !== etag) {
        const raw = await readFile(file);
        const gzip = gzipSync(raw, { level: 6 });
        if (staticTextCache.size >= MAX_STATIC_CACHE_ENTRIES) staticTextCache.clear();
        cached = { etag, raw, gzip };
        staticTextCache.set(file, cached);
      }
      const acceptsGzip = /\bgzip\b/i.test(String(req.headers["accept-encoding"] ?? ""));
      const payload = acceptsGzip ? cached.gzip : cached.raw;
      const headers: Record<string, string> = {
        "content-type": contentType,
        "content-length": String(payload.byteLength),
        "cache-control": cacheControl,
        etag,
        vary: "Accept-Encoding",
      };
      if (acceptsGzip) headers["content-encoding"] = "gzip";
      res.writeHead(200, headers);
      res.end(req.method === "HEAD" ? undefined : payload);
      return;
    }

    if (req.method === "HEAD") {
      res.writeHead(200, {
        "content-type": contentType,
        "content-length": String(st.size),
        "cache-control": cacheControl,
        etag,
      }).end();
      return;
    }

    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": contentType,
      "content-length": String(body.byteLength),
      "cache-control": cacheControl,
      etag,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
  }
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    const last = (Array.isArray(xff) ? xff.join(",") : (xff ?? "")).split(",").pop()?.trim();
    if (last) return last;
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** HTTP routes + the `/ws` upgrade. Origin and room are checked before `handleUpgrade`; the per-IP cap after (see below). */
export function createAppServer(
  config: Config,
  hub: RoomHub,
  clock: () => number = Date.now,
  population: PopulationStore = new PopulationStore("", config.capacity),
  roomNames: RoomNamesStore = new RoomNamesStore(""),
  accounts: Accounts = new Accounts(""),
): Server {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });
  const connsByIpRoom = new Map<string, number>();
  const admin = createAdminHandler({
    user: config.adminUser,
    password: config.adminPassword,
    store: population,
    roomNames,
    hub,
    accounts,
    allowedOrigins: config.allowedOrigins,
    capacity: config.capacity,
    clientIp: (req) => clientIp(req, config.trustProxy),
    clock,
  });
  const account = createAccountHandler({
    accounts,
    clientIp: (req) => clientIp(req, config.trustProxy),
    registerPerIpPerDay: config.registerPerIpPerDay,
    clock,
  });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const handle = async (): Promise<void> => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (await admin(req, res, url.pathname)) return;
      if (url.pathname.startsWith("/api/")) {
        const origin = req.headers.origin;
        const cors: Record<string, string> = {};
        if (origin && isAllowedOrigin(origin, req.headers.host, config.allowedOrigins)) {
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
        } else if (await account(req, res, url.pathname, cors)) {
          return;
        } else if (req.method === "GET" && url.pathname === "/api/ping") {
          json(res, 200, { ok: true, serverTime: clock() }, cors);
        } else if (req.method === "GET" && url.pathname === "/api/rooms") {
          json(res, 200, { rooms: hub.list() }, cors);
        } else {
          json(res, 404, { error: "not-found" }, cors);
        }
        return;
      }
      if (config.staticDir && (req.method === "GET" || req.method === "HEAD")) {
        await serveStatic(config.staticDir, req, url.pathname, res);
        return;
      }
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
    };
    handle().catch((err: unknown) => {
      console.error("http handler failed", err);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/ws") return reject(socket, 404, "Not Found");
      const room = url.searchParams.get("room") ?? "";
      if (roomNumber(room) === null || !hub.has(room)) return reject(socket, 400, "Bad Request");
      if (!isAllowedOrigin(req.headers.origin, req.headers.host, config.allowedOrigins)) return reject(socket, 403, "Forbidden");
      const key = `${clientIp(req, config.trustProxy)} ${room}`;
      const near = parseNearId(url.searchParams.get("near"));
      const resume = parseResumeToken(url.searchParams.get("resume"));
      const name = normalizeVisitorName(url.searchParams.get("name"));
      const over =
        config.maxConnPerIpRoom > 0 &&
        (connsByIpRoom.get(key) ?? 0) >= config.maxConnPerIpRoom &&
        !(resume !== null && hub.holds(room, resume));
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (over) {
          ws.send(JSON.stringify({ type: "error", code: "too-many", serverTime: clock() } satisfies ServerMsg));
          ws.close(4002, "too-many");
          return;
        }
        connsByIpRoom.set(key, (connsByIpRoom.get(key) ?? 0) + 1);
        ws.once("close", () => {
          const n = (connsByIpRoom.get(key) ?? 1) - 1;
          if (n <= 0) connsByIpRoom.delete(key);
          else connsByIpRoom.set(key, n);
        });
        try {
          hub.join(room, ws, near, resume, name);
        } catch (err) {
          console.error("join failed", err);
          ws.terminate();
        }
      });
    } catch (err) {
      console.error("upgrade failed", err);
      socket.destroy();
    }
  });

  server.on("close", () => wss.close());
  return server;
}
