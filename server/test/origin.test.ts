import { afterEach, describe, expect, it } from "vitest";
import { ROOM_CAPACITY } from "@santinh/shared";
import { isAllowedOrigin } from "../src/origin.ts";
import { loadConfig } from "../src/config.ts";
import { TestClient, startServer, upgradeStatus, type TestServer } from "./helpers.ts";

describe("isAllowedOrigin", () => {
  it("empty list = same origin only", () => {
    expect(isAllowedOrigin("http://localhost:4663", "localhost:4663", [])).toBe(true);
    expect(isAllowedOrigin("http://localhost:4664", "localhost:4663", [])).toBe(false);
    expect(isAllowedOrigin(undefined, "localhost:4663", [])).toBe(true); // non-browser client
  });

  it("exact match and scheme", () => {
    const list = ["https://santinh.com"];
    expect(isAllowedOrigin("https://santinh.com", "rt.santinh.com", list)).toBe(true);
    expect(isAllowedOrigin("http://santinh.com", "rt.santinh.com", list)).toBe(false);
    expect(isAllowedOrigin("https://santinh.com.evil.com", "rt.santinh.com", list)).toBe(false);
  });

  it("wildcard stays inside one host label", () => {
    const list = ["https://*-team.vercel.app"];
    expect(isAllowedOrigin("https://santinh-git-dev-team.vercel.app", "x", list)).toBe(true);
    expect(isAllowedOrigin("https://evil-team.vercel.app.attacker.com", "x", list)).toBe(false);
    expect(isAllowedOrigin("https://a.b-team.vercel.app", "x", list)).toBe(false);
    expect(isAllowedOrigin("http://x-team.vercel.app", "x", list)).toBe(false);
  });

  it("garbage origin is refused", () => {
    expect(isAllowedOrigin("null", "x", ["https://a.com"])).toBe(false);
    expect(isAllowedOrigin("https://a.com/path", "x", ["https://a.com/path"])).toBe(false);
  });
});

describe("loadConfig", () => {
  it("defaults", () => {
    expect(loadConfig({})).toMatchObject({ port: 4663, capacity: ROOM_CAPACITY, fakePopulation: true, allowedOrigins: [], staticDir: "" });
  });
  it("rejects bad values", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/PORT/);
    expect(() => loadConfig({ CAPACITY: "0" })).toThrow(/CAPACITY/);
    expect(() => loadConfig({ FAKE_POPULATION: "maybe" })).toThrow(/FAKE_POPULATION/);
  });
  it("parses the origin list", () => {
    expect(loadConfig({ ALLOWED_ORIGINS: " https://a.com , https://b.com ," }).allowedOrigins).toEqual(["https://a.com", "https://b.com"]);
  });
  it("normalizes origin typos instead of silently rejecting every browser", () => {
    const list = loadConfig({ ALLOWED_ORIGINS: "https://Santinh.com/,HTTPS://*-Team.vercel.app/" }).allowedOrigins;
    expect(list).toEqual(["https://santinh.com", "https://*-team.vercel.app"]);
    expect(isAllowedOrigin("https://santinh.com", "rt.santinh.com", list)).toBe(true);
    expect(isAllowedOrigin("https://pr-1-team.vercel.app", "rt.santinh.com", list)).toBe(true);
  });
  it("rejects entries that are not origins", () => {
    for (const bad of ["santinh.com", "https://a.com/path", "https://a.com?x=1", "https://*.*.com", "http*://a.com", "https://u@a.com"]) {
      expect(() => loadConfig({ ALLOWED_ORIGINS: bad }), bad).toThrow(/ALLOWED_ORIGINS/);
    }
  });
  it("per-IP cap and proxy trust", () => {
    expect(loadConfig({})).toMatchObject({ maxConnPerIpRoom: 10, trustProxy: false });
    expect(loadConfig({ MAX_CONN_PER_IP_ROOM: "0", TRUST_PROXY: "on" })).toMatchObject({ maxConnPerIpRoom: 0, trustProxy: true });
    expect(() => loadConfig({ MAX_CONN_PER_IP_ROOM: "-1" })).toThrow(/MAX_CONN_PER_IP_ROOM/);
    // The old per-IP name must not be silently ignored on a server that still sets it.
    expect(() => loadConfig({ MAX_CONN_PER_IP: "8" })).toThrow(/MAX_CONN_PER_IP_ROOM/);
    expect(() => loadConfig({ TRUST_PROXY: "yes" })).toThrow(/TRUST_PROXY/);
  });
});

