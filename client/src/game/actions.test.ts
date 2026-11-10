import { describe, expect, it } from "vitest";
import { BOW_PERIOD_MS, spaceOf, type Pose } from "@santinh/shared";
import { Movement } from "../controls/movement.ts";
import { vi as copy } from "../i18n/vi.ts";
import { Actions, HELLO_COOLDOWN_MS, SEEK_TIMEOUT_S, type ActionToast } from "./actions.ts";

const DT = 1 / 60;
const space = spaceOf("san-01");

interface Rig {
  actions: Actions;
  movement: Movement;
  poses: Pose[];
  calls: string[];
  toasts: ActionToast[];
  clock: { now: number };
  setSeat(seat: number | null): void;
  setConnected(c: boolean): void;
  frames(seconds: number, onFrame?: () => void): Promise<void>;
  /** Lạy, then frames until on the cushion (far start: snaps at once). */
  sit(): Promise<void>;
}

function rig(start = { x: 0, z: 4, yaw: Math.PI }): Rig {
  const movement = new Movement(space, start);
  const poses: Pose[] = [];
  const calls: string[] = [];
  const toasts: ActionToast[] = [];
  const clock = { now: 1_000_000 };
  let seat: number | null = 2;
  let connected = true;
  const avatar = {
    pose: "walk" as Pose,
    asleep: false,
    setPose(p: Pose) {
      this.pose = p;
      poses.push(p);
    },
    setAsleep(a: boolean) {
      this.asleep = a;
    },
  };
  const actions = new Actions({
    space,
    net: {
      requestSeat: () => {
        calls.push("requestSeat");
        return Promise.resolve(seat);
      },
      stand: () => calls.push("stand"),
      hello: () => calls.push("hello"),
      bead: () => calls.push("bead"),
      bow: () => calls.push("bow"),
      sendMove: (_p, pose) => calls.push(`move:${pose}`),
      setAsleep: (a) => calls.push(a ? "sleep" : "wake"),
    },
    mover: movement,
    avatar,
    connected: () => connected,
    serverNow: () => clock.now,
    obstacles: () => [],
  });
  actions.on("toast", (t) => toasts.push(t));
  return {
    actions,
    movement,
    poses,
    calls,
    toasts,
    clock,
    setSeat: (s) => (seat = s),
    setConnected: (c) => (connected = c),
    async frames(seconds, onFrame) {
      await Promise.resolve();
      for (let i = 0; i < seconds / DT; i++) {
        clock.now += DT * 1000;
        movement.update(DT, clock.now);
        actions.update(DT);
        onFrame?.();
      }
    },
    async sit() {
      actions.bow();
      for (let i = 0; i < 600 && actions.state !== "kneeling"; i++) await this.frames(DT);
      expect(actions.state).toBe("kneeling");
    },
  };
}

