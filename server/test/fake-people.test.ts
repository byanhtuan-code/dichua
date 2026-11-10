import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import {
  DEFAULT_POPULATION,
  RESUME_GRACE_MS,
  ROOMS,
  SLOT_MS,
  botTarget,
  decodeDelta,
  tierOf,
  type PopulationConfig,
  type RoomTier,
  type ServerMsg,
} from "@santinh/shared";
import { Room } from "../src/room.ts";
import { RoomHub } from "../src/hub.ts";
import { startServer, type TestServer } from "./helpers.ts";

const CAP = 30;
const T0 = Date.UTC(2026, 10, 3, 5, 0, 0);
const DEF = DEFAULT_POPULATION;
/** The phase-02 numbers: one full room per slot. */
const WITH_FULL: PopulationConfig = {
  layout: { full: 1, busy: 2, medium: 3, quiet: 4 },
  bots: { busy: [19, 24], medium: [9, 14], quiet: [3, 5] },
  minBots: 3,
};
const withFull = (): PopulationConfig => WITH_FULL;

/** Just enough of a `ws` socket for Room. */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  readonly json: ServerMsg[] = [];
  readonly frames: ReturnType<typeof decodeDelta>[] = [];
  closeCode: number | null = null;
  send(data: string | Buffer): void {
    if (typeof data === "string") this.json.push(JSON.parse(data) as ServerMsg);
    else this.frames.push(decodeDelta(data));
  }
  close(code?: number): void {
    this.closeCode = code ?? 1000;
    this.readyState = 3;
    this.emit("close");
  }
  terminate(): void {
    this.close(1006);
  }
  ping(): void {}
  asWs(): WebSocket {
    return this as unknown as WebSocket;
  }
  snapshot() {
    return this.json.find((m): m is Extract<ServerMsg, { type: "snapshot" }> => m.type === "snapshot");
  }
}

function roomOfTier(tier: RoomTier, now: number, cfg: PopulationConfig = DEF): string {
  const r = ROOMS.find((x) => tierOf(x.id, now, cfg) === tier);
  if (!r) throw new Error(tier);
  return r.id;
}

const rooms: Room[] = [];
function mk(id: string, now: () => number, fake = true, cap = CAP, population?: () => PopulationConfig): Room {
  const r = new Room(id, cap, now, fake, population);
  rooms.push(r);
  return r;
}
function join(room: Room, resume: string | null = null): FakeSocket {
  const s = new FakeSocket();
  room.join(s.asWs(), null, resume);
  return s;
}
const botIds = (s: FakeSocket): string[] =>
  (s.snapshot()?.visitors ?? []).map((v) => v.id).filter((i) => i.startsWith("v:") && i !== s.snapshot()?.selfId);
afterEach(() => {
  for (const r of rooms.splice(0)) r.closeAll(1001);
});

