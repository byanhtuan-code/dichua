import { afterEach, describe, expect, it } from "vitest";
import { BOW_PERIOD_MS, isWalkable, residentsFor, segmentClear, spaceOf } from "@santinh/shared";
import { startServer, TestClient, upgradeStatus, type TestServer } from "./helpers.ts";

let srv: TestServer;

/** Spawns are random and may sit next to a wall: pick a direction the server will accept. */
function clearStep(room: string, from: { x: number; z: number }, dist: number): { x: number; z: number } {
  const map = spaceOf(room).collision;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const to = { x: from.x + Math.cos(a) * dist, z: from.z + Math.sin(a) * dist };
    if (segmentClear(map, from, to)) return to;
  }
  throw new Error(`no clear ${dist} m step from ${from.x},${from.z}`);
}
afterEach(async () => {
  await srv.stop();
});

describe("room join / leave", () => {
  it("snapshot has the four residents; others get a join frame, then a removed frame", async () => {
    srv = await startServer();
    const a = srv.connect("san-01");
    await a.until(() => a.snapshot() !== undefined);
    const snapA = a.snapshot();
    expect(snapA?.visitors.filter((v) => v.id.startsWith("resident:"))).toHaveLength(4);
    expect(snapA?.visitors.map((v) => v.name)).toEqual(expect.arrayContaining(residentsFor("san-01").map((r) => r.name)));

    const b = srv.connect("san-01");
    await b.until(() => b.snapshot() !== undefined);
    await a.until(() => a.frames.length >= 1);
    const joined = a.frames[0];
    expect(joined?.profiles.map((p) => p.id)).toEqual([b.snapshot()?.selfId]);
    expect(joined?.records).toHaveLength(1);
    expect(b.frames).toHaveLength(0); // the newcomer already has itself in the snapshot
    expect(b.snapshot()?.visitors.some((v) => v.id === snapA?.selfId)).toBe(true);

    const bId = b.snapshot()?.selfId;
    b.ws.close();
    await a.until(() => a.frames.length >= 2);
    expect(a.frames[1]?.removed).toEqual([bId]);
    expect((a.frames[1]?.revision ?? 0) > (joined?.revision ?? 0)).toBe(true);
  });

  it("hands out distinct slots and unique names", async () => {
    srv = await startServer();
    const cs = [srv.connect("san-02"), srv.connect("san-02"), srv.connect("san-02")];
    await Promise.all(cs.map((c) => c.until(() => c.snapshot() !== undefined)));
    const last = cs[2]?.snapshot()?.visitors ?? [];
    expect(new Set(last.map((v) => v.slot)).size).toBe(last.length);
    expect(new Set(last.map((v) => v.name)).size).toBe(last.length);
    expect(last.every((v) => v.position.x !== undefined)).toBe(true);
  });

  it("answers ping with pong carrying serverTime", async () => {
    srv = await startServer();
    const a = srv.connect("san-01");
    await a.until(() => a.snapshot() !== undefined);
    a.ws.send(JSON.stringify({ type: "ping", clientTime: 42 }));
    await a.until(() => a.json.some((m) => m.type === "pong"));
    const pong = a.json.find((m) => m.type === "pong");
    expect(pong).toMatchObject({ type: "pong", clientTime: 42 });
    expect(typeof (pong as { serverTime: number }).serverTime).toBe("number");
  });

  it("sync resends the snapshot; garbage does not drop the socket", async () => {
    srv = await startServer();
    const a = srv.connect("san-01");
    await a.until(() => a.snapshot() !== undefined);
    a.ws.send("{not json");
    a.ws.send(Buffer.from([1, 2, 3]));
    a.ws.send(JSON.stringify({ type: "sync" }));
    await a.until(() => a.json.filter((m) => m.type === "snapshot").length === 2);
    expect(a.closeCode).toBeNull();
  });

  it("full room: second socket gets room-full and 4000", async () => {
    srv = await startServer({ CAPACITY: "1" });
    const a = srv.connect("san-01");
    await a.until(() => a.snapshot() !== undefined);
    const b = srv.connect("san-01");
    await b.until(() => b.closeCode !== null);
    expect(b.json[0]).toMatchObject({ type: "error", code: "room-full" });
    expect(b.closeCode).toBe(4000);
    expect(srv.hub.list().find((r) => r.id === "san-01")).toMatchObject({ count: 1, capacity: 1 });
  });

  it("a leaver frees the room for the next one", async () => {
    srv = await startServer({ CAPACITY: "1" });
    const a = srv.connect("san-01");
    await a.until(() => a.snapshot() !== undefined);
    a.ws.close();
    await a.until(() => a.closeCode !== null);
    await new Promise((ok) => setTimeout(ok, 50));
    const b = srv.connect("san-01");
    await b.until(() => b.snapshot() !== undefined);
    expect(b.closeCode).toBeNull();
  });

  it("rejects an unknown room (400) and a wrong path (404)", async () => {
    srv = await startServer();
    expect(await upgradeStatus(srv.port, "/ws?room=san-99")).toBe(400);
    expect(await upgradeStatus(srv.port, "/ws")).toBe(400);
    expect(await upgradeStatus(srv.port, "/nope?room=san-01")).toBe(404);
  });
});

