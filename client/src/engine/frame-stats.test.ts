import { describe, expect, it } from "vitest";
import { FrameStats } from "./frame-stats.ts";

describe("FrameStats", () => {
  it("summarises fps, median, p95 and worst", () => {
    const s = new FrameStats();
    for (let i = 0; i < 95; i++) s.push(10);
    for (let i = 0; i < 5; i++) s.push(40);
    const r = s.summary();
    expect(r.median).toBe(10);
    expect(r.p95).toBe(10);
    expect(r.worst).toBe(40);
    expect(r.fps).toBeCloseTo(1000 / 11.5);
  });

  it("only looks at the newest frames when asked", () => {
    const s = new FrameStats();
    for (let i = 0; i < 100; i++) s.push(50);
    for (let i = 0; i < 10; i++) s.push(16);
    expect(s.summary(10).worst).toBe(16);
  });

  it("keeps only the last 600 frames", () => {
    const s = new FrameStats();
    for (let i = 0; i < 700; i++) s.push(i < 100 ? 99 : 5);
    expect(s.size).toBe(600);
    expect(s.summary().worst).toBe(5);
  });

  it("returns zeros when empty", () => {
    expect(new FrameStats().summary()).toEqual({ fps: 0, median: 0, p95: 0, worst: 0 });
  });
});
