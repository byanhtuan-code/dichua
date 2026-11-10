import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { CHAT_HISTORY, CHAT_LIMITS, type ServerMsg } from "@santinh/shared";
import { Accounts } from "../src/accounts.ts";
import { loadConfig } from "../src/config.ts";
import { createAppServer } from "../src/http.ts";
import { RoomHub } from "../src/hub.ts";
import { TestClient } from "./helpers.ts";

type Msg<T extends ServerMsg["type"]> = Extract<ServerMsg, { type: T }>;

/** Server with a shared Accounts and a hand-moved clock, so cooldowns need no real waiting. */
interface ChatServer {
  accounts: Accounts;
  clients: TestClient[];
  advance(ms: number): void;
  connect(room: string, name?: string): TestClient;
  stop(): Promise<void>;
}

let srv: ChatServer;

async function startChatServer(): Promise<ChatServer> {
  let now = Date.now();
  const clock = (): number => now;
  const config = loadConfig({ PORT: "0", FAKE_POPULATION: "off", MAX_CONN_PER_IP_ROOM: "0" });
  const accounts = new Accounts("", clock);
  const hub = new RoomHub(config.capacity, clock, config.fakePopulation, undefined, undefined, accounts);
  const server: Server = createAppServer(config, hub, clock, undefined, undefined, accounts);
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  const port = (server.address() as AddressInfo).port;
  const clients: TestClient[] = [];
  return {
    accounts,
    clients,
    advance(ms) {
      now += ms;
    },
    connect(room, name) {
      const q = name ? `&name=${encodeURIComponent(name)}` : "";
      const c = new TestClient(`ws://127.0.0.1:${port}/ws?room=${room}${q}`);
      clients.push(c);
      return c;
    },
    async stop() {
      for (const c of clients) c.ws.terminate();
      hub.closeAll(1001);
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
      accounts.close();
    },
  };
}

afterEach(async () => {
  await srv.stop();
});

/** Fresh random credentials every run: nothing secret is fixed in the test. */
async function newAccount(displayName = "Mây"): Promise<string> {
  const username = "u" + randomBytes(6).toString("hex");
  const signed = await srv.accounts.register(username, randomBytes(12).toString("base64url"), displayName);
  if (typeof signed === "string") throw new Error(signed);
  return signed.token;
}

function all<T extends ServerMsg["type"]>(c: TestClient, type: T): Msg<T>[] {
  return c.json.filter((m): m is Msg<T> => m.type === type);
}

function last<T extends ServerMsg["type"]>(c: TestClient, type: T): Msg<T> | undefined {
  return all(c, type).at(-1);
}

function send(c: TestClient, msg: object): void {
  c.ws.send(JSON.stringify(msg));
}

async function joined(c: TestClient): Promise<TestClient> {
  await c.until(() => c.snapshot() !== undefined);
  return c;
}

/** Joins, signs in, waits for the `account` reply. */
async function signedIn(room: string, token: string, name?: string): Promise<TestClient> {
  const c = await joined(srv.connect(room, name));
  send(c, { type: "auth", token });
  await c.until(() => last(c, "account") !== undefined);
  return c;
}

async function denied(c: TestClient, text: string): Promise<Msg<"chat-denied">> {
  const before = all(c, "chat-denied").length;
  send(c, { type: "chat", text });
  await c.until(() => all(c, "chat-denied").length > before);
  const d = last(c, "chat-denied");
  if (!d) throw new Error("no chat-denied");
  return d;
}

async function chatted(c: TestClient, text: string, count: number): Promise<Msg<"chat">> {
  send(c, { type: "chat", text });
  await c.until(() => all(c, "chat").length >= count);
  const m = all(c, "chat")[count - 1];
  if (!m) throw new Error("no chat");
  return m;
}

describe("auth", () => {
  it("answers account, puts on the account's name; a bad token → account null", async () => {
    srv = await startChatServer();
    const token = await newAccount("Sương Sớm");
    const watcher = await joined(srv.connect("san-04"));
    const c = await signedIn("san-04", token, "Khách");
    const acc = last(c, "account")?.account;
    expect(acc?.displayName).toBe("Sương Sớm");
    expect(acc?.tier).toBe("free");
    expect(acc?.username).toMatch(/^u[0-9a-f]{12}$/);
    const selfId = c.snapshot()?.selfId;
    await watcher.until(() => watcher.frames.some((f) => f.profiles.some((p) => p.id === selfId && p.name === "Sương Sớm")));
    // The username goes to its owner only.
    expect(watcher.json.some((m) => JSON.stringify(m).includes(acc?.username ?? "-"))).toBe(false);

    const other = await joined(srv.connect("san-04"));
    send(other, { type: "auth", token: randomBytes(32).toString("base64url") });
    await other.until(() => last(other, "account") !== undefined);
    expect(last(other, "account")?.account).toBeNull();
  });

  it("auth null signs out in place: same id, chat → login", async () => {
    srv = await startChatServer();
    const c = await signedIn("san-05", await newAccount());
    const id = c.snapshot()?.selfId;
    send(c, { type: "auth", token: null });
    await c.until(() => all(c, "account").length === 2);
    expect(last(c, "account")?.account).toBeNull();
    expect((await denied(c, "còn đó không")).reason).toBe("login");
    expect(c.closeCode).toBeNull();
    send(c, { type: "sync" });
    await c.until(() => c.json.filter((m) => m.type === "snapshot").length === 2);
    expect(c.json.filter((m): m is Msg<"snapshot"> => m.type === "snapshot").at(-1)?.selfId).toBe(id);
  });

  it("ignores a second token auth within a second, but never a sign-out", async () => {
    srv = await startChatServer();
    const token = await newAccount();
    const c = await signedIn("san-05", token);
    send(c, { type: "auth", token });
    send(c, { type: "ping", clientTime: 1 });
    await c.until(() => last(c, "pong") !== undefined);
    expect(all(c, "account")).toHaveLength(1);
    send(c, { type: "auth", token: null });
    await c.until(() => all(c, "account").length === 2);
    expect(last(c, "account")?.account).toBeNull();
  });

  it("a rename while signed in is saved to the account", async () => {
    srv = await startChatServer();
    const token = await newAccount("Lá Trúc");
    const c = await signedIn("san-06", token);
    srv.advance(10_000); // past the rename cooldown started by auth
    send(c, { type: "rename", name: "Hoa Sen" });
    const selfId = c.snapshot()?.selfId;
    await c.until(() => c.frames.some((f) => f.profiles.some((p) => p.id === selfId && p.name === "Hoa Sen")));
    expect(srv.accounts.bySession(token)?.account.displayName).toBe("Hoa Sen");
  });
});

