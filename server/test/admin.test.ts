import { randomBytes } from "node:crypto";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_POPULATION, DEFAULT_ROOM_NAMES, type PopulationConfig } from "@santinh/shared";
import { ADMIN_MAX_FAILS, AdminAuth } from "../src/admin.ts";
import { loadConfig } from "../src/config.ts";
import { createAppServer } from "../src/http.ts";
import { RoomHub } from "../src/hub.ts";
import { PopulationStore } from "../src/population-store.ts";
import { RoomNamesStore } from "../src/room-names-store.ts";

const ONE_FULL: PopulationConfig = { ...DEFAULT_POPULATION, layout: { full: 1, busy: 2, medium: 3, quiet: 4 } };

interface Running {
  base: string;
  port: number;
  stop(): Promise<void>;
}

async function start(env: Record<string, string>): Promise<Running> {
  const config = loadConfig({ PORT: "0", FAKE_POPULATION: "off", ...env });
  const store = new PopulationStore("", config.capacity);
  const names = new RoomNamesStore("");
  const hub = new RoomHub(config.capacity, Date.now, config.fakePopulation, () => store.current, () => names.current);
  const server: Server = createAppServer(config, hub, Date.now, store, names);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    port,
    async stop() {
      hub.closeAll(1001);
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}

describe("admin API", () => {
  // Generated per run: no real password ever sits in the repo.
  const pw = randomBytes(18).toString("base64url");
  const auth = { authorization: `Bearer ${pw}` };
  let srv: Running | null = null;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(async () => {
    await srv?.stop();
    srv = null;
    vi.restoreAllMocks();
  });

  it("no password → /admin and the API are 404", async () => {
    srv = await start({});
    expect((await fetch(`${srv.base}/admin`)).status).toBe(404);
    expect((await fetch(`${srv.base}/api/admin/population`, { headers: auth })).status).toBe(404);
  });

  it("serves the page with a strict CSP and no CORS", async () => {
    srv = await start({ ADMIN_PASSWORD: pw });
    const res = await fetch(`${srv.base}/admin`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(await res.text()).not.toContain(pw);
  });

  it("wrong password → 401; more than 10 failures → 429 even with the right one", async () => {
    srv = await start({ ADMIN_PASSWORD: pw });
    const url = `${srv.base}/api/admin/population`;
    expect((await fetch(url)).status).toBe(401);
    for (let i = 1; i < ADMIN_MAX_FAILS; i++) {
      expect((await fetch(url, { headers: { authorization: "Bearer nope" } })).status).toBe(401);
    }
    const limited = await fetch(url, { headers: { authorization: "Bearer nope" } });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await fetch(url, { headers: auth })).status).toBe(429);
  });

  it("GET returns config + defaults; PUT saves and /api/rooms follows", async () => {
    // Fake population on: /api/rooms only counts bots then.
    srv = await start({ ADMIN_PASSWORD: pw, FAKE_POPULATION: "on" });
    const url = `${srv.base}/api/admin/population`;
    const got = await fetch(url, { headers: auth });
    expect(got.status).toBe(200);
    expect(got.headers.get("access-control-allow-origin")).toBeNull();
    const body = (await got.json()) as { config: PopulationConfig; defaults: PopulationConfig };
    expect(body.config).toEqual(DEFAULT_POPULATION);
    const before = (await (await fetch(`${srv.base}/api/rooms`)).json()) as { rooms: { count: number; capacity: number }[] };
    expect(before.rooms.filter((r) => r.count === r.capacity)).toHaveLength(0);
    expect(body.defaults).toEqual(DEFAULT_POPULATION);

    const put = await fetch(url, { method: "PUT", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(ONE_FULL) });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { config: PopulationConfig }).config).toEqual(ONE_FULL);

    const rooms = (await (await fetch(`${srv.base}/api/rooms`)).json()) as { rooms: { count: number; capacity: number }[] };
    expect(rooms.rooms.filter((r) => r.count === r.capacity)).toHaveLength(1);
  });

  it("room names (D26): GET has names + defaults; PUT renames /api/rooms; a blank or duplicate → 400", async () => {
    srv = await start({ ADMIN_PASSWORD: pw });
    const url = `${srv.base}/api/admin/rooms`;
    const got = (await (await fetch(url, { headers: auth })).json()) as { names: string[]; defaults: string[] };
    expect(got.names).toEqual(DEFAULT_ROOM_NAMES);
    expect(got.defaults).toEqual(DEFAULT_ROOM_NAMES);
    expect((await fetch(url)).status).toBe(401);

    const names = DEFAULT_ROOM_NAMES.map((n, i) => (i === 2 ? "  Sen  Hồng " : n));
    const put = await fetch(url, { method: "PUT", headers: auth, body: JSON.stringify({ names }) });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { names: string[] }).names[2]).toBe("Sen Hồng");
    const rooms = (await (await fetch(`${srv.base}/api/rooms`)).json()) as { rooms: { id: string; name: string }[] };
    expect(rooms.rooms.find((r) => r.id === "san-03")?.name).toBe("Sen Hồng");

    for (const bad of [names.map((n, i) => (i === 0 ? " " : n)), names.map((n, i) => (i === 1 ? names[0] : n)), names.slice(1)]) {
      const res = await fetch(url, { method: "PUT", headers: auth, body: JSON.stringify({ names: bad }) });
      expect(res.status).toBe(400);
    }
    expect(((await (await fetch(url, { headers: auth })).json()) as { names: string[] }).names[2]).toBe("Sen Hồng");
  });

  it("PUT with a bad layout or broken JSON → 400, config unchanged", async () => {
    srv = await start({ ADMIN_PASSWORD: pw });
    const url = `${srv.base}/api/admin/population`;
    const bad = { ...DEFAULT_POPULATION, layout: { full: 0, busy: 2, medium: 4, quiet: 5 } };
    const res = await fetch(url, { method: "PUT", headers: auth, body: JSON.stringify(bad) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid-config");
    expect((await fetch(url, { method: "PUT", headers: auth, body: "{oops" })).status).toBe(400);
    const now = (await (await fetch(url, { headers: auth })).json()) as { config: PopulationConfig };
    expect(now.config).toEqual(DEFAULT_POPULATION);
  });

  it("a foreign Origin → 403, same origin passes", async () => {
    srv = await start({ ADMIN_PASSWORD: pw, ALLOWED_ORIGINS: "https://santinh.com" });
    const url = `${srv.base}/api/admin/population`;
    // The public allow-list must not open admin to the client site.
    expect((await fetch(url, { headers: { ...auth, origin: "https://santinh.com" } })).status).toBe(403);
    expect((await fetch(url, { headers: { ...auth, origin: "https://evil.example" } })).status).toBe(403);
    expect((await fetch(url, { headers: { ...auth, origin: srv.base } })).status).toBe(200);
  });

  it("body over 4 KB → 413 (declared or streamed)", async () => {
    srv = await start({ ADMIN_PASSWORD: pw });
    const big = JSON.stringify({ ...DEFAULT_POPULATION, pad: "x".repeat(5000) });
    const res = await fetch(`${srv.base}/api/admin/population`, { method: "PUT", headers: auth, body: big });
    expect(res.status).toBe(413);

    // No Content-Length: the limit must hold while streaming too.
    const status = await new Promise<number>((ok, fail) => {
      const req = request({ host: "127.0.0.1", port: srv?.port, path: "/api/admin/population", method: "PUT", headers: auth }, (r) => {
        ok(r.statusCode ?? 0);
        r.resume();
      });
      req.on("error", fail);
      for (let i = 0; i < 5; i++) req.write("x".repeat(1024));
      req.end();
    });
    expect(status).toBe(413);
  });
});

describe("AdminAuth window", () => {
  it("failures older than 60 s stop counting", () => {
    let now = 1_000_000;
    const auth = new AdminAuth("secret-in-test", () => now);
    for (let i = 0; i < ADMIN_MAX_FAILS; i++) expect(auth.check("1.2.3.4", "Bearer x")).toBe("unauthorized");
    expect(auth.check("1.2.3.4", "Bearer secret-in-test")).toBe("limited");
    expect(auth.check("5.6.7.8", "Bearer secret-in-test")).toBe("ok");
    now += 60_000;
    // The auth scheme is case-insensitive (RFC 7235).
    expect(auth.check("1.2.3.4", "bearer secret-in-test")).toBe("ok");
  });
});