describe("room gameplay over the socket", () => {
  const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

  it("A moves → B gets a binary frame with A's position", async () => {
    srv = await startServer();
    const a = srv.connect("san-01");
    await a.until(() => a.snapshot() !== undefined);
    const b = srv.connect("san-01");
    await b.until(() => b.snapshot() !== undefined);
    const me = a.snapshot()!;
    const self = me.visitors.find((v) => v.id === me.selfId)!;
    const slot = self.slot;
    await a.until(() => a.frames.length >= 1); // b's join
    const to = clearStep("san-01", self.position, 0.5);
    a.ws.send(JSON.stringify({ type: "move", x: to.x, z: to.z, yaw: 1, pose: "walk" }));
    await b.until(() => b.frames.some((f) => f.records.some((r) => r.slot === slot && Math.abs(r.x - to.x) < 1e-9)));
  });

  it("a teleport gets position-corrected", async () => {
    srv = await startServer();
    const a = srv.connect("san-01");
    await a.until(() => a.snapshot() !== undefined);
    const self = a.snapshot()!.visitors.find((v) => v.id === a.snapshot()!.selfId)!;
    a.ws.send(JSON.stringify({ type: "move", x: self.position.x + 20, z: self.position.z, yaw: 0, pose: "walk" }));
    await a.until(() => a.json.some((m) => m.type === "position-corrected"));
    expect(a.json.find((m) => m.type === "position-corrected")).toMatchObject({ x: self.position.x, z: self.position.z });
  });

  it("seat → granted, bow on arrival; stand frees; second seeker gets another cushion", async () => {
    srv = await startServer();
    const a = srv.connect("san-01");
    const b = srv.connect("san-01");
    await Promise.all([a, b].map((c) => c.until(() => c.snapshot() !== undefined)));
    a.ws.send(JSON.stringify({ type: "seat", requestId: 1 }));
    b.ws.send(JSON.stringify({ type: "seat", requestId: 2 }));
    await a.until(() => a.json.some((m) => m.type === "seat-granted"));
    await b.until(() => b.json.some((m) => m.type === "seat-granted"));
    const ca = (a.json.find((m) => m.type === "seat-granted") as { cushion: number }).cushion;
    const cb = (b.json.find((m) => m.type === "seat-granted") as { cushion: number }).cushion;
    expect(ca).not.toBe(cb);
    // No bow at the grant: it rings when each one arrives (the client's kneel move).
    await sleep(250);
    expect(b.json.filter((m) => m.type === "event")).toHaveLength(0);
    for (const [c, cushion] of [[a, ca], [b, cb]] as const) {
      const spot = spaceOf("san-01").cushions[cushion]!;
      c.ws.send(JSON.stringify({ type: "move", x: spot.x, z: spot.z, yaw: 0, pose: "kneel" }));
    }
    await b.until(() => b.json.filter((m) => m.type === "event").length >= 2);
    a.ws.send(JSON.stringify({ type: "stand" }));
    await b.until(() => b.frames.some((f) => f.records.some((r) => r.cushion === -1 || r.cushion === null)));
  });

  it("bow while seated → others get exactly one bow event; a repeat inside BOW_PERIOD_MS is dropped", async () => {
    srv = await startServer();
    const a = srv.connect("san-01");
    const b = srv.connect("san-01");
    await Promise.all([a, b].map((c) => c.until(() => c.snapshot() !== undefined)));
    const aId = a.snapshot()!.selfId;
    const bowsOfA = () => b.json.filter((m) => m.type === "event" && m.event.type === "bow" && m.event.visitorId === aId).length;
    // Not seated yet: dropped.
    a.ws.send(JSON.stringify({ type: "bow" }));
    a.ws.send(JSON.stringify({ type: "seat", requestId: 1 }));
    await a.until(() => a.json.some((m) => m.type === "seat-granted"));
    const cushion = (a.json.find((m) => m.type === "seat-granted") as { cushion: number }).cushion;
    const spot = spaceOf("san-01").cushions[cushion]!;
    a.ws.send(JSON.stringify({ type: "move", x: spot.x, z: spot.z, yaw: 0, pose: "kneel" }));
    await b.until(() => bowsOfA() === 1);
    // The sit-down bow has to finish first (real clock: the test server runs on Date.now).
    await sleep(BOW_PERIOD_MS + 100);
    a.ws.send(JSON.stringify({ type: "bow" }));
    await b.until(() => bowsOfA() === 2);
    a.ws.send(JSON.stringify({ type: "bow" }));
    await sleep(300);
    expect(bowsOfA()).toBe(2);
  }, 10_000);

  it("a resync snapshot names the cushion reserved for us; none once seated or on join", async () => {
    srv = await startServer();
    const a = srv.connect("san-01");
    await a.until(() => a.snapshot() !== undefined);
    expect(a.snapshot()).toMatchObject({ reserved: null });
    a.ws.send(JSON.stringify({ type: "seat", requestId: 1 }));
    await a.until(() => a.json.some((m) => m.type === "seat-granted"));
    const cushion = (a.json.find((m) => m.type === "seat-granted") as { cushion: number }).cushion;
    a.ws.send(JSON.stringify({ type: "sync" }));
    await a.until(() => a.json.filter((m) => m.type === "snapshot").length === 2);
    expect(a.json.filter((m) => m.type === "snapshot").at(-1)).toMatchObject({ reserved: cushion });
    a.ws.send(JSON.stringify({ type: "stand" }));
    a.ws.send(JSON.stringify({ type: "sync" }));
    await a.until(() => a.json.filter((m) => m.type === "snapshot").length === 3);
    expect(a.json.filter((m) => m.type === "snapshot").at(-1)).toMatchObject({ reserved: null });
  });

  it("20 beads in 1 s → socket stays open, one bead event", async () => {
    srv = await startServer();
    const a = srv.connect("san-01");
    await a.until(() => a.snapshot() !== undefined);
    for (let i = 0; i < 20; i++) a.ws.send(JSON.stringify({ type: "bead" }));
    await sleep(300);
    expect(a.closeCode).toBeNull();
    const beads = a.json.filter((m) => m.type === "event" && m.event.type === "bead");
    expect(beads).toHaveLength(1);
  });

  it("40 messages in 1 s → rate-limit and 1008", async () => {
    srv = await startServer();
    const a = srv.connect("san-01");
    await a.until(() => a.snapshot() !== undefined);
    for (let i = 0; i < 40; i++) a.ws.send(JSON.stringify({ type: "ping", clientTime: i }));
    await a.until(() => a.closeCode !== null);
    expect(a.closeCode).toBe(1008);
    expect(a.json.some((m) => m.type === "error" && m.code === "rate-limit")).toBe(true);
  });

  it("broken JSON does not break the room; others keep receiving frames", async () => {
    srv = await startServer();
    const a = srv.connect("san-01");
    const b = srv.connect("san-02");
    await Promise.all([a, b].map((c) => c.until(() => c.snapshot() !== undefined)));
    a.ws.send("{oops");
    a.ws.send(JSON.stringify({ type: "move", x: "x" }));
    const c = srv.connect("san-01");
    await c.until(() => c.snapshot() !== undefined);
    await a.until(() => a.frames.length >= 1);
    expect(a.closeCode).toBeNull();
    expect(b.closeCode).toBeNull();
  });

  it("an error inside one room's tick does not stop another room", async () => {
    srv = await startServer();
    const a = srv.connect("san-01");
    const b = srv.connect("san-02");
    await Promise.all([a, b].map((c) => c.until(() => c.snapshot() !== undefined)));
    const room1 = (srv.hub as unknown as { rooms: Map<string, { state: { takeDirty(): never } }> }).rooms.get("san-01")!;
    room1.state.takeDirty = () => {
      throw new Error("boom");
    };
    const errSpy = console.error;
    console.error = () => undefined;
    try {
      const self = b.snapshot()!.visitors.find((v) => v.id === b.snapshot()!.selfId)!;
      const c = srv.connect("san-02");
      await c.until(() => c.snapshot() !== undefined);
      const to = clearStep("san-02", self.position, 0.3);
      b.ws.send(JSON.stringify({ type: "move", x: to.x, z: to.z, yaw: 0, pose: "walk" }));
      await c.until(() => c.frames.some((f) => f.records.some((r) => r.slot === self.slot)));
      await sleep(300);
    } finally {
      console.error = errSpy;
    }
    expect(a.closeCode).toBeNull();
  });
});