describe("chat", () => {
  it("guest → login; quiet room → quiet-room, and no history there", async () => {
    srv = await startChatServer();
    const guest = await joined(srv.connect("san-04"));
    await guest.until(() => last(guest, "chat-history") !== undefined);
    expect(last(guest, "chat-history")?.lines).toEqual([]);
    expect((await denied(guest, "chào")).reason).toBe("login");

    const quiet = await signedIn("san-01", await newAccount());
    expect(all(quiet, "chat-history")).toHaveLength(0);
    expect((await denied(quiet, "chào")).reason).toBe("quiet-room");
  });

  it("a line reaches everyone in the room, sender included; rude words are masked", async () => {
    srv = await startChatServer();
    const guest = await joined(srv.connect("san-04"));
    const c = await signedIn("san-04", await newAccount("Mây Trắng"));
    const mine = await chatted(c, "  xin   chào fuck  ", 1);
    await guest.until(() => all(guest, "chat").length === 1);
    expect(all(guest, "chat")[0]?.line).toEqual(mine.line);
    expect(mine.line.text).toBe("xin chào ***");
    expect(mine.line.name).toBe("Mây Trắng");
    expect(mine.line.visitorId).toBe(c.snapshot()?.selfId);
    expect(Object.keys(mine.line).sort()).toEqual(["at", "id", "name", "text", "visitorId"]);
  });

  it("too-fast with retryInMs, duplicate, too-long, empty", async () => {
    srv = await startChatServer();
    const c = await signedIn("san-07", await newAccount());
    await chatted(c, "một", 1);
    const fast = await denied(c, "hai");
    expect(fast.reason).toBe("too-fast");
    expect(fast.retryInMs).toBeGreaterThan(0);
    expect(fast.retryInMs).toBeLessThanOrEqual(CHAT_LIMITS.free.cooldownMs);
    srv.advance(CHAT_LIMITS.free.cooldownMs);
    expect((await denied(c, "MỘT")).reason).toBe("duplicate");
    expect((await denied(c, "a".repeat(CHAT_LIMITS.free.maxChars + 1))).reason).toBe("too-long");
    expect((await denied(c, " ​ ")).reason).toBe("empty");
    await chatted(c, "a".repeat(CHAT_LIMITS.free.maxChars), 2);
  });

  it("a newcomer gets the last 30 lines in order, right after the snapshot", async () => {
    srv = await startChatServer();
    const tokens = await Promise.all(Array.from({ length: 7 }, () => newAccount()));
    const senders = await Promise.all(tokens.map((t) => signedIn("san-08", t)));
    let n = 0;
    // Each account may send 5 per 30 s: spread 35 lines over 7 accounts, 3 s apart.
    for (let round = 0; round < 5; round++) {
      for (const s of senders) {
        n++;
        send(s, { type: "chat", text: `tin ${n}` });
      }
      await senders[0]?.until(() => all(senders[0] as TestClient, "chat").length === n);
      srv.advance(CHAT_LIMITS.free.cooldownMs);
    }
    const late = await joined(srv.connect("san-08"));
    await late.until(() => last(late, "chat-history") !== undefined);
    const snapAt = late.json.findIndex((m) => m.type === "snapshot");
    expect(late.json[snapAt + 1]?.type).toBe("chat-history");
    const lines = last(late, "chat-history")?.lines ?? [];
    expect(lines).toHaveLength(CHAT_HISTORY);
    expect(lines.map((l) => l.text)).toEqual(Array.from({ length: CHAT_HISTORY }, (_, i) => `tin ${n - CHAT_HISTORY + i + 1}`));
  });

  it("a room change keeps the cooldown (throttle is per account)", async () => {
    srv = await startChatServer();
    const token = await newAccount();
    const a = await signedIn("san-04", token);
    await chatted(a, "ở phòng 4", 1);
    a.ws.close();
    const b = await signedIn("san-09", token);
    expect((await denied(b, "ở phòng 9")).reason).toBe("too-fast");
  });
});