describe("Actions", () => {
  it("bow: requests a seat, walks to it, kneels facing the altar", async () => {
    const r = rig();
    r.actions.bow();
    expect(r.actions.state).toBe("seeking-seat");
    await r.frames(0.5);
    expect(r.actions.cushion).toBe(2);
    expect(r.movement.walking).toBe(true);
    await r.frames(8);
    const c = space.cushions[2] ?? { x: 0, z: 0, yaw: 0 };
    expect(r.actions.state).toBe("kneeling");
    expect(r.actions.seated).toBe(true);
    expect(r.movement.position).toEqual({ x: c.x, z: c.z, yaw: c.yaw });
    expect(r.poses.at(-1)).toBe("kneel");
    expect(r.toasts.at(-1)?.text).toBe(copy.toast.bowing);
    // Others must see the kneel even when the last walk step already sent the cushion position.
    expect(r.calls.at(-1)).toBe("move:kneel");
  });

  it("far away (at the gate): toast to go inside first, nothing reserved (AC8 ≤ 10 s)", async () => {
    const r = rig({ x: 0, z: 38, yaw: Math.PI });
    r.actions.bow();
    await r.frames(0.1);
    expect(r.actions.state).toBe("idle");
    expect(r.calls).not.toContain("requestSeat");
    expect(r.toasts).toEqual([{ text: copy.toast.tooFarToBow, kind: "info" }]);
  });

  it("outside the front wall: walks round through the door, no snap", async () => {
    const r = rig({ x: 6, z: 16.5, yaw: Math.PI });
    r.setSeat(28);
    const c = space.cushions[28]!;
    let teleports = 0;
    r.actions.on("teleport", () => teleports++);
    r.actions.bow();
    let last = { ...r.movement.position };
    let maxStep = 0;
    let crossedAt: number | null = null;
    await r.frames(SEEK_TIMEOUT_S, () => {
      const p = r.movement.position;
      maxStep = Math.max(maxStep, Math.hypot(p.x - last.x, p.z - last.z));
      if (crossedAt === null && last.z >= 14 && p.z < 14) crossedAt = p.x;
      last = { ...p };
    });
    expect(r.actions.state).toBe("kneeling");
    expect(teleports).toBe(0);
    expect(maxStep, "no jump").toBeLessThan(0.1);
    expect(Math.abs(crossedAt ?? Infinity), "came in through the door").toBeLessThan(3.5);
    expect(r.movement.position).toEqual({ x: c.x, z: c.z, yaw: c.yaw });
  });

  it("granted cushion beyond the walk budget: gives it back, toast, idle", async () => {
    // Nearest cushion is a short walk (passes the pre-check), but the server hands out a back-row one.
    const r = rig({ x: 0, z: 16, yaw: Math.PI });
    r.setSeat(2);
    r.actions.bow();
    await r.frames(0.1);
    expect(r.calls).toContain("requestSeat");
    expect(r.calls).toContain("stand");
    expect(r.actions.state).toBe("idle");
    expect(r.actions.cushion).toBeNull();
    expect(r.movement.walking).toBe(false);
    expect(r.toasts.at(-1)?.text).toBe(copy.toast.tooFarToBow);
  });

  it("no free cushion: toast, back to idle", async () => {
    const r = rig();
    r.setSeat(null);
    r.actions.bow();
    await r.frames(0.1);
    expect(r.actions.state).toBe("idle");
    expect(r.actions.cushion).toBeNull();
    expect(r.toasts).toEqual([{ text: copy.toast.noCushion, kind: "warn" }]);
  });

  it("not connected: toast, no request", () => {
    const r = rig();
    r.setConnected(false);
    r.actions.bow();
    expect(r.calls).toEqual([]);
    expect(r.toasts[0]?.text).toBe(copy.toast.notConnected);
  });

  it("Dừng during the sitting-down bow: that bow is the last one, stand when it ends (no second bow sent)", async () => {
    const r = rig();
    let bells = 0;
    r.actions.on("bell", () => bells++);
    await r.sit();
    await r.frames(1);
    r.actions.bow();
    expect(r.actions.state).toBe("rising");
    expect(r.calls).not.toContain("bow");
    expect(r.calls).not.toContain("stand");
    await r.frames(BOW_PERIOD_MS / 1000 - 1.2);
    expect(r.actions.cushion).not.toBeNull();
    await r.frames(0.4);
    expect(r.calls.filter((c) => c === "stand")).toHaveLength(1);
    expect(r.actions.state).toBe("idle");
    expect(r.poses.at(-1)).toBe("walk");
    expect(bells).toBe(1);
  });

  it("Dừng after the first bow: bow once (one bell), stand after BOW_PERIOD_MS", async () => {
    const r = rig();
    await r.sit();
    await r.frames(BOW_PERIOD_MS / 1000 + 1);
    let bells = 0;
    r.actions.on("bell", () => bells++);
    r.actions.bow();
    expect(r.calls.at(-1)).toBe("bow");
    expect(r.actions.state).toBe("rising");
    expect(r.actions.bowing).toBe(true);
    expect(r.actions.seated).toBe(true);
    expect(r.poses.at(-1)).toBe("kneel");
    await r.frames(BOW_PERIOD_MS / 1000 - 0.2);
    expect(r.calls).not.toContain("stand");
    expect(r.actions.cushion).not.toBeNull();
    await r.frames(0.4);
    expect(bells).toBe(1);
    expect(r.calls.filter((c) => c === "stand")).toHaveLength(1);
    expect(r.actions.state).toBe("idle");
    expect(r.actions.cushion).toBeNull();
    expect(r.poses.at(-1)).toBe("walk");
  });

  it("Dừng twice: stands at once, no second bow", async () => {
    const r = rig();
    await r.sit();
    await r.frames(BOW_PERIOD_MS / 1000 + 1);
    r.actions.bow();
    await r.frames(0.5);
    r.actions.bow();
    expect(r.calls.filter((c) => c === "bow")).toHaveLength(1);
    expect(r.calls.at(-1)).toBe("stand");
    expect(r.actions.state).toBe("idle");
    await r.frames(BOW_PERIOD_MS / 1000);
    expect(r.calls.filter((c) => c === "stand")).toHaveLength(1);
  });

  it("walking (WASD) during the rising bow stands at once", async () => {
    const r = rig();
    await r.sit();
    await r.frames(BOW_PERIOD_MS / 1000 + 1);
    r.actions.bow();
    await r.frames(0.5);
    r.actions.interrupt();
    expect(r.calls.at(-1)).toBe("stand");
    r.movement.setDirection(0, 1);
    await r.frames(0.5);
    expect(r.actions.state).toBe("walking");
    expect(r.actions.cushion).toBeNull();
  });

  it("offline or bead screen open: Dừng stands at once without a bow", async () => {
    const r = rig();
    await r.sit();
    await r.frames(BOW_PERIOD_MS / 1000 + 1);
    r.setConnected(false);
    r.actions.bow();
    expect(r.calls).not.toContain("bow");
    expect(r.actions.state).toBe("idle");

    const s = rig();
    await s.sit();
    await s.frames(BOW_PERIOD_MS / 1000 + 1);
    s.actions.toggleBeads();
    s.actions.bow();
    expect(s.calls).not.toContain("bow");
    expect(s.calls).toContain("stand");
  });

  it("a room snapshot without our cushion cancels the rising bow", async () => {
    const r = rig();
    await r.sit();
    await r.frames(BOW_PERIOD_MS / 1000 + 1);
    r.actions.bow();
    r.actions.syncSelf(null, null);
    expect(r.actions.state).toBe("idle");
    expect(r.actions.cushion).toBeNull();
    await r.frames(BOW_PERIOD_MS / 1000);
    expect(r.calls).not.toContain("stand");
  });

  it("walking (tap / WASD) while kneeling or seeking stands up", async () => {
    const r = rig();
    r.actions.bow();
    await r.frames(8);
    r.actions.interrupt();
    r.movement.setDirection(0, 1);
    await r.frames(0.5);
    expect(r.actions.state).toBe("walking");
    expect(r.actions.cushion).toBeNull();

    // Cancel on the way: the late grant must not seat us.
    const s = rig();
    s.actions.bow();
    s.actions.interrupt();
    await s.frames(1);
    expect(s.actions.state).toBe("idle");
    expect(s.actions.cushion).toBeNull();
    expect(s.calls).toEqual(["requestSeat", "stand"]);
  });

  it("sitting down: one bow, one bell, then still (12 s seated = 1 bell)", async () => {
    const r = rig();
    let bells = 0;
    r.actions.on("bell", () => bells++);
    await r.sit();
    await r.frames(12);
    expect(bells).toBe(1);
    expect(r.actions.state).toBe("kneeling");
  });

  it("hello: pose + network once per cooldown, kneeling is kept", async () => {
    const r = rig();
    r.actions.hello();
    r.actions.hello();
    expect(r.calls.filter((c) => c === "hello")).toHaveLength(1);
    expect(r.actions.state).toBe("hello");
    await r.frames(2.1);
    expect(r.actions.state).toBe("idle");
    r.clock.now += HELLO_COOLDOWN_MS;
    r.actions.hello();
    expect(r.calls.filter((c) => c === "hello")).toHaveLength(2);

    const k = rig();
    k.actions.bow();
    await k.frames(8);
    k.actions.hello();
    await k.frames(2.1);
    expect(k.actions.state).toBe("kneeling");
    expect(k.actions.cushion).toBe(2);
  });

  it("beads: opens the screen with the bead pose, closing restores the pose", () => {
    const r = rig();
    const open: boolean[] = [];
    r.actions.on("beads", (b) => open.push(b));
    r.actions.toggleBeads();
    expect(r.actions.state).toBe("beads");
    expect(r.poses.at(-1)).toBe("beads");
    r.actions.closeBeads();
    expect(r.actions.state).toBe("idle");
    expect(r.poses.at(-1)).toBe("walk");
    expect(open).toEqual([true, false]);
    expect(r.calls).toEqual(["move:beads", "move:walk"]);
  });

  it("bead(): sends a bead event only while the screen is open and connected", () => {
    const r = rig();
    r.actions.bead();
    r.actions.toggleBeads();
    r.actions.bead();
    r.setConnected(false);
    r.actions.bead();
    expect(r.calls.filter((c) => c === "bead")).toHaveLength(1);
  });

  it("a snapshot without our cushion drops the seat", async () => {
    const r = rig();
    r.actions.bow();
    await r.frames(8);
    r.actions.syncSelf(null, null);
    expect(r.actions.state).toBe("idle");
    expect(r.actions.cushion).toBeNull();
    // Seated and missing from the snapshot: the server already dropped it, nothing to release.
    expect(r.calls).not.toContain("stand");
  });

  it("a snapshot while still walking to the granted cushion releases the server's reservation", async () => {
    const r = rig();
    r.actions.bow();
    await r.frames(0.5);
    expect(r.movement.walking).toBe(true);
    r.actions.syncSelf(null, null);
    expect(r.actions.state).toBe("idle");
    expect(r.calls.at(-1)).toBe("stand");
    // The walk stops too: no arriving at a released cushion standing.
    expect(r.movement.heading).toBeNull();
    await r.frames(8);
    expect(r.actions.state).toBe("idle");
  });

  it("a resync while walking to a cushion the server still holds keeps the walk", async () => {
    const r = rig();
    r.actions.bow();
    await r.frames(0.5);
    r.actions.syncSelf(null, 2);
    expect(r.actions.state).toBe("seeking-seat");
    expect(r.calls).not.toContain("stand");
    await r.frames(8);
    expect(r.actions.state).toBe("kneeling");
    expect(r.actions.cushion).toBe(2);
  });

  it("a resync naming another cushion than ours releases ours", async () => {
    const r = rig();
    r.actions.bow();
    await r.frames(0.5);
    r.actions.syncSelf(null, 5);
    expect(r.actions.state).toBe("idle");
    expect(r.calls.at(-1)).toBe("stand");
  });

  it("sleep on a cushion keeps the cushion; wake goes back to kneeling (D25)", async () => {
    const r = rig();
    await r.sit();
    expect(r.actions.sleep()).toBe(true);
    expect(r.actions.asleep).toBe(true);
    expect(r.calls.at(-1)).toBe("sleep");
    expect(r.actions.cushion).toBe(2);
    expect(r.actions.state).toBe("kneeling");
    r.actions.wake();
    expect(r.actions.asleep).toBe(false);
    expect(r.calls.at(-1)).toBe("wake");
    expect(r.actions.cushion).toBe(2);
  });

  it("sleep while standing stops the walk, closes beads; not while seeking a seat", async () => {
    const r = rig();
    r.actions.bow();
    expect(r.actions.sleep()).toBe(false);
    expect(r.calls).not.toContain("sleep");
    r.actions.interrupt();
    r.actions.toggleBeads();
    expect(r.actions.sleep()).toBe(true);
    expect(r.actions.beadsOpen).toBe(false);
    expect(r.movement.walking).toBe(false);
    // Twice is one message.
    r.actions.sleep();
    expect(r.calls.filter((c) => c === "sleep")).toHaveLength(1);
  });
});
