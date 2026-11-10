import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_NAMES, encodeDelta, spaceOf, type DeltaFrame, type ConnectionStatus, type ServerMsg, type WireVisitor } from "@santinh/shared";
import { WebSocketNetDriver, parseServerMsg } from "./ws-driver.ts";

class FakeSocket {
  static all: FakeSocket[] = [];
  binaryType = "blob";
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closedWith: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
  }
  send(text: string): void {
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
  }
  close(code?: number): void {
    this.closedWith = code ?? 1000;
    this.readyState = 3;
    this.onclose?.();
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  json(msg: ServerMsg): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  binary(frame: DeltaFrame): void {
    this.onmessage?.({ data: encodeDelta(frame) });
  }
  drop(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

const last = (): FakeSocket => FakeSocket.all[FakeSocket.all.length - 1] as FakeSocket;
const wire = (id: string, slot: number, cushion: number | null = null): WireVisitor => ({
  id,
  slot,
  name: id,
  color: "#fff",
  joinedAt: 1,
  pose: "walk",
  cushion,
  position: { x: 1, z: 2, yaw: 0 },
});
const snapshot = (room: string, visitors: WireVisitor[], revision = 0, reserved: number | null = null, resume = ""): ServerMsg => ({
  type: "snapshot",
  room,
  selfId: "me",
  revision,
  serverTime: 5000,
  visitors,
  reserved,
  resume,
});
const delta = (room: string, revision: number, extra: Partial<DeltaFrame> = {}): DeltaFrame => ({
  revision,
  serverTime: 6000,
  room,
  profiles: [],
  removed: [],
  records: [],
  ...extra,
});

let driver: WebSocketNetDriver;
let statuses: ConnectionStatus[];

function connected(room = "san-01", visitors: WireVisitor[] = [wire("me", 4)]): FakeSocket {
  driver.connect(room);
  const s = last();
  s.open();
  s.json(snapshot(room, visitors));
  return s;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("location", { origin: "http://localhost:4663" });
  FakeSocket.all = [];
  driver = new WebSocketNetDriver({ random: () => 0.5 });
  statuses = [];
  driver.on("status", (s) => statuses.push(s));
});

afterEach(() => {
  driver.disconnect();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("connect", () => {
  it("connecting → snapshot → connected; slot is stripped", () => {
    const snaps: unknown[] = [];
    driver.on("snapshot", (s) => snaps.push(s));
    driver.connect("san-02");
    expect(last().url).toBe("ws://localhost:4663/ws?room=san-02");
    expect(last().binaryType).toBe("arraybuffer");
    last().open();
    expect(statuses).toEqual(["connecting"]);
    last().json(snapshot("san-02", [wire("me", 4)]));
    expect(statuses).toEqual(["connecting", "connected"]);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ selfId: "me", room: "san-02", visitors: [{ id: "me" }] });
    expect(snaps[0] as { visitors: object[] }).not.toHaveProperty("visitors.0.slot");
  });

  it("reconnects with backoff 700, 1400, 2800 and resets after a snapshot", () => {
    connected();
    last().drop();
    expect(statuses.at(-1)).toBe("reconnecting");
    for (const wait of [700, 1400, 2800]) {
      const n = FakeSocket.all.length;
      vi.advanceTimersByTime(wait - 1);
      expect(FakeSocket.all).toHaveLength(n);
      vi.advanceTimersByTime(1);
      expect(FakeSocket.all).toHaveLength(n + 1);
      last().drop();
    }
    vi.advanceTimersByTime(5600);
    last().open();
    last().json(snapshot("san-01", [wire("me", 4)]));
    expect(statuses.at(-1)).toBe("connected");
    last().drop();
    const n = FakeSocket.all.length;
    vi.advanceTimersByTime(700);
    expect(FakeSocket.all).toHaveLength(n + 1);
  });

  it("caps the backoff at 15 s", () => {
    driver.connect("san-01");
    for (let i = 0; i < 8; i++) {
      last().drop();
      vi.advanceTimersByTime(15_000 * 1.2);
    }
    const n = FakeSocket.all.length;
    last().drop();
    vi.advanceTimersByTime(14_999);
    expect(FakeSocket.all).toHaveLength(n);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(n + 1);
  });

  it("room-full → full, retries after 8–12 s, then connects", () => {
    driver.connect("san-03");
    last().open();
    last().json({ type: "error", code: "room-full", serverTime: 1 });
    expect(statuses).toEqual(["connecting", "full"]);
    const n = FakeSocket.all.length;
    vi.advanceTimersByTime(9999);
    expect(FakeSocket.all).toHaveLength(n);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(n + 1);
    last().open();
    last().json(snapshot("san-03", [wire("me", 4)]));
    expect(statuses.at(-1)).toBe("connected");
  });

  it("too-many (our network has too many people there) → limited, not 'reconnecting'; retries like a full room", () => {
    driver.connect("san-03");
    last().open();
    last().json({ type: "error", code: "too-many", serverTime: 1 });
    expect(statuses).toEqual(["connecting", "limited"]);
    const n = FakeSocket.all.length;
    vi.advanceTimersByTime(9999);
    expect(FakeSocket.all).toHaveLength(n);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.all).toHaveLength(n + 1);
  });

  it("connecting to another room stops the full retry", () => {
    driver.connect("san-03");
    last().json({ type: "error", code: "room-full", serverTime: 1 });
    driver.connect("san-04");
    const n = FakeSocket.all.length;
    vi.advanceTimersByTime(30_000);
    // san-04 never answers, so it may be retried as a dead link; san-03 must never be tried again.
    expect(FakeSocket.all.slice(n).every((x) => x.url.includes("room=san-04"))).toBe(true);
  });

  it("disconnect closes with 1000 and cancels timers", () => {
    const s = connected();
    driver.disconnect();
    expect(s.closedWith).toBe(1000);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("delta", () => {
  it("merges profiles and records into visitors, tracks removed", () => {
    connected();
    const updates: { visitors: { id: string; cushion: number | null; bowAt?: number }[]; removed: string[] }[] = [];
    driver.on("update", (u) => updates.push(u));
    last().binary(
      delta("san-01", 1, {
        profiles: [{ slot: 9, id: "v:a", name: "A", color: "#abc", joinedAt: 3 }],
        records: [{ slot: 9, cushion: 2, pose: "kneel", x: 4, z: 5, yaw: 1, bowAt: 77 }],
      }),
    );
    last().binary(delta("san-01", 2, { removed: ["v:a"] }));
    expect(updates[0]?.visitors).toEqual([
      { id: "v:a", name: "A", color: "#abc", joinedAt: 3, pose: "kneel", cushion: 2, position: { x: 4, z: 5, yaw: 1 }, bowAt: 77 },
    ]);
    expect(updates[1]?.removed).toEqual(["v:a"]);
  });

  it("uses slots from the snapshot for later records", () => {
    connected("san-01", [wire("me", 4), wire("resident:0", 0, 1)]);
    const updates: { visitors: { id: string }[] }[] = [];
    driver.on("update", (u) => updates.push(u));
    last().binary(delta("san-01", 1, { records: [{ slot: 0, cushion: 1, pose: "kneel", x: 0, z: 0, yaw: 0 }] }));
    expect(updates[0]?.visitors[0]?.id).toBe("resident:0");
  });

  it("a revision gap sends sync and ignores deltas until the snapshot", () => {
    const s = connected();
    const updates: unknown[] = [];
    driver.on("update", (u) => updates.push(u));
    s.binary(delta("san-01", 3));
    expect(s.sent.filter((m) => m["type"] === "sync")).toHaveLength(1);
    s.binary(delta("san-01", 4));
    expect(updates).toHaveLength(0);
    s.json(snapshot("san-01", [wire("me", 4)], 4));
    s.binary(delta("san-01", 5));
    expect(updates).toHaveLength(1);
  });

  it("drops stale, foreign-room and garbage frames", () => {
    const s = connected();
    const updates: unknown[] = [];
    driver.on("update", (u) => updates.push(u));
    s.binary(delta("san-01", 0));
    s.binary(delta("san-02", 1));
    s.onmessage?.({ data: new ArrayBuffer(10) });
    expect(updates).toHaveLength(0);
    expect(s.sent.filter((m) => m["type"] === "sync")).toHaveLength(0);
  });
});

describe("cushion from the wire is not trusted", () => {
  const count = spaceOf("san-01").cushions.length;

  it("snapshot / delta cushion out of range → not seated", () => {
    const snaps: { visitors: { cushion: number | null }[] }[] = [];
    driver.on("snapshot", (s) => snaps.push(s));
    const s = connected("san-01", [wire("me", 4, count), wire("a", 5, 0)]);
    expect(snaps[0]?.visitors.map((v) => v.cushion)).toEqual([null, 0]);
    const updates: { visitors: { cushion: number | null }[] }[] = [];
    driver.on("update", (u) => updates.push(u));
    s.binary(delta("san-01", 1, { records: [{ slot: 5, cushion: count + 3, pose: "kneel", x: 0, z: 0, yaw: 0 }] }));
    expect(updates[0]?.visitors[0]?.cushion).toBeNull();
  });

  it("seat-granted with a bad cushion → null", async () => {
    const s = connected();
    const p = driver.requestSeat();
    s.json({ type: "seat-granted", requestId: s.sent.at(-1)?.["requestId"] as number, cushion: count, serverTime: 1 });
    await expect(p).resolves.toBeNull();
  });
});

describe("seats", () => {
  it("granted resolves with the cushion", async () => {
    const s = connected();
    const p = driver.requestSeat();
    expect(s.sent.at(-1)).toEqual({ type: "seat", requestId: expect.any(Number) });
    s.json({ type: "seat-granted", requestId: s.sent.at(-1)?.["requestId"] as number, cushion: 3, serverTime: 1 });
    await expect(p).resolves.toBe(3);
  });

  it("a throttled move goes out right before the seat request (the server seats from its own position)", () => {
    const s = connected();
    driver.sendMove({ x: 1, z: 1, yaw: 0 }, "walk");
    driver.sendMove({ x: 4, z: 5, yaw: 0 }, "walk");
    void driver.requestSeat();
    expect(s.sent.slice(-2).map((m) => m["type"])).toEqual(["move", "seat"]);
    expect(s.sent.at(-2)).toMatchObject({ x: 4, z: 5 });
    vi.advanceTimersByTime(500);
    expect(s.sent.filter((m) => m["type"] === "move")).toHaveLength(2);
  });

  it("unavailable resolves null", async () => {
    const s = connected();
    const p = driver.requestSeat();
    s.json({ type: "seat-unavailable", requestId: s.sent.at(-1)?.["requestId"] as number, serverTime: 1 });
    await expect(p).resolves.toBeNull();
  });

  it("times out after 5 s and releases a grant that may still come", async () => {
    const s = connected();
    const p = driver.requestSeat();
    vi.advanceTimersByTime(5000);
    await expect(p).resolves.toBeNull();
    expect(s.sent.at(-1)).toEqual({ type: "stand" });
  });

  it("a resync snapshot carries the cushion the server still holds for us", () => {
    const s = connected();
    const snaps: { reserved: number | null }[] = [];
    driver.on("snapshot", (snap) => snaps.push(snap));
    s.json(snapshot("san-01", [wire("me", 4)], 3, 2));
    s.json(snapshot("san-01", [wire("me", 4)], 4, spaceOf("san-01").cushions.length));
    expect(snaps.map((x) => x.reserved)).toEqual([2, null]);
  });

  it("a snapshot from an older server (no `reserved`) means nothing reserved", () => {
    const raw = { type: "snapshot", room: "san-01", selfId: "me", revision: 0, serverTime: 1, visitors: [] };
    expect(parseServerMsg(JSON.stringify(raw))).toMatchObject({ reserved: null });
  });

  it("disconnect leaves no promise hanging", async () => {
    connected();
    const p = driver.requestSeat();
    driver.disconnect();
    await expect(p).resolves.toBeNull();
  });

  it("not connected → null at once", async () => {
    await expect(driver.requestSeat()).resolves.toBeNull();
  });
});

describe("resume", () => {
  const token = "T".repeat(22);
  const resumeOf = (s: FakeSocket): string | null => new URL(s.url).searchParams.get("resume");

  it("a reconnect to the same room sends the last snapshot's token; a fresh one replaces it", () => {
    const s = connected();
    expect(resumeOf(s)).toBeNull();
    s.json(snapshot("san-01", [wire("me", 4)], 1, null, token));
    s.drop();
    vi.advanceTimersByTime(700);
    expect(resumeOf(last())).toBe(token);
    last().open();
    last().json(snapshot("san-01", [wire("me", 4)], 0, null, "U".repeat(22)));
    last().drop();
    vi.advanceTimersByTime(700);
    expect(resumeOf(last())).toBe("U".repeat(22));
  });

  it("a back/forward-cache restore comes back as the same visitor", () => {
    const win = new EventTarget();
    vi.stubGlobal("window", win);
    const s = connected();
    s.json(snapshot("san-01", [wire("me", 4)], 1, null, token));
    win.dispatchEvent(new Event("pagehide"));
    win.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    expect(last()).not.toBe(s);
    expect(resumeOf(last())).toBe(token);
  });

  it("another room never gets the token; a server without resume gets none", () => {
    const s = connected();
    s.json(snapshot("san-01", [wire("me", 4)], 1, null, token));
    void driver.switchRoom("san-02");
    expect(resumeOf(last())).toBeNull();
    driver.disconnect();
    connected("san-03");
    last().drop();
    vi.advanceTimersByTime(700);
    expect(resumeOf(last())).toBeNull();
  });
});

describe("name", () => {
  const nameOf = (s: FakeSocket): string | null => new URL(s.url).searchParams.get("name");
  const renames = (s: FakeSocket): unknown[] => s.sent.filter((m) => m["type"] === "rename");

  it("no name set → no name in the URL", () => {
    expect(nameOf(connected())).toBeNull();
  });

  it("goes in the URL on the first connect, every reconnect and a room switch", () => {
    driver.setName("  Hoa   Sen ");
    const s = connected();
    expect(nameOf(s)).toBe("Hoa Sen");
    s.drop();
    vi.advanceTimersByTime(700);
    expect(nameOf(last())).toBe("Hoa Sen");
    last().open();
    last().json(snapshot("san-01", [wire("me", 4)]));
    void driver.switchRoom("san-02");
    expect(nameOf(last())).toBe("Hoa Sen");
    expect(renames(last())).toEqual([]);
  });

  it("while connected → a rename message, and later sockets carry the new name", () => {
    const s = connected();
    driver.setName("Mây");
    expect(renames(s)).toEqual([{ type: "rename", name: "Mây" }]);
    // Same (normalised) name or a blank one: nothing more goes out.
    driver.setName(" Mây ");
    driver.setName("  ");
    expect(renames(s)).toHaveLength(1);
    s.drop();
    vi.advanceTimersByTime(700);
    expect(nameOf(last())).toBe("Mây");
  });

  it("set while a socket is still opening: the old name was in its URL, so a rename follows its snapshot", async () => {
    driver.setName("An");
    connected();
    const p = driver.switchRoom("san-02");
    const next = last();
    driver.setName("Bình");
    next.open();
    next.json(snapshot("san-02", [wire("me", 4)]));
    await expect(p).resolves.toBe(true);
    expect(nameOf(next)).toBe("An");
    expect(renames(next)).toEqual([{ type: "rename", name: "Bình" }]);
  });
});

describe("switchRoom", () => {
  it("success: new snapshot promotes the second socket and closes the old one", async () => {
    const old = connected();
    const snaps: string[] = [];
    driver.on("snapshot", (s) => snaps.push(s.room));
    const p = driver.switchRoom("san-02");
    const next = last();
    expect(next).not.toBe(old);
    expect(old.closedWith).toBeNull();
    next.open();
    next.json(snapshot("san-02", [wire("me", 4)]));
    await expect(p).resolves.toBe(true);
    expect(old.closedWith).toBe(1000);
    expect(snaps).toEqual(["san-02"]);
    driver.hello();
    expect(next.sent.at(-1)).toEqual({ type: "hello" });
    // The old socket closing must not trigger a reconnect.
    const n = FakeSocket.all.length;
    // Keep the new link alive (pongs) so only a reconnect caused by the old socket could add one.
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(5_000);
      next.json({ type: "pong", clientTime: Date.now(), serverTime: Date.now() });
    }
    expect(FakeSocket.all).toHaveLength(n);
  });

  it("too-many on the new room: false and the old socket stays", async () => {
    const old = connected();
    const p = driver.switchRoom("san-02");
    last().json({ type: "error", code: "too-many", serverTime: 1 });
    await expect(p).resolves.toBe(false);
    expect(old.closedWith).toBeNull();
    expect(statuses.at(-1)).toBe("connected");
  });

  it("full: false and the old socket stays", async () => {
    const old = connected();
    const p = driver.switchRoom("san-02");
    last().json({ type: "error", code: "room-full", serverTime: 1 });
    await expect(p).resolves.toBe(false);
    expect(old.closedWith).toBeNull();
    expect(statuses.at(-1)).toBe("connected");
  });

  it("timeout after 6 s → false", async () => {
    connected();
    const p = driver.switchRoom("san-02");
    vi.advanceTimersByTime(6000);
    await expect(p).resolves.toBe(false);
  });

  it("invalid id → false without opening a socket", async () => {
    connected();
    const n = FakeSocket.all.length;
    await expect(driver.switchRoom("nope")).resolves.toBe(false);
    expect(FakeSocket.all).toHaveLength(n);
  });

  it("disconnect resolves a pending switch", async () => {
    connected();
    const p = driver.switchRoom("san-02");
    driver.disconnect();
    await expect(p).resolves.toBe(false);
  });
});

describe("sending", () => {
  it("coalesces moves to one per tick, latest wins", () => {
    const s = connected();
    const moves = (): Record<string, unknown>[] => s.sent.filter((m) => m["type"] === "move");
    driver.sendMove({ x: 1, z: 1, yaw: 0 }, "walk");
    driver.sendMove({ x: 2, z: 2, yaw: 0 }, "walk");
    driver.sendMove({ x: 3, z: 3, yaw: 0 }, "walk");
    expect(moves()).toHaveLength(1);
    expect(moves()[0]).toMatchObject({ x: 1 });
    vi.advanceTimersByTime(200);
    expect(moves()).toHaveLength(2);
    expect(moves()[1]).toMatchObject({ x: 3 });
  });

  it("beads: at most one per second", () => {
    const s = connected();
    for (let i = 0; i < 5; i++) driver.bead();
    vi.advanceTimersByTime(1000);
    driver.bead();
    expect(s.sent.filter((m) => m["type"] === "bead")).toHaveLength(2);
  });

  it("bow: sends {type:\"bow\"} when connected", () => {
    const s = connected();
    driver.bow();
    expect(s.sent.at(-1)).toEqual({ type: "bow" });
  });

  it("nothing is sent while not connected", () => {
    driver.hello();
    driver.bow();
    driver.stand();
    driver.sendMove({ x: 1, z: 1, yaw: 0 }, "walk");
    expect(FakeSocket.all).toHaveLength(0);
  });
});

describe("dead connection", () => {
  const pong = (s: FakeSocket) => s.json({ type: "pong", clientTime: Date.now(), serverTime: Date.now() });

  it("a socket that stays open but goes silent is dropped → reconnecting → a new socket", () => {
    const s = connected();
    vi.advanceTimersByTime(15_000);
    expect(statuses.at(-1)).toBe("reconnecting");
    expect(s.closedWith).toBe(1000);
    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.all.length).toBe(2);
  });

  it("a live link (pongs coming back) is never dropped", () => {
    const s = connected();
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(5_000);
      pong(s);
    }
    expect(statuses.at(-1)).toBe("connected");
    expect(s.closedWith).toBeNull();
  });

  it("a late timer (frozen tab) is not taken as silence", () => {
    const s = connected();
    // The page was frozen 30 s: the clock jumped, the interval fires once late, queued messages are not read yet.
    vi.setSystemTime(Date.now() + 30_000);
    vi.advanceTimersByTime(5_000);
    expect(s.closedWith).toBeNull();
    pong(s);
    vi.advanceTimersByTime(5_000);
    expect(statuses.at(-1)).toBe("connected");
  });
});

describe("back/forward cache", () => {
  it("pagehide closes; pageshow from the cache reconnects to the same room", () => {
    const win = new EventTarget();
    vi.stubGlobal("window", win);
    const s = connected("san-04");
    win.dispatchEvent(new Event("pagehide"));
    expect(s.closedWith).toBe(1000);
    win.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    expect(last()).not.toBe(s);
    expect(last().url).toContain("room=san-04");
    expect(statuses.at(-1)).toBe("connecting");
  });

  it("a normal pageshow (not from the cache) does nothing", () => {
    const win = new EventTarget();
    vi.stubGlobal("window", win);
    connected("san-04");
    win.dispatchEvent(new Event("pagehide"));
    const count = FakeSocket.all.length;
    win.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false }));
    expect(FakeSocket.all.length).toBe(count);
  });
});

