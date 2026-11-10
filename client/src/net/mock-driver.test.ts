import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOW_PERIOD_MS, RESIDENTS, ROOM_CAPACITY, TICK_MS, isWalkable, spaceOf, type ConnectionStatus } from "@santinh/shared";
import { MockNetDriver, parseMock } from "./mock-driver.ts";
import type { RoomSnapshot, VisitorsUpdate } from "./net-driver.ts";

const space = spaceOf("san-01");
const CUSHION_COUNT = space.cushions.length;

async function connected(driver: MockNetDriver): Promise<RoomSnapshot> {
  let snap: RoomSnapshot | null = null;
  driver.on("snapshot", (s) => (snap = s));
  driver.connect("san-01");
  await vi.advanceTimersByTimeAsync(1000);
  if (!snap) throw new Error("no snapshot");
  return snap;
}

describe("parseMock", () => {
  it("reads offline / full / bots=N and clamps N", () => {
    expect(parseMock(null)).toEqual({ mode: "normal", bots: 3 });
    expect(parseMock("offline").mode).toBe("offline");
    expect(parseMock("full").mode).toBe("full");
    expect(parseMock("bots=26").bots).toBe(26);
    expect(parseMock("bots=99").bots).toBe(ROOM_CAPACITY - 1);
    expect(parseMock("bots=x")).toEqual({ mode: "normal", bots: 3 });
  });
});