describe("?resume=", () => {
  it("reconnecting with the snapshot's token keeps the visitor id", async () => {
    srv = await startServer();
    const a = srv.connect("san-02");
    await a.until(() => a.snapshot() !== undefined);
    const { selfId, resume } = a.snapshot()!;
    a.ws.close();
    await a.until(() => a.closeCode !== null);
    const b = new TestClient(`ws://127.0.0.1:${srv.port}/ws?room=san-02&resume=${resume}`);
    srv.clients.push(b);
    await b.until(() => b.snapshot() !== undefined);
    expect(b.snapshot()?.selfId).toBe(selfId);
  });
});

describe("?near= placement", () => {
  const selfPos = (c: ReturnType<TestServer["connect"]>): { x: number; z: number } | undefined => {
    const snap = c.snapshot();
    return snap?.visitors.find((v) => v.id === snap.selfId)?.position;
  };

  it("puts the newcomer 1.2–2 m from the inviter on a walkable spot", async () => {
    srv = await startServer();
    const a = srv.connect("san-04");
    await a.until(() => a.snapshot() !== undefined);
    const aId = a.snapshot()?.selfId ?? "";
    const b = new TestClient(`ws://127.0.0.1:${srv.port}/ws?room=san-04&near=${aId}`);
    srv.clients.push(b);
    await b.until(() => b.snapshot() !== undefined);
    const pa = selfPos(a);
    const pb = selfPos(b);
    expect(pa && pb).toBeTruthy();
    const d = Math.hypot((pa?.x ?? 0) - (pb?.x ?? 0), (pa?.z ?? 0) - (pb?.z ?? 0));
    expect(d).toBeGreaterThanOrEqual(1.19);
    expect(d).toBeLessThanOrEqual(2.01);
    expect(isWalkable(spaceOf("san-04").collision, pb?.x ?? NaN, pb?.z ?? NaN)).toBe(true);
  });

  it("tells only the inviter that someone came through their link", async () => {
    srv = await startServer();
    const a = srv.connect("san-04");
    await a.until(() => a.snapshot() !== undefined);
    const other = srv.connect("san-04");
    await other.until(() => other.snapshot() !== undefined);
    const stranger = srv.connect("san-04");
    await stranger.until(() => stranger.snapshot() !== undefined);
    const b = new TestClient(`ws://127.0.0.1:${srv.port}/ws?room=san-04&near=${a.snapshot()?.selfId ?? ""}`);
    srv.clients.push(b);
    await b.until(() => b.snapshot() !== undefined);
    await a.until(() => a.json.some((m) => m.type === "invite-arrived"));
    const arrived = a.json.filter((m) => m.type === "invite-arrived");
    const me = b.snapshot()?.visitors.find((v) => v.id === b.snapshot()?.selfId);
    expect(arrived).toEqual([{ type: "invite-arrived", visitorId: me?.id, name: me?.name, serverTime: expect.any(Number) }]);
    // The stranger who joined without a link did not count, and nobody else heard.
    expect(other.json.some((m) => m.type === "invite-arrived")).toBe(false);
    expect(b.json.some((m) => m.type === "invite-arrived")).toBe(false);
  });

  it("unknown or malformed near falls back to the spawn area", async () => {
    srv = await startServer();
    const spawn = spaceOf("san-04").spawn;
    for (const near of ["v:nobody", "bad id!", "resident:1"]) {
      const c = new TestClient(`ws://127.0.0.1:${srv.port}/ws?room=san-04&near=${encodeURIComponent(near)}`);
      srv.clients.push(c);
      await c.until(() => c.snapshot() !== undefined);
      const p = selfPos(c);
      expect(Math.hypot((p?.x ?? 1e9) - spawn.x, (p?.z ?? 1e9) - spawn.z)).toBeLessThanOrEqual(spaceOf("san-04").spawnJitter + 0.01);
    }
  });
});