describe("server messages", () => {
  it("corrected and event are forwarded", () => {
    const s = connected();
    const got: unknown[] = [];
    driver.on("corrected", (p) => got.push(p));
    driver.on("event", (e) => got.push(e));
    s.json({ type: "position-corrected", x: 1, z: 2, yaw: 3, serverTime: 1 });
    s.json({ type: "event", event: { eventId: "e1", visitorId: "v", type: "hello", at: 9 }, serverTime: 1 });
    expect(got).toEqual([{ x: 1, z: 2, yaw: 3 }, { eventId: "e1", visitorId: "v", type: "hello", at: 9 }]);
  });

  it("clockOffset = serverTime + RTT/2 − now, averaged over 5 samples", () => {
    const s = connected();
    expect(driver.clockOffset).toBe(0);
    vi.setSystemTime(100_000);
    s.json({ type: "pong", clientTime: 99_900, serverTime: 100_000 + 1000 - 50 });
    // RTT 100 → serverTime + 50 − now = 1000
    expect(driver.clockOffset).toBe(1000);
    s.json({ type: "pong", clientTime: 100_000, serverTime: 100_000 + 2000 });
    expect(driver.clockOffset).toBe(1500);
  });

  it("pings on connect and every PING_EVERY_MS", () => {
    const s = connected();
    const pings = (): number => s.sent.filter((m) => m["type"] === "ping").length;
    expect(pings()).toBeGreaterThanOrEqual(1);
    const before = pings();
    vi.advanceTimersByTime(5000);
    expect(pings()).toBe(before + 1);
  });

  it("invite-arrived reaches the game as inviteArrived", () => {
    const s = connected();
    const got: { visitorId: string; name: string }[] = [];
    driver.on("inviteArrived", (a) => got.push(a));
    s.json({ type: "invite-arrived", visitorId: "v:friend", name: "Minh An", serverTime: 1 });
    expect(got).toEqual([{ visitorId: "v:friend", name: "Minh An" }]);
    expect(parseServerMsg(JSON.stringify({ type: "invite-arrived", visitorId: 3, name: "x", serverTime: 1 }))).toBeNull();
  });

  it("parseServerMsg rejects malformed input", () => {
    expect(parseServerMsg("nope")).toBeNull();
    expect(parseServerMsg(JSON.stringify({ type: "pong", clientTime: "x", serverTime: 1 }))).toBeNull();
    expect(parseServerMsg(JSON.stringify({ type: "error", code: "weird", serverTime: 1 }))).toBeNull();
  });
});

