import { describe, expect, it } from "vitest";
import {
  BOW_PERIOD_MS,
  HELLO_COOLDOWN_MS,
  MAX_SPEED,
  MOVE_SPEED,
  SPEED_TOLERANCE_M,
  isWalkable,
  seeded,
  segmentClear,
  spaceOf,
  type Visitor,
} from "@santinh/shared";
import { RoomState, SlidingWindow } from "../src/room-state.ts";

const space = spaceOf("san-01");

function visitor(id: string, x = space.spawn.x, z = space.spawn.z): Visitor {
  return { id, name: id, color: "#fff", joinedAt: 0, pose: "walk", cushion: null, position: { x, z, yaw: 0 } };
}

function clearPoint(from: { x: number; z: number }, d: number): { x: number; z: number } {
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const to = { x: from.x + Math.cos(a) * d, z: from.z + Math.sin(a) * d };
    if (segmentClear(space.collision, from, to)) return to;
  }
  throw new Error("boxed in");
}

/** Reserve the nearest cushion, then arrive on it the way the client does (a `kneel` move). */
function sitDown(s: RoomState, id: string, now: number) {
  const r = s.seat(id)!;
  const c = space.cushions[r.cushion]!;
  const { bow } = s.move(id, { x: c.x, z: c.z, yaw: 0, pose: "kneel" }, now);
  return { cushion: r.cushion, bow };
}

function setup(...ids: string[]): RoomState {
  const s = new RoomState("san-01", space);
  ids.forEach((id, i) => s.add(visitor(id), i + 4, 0));
  return s;
}

describe("RoomState.move", () => {
  it("accepts a normal step and marks dirty", () => {
    const s = setup("a");
    const p = s.get("a")!.visitor.position;
    expect(s.move("a", { x: p.x + 0.5, z: p.z, yaw: 1, pose: "walk" }, 200)).toEqual({ fix: null, bow: null });
    expect(s.get("a")?.visitor.position.x).toBeCloseTo(p.x + 0.5);
    expect(s.takeDirty()).toHaveLength(1);
    expect(s.takeDirty()).toHaveLength(0);
  });

  it("10 m in 0.2 s is corrected to the last valid position", () => {
    const s = setup("a");
    const p = { ...s.get("a")!.visitor.position };
    const { fix } = s.move("a", { x: p.x + 10, z: p.z, yaw: 0, pose: "walk" }, 200);
    expect(fix).toEqual(p);
    expect(s.get("a")?.visitor.position).toEqual(p);
    expect(MAX_SPEED * 0.2).toBeLessThan(10);
  });

  it("walking into a blocked spot is corrected", () => {
    const s = setup("a");
    const p = { ...s.get("a")!.visitor.position };
    // Outside the boundary is never walkable, even when the distance is small.
    const out = space.collision.boundary;
    const { fix } = s.move("a", { x: out.x + out.rx + 0.2, z: out.z, yaw: 0, pose: "walk" }, 100000);
    expect(fix).toEqual(p);
  });

  it("seated: position is fixed, yaw and pose change, walk pose ignored", () => {
    const s = setup("a");
    sitDown(s, "a", 500);
    const before = { ...s.get("a")!.visitor.position };
    expect(s.move("a", { x: before.x + 3, z: before.z, yaw: 2, pose: "beads" }, 1000).fix).toBeNull();
    const v = s.get("a")!.visitor;
    expect(v.position).toEqual({ ...before, yaw: 2 });
    expect(v.pose).toBe("beads");
    s.move("a", { x: before.x, z: before.z, yaw: 2, pose: "walk" }, 2000);
    expect(v.pose).toBe("beads");
  });

  it("kneel without a cushion is downgraded to walk", () => {
    const s = setup("a");
    const p = s.get("a")!.visitor.position;
    s.move("a", { x: p.x, z: p.z, yaw: 0, pose: "kneel" }, 100);
    expect(s.get("a")?.visitor.pose).toBe("walk");
  });
});

