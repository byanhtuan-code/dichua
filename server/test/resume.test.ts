import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { RENAME_COOLDOWN_MS, RESUME_GRACE_MS, TICK_MS, decodeDelta, type DeltaFrame, type ServerMsg } from "@santinh/shared";
import { Room } from "../src/room.ts";

type Snapshot = Extract<ServerMsg, { type: "snapshot" }>;

class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  terminated = false;
  sent: unknown[] = [];
  send(data: unknown): void {
    this.sent.push(data);
  }
  ping(): void {}
  terminate(): void {
    this.terminated = true;
    this.readyState = 3;
    this.emit("close");
  }
  close(): void {
    this.readyState = 3;
    this.emit("close");
  }
  snapshot(): Snapshot {
    const snap = this.sent
      .filter((d): d is string => typeof d === "string")
      .map((d) => JSON.parse(d) as ServerMsg)
      .find((m): m is Snapshot => m.type === "snapshot");
    if (!snap) throw new Error("no snapshot");
    return snap;
  }
  self(): Snapshot["visitors"][number] {
    const s = this.snapshot();
    const me = s.visitors.find((v) => v.id === s.selfId);
    if (!me) throw new Error("not in own snapshot");
    return me;
  }
  removed(): string[] {
    return this.frames().flatMap((f) => f.removed);
  }
  frames(): DeltaFrame[] {
    return this.sent.filter((d) => typeof d !== "string").flatMap((d) => decodeDelta(d as Buffer) ?? []);
  }
  /** Names this socket heard for visitor `id` in delta profiles, oldest first. */
  namesOf(id: string): string[] {
    return this.frames().flatMap((f) => f.profiles.filter((p) => p.id === id).map((p) => p.name));
  }
  say(msg: unknown): void {
    this.emit("message", JSON.stringify(msg), false);
  }
}
const asWs = (s: FakeSocket): WebSocket => s as unknown as WebSocket;

describe("resume", () => {
  let now = 0;
  let room: Room;
  beforeEach(() => {
    now = 1_000_000;
    vi.useFakeTimers();
    room = new Room("san-01", 30, () => now);
  });
  afterEach(() => {
    room.closeAll(1001);
    vi.useRealTimers();
  });

  it("coming back within the grace time with the token gives the same visitor, on foot, with a fresh token", () => {
    const a = new FakeSocket();
    room.join(asWs(a));
    const first = a.self();
    const token = a.snapshot().resume;
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);
    a.close();

    now += RESUME_GRACE_MS - 1;
    const back = new FakeSocket();
    room.join(asWs(back), null, token);
    expect(back.snapshot().selfId).toBe(first.id);
    expect(back.self()).toMatchObject({ name: first.name, color: first.color, position: first.position, cushion: null, pose: "walk" });
    expect(back.snapshot().resume).not.toBe(token);

    // A token works once: a second socket with it is a newcomer.
    back.close();
    const again = new FakeSocket();
    room.join(asWs(again), null, token);
    expect(again.snapshot().selfId).not.toBe(first.id);
  });

  it("after the grace time, or with a token this room never issued, you are a newcomer", () => {
    const a = new FakeSocket();
    room.join(asWs(a));
    const id = a.snapshot().selfId;
    const token = a.snapshot().resume;
    a.close();
    now += RESUME_GRACE_MS;
    const late = new FakeSocket();
    room.join(asWs(late), null, token);
    expect(late.snapshot().selfId).not.toBe(id);

    const stranger = new FakeSocket();
    room.join(asWs(stranger), null, "A".repeat(22));
    expect(stranger.snapshot().selfId).not.toBe(id);
  });

  it("a new socket with the token of a socket the server still holds takes over: one visitor, old socket dropped", () => {
    const a = new FakeSocket();
    const watcher = new FakeSocket();
    room.join(asWs(a));
    room.join(asWs(watcher));
    const id = a.snapshot().selfId;

    const b = new FakeSocket();
    room.join(asWs(b), null, a.snapshot().resume);
    expect(a.terminated).toBe(true);
    expect(b.snapshot().selfId).toBe(id);
    expect(b.snapshot().visitors.filter((v) => v.id === id)).toHaveLength(1);
    expect(room.size).toBe(2);
    // Others see the old one leave before the same id comes back.
    expect(watcher.removed()).toContain(id);
  });
});

describe("names: resume + rename cooldown", () => {
  let now = 0;
  let room: Room;
  beforeEach(() => {
    now = 1_000_000;
    vi.useFakeTimers();
    room = new Room("san-01", 30, () => now);
  });
  afterEach(() => {
    room.closeAll(1001);
    vi.useRealTimers();
  });
  /** Moves both clocks: the room reads `now`, its tick runs on fake timers. */
  const wait = (ms: number): void => {
    now += ms;
    vi.advanceTimersByTime(ms);
  };

  it("resume with a new ?name= keeps the id and takes the new name; without one keeps the old name", () => {
    const a = new FakeSocket();
    room.join(asWs(a), null, null, "An");
    const { id } = a.self();
    const token = a.snapshot().resume;
    a.close();
    wait(1000);
    const back = new FakeSocket();
    room.join(asWs(back), null, token, "Bình");
    expect(back.self()).toMatchObject({ id, name: "Bình" });

    const token2 = back.snapshot().resume;
    back.close();
    const again = new FakeSocket();
    room.join(asWs(again), null, token2);
    expect(again.self()).toMatchObject({ id, name: "Bình" });
  });

  it("resume without ?name= while someone else took the old name → the old name gets a number", () => {
    const a = new FakeSocket();
    room.join(asWs(a), null, null, "An");
    const { id } = a.self();
    const token = a.snapshot().resume;
    a.close();
    const b = new FakeSocket();
    room.join(asWs(b), null, null, "An");
    expect(b.self().name).toBe("An");
    const back = new FakeSocket();
    room.join(asWs(back), null, token);
    expect(back.self()).toMatchObject({ id, name: "An 2" });
  });

  it("two renames inside the cooldown: the second waits, then the room sees only the newest name", () => {
    const a = new FakeSocket();
    const b = new FakeSocket();
    room.join(asWs(a), null, null, "An");
    room.join(asWs(b));
    const { id } = a.self();

    a.say({ type: "rename", name: "Bình" });
    // a joined before b, so b only hears the rename; a hears its own.
    expect(b.namesOf(id)).toEqual(["Bình"]);
    expect(a.namesOf(id)).toEqual(["Bình"]);

    wait(1000);
    a.say({ type: "rename", name: "Chi" });
    a.say({ type: "rename", name: "Dung" });
    wait(TICK_MS);
    expect(b.namesOf(id)).toEqual(["Bình"]);

    wait(RENAME_COOLDOWN_MS - 1000);
    expect(b.namesOf(id)).toEqual(["Bình", "Dung"]);
    expect(a.namesOf(id)).toEqual(["Bình", "Dung"]);
    wait(RENAME_COOLDOWN_MS);
    expect(b.namesOf(id)).toEqual(["Bình", "Dung"]);
  });

  it("a rename to a name someone else holds gets a number", () => {
    const a = new FakeSocket();
    const b = new FakeSocket();
    room.join(asWs(a), null, null, "An");
    room.join(asWs(b), null, null, "Bình");
    b.say({ type: "rename", name: "An" });
    expect(a.namesOf(b.self().id)).toEqual(["Bình", "An 2"]);
    // Renaming to the name you already hold (after numbering) is a no-op.
    wait(RENAME_COOLDOWN_MS);
    b.say({ type: "rename", name: "An" });
    expect(a.namesOf(b.self().id)).toEqual(["Bình", "An 2"]);
  });
});