describe("listRooms", () => {
  it("fetches /api/rooms; failure rejects", async () => {
    const rooms = [{ id: "san-01", number: 1, name: "Am Mây", count: 2, capacity: 30 }, { id: "san-02", number: 2, count: 0, capacity: 30 }, { bad: 1 }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ rooms }) });
    vi.stubGlobal("fetch", fetchMock);
    // An older server sends no name (D26): the default one is shown.
    await expect(driver.listRooms()).resolves.toEqual([
      { id: "san-01", number: 1, name: "Am Mây", count: 2, capacity: 30 },
      { id: "san-02", number: 2, name: DEFAULT_ROOM_NAMES[1], count: 0, capacity: 30 },
    ]);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4663/api/rooms", { signal: expect.any(AbortSignal) });
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(driver.listRooms()).rejects.toThrow();
  });

  it("a hanging request is aborted, so the dialog shows its error instead of loading forever", async () => {
    // AbortSignal.timeout is missing on Safari < 16: the driver must not depend on it.
    vi.stubGlobal("AbortSignal", Object.assign(Object.create(AbortSignal), { timeout: undefined }));
    let aborted = false;
    vi.stubGlobal("fetch", (_url: string, init: { signal: AbortSignal }) => new Promise((_ok, fail) => init.signal.addEventListener("abort", () => { aborted = true; fail(new Error("aborted")); })));
    const p = driver.listRooms();
    const done = expect(p).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(7999);
    expect(aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(aborted).toBe(true);
  });

  it("a finished request clears its timer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ rooms: [] }) }));
    await expect(driver.listRooms()).resolves.toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

describe("session (auth)", () => {
  const types = (s: FakeSocket): unknown[] => s.sent.map((m) => m["type"]);

  it("no session → no auth on open", () => {
    const s = connected();
    expect(types(s)).not.toContain("auth");
  });

  it("auth is the first frame after open, on the first socket and every reconnect", () => {
    const token = randomToken();
    driver.setSession(token);
    const first = connected();
    expect(first.sent[0]).toEqual({ type: "auth", token });
    first.drop();
    vi.advanceTimersByTime(700);
    const again = last();
    expect(again).not.toBe(first);
    again.open();
    again.json(snapshot("san-01", [wire("me", 4)]));
    expect(again.sent[0]).toEqual({ type: "auth", token });
    expect(again.sent.filter((m) => m["type"] === "auth")).toHaveLength(1);
    // Never in the URL.
    expect(again.url).not.toContain(token);
  });

  it("a room switch socket sends auth first too", async () => {
    const token = randomToken();
    driver.setSession(token);
    connected();
    const p = driver.switchRoom("san-05");
    const next = last();
    next.open();
    expect(next.sent[0]).toEqual({ type: "auth", token });
    next.json(snapshot("san-05", [wire("me", 4)]));
    await expect(p).resolves.toBe(true);
  });

  it("setSession while connected sends auth now; null sends auth null and keeps the socket", () => {
    const s = connected();
    const token = randomToken();
    driver.setSession(token);
    expect(s.sent.at(-1)).toEqual({ type: "auth", token });
    driver.setSession(token);
    expect(s.sent.filter((m) => m["type"] === "auth")).toHaveLength(1);
    const n = FakeSocket.all.length;
    driver.setSession(null);
    expect(s.sent.at(-1)).toEqual({ type: "auth", token: null });
    expect(s.closedWith).toBeNull();
    expect(FakeSocket.all).toHaveLength(n);
    // Signed out: the next socket carries no auth at all.
    s.drop();
    vi.advanceTimersByTime(700);
    last().open();
    expect(types(last())).not.toContain("auth");
  });

  it("a malformed token counts as no session", () => {
    driver.setSession("short");
    const s = connected();
    expect(types(s)).not.toContain("auth");
  });
});

describe("chat", () => {
  const line = { id: "1", visitorId: "v:a", name: "An", text: "chào", at: 10 };

  it("sendChat sends {type:\"chat\", text}; an oversized text is refused locally", () => {
    const s = connected("san-04");
    driver.sendChat("chào cả nhà");
    expect(s.sent.at(-1)).toEqual({ type: "chat", text: "chào cả nhà" });
    const denied: unknown[] = [];
    driver.on("chatDenied", (d) => denied.push(d));
    const n = s.sent.length;
    driver.sendChat("a".repeat(1001));
    expect(s.sent).toHaveLength(n);
    expect(denied).toEqual([{ reason: "too-long" }]);
  });

  it("account / chat / chat-history / chat-denied reach the game", () => {
    const s = connected("san-04");
    const got: unknown[] = [];
    driver.on("account", (a) => got.push(["account", a]));
    driver.on("chat", (l) => got.push(["chat", l]));
    driver.on("chatHistory", (l) => got.push(["history", l]));
    driver.on("chatDenied", (d) => got.push(["denied", d]));
    const account = { username: "minh.an", displayName: "Minh An", tier: "free" } as const;
    s.json({ type: "chat-history", lines: [line], serverTime: 1 });
    s.json({ type: "account", account, serverTime: 1 });
    s.json({ type: "chat", line, serverTime: 1 });
    s.json({ type: "chat-denied", reason: "too-fast", retryInMs: 2999, serverTime: 1 });
    s.json({ type: "chat-denied", reason: "login", serverTime: 1 });
    s.json({ type: "account", account: null, serverTime: 1 });
    expect(got).toEqual([
      ["history", [line]],
      ["account", account],
      ["chat", line],
      ["denied", { reason: "too-fast", retryInMs: 2999 }],
      ["denied", { reason: "login" }],
      ["account", null],
    ]);
  });

  it("lines from the old socket of a room switch are dropped", async () => {
    const old = connected("san-04");
    const got: unknown[] = [];
    driver.on("chat", (l) => got.push(l));
    const p = driver.switchRoom("san-05");
    const next = last();
    next.open();
    next.json(snapshot("san-05", [wire("me", 4)]));
    await p;
    old.onmessage?.({ data: JSON.stringify({ type: "chat", line, serverTime: 1 }) });
    expect(got).toEqual([]);
    next.json({ type: "chat", line, serverTime: 1 });
    expect(got).toEqual([line]);
  });

  it("parseServerMsg drops malformed chat messages", () => {
    const parse = (m: object): unknown => parseServerMsg(JSON.stringify({ serverTime: 1, ...m }));
    expect(parse({ type: "account", account: { username: "x", displayName: "An", tier: "free" } })).toBeNull();
    expect(parse({ type: "account", account: { username: "minh.an", displayName: "An", tier: "gold" } })).toBeNull();
    expect(parse({ type: "account" })).toBeNull();
    expect(parse({ type: "chat", line: { ...line, at: "x" } })).toBeNull();
    expect(parse({ type: "chat" })).toBeNull();
    expect(parse({ type: "chat-history", lines: "x" })).toBeNull();
    expect(parse({ type: "chat-denied", reason: "nope" })).toBeNull();
    // A bad line costs only itself; a bad retryInMs is left out.
    expect(parse({ type: "chat-history", lines: [line, { id: 3 }] })).toEqual({ type: "chat-history", lines: [line], serverTime: 1 });
    expect(parse({ type: "chat-denied", reason: "too-fast", retryInMs: "soon" })).toEqual({ type: "chat-denied", reason: "too-fast", serverTime: 1 });
  });
});
