import { describe, expect, it } from "vitest";
import type { Visitor } from "@santinh/shared";
import { EVENT_MAX_AGE_MS, EventFilter, SampleBuffer, needsRefresh, type Sample } from "./remote-avatars.ts";

describe("SampleBuffer", () => {
  const out: Sample = { t: 0, x: 0, z: 0, yaw: 0 };

  it("blends between the two samples around the render time", () => {
    const b = new SampleBuffer();
    b.push(0, 0, 0, 0);
    b.push(200, 2, 0, 0);
    const speed = b.sample(50, out);
    expect(out.x).toBeCloseTo(0.5);
    expect(speed).toBeCloseTo(10);
  });

  it("holds the last sample without extrapolating, then stops the legs", () => {
    const b = new SampleBuffer();
    b.push(0, 0, 0, 0);
    b.push(200, 1, 0, 0);
    expect(b.sample(300, out)).toBeGreaterThan(0);
    expect(out.x).toBe(1);
    expect(b.sample(1000, out)).toBe(0);
    expect(out.x).toBe(1);
  });

  it("turns the short way round", () => {
    const b = new SampleBuffer();
    b.push(0, 0, 0, Math.PI - 0.1);
    b.push(100, 0, 0, -Math.PI + 0.1);
    b.sample(50, out);
    expect(Math.abs(Math.abs(out.yaw) - Math.PI)).toBeLessThan(0.01);
  });

  it("keeps the newest 8 samples and ignores out-of-order ones", () => {
    const b = new SampleBuffer();
    for (let i = 0; i < 20; i++) b.push(i * 100, i, 0, 0);
    b.push(50, 99, 0, 0);
    expect(b.size).toBe(8);
    expect(b.lastTime).toBe(1900);
    b.sample(0, out);
    expect(out.x).toBe(12);
  });
});

describe("EventFilter", () => {
  it("drops repeats and events older than 10 s", () => {
    const f = new EventFilter();
    const e = { eventId: "a", visitorId: "bot:1", type: "hello" as const, at: 1000 };
    expect(f.accept(e, 1000)).toBe(true);
    expect(f.accept(e, 1100)).toBe(false);
    expect(f.accept({ ...e, eventId: "b" }, 1000 + EVENT_MAX_AGE_MS + 1)).toBe(false);
  });
});

describe("needsRefresh", () => {
  const v: Visitor = { id: "v:a", name: "An", color: "#fff", joinedAt: 0, pose: "walk", cushion: null, position: { x: 0, z: 0, yaw: 0 } };

  it("someone new, a seat change or a rename refreshes labels; a step alone does not", () => {
    expect(needsRefresh(undefined, v)).toBe(true);
    expect(needsRefresh(v, { ...v, cushion: 2 })).toBe(true);
    expect(needsRefresh(v, { ...v, name: "An 2" })).toBe(true);
    expect(needsRefresh(v, { ...v, position: { x: 1, z: 0, yaw: 0 } })).toBe(false);
  });
});