describe("MockNetDriver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("snapshot has us, 3 bots and the 4 residents kneeling on their cushions", async () => {
    const driver = new MockNetDriver();
    const snap = await connected(driver);
    expect(snap.room).toBe("san-01");
    expect(snap.visitors.filter((v) => v.id.startsWith("bot:"))).toHaveLength(3);
    const residents = snap.visitors.filter((v) => v.id.startsWith("resident:"));
    expect(residents.map((r) => r.cushion)).toEqual(RESIDENTS.map((r) => r.cushion));
    expect(residents.every((r) => r.pose === "kneel")).toBe(true);
    expect(snap.visitors.some((v) => v.id === snap.selfId)).toBe(true);
    driver.disconnect();
  });

  it("bots never leave walkable ground over 2000 ticks", async () => {
    const driver = new MockNetDriver({ bots: 8 });
    await connected(driver);
    let moved = 0;
    driver.on("update", (u) => (moved += u.visitors.length));
    for (let i = 0; i < 2000; i++) {
      await vi.advanceTimersByTimeAsync(TICK_MS);
      for (const b of driver.botVisitors) {
        if (b.cushion !== null) continue;
        expect(isWalkable(space.collision, b.position.x, b.position.z), `${b.id} at ${b.position.x},${b.position.z}`).toBe(true);
      }
    }
    expect(moved).toBeGreaterThan(100);
    driver.disconnect();
  });

  it("requestSeat gives the nearest free cushion, and null when all are taken", async () => {
    const driver = new MockNetDriver({ bots: 3, seated: 0 });
    await connected(driver);
    const seatP = driver.requestSeat({ x: 0, z: -6 });
    await vi.advanceTimersByTimeAsync(500);
    const seat = await seatP;
    expect(seat).not.toBeNull();
    expect(RESIDENTS.some((r) => r.cushion === seat)).toBe(false);
    driver.disconnect();

    const full = new MockNetDriver({ bots: CUSHION_COUNT - RESIDENTS.length, seated: CUSHION_COUNT - RESIDENTS.length });
    await connected(full);
    const none = full.requestSeat({ x: 0, z: 0 });
    await vi.advanceTimersByTimeAsync(500);
    expect(await none).toBeNull();
    full.disconnect();
  });

  it("?mock=offline stays reconnecting, ?mock=full reports full", async () => {
    for (const [mode, last] of [
      ["offline", "reconnecting"],
      ["full", "full"],
    ] as const) {
      const statuses: ConnectionStatus[] = [];
      const driver = new MockNetDriver({ mode });
      driver.on("status", (s) => statuses.push(s));
      driver.connect("san-01");
      await vi.advanceTimersByTimeAsync(30_000);
      expect(statuses).toEqual(["connecting", last]);
      driver.disconnect();
      expect(statuses.at(-1)).toBe("offline");
    }
  });

  it("?mock=full turns away the first room only and lists it as full", async () => {
    const driver = new MockNetDriver({ mode: "full" });
    const statuses: ConnectionStatus[] = [];
    driver.on("status", (s) => statuses.push(s));
    driver.connect("san-02");
    await vi.advanceTimersByTimeAsync(1000);
    expect(statuses.at(-1)).toBe("full");
    const list = driver.listRooms();
    await vi.advanceTimersByTimeAsync(1000);
    expect((await list).find((r) => r.id === "san-02")?.count).toBe(ROOM_CAPACITY);
    driver.connect("san-03");
    await vi.advanceTimersByTimeAsync(1000);
    expect(statuses.at(-1)).toBe("connected");
    driver.disconnect();
  });

  it("switchRoom refuses a full room and moves to a free one", async () => {
    const driver = new MockNetDriver();
    await connected(driver);
    const rooms = driver.listRooms();
    await vi.advanceTimersByTimeAsync(500);
    const list = await rooms;
    expect(list).toHaveLength(10);
    expect(list[0]?.count).toBe(4);
    const fullRoom = list.find((r) => r.count >= r.capacity);
    if (!fullRoom) throw new Error("expected a full fake room");

    const denied = driver.switchRoom(fullRoom.id);
    await vi.advanceTimersByTimeAsync(500);
    expect(await denied).toBe(false);

    let room = "";
    driver.on("snapshot", (s) => (room = s.room));
    const ok = driver.switchRoom("san-02");
    await vi.advanceTimersByTimeAsync(500);
    expect(await ok).toBe(true);
    expect(room).toBe("san-02");
    driver.disconnect();
  });

  it("bow: only when seated and the last bow is over → bowAt + update + bow event", async () => {
    const driver = new MockNetDriver({ bots: 0 });
    const snap = await connected(driver);
    const updates: VisitorsUpdate[] = [];
    const bows: number[] = [];
    driver.on("update", (u) => updates.push(u));
    driver.on("event", (e) => {
      if (e.visitorId === snap.selfId && e.type === "bow") bows.push(e.at);
    });
    driver.bow();
    expect(bows).toHaveLength(0);
    const seatP = driver.requestSeat({ x: 0, z: -6 });
    await vi.advanceTimersByTimeAsync(500);
    expect(await seatP).not.toBeNull();
    // Sitting-down bow still running: dropped, like the server.
    driver.bow();
    expect(bows).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(BOW_PERIOD_MS);
    const before = updates.length;
    driver.bow();
    expect(bows).toHaveLength(1);
    const mine = updates.slice(before).flatMap((u) => u.visitors).find((v) => v.id === snap.selfId);
    expect(mine?.bowAt).toBe(bows[0]);
    driver.bow();
    expect(bows).toHaveLength(1);
    driver.disconnect();
  });

  it("hello is rate limited to once per 3 s", async () => {
    const driver = new MockNetDriver({ bots: 0 });
    const snap = await connected(driver);
    const mine: string[] = [];
    driver.on("event", (e) => {
      if (e.visitorId === snap.selfId) mine.push(e.type);
    });
    driver.hello();
    driver.hello();
    await vi.advanceTimersByTimeAsync(3100);
    driver.hello();
    expect(mine).toEqual(["hello", "hello"]);
    driver.disconnect();
  });
});

describe("MockNetDriver names", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("setName before connect: we join with it, and the bots / positions are the same as without it", async () => {
    const plainDriver = new MockNetDriver({ seed: 3 });
    const plain = await connected(plainDriver);
    plainDriver.disconnect();
    const named = new MockNetDriver({ seed: 3 });
    named.setName("  Hoa   Sen ");
    const snap = await connected(named);
    const me = snap.visitors.find((v) => v.id === snap.selfId);
    expect(me?.name).toBe("Hoa Sen");
    expect(snap.selfId).toBe(plain.selfId);
    const others = (s: RoomSnapshot): unknown[] => s.visitors.filter((v) => v.id !== s.selfId).map((v) => [v.id, v.name, v.position]);
    expect(others(snap)).toEqual(others(plain));
    named.disconnect();
  });

  it("setName while connected renames us and sends an update; a bot's name gets a number", async () => {
    const driver = new MockNetDriver();
    const snap = await connected(driver);
    const updates: VisitorsUpdate[] = [];
    driver.on("update", (u) => updates.push(u));
    driver.setName("Mây Mới");
    expect(updates).toHaveLength(1);
    expect(updates[0]?.visitors).toEqual([expect.objectContaining({ id: snap.selfId, name: "Mây Mới" })]);
    const botName = driver.botVisitors[0]?.name ?? "";
    driver.setName(botName);
    expect(updates.at(-1)?.visitors[0]?.name).toBe(`${botName} 2`);
    // Blank → ignored, same name → nothing sent.
    driver.setName("   ");
    driver.setName(botName);
    expect(updates).toHaveLength(2);
    driver.disconnect();
  });
});

