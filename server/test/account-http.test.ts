import { randomBytes } from "node:crypto";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOGIN_FAILS_PER_MIN, REGISTER_PER_IP_PER_DAY, type AccountView } from "@santinh/shared";
import { IpWindow } from "../src/account-http.ts";
import { Accounts } from "../src/accounts.ts";
import { loadConfig } from "../src/config.ts";
import { createAppServer } from "../src/http.ts";
import { RoomHub } from "../src/hub.ts";
import { PopulationStore } from "../src/population-store.ts";
import { RoomNamesStore } from "../src/room-names-store.ts";

interface Running {
  base: string;
  port: number;
  stop(): Promise<void>;
}

async function start(env: Record<string, string> = {}): Promise<Running> {
  const config = loadConfig({ PORT: "0", FAKE_POPULATION: "off", ...env });
  const store = new PopulationStore("", config.capacity);
  const names = new RoomNamesStore("");
  const accounts = new Accounts("");
  const hub = new RoomHub(config.capacity, Date.now, config.fakePopulation, () => store.current, () => names.current);
  const server: Server = createAppServer(config, hub, Date.now, store, names, accounts);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    port,
    async stop() {
      hub.closeAll(1001);
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
      accounts.close();
    },
  };
}

// Generated per run: no real password or token ever sits in the repo.
const pw = (): string => randomBytes(12).toString("base64url");
const JSON_HEADERS = { "content-type": "application/json" };

interface Signed {
  token: string;
  account: AccountView;
}