describe("RoomState.move speed budget", () => {
  const step = (s: RoomState, d: number, t: number) => {
    const p = s.get("a")!.visitor.position;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const to = { x: p.x + Math.cos(a) * d, z: p.z + Math.sin(a) * d };
      if (segmentClear(space.collision, p, to)) return s.move("a", { ...to, yaw: 0, pose: "walk" }, t).fix;
    }
    throw new Error("boxed in");
  };

  it("the slack is spent, not granted afresh every step: 2.29 m per 200 ms is cut off", () => {
    const s = setup("a");
    let accepted = 0;
    for (let i = 1; i <= 20; i++) if (step(s, 2.29, i * 200) === null) accepted++;
    // Over 4 s at most MAX_SPEED × 4 s + one slack is covered (was 20 × 2.29 = 45.8 m before the fix).
    expect(accepted * 2.29).toBeLessThanOrEqual(MAX_SPEED * 4 + SPEED_TOLERANCE_M);
    expect(accepted).toBeLessThan(20);
  });

  it("an honest walker (MOVE_SPEED, jittery ticks) is never corrected", () => {
    const s = setup("a");
    let t = 0;
    for (let i = 0; i < 100; i++) {
      const dt = i % 3 === 0 ? 50 : 300; // bunched / late packets
      t += dt;
      expect(step(s, (MOVE_SPEED * dt) / 1000, t)).toBeNull();
    }
  });
});

describe("RoomState.move after a refusal", () => {
  it("a refused move does not use up time: the next in-flight step is still judged over the whole gap", () => {
    const s = setup("a");
    const p = { ...s.get("a")!.visitor.position };
    expect(s.move("a", { x: p.x + 10, z: p.z, yaw: 0, pose: "walk" }, 200).fix).not.toBeNull();
    // 0.4 s since the last accepted move → 1.6 m + slack covers 2.5 m, though the refusal was only 0.2 s ago.
    const to = clearPoint(p, 2.5);
    expect(s.move("a", { ...to, yaw: 0, pose: "walk" }, 400).fix).toBeNull();
  });
});

describe("RoomState seats", () => {
  it("two seekers at the same spot get different cushions", () => {
    const s = setup("a", "b");
    const a = s.seat("a");
    const b = s.seat("b");
    expect(a && b && a.cushion !== b.cushion).toBe(true);
  });

  it("never hands out resident cushions; runs out → null", () => {
    const ids = Array.from({ length: space.cushions.length }, (_, i) => `v${i}`);
    const s = setup(...ids);
    const got = new Set<number>();
    for (const id of ids) {
      const r = s.seat(id);
      if (r) got.add(r.cushion);
    }
    expect(got.size).toBe(space.cushions.length - space.residentCushions.length);
    for (const c of space.residentCushions) expect(got.has(c)).toBe(false);
    expect(s.seat(ids[0]!)?.cushion).toBeDefined(); // re-seat keeps/gets one
    expect(s.seat("v-none")).toBeNull();
  });

  it("seats from the server-held position, so a far cushion cannot be reached in one message", () => {
    const s = setup("a");
    const p = s.get("a")!.visitor.position;
    const nearest = space.cushions
      .map((c, i) => ({ i, d: Math.hypot(c.x - p.x, c.z - p.z) }))
      .filter((c) => !space.residentCushions.includes(c.i))
      .sort((x, y) => x.d - y.d)[0]!;
    expect(s.seat("a")?.cushion).toBe(nearest.i);
  });

  it("a grant only reserves: no cushion on the wire, no jump, no bow until the visitor arrives", () => {
    const s = setup("a");
    const before = { ...s.get("a")!.visitor.position };
    const r = s.seat("a")!;
    expect(s.get("a")!.visitor).toMatchObject({ cushion: null, pose: "walk", position: before });
    expect(s.takeDirty()).toHaveLength(0);
    const c = space.cushions[r.cushion]!;
    const { bow } = s.move("a", { x: c.x, z: c.z, yaw: 0, pose: "kneel" }, 300);
    expect(bow).toMatchObject({ type: "bow", visitorId: "a" });
    expect(s.get("a")!.visitor).toMatchObject({ cushion: r.cushion, pose: "kneel", bowAt: 300, position: { x: c.x, z: c.z } });
  });

  it("a reserved cushion is skipped by the next seeker", () => {
    const s = setup("a", "b");
    expect(s.seat("b")!.cushion).not.toBe(s.seat("a")!.cushion);
  });

  it("standing up halfway leaves the walker where it is (no snap back onto the cushion)", () => {
    const s = setup("a");
    s.seat("a");
    const p = { ...s.get("a")!.visitor.position };
    s.stand("a");
    expect(s.move("a", { ...clearPoint(p, 0.4), yaw: 0, pose: "walk" }, 200).fix).toBeNull();
    expect(s.get("a")!.visitor.cushion).toBeNull();
  });

  it("a repeated seat returns the same cushion and never a second bow", () => {
    const s = setup("a");
    const first = sitDown(s, "a", 100);
    expect(first.bow).not.toBeNull();
    for (let i = 0; i < 10; i++) expect(s.seat("a")).toEqual({ cushion: first.cushion });
    expect(s.move("a", { x: 0, z: 0, yaw: 0, pose: "kneel" }, 200).bow).toBeNull();
  });

  it("stand frees the cushion and clears bowAt", () => {
    const s = setup("a", "b");
    const a = s.seat("a")!;
    s.stand("a");
    expect(s.get("a")?.visitor).toMatchObject({ pose: "walk", cushion: null });
    expect(s.get("a")?.visitor.bowAt).toBeUndefined();
    expect(s.seat("b")?.cushion).toBe(a.cushion);
  });

  it("leaving frees the cushion", () => {
    const s = setup("a", "b");
    const a = s.seat("a")!;
    s.remove("a");
    expect(s.seat("b")?.cushion).toBe(a.cushion);
  });
});