describe("http", () => {
  let srv: TestServer;
  afterEach(async () => {
    await srv.stop();
  });

  it("foreign Origin on /ws → 403 when ALLOWED_ORIGINS is set; allowed one → 101", async () => {
    srv = await startServer({ ALLOWED_ORIGINS: "https://santinh.com" });
    expect(await upgradeStatus(srv.port, "/ws?room=san-01", { Origin: "https://evil.com" })).toBe(403);
    expect(await upgradeStatus(srv.port, "/ws?room=san-01", { Origin: "https://santinh.com" })).toBe(101);
  });

  it("/api/rooms: 10 rooms, CORS only for an allowed origin; OPTIONS → 204", async () => {
    srv = await startServer({ ALLOWED_ORIGINS: "https://santinh.com" });
    const base = `http://127.0.0.1:${srv.port}`;
    const ok = await fetch(`${base}/api/rooms`, { headers: { Origin: "https://santinh.com" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://santinh.com");
    const body = (await ok.json()) as { rooms: unknown[] };
    expect(body.rooms).toHaveLength(10);
    const bad = await fetch(`${base}/api/rooms`, { headers: { Origin: "https://evil.com" } });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    const pre = await fetch(`${base}/api/rooms`, { method: "OPTIONS", headers: { Origin: "https://santinh.com" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://santinh.com");
    const ping = (await (await fetch(`${base}/api/ping`)).json()) as { ok: boolean; serverTime: number };
    expect(ping.ok).toBe(true);
  });

  it("per IP per room: the extra socket is told `too-many` (4002); other rooms and a freed slot are fine", async () => {
    srv = await startServer({ MAX_CONN_PER_IP_ROOM: "2" });
    const a = srv.connect("san-01");
    const b = srv.connect("san-01");
    await a.until(() => a.snapshot() !== undefined);
    await b.until(() => b.snapshot() !== undefined);
    const c = srv.connect("san-01");
    await c.until(() => c.closeCode !== null);
    expect(c.json).toEqual([expect.objectContaining({ type: "error", code: "too-many" })]);
    expect(c.closeCode).toBe(4002);
    // Same IP, another room (a room switch holds both for a moment): not counted against san-01.
    const d = srv.connect("san-02");
    await d.until(() => d.snapshot() !== undefined);
    a.ws.close();
    await a.until(() => a.closeCode !== null);
    await new Promise((ok) => setTimeout(ok, 50));
    const e = srv.connect("san-01");
    await e.until(() => e.snapshot() !== undefined);
  });

  it("at the cap, reconnecting with our own live socket's resume token is let in (it replaces, not adds)", async () => {
    srv = await startServer({ MAX_CONN_PER_IP_ROOM: "1" });
    const a = srv.connect("san-01");
    await a.until(() => a.snapshot() !== undefined);
    const b = new TestClient(`ws://127.0.0.1:${srv.port}/ws?room=san-01&resume=${a.snapshot()!.resume}`);
    srv.clients.push(b);
    await b.until(() => b.snapshot() !== undefined);
    expect(b.snapshot()!.selfId).toBe(a.snapshot()!.selfId);
    await a.until(() => a.closeCode !== null);
    // A made-up token does not get around the cap.
    const c = new TestClient(`ws://127.0.0.1:${srv.port}/ws?room=san-01&resume=${"A".repeat(22)}`);
    srv.clients.push(c);
    await c.until(() => c.closeCode !== null);
    expect(c.closeCode).toBe(4002);
  });

  it("TRUST_PROXY: counts by the last X-Forwarded-For entry, ignores a forged first one", async () => {
    srv = await startServer({ MAX_CONN_PER_IP_ROOM: "1", TRUST_PROXY: "on" });
    const a = srv.connect("san-01", { "X-Forwarded-For": "1.1.1.1" });
    await a.until(() => a.snapshot() !== undefined);
    const forged = srv.connect("san-01", { "X-Forwarded-For": "9.9.9.9, 1.1.1.1" });
    await forged.until(() => forged.closeCode !== null);
    expect(forged.closeCode).toBe(4002);
    const other = srv.connect("san-01", { "X-Forwarded-For": "2.2.2.2" });
    await other.until(() => other.snapshot() !== undefined);
  });

  it("no STATIC_DIR → 404 for pages", async () => {
    srv = await startServer();
    expect((await fetch(`http://127.0.0.1:${srv.port}/`)).status).toBe(404);
  });
});