describe("account API", () => {
  let srv: Running | null = null;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
    fetch(`${srv?.base}/api/account/${path}`, { method: "POST", headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body) });
  const me = (token: string): Promise<Response> => fetch(`${srv?.base}/api/account/me`, { headers: { authorization: `Bearer ${token}` } });

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(async () => {
    await srv?.stop();
    srv = null;
    vi.restoreAllMocks();
  });

  it("register → me → logout → me 401", async () => {
    srv = await start();
    const reg = await post("register", { username: "thu_nghiem", password: pw(), displayName: "An" });
    expect(reg.status).toBe(201);
    const { token, account } = (await reg.json()) as Signed;
    expect(account).toEqual({ username: "thu_nghiem", displayName: "An", tier: "free" });

    const got = await me(token);
    expect(got.status).toBe(200);
    expect(((await got.json()) as { account: AccountView }).account.username).toBe("thu_nghiem");

    expect((await post("logout", {}, { authorization: `Bearer ${token}` })).status).toBe(204);
    const after = await me(token);
    expect(after.status).toBe(401);
    expect(((await after.json()) as { error: string }).error).toBe("unauthorized");
    expect((await fetch(`${srv.base}/api/account/me`)).status).toBe(401);
  });

  it("taken name → 409; bad input → 400; broken JSON → 400", async () => {
    srv = await start();
    expect((await post("register", { username: "minh", password: pw(), displayName: "Minh" })).status).toBe(201);
    const dup = await post("register", { username: "MINH", password: pw(), displayName: "Khác" });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { error: string }).error).toBe("username-taken");
    const bad = await post("register", { username: "m", password: pw(), displayName: "Minh" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("bad-input");
    expect((await post("register", [1, 2])).status).toBe(400);
    const broken = await fetch(`${srv.base}/api/account/register`, { method: "POST", headers: JSON_HEADERS, body: "{oops" });
    expect(broken.status).toBe(400);
  });

  it("login: right → 200; wrong password and unknown name → the same 401", async () => {
    srv = await start();
    const p = pw();
    await post("register", { username: "lan", password: p, displayName: "Lan" });
    const ok = await post("login", { username: "lan", password: p });
    expect(ok.status).toBe(200);
    expect((await me(((await ok.json()) as Signed).token)).status).toBe(200);

    const wrong = await post("login", { username: "lan", password: pw() });
    const nobody = await post("login", { username: "khong_co", password: p });
    expect(wrong.status).toBe(401);
    expect(nobody.status).toBe(401);
    expect(await wrong.json()).toEqual(await nobody.json());
  });

  it("register per IP: the 4th → 429 with retryAfterMs; 0 = no limit", async () => {
    srv = await start();
    for (let i = 0; i < REGISTER_PER_IP_PER_DAY; i++) {
      expect((await post("register", { username: `nguoi_${i}`, password: pw(), displayName: "An" })).status).toBe(201);
    }
    const limited = await post("register", { username: "nguoi_x", password: pw(), displayName: "An" });
    expect(limited.status).toBe(429);
    const body = (await limited.json()) as { error: string; retryAfterMs: number };
    expect(body.error).toBe("rate-limit");
    expect(body.retryAfterMs).toBeGreaterThan(0);
    await srv.stop();

    srv = await start({ REGISTER_PER_IP_PER_DAY: "0" });
    for (let i = 0; i <= REGISTER_PER_IP_PER_DAY; i++) {
      expect((await post("register", { username: `khach_${i}`, password: pw(), displayName: "An" })).status).toBe(201);
    }
  });

  it("failed logins per IP: after 10 → 429 even with the right password", async () => {
    srv = await start();
    const p = pw();
    await post("register", { username: "hoa", password: p, displayName: "Hoa" });
    for (let i = 0; i < LOGIN_FAILS_PER_MIN; i++) expect((await post("login", { username: "hoa", password: pw() })).status).toBe(401);
    expect((await post("login", { username: "hoa", password: p })).status).toBe(429);
  });

  it("parallel requests from one IP cannot slip past the limits while the hash runs", async () => {
    srv = await start();
    const regs = await Promise.all(
      Array.from({ length: REGISTER_PER_IP_PER_DAY + 3 }, (_, i) => post("register", { username: `song_song_${i}`, password: pw(), displayName: "An" })),
    );
    expect(regs.filter((r) => r.status === 201)).toHaveLength(REGISTER_PER_IP_PER_DAY);
    expect(regs.filter((r) => r.status === 429)).toHaveLength(3);

    const logins = await Promise.all(
      Array.from({ length: LOGIN_FAILS_PER_MIN + 5 }, () => post("login", { username: "song_song_0", password: pw() })),
    );
    expect(logins.filter((r) => r.status === 401)).toHaveLength(LOGIN_FAILS_PER_MIN);
    expect(logins.filter((r) => r.status === 429)).toHaveLength(5);
  });

  it("a taken name or a right password does not use up the IP's slots", async () => {
    srv = await start();
    const p = pw();
    expect((await post("register", { username: "dau_tien", password: p, displayName: "An" })).status).toBe(201);
    for (let i = 0; i < REGISTER_PER_IP_PER_DAY + 2; i++) {
      expect((await post("register", { username: "dau_tien", password: pw(), displayName: "An" })).status).toBe(409);
    }
    for (let i = 0; i < LOGIN_FAILS_PER_MIN + 2; i++) expect((await post("login", { username: "dau_tien", password: p })).status).toBe(200);
    expect((await post("register", { username: "thu_hai", password: pw(), displayName: "An" })).status).toBe(201);
  });

  it("body over 2 KB → 413 (declared or streamed)", async () => {
    srv = await start();
    const res = await post("register", { username: "big", password: pw(), displayName: "x".repeat(3000) });
    expect(res.status).toBe(413);
    const status = await new Promise<number>((ok, fail) => {
      const req = request({ host: "127.0.0.1", port: srv?.port, path: "/api/account/login", method: "POST" }, (r) => {
        ok(r.statusCode ?? 0);
        r.resume();
      });
      req.on("error", fail);
      for (let i = 0; i < 3; i++) req.write("x".repeat(1024));
      req.end();
    });
    expect(status).toBe(413);
  });

  it("wrong method → 405; unknown route → 404", async () => {
    srv = await start();
    expect((await fetch(`${srv.base}/api/account/register`)).status).toBe(405);
    expect((await post("me", {})).status).toBe(405);
    expect((await post("nope", {})).status).toBe(404);
  });

  it("CORS: preflight from an allowed origin allows POST + authorization; responses carry the origin", async () => {
    srv = await start({ ALLOWED_ORIGINS: "https://santinh.com" });
    const pre = await fetch(`${srv.base}/api/account/me`, {
      method: "OPTIONS",
      headers: { origin: "https://santinh.com", "access-control-request-method": "GET", "access-control-request-headers": "authorization" },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBe("https://santinh.com");
    expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
    expect(pre.headers.get("access-control-allow-headers")).toContain("authorization");

    const reg = await post("register", { username: "cors_ok", password: pw(), displayName: "An" }, { origin: "https://santinh.com" });
    expect(reg.status).toBe(201);
    expect(reg.headers.get("access-control-allow-origin")).toBe("https://santinh.com");
    const evil = await post("login", { username: "cors_ok", password: pw() }, { origin: "https://evil.example" });
    expect(evil.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("IpWindow", () => {
  it("counts per IP, frees as hits leave the window, 0 = off", () => {
    const w = new IpWindow(2, 1000);
    w.record("a", 0);
    w.record("a", 100);
    expect(w.retryAfterMs("a", 200)).toBe(800);
    expect(w.retryAfterMs("b", 200)).toBe(0);
    expect(w.retryAfterMs("a", 999)).toBe(1);
    expect(w.retryAfterMs("a", 1000)).toBe(0);
    const off = new IpWindow(0, 1000);
    off.record("a", 0);
    expect(off.retryAfterMs("a", 0)).toBe(0);
  });
});