describe("RoomState events", () => {
  it("hello twice within the cooldown → one event", () => {
    const s = setup("a");
    expect(s.hello("a", 1000)).toMatchObject({ type: "hello", eventId: "san-01:1" });
    expect(s.hello("a", 2000)).toBeNull();
    expect(s.hello("a", 1000 + HELLO_COOLDOWN_MS)).not.toBeNull();
  });

  it("bowAgain: standing or still walking to a cushion → null", () => {
    const s = setup("a");
    expect(s.bowAgain("a", 10_000)).toBeNull();
    s.seat("a");
    expect(s.bowAgain("a", 10_000)).toBeNull();
    expect(s.get("a")!.visitor.bowAt).toBeUndefined();
    expect(s.takeDirty()).toHaveLength(0);
    expect(s.bowAgain("nobody", 10_000)).toBeNull();
  });

  it("bowAgain while seated: new bowAt + one event, at most once per BOW_PERIOD_MS", () => {
    const s = setup("a");
    sitDown(s, "a", 1000);
    s.takeDirty();
    // The sit-down bow is still running.
    expect(s.bowAgain("a", 1000 + BOW_PERIOD_MS - 1)).toBeNull();
    const at = 1000 + BOW_PERIOD_MS;
    expect(s.bowAgain("a", at)).toMatchObject({ type: "bow", visitorId: "a", at });
    expect(s.get("a")!.visitor).toMatchObject({ bowAt: at, pose: "kneel" });
    expect(s.takeDirty().map((e) => e.visitor.id)).toEqual(["a"]);
    expect(s.bowAgain("a", at + 200)).toBeNull();
    expect(s.bowAgain("a", at + BOW_PERIOD_MS - 1)).toBeNull();
    expect(s.get("a")!.visitor.bowAt).toBe(at);
    expect(s.bowAgain("a", at + BOW_PERIOD_MS)).not.toBeNull();
  });

  it("bead is capped at one per BEAD_EVERY_MS", () => {
    const s = setup("a");
    expect(s.bead("a", 5000)).not.toBeNull();
    expect(s.bead("a", 5200)).toBeNull();
    expect(s.bead("a", 6100)).not.toBeNull();
  });
});

describe("SlidingWindow", () => {
  it("trips only above the limit within the window", () => {
    const w = new SlidingWindow(3, 1000);
    expect([0, 100, 200].map((t) => w.hit(t))).toEqual([false, false, false]);
    expect(w.hit(300)).toBe(true);
    expect(w.hit(1500)).toBe(false);
  });
});

describe("placeNear", () => {
  it("never picks a spot behind a wall, column or pond edge", () => {
    const rng = seeded(7);
    let tried = 0;
    // Hosts all over the walkable ground, many close to walls.
    for (let x = -40; x <= 40; x += 0.7) {
      for (let z = -40; z <= 40; z += 0.7) {
        if (!isWalkable(space.collision, x, z)) continue;
        const s = new RoomState("san-01", space);
        s.add(visitor("v:host", x, z), 4, 0);
        const p = s.placeNear("v:host", rng);
        if (!p) continue;
        tried++;
        expect(segmentClear(space.collision, { x, z }, p), `host ${x.toFixed(1)},${z.toFixed(1)}`).toBe(true);
      }
    }
    expect(tried).toBeGreaterThan(200);
  });
});