describe("visitor names (?name=, rename)", () => {
  const selfOf = (c: TestClient) => {
    const snap = c.snapshot();
    return snap?.visitors.find((v) => v.id === snap.selfId);
  };
  const named = (name: string) => new TestClient(`ws://127.0.0.1:${srv.port}/ws?room=san-02&name=${encodeURIComponent(name)}`);

  it("?name= is normalised and shows in the snapshot; a taken name (person or NPC) gets a number", async () => {
    srv = await startServer();
    const a = named("  An\u202E ");
    const b = named("An");
    const resident = residentsFor("san-02")[0]?.name ?? "";
    const c = named(resident);
    const d = named("   ");
    srv.clients.push(a, b, c, d);
    await a.until(() => a.snapshot() !== undefined);
    await b.until(() => b.snapshot() !== undefined);
    await c.until(() => c.snapshot() !== undefined);
    await d.until(() => d.snapshot() !== undefined);
    expect(selfOf(a)?.name).toBe("An");
    expect(selfOf(b)?.name).toBe("An 2");
    expect(selfOf(c)?.name).toBe(`${resident} 2`);
    // Blank → a random name as before.
    expect(selfOf(d)?.name).toMatch(/^\p{Lu}\p{Ll}* \p{Lu}\p{Ll}*$/u);
  });

  it("rename → everyone, the renamer included, gets a profile + record frame with the new name", async () => {
    srv = await startServer();
    const a = named("An");
    srv.clients.push(a);
    await a.until(() => a.snapshot() !== undefined);
    const b = srv.connect("san-02");
    await b.until(() => b.snapshot() !== undefined);
    await a.until(() => a.frames.length >= 1); // b's join
    const me = selfOf(a);
    a.ws.send(JSON.stringify({ type: "rename", name: "Bình" }));
    const renamed = (c: TestClient) => c.frames.find((f) => f.profiles.some((p) => p.id === me?.id && p.name === "Bình"));
    await a.until(() => renamed(a) !== undefined);
    await b.until(() => renamed(b) !== undefined);
    for (const f of [renamed(a), renamed(b)]) {
      const slot = f?.profiles[0]?.slot;
      expect(f?.profiles).toHaveLength(1);
      expect(f?.records.map((r) => r.slot)).toEqual([slot]);
      expect(slot).toBe(me?.slot);
    }
    // The resync snapshot has it too.
    b.json.length = 0;
    b.ws.send(JSON.stringify({ type: "sync" }));
    await b.until(() => b.snapshot() !== undefined);
    expect(b.snapshot()?.visitors.find((v) => v.id === me?.id)?.name).toBe("Bình");
  });

  it("renaming to the current name or to garbage sends nothing", async () => {
    srv = await startServer();
    const a = named("An");
    srv.clients.push(a);
    await a.until(() => a.snapshot() !== undefined);
    a.ws.send(JSON.stringify({ type: "rename", name: " An " }));
    a.ws.send(JSON.stringify({ type: "rename", name: "\u0000" }));
    a.ws.send(JSON.stringify({ type: "rename", name: 5 }));
    a.ws.send(JSON.stringify({ type: "ping", clientTime: 1 }));
    await a.until(() => a.json.some((m) => m.type === "pong"));
    await new Promise((ok) => setTimeout(ok, 300));
    expect(a.frames).toHaveLength(0);
    expect(a.closeCode).toBeNull();
  });
});

describe("dozing (D25)", () => {
  it("sleep → others get a record flagged asleep, the snapshot has it, waking clears it", async () => {
    srv = await startServer();
    const a = srv.connect("san-02");
    await a.until(() => a.snapshot() !== undefined);
    const b = srv.connect("san-02");
    await b.until(() => b.snapshot() !== undefined);
    const snap = a.snapshot();
    const me = snap?.visitors.find((v) => v.id === snap.selfId);
    const flagged = (asleep: boolean) => b.frames.find((f) => f.records.some((r) => r.slot === me?.slot && Boolean(r.asleep) === asleep));

    a.ws.send(JSON.stringify({ type: "sleep", asleep: true }));
    await b.until(() => flagged(true) !== undefined);
    b.json.length = 0;
    b.ws.send(JSON.stringify({ type: "sync" }));
    await b.until(() => b.snapshot() !== undefined);
    expect(b.snapshot()?.visitors.find((v) => v.id === me?.id)?.asleep).toBe(true);

    b.frames.length = 0;
    a.ws.send(JSON.stringify({ type: "sleep", asleep: false }));
    await b.until(() => flagged(false) !== undefined);
  });
});