describe("MockNetDriver chat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const token = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

  async function inRoom(room: string, signedIn: boolean): Promise<{ driver: MockNetDriver; got: unknown[]; selfId: string }> {
    const driver = new MockNetDriver({ bots: 2 });
    if (signedIn) driver.setSession(token());
    const got: unknown[] = [];
    let selfId = "";
    driver.on("snapshot", (s) => {
      selfId = s.selfId;
      got.push(["snapshot"]);
    });
    driver.on("account", (a) => got.push(["account", a]));
    driver.on("chat", (l) => got.push(["chat", l]));
    driver.on("chatHistory", (l) => got.push(["history", l]));
    driver.on("chatDenied", (d) => got.push(["denied", d]));
    driver.connect(room);
    await vi.advanceTimersByTimeAsync(1000);
    return { driver, got, selfId };
  }

  it("quiet room: no history, and a line → quiet-room", async () => {
    const { driver, got } = await inRoom("san-01", true);
    expect(got.filter((g) => (g as string[])[0] === "history")).toEqual([]);
    driver.sendChat("chào");
    await vi.advanceTimersByTimeAsync(200);
    expect(got.at(-1)).toEqual(["denied", { reason: "quiet-room" }]);
    driver.disconnect();
  });

  it("guest in a chat room: empty history, a line → login", async () => {
    const { driver, got } = await inRoom("san-04", false);
    expect(got).toEqual([["snapshot"], ["history", []]]);
    driver.sendChat("chào");
    await vi.advanceTimersByTimeAsync(200);
    expect(got.at(-1)).toEqual(["denied", { reason: "login" }]);
    driver.disconnect();
  });

  it("signed in: account after the snapshot, our line echoes back masked; two in a row → too-fast", async () => {
    const { driver, got, selfId } = await inRoom("san-04", true);
    expect(got[2]).toEqual(["account", expect.objectContaining({ tier: "free" })]);
    driver.sendChat("  chào   cả nhà  ");
    driver.sendChat("lần hai");
    await vi.advanceTimersByTimeAsync(200);
    expect(got.at(-2)).toEqual(["chat", expect.objectContaining({ visitorId: selfId, text: "chào cả nhà" })]);
    expect(got.at(-1)).toEqual(["denied", { reason: "too-fast", retryInMs: expect.any(Number) }]);
    // Same text again after the cooldown → duplicate; empty → empty.
    await vi.advanceTimersByTimeAsync(3000);
    driver.sendChat("chào cả nhà");
    driver.sendChat("   ");
    await vi.advanceTimersByTimeAsync(200);
    expect(got.slice(-2)).toEqual([["denied", { reason: "duplicate" }], ["denied", { reason: "empty" }]]);
    driver.disconnect();
  });

  it("setSession while connected → account; null → account null and lines need login again", async () => {
    const { driver, got } = await inRoom("san-04", false);
    driver.setSession(token());
    await vi.advanceTimersByTimeAsync(200);
    expect(got.at(-1)).toEqual(["account", expect.objectContaining({ username: expect.any(String) })]);
    driver.setSession(null);
    await vi.advanceTimersByTimeAsync(200);
    expect(got.at(-1)).toEqual(["account", null]);
    driver.sendChat("chào");
    await vi.advanceTimersByTimeAsync(200);
    expect(got.at(-1)).toEqual(["denied", { reason: "login" }]);
    driver.disconnect();
  });
});