describe("/api/rooms population", () => {
  it("default: no full room, ≥2 rooms ≥8, ≥3 rooms ≤3 in every slot", () => {
    const hub = new RoomHub(CAP, () => T0, true);
    for (let k = 0; k < 8; k++) {
      const list = hub.list(T0 + k * SLOT_MS);
      expect(list.filter((r) => r.count >= r.capacity)).toHaveLength(0);
      expect(list.filter((r) => r.count >= 8).length).toBeGreaterThanOrEqual(2);
      expect(list.filter((r) => r.count <= 3).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("config with full: 1: every slot has 1 full, ≥2 rooms ≥19, ≥3 rooms ≤5", () => {
    const hub = new RoomHub(CAP, () => T0, true, withFull);
    for (let k = 0; k < 8; k++) {
      const list = hub.list(T0 + k * SLOT_MS);
      expect(list.filter((r) => r.count === r.capacity)).toHaveLength(1);
      expect(list.filter((r) => r.count >= 19).length).toBeGreaterThanOrEqual(2);
      expect(list.filter((r) => r.count <= 5).length).toBeGreaterThanOrEqual(3);
    }
  });

  it("a config change reaches /api/rooms at once (read through the getter)", () => {
    let cfg = DEF;
    const hub = new RoomHub(CAP, () => T0, true, () => cfg);
    expect(hub.list().filter((r) => r.count === r.capacity)).toHaveLength(0);
    cfg = WITH_FULL;
    expect(hub.list().filter((r) => r.count === r.capacity)).toHaveLength(1);
  });

  it("an empty room shows full exactly when the join would refuse, in every slot, capacity and config", () => {
    for (const cfg of [DEF, WITH_FULL]) {
      for (const cap of [CAP, 20, 8]) {
        for (let k = 0; k < 8; k++) {
          const now = T0 + k * SLOT_MS;
          for (const def of ROOMS) {
            const room = mk(def.id, () => now, true, cap, () => cfg);
            expect(room.info(now).count >= cap, `${def.id} cap ${cap} slot ${k}`).toBe(room.admit(now) === "full");
          }
        }
      }
    }
  });

  it("FAKE_POPULATION off: count is the real head count, every room joinable in every slot", () => {
    for (let k = 0; k < 8; k++) {
      const now = T0 + k * SLOT_MS;
      const hub = new RoomHub(CAP, () => now, false);
      expect(hub.list(now).every((r) => r.count === 0)).toBe(true);
      for (const def of ROOMS) {
        const s = new FakeSocket();
        expect(hub.join(def.id, s.asWs())).toBe("ok");
        expect(s.snapshot()?.visitors.filter((v) => !v.id.startsWith("resident:"))).toHaveLength(1);
      }
      expect(hub.list(now).every((r) => r.count === 1)).toBe(true);
      hub.closeAll(1001);
    }
  });
});

describe("fake people in a room", () => {
  it("full-tier room refuses with room-full", () => {
    const id = roomOfTier("full", T0, WITH_FULL);
    const room = mk(id, () => T0, true, CAP, withFull);
    expect(room.info().count).toBe(CAP);
    const s = new FakeSocket();
    expect(room.join(s.asWs())).toBe("full");
    expect(s.json.some((m) => m.type === "error" && m.code === "room-full")).toBe(true);
  });

  it("first visitor finds botTarget bots; two sockets see the same ids", () => {
    const id = roomOfTier("medium", T0);
    const room = mk(id, () => T0);
    const before = room.info().count;
    expect(before).toBe(botTarget(id, T0, CAP, 0, DEF));
    const a = join(room);
    const b = join(room);
    const ids = (s: FakeSocket) => (s.snapshot()?.visitors ?? []).map((v) => v.id).filter((i) => i.startsWith("v:"));
    const botsA = ids(a).filter((i) => i !== a.snapshot()?.selfId);
    expect(botsA).toHaveLength(botTarget(id, T0, CAP, 1, DEF));
    expect(ids(b).filter((i) => botsA.includes(i))).toEqual(botsA);
    const names = (a.snapshot()?.visitors ?? []).map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
    const slots = (b.snapshot()?.visitors ?? []).map((v) => v.slot);
    expect(new Set(slots).size).toBe(slots.length);
  });

  it("busy room at capacity: bots step aside until minBots are left, then it is full", () => {
    const id = roomOfTier("busy", T0);
    const room = mk(id, () => T0, true, 24);
    const first = join(room);
    expect(first.snapshot()).toBeDefined();
    let joined = 1;
    for (let guard = 0; guard < 40; guard++) {
      const count = room.info().count;
      const verdict = room.admit();
      const s = new FakeSocket();
      const res = room.join(s.asWs());
      expect(res).toBe(verdict);
      // The room list is what people choose from: it must say "full" exactly when the join refuses.
      expect(count >= 24).toBe(verdict === "full");
      if (res === "full") break;
      joined++;
    }
    const snap = join(room);
    expect(snap.closeCode).toBe(4000);
    expect(room.info().count).toBe(24);
    expect(24 - joined).toBe(DEF.minBots);
  });

  it("ticks move the bots and keep the population near the target; leaving stops all timers", () => {
    vi.useFakeTimers();
    try {
      let now = T0;
      const id = roomOfTier("medium", T0);
      const room = mk(id, () => now);
      const a = join(room);
      const bots = (a.snapshot()?.visitors ?? []).filter((v) => v.id.startsWith("v:") && v.id !== a.snapshot()?.selfId);
      for (let i = 0; i < 600; i++) {
        now += 200;
        vi.advanceTimersByTime(200);
      }
      expect(a.frames.length).toBeGreaterThan(10);
      const moved = new Set(a.frames.flatMap((f) => f?.records.map((r) => r.slot) ?? []));
      expect(bots.some((b) => moved.has(b.slot))).toBe(true);
      expect(Math.abs(room.info().count - (botTarget(id, now, CAP, 1, DEF) + 1))).toBeLessThanOrEqual(4);
      a.close();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("the last visitor back from a short drop meets the same bots; after the grace time a fresh set", () => {
    let now = T0;
    const id = roomOfTier("quiet", T0);
    const room = mk(id, () => now);
    const a = join(room);
    const before = botIds(a);
    expect(before.length).toBeGreaterThanOrEqual(DEF.minBots);
    a.close();
    expect(room.size).toBe(0);
    expect(room.info().count).toBe(botTarget(id, now, CAP, 0, DEF));

    now += 5000;
    const back = join(room, a.snapshot()?.resume ?? null);
    expect(back.snapshot()?.selfId).toBe(a.snapshot()?.selfId);
    expect(botIds(back)).toEqual(before);
    back.close();

    now += RESUME_GRACE_MS;
    const later = join(room);
    expect(botIds(later).length).toBeGreaterThanOrEqual(DEF.minBots);
    expect(botIds(later).some((b) => before.includes(b))).toBe(false);
  });

  it("a newcomer within the grace time meets the crowd /api/rooms showed, not the frozen bots", () => {
    let now = T0;
    const id = roomOfTier("medium", T0);
    const room = mk(id, () => now);
    const a = join(room);
    const before = botIds(a);
    a.close();
    now += 5000;
    const shown = room.info().count;
    const stranger = join(room);
    expect(botIds(stranger).some((b) => before.includes(b))).toBe(false);
    expect(botIds(stranger)).toHaveLength(botTarget(id, now, CAP, 1, DEF));
    expect(Math.abs(botIds(stranger).length - shown)).toBeLessThanOrEqual(1);
  });

  it("bots frozen for a minute do not all wave at once when their visitor comes back", () => {
    vi.useFakeTimers();
    try {
      let now = T0;
      const room = mk(roomOfTier("medium", T0), () => now);
      const a = join(room);
      a.close();
      now += 60_000;
      const back = join(room, a.snapshot()?.resume ?? null);
      expect(botIds(back).length).toBeGreaterThan(DEF.minBots);
      for (let i = 0; i < 5; i++) {
        now += 200;
        vi.advanceTimersByTime(200);
      }
      const hellos = back.json.filter((m) => m.type === "event" && m.event.type === "hello");
      expect(hellos).toHaveLength(0);
      back.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("someone inside when the room turns full gets back in with their token (live socket or just dropped)", () => {
    const id = roomOfTier("medium", T0, WITH_FULL);
    // Bounded: a layout without a full room would otherwise spin forever.
    let flip = -1;
    for (let k = 1; k <= 64 && flip < 0; k++) if (tierOf(id, T0 + k * SLOT_MS, WITH_FULL) === "full") flip = T0 + k * SLOT_MS;
    if (flip < 0) throw new Error(`${id} never turns full in 64 slots`);
    let now = T0;
    const room = mk(id, () => now, true, CAP, withFull);
    const a = join(room);
    const self = a.snapshot()?.selfId;
    now = flip;
    expect(join(room).closeCode).toBe(4000);

    // Network switch: the old socket is still open.
    const b = join(room, a.snapshot()?.resume ?? null);
    expect(b.snapshot()?.selfId).toBe(self);
    expect(a.closeCode).toBe(1006);

    // Dropped first, back a few seconds later.
    b.close();
    now += 3000;
    const c = join(room, b.snapshot()?.resume ?? null);
    expect(c.closeCode).toBeNull();
    expect(c.snapshot()?.selfId).toBe(self);
  });
});

describe("live server", () => {
  let srv: TestServer;
  afterEach(async () => {
    await srv.stop();
  });

  it("FAKE_POPULATION=on: /api/rooms has bots and, by default, no full room", async () => {
    srv = await startServer({ FAKE_POPULATION: "on" });
    const res = await fetch(`http://127.0.0.1:${srv.port}/api/rooms`);
    const { rooms: list } = (await res.json()) as { rooms: { count: number; capacity: number }[] };
    expect(list).toHaveLength(10);
    expect(list.filter((r) => r.count >= r.capacity)).toHaveLength(0);
    expect(list.every((r) => r.count >= DEF.minBots)).toBe(true);
  });
});
