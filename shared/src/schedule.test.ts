import { describe, expect, it } from "vitest";
import { ceremonyAt, dayPhase, vnTimeOfDay } from "./schedule.ts";

/** UTC ms for a wall-clock time in Vietnam (UTC+7). */
const vn = (d: number, h: number, m = 0, s = 0): number => Date.UTC(2026, 9, d, h - 7, m, s);
const DURATION_S = 20 * 60;

describe("vnTimeOfDay", () => {
  it("shifts UTC by +7 h and wraps at midnight", () => {
    expect(vnTimeOfDay(Date.UTC(2026, 9, 31, 17, 0))).toBe(0);
    expect(vnTimeOfDay(vn(31, 5, 30))).toBe(5.5 * 3_600_000);
  });
});

describe("dayPhase", () => {
  it("switches isDay exactly at 06:00 and 18:00 VN", () => {
    expect(dayPhase(vn(31, 5, 59)).isDay).toBe(false);
    expect(dayPhase(vn(31, 6, 0)).isDay).toBe(true);
    expect(dayPhase(vn(31, 17, 59)).isDay).toBe(true);
    expect(dayPhase(vn(31, 18, 0)).isDay).toBe(false);
  });

  it("blends daylight over 20 minutes around each boundary", () => {
    expect(dayPhase(vn(31, 0, 0)).t).toBe(0);
    expect(dayPhase(vn(31, 5, 49)).t).toBe(0);
    expect(dayPhase(vn(31, 6, 0)).t).toBeCloseTo(0.5);
    expect(dayPhase(vn(31, 6, 10)).t).toBe(1);
    expect(dayPhase(vn(31, 12, 0)).t).toBe(1);
    expect(dayPhase(vn(31, 18, 0)).t).toBeCloseTo(0.5);
    expect(dayPhase(vn(31, 18, 10)).t).toBe(0);
  });
});

describe("ceremonyAt", () => {
  it("is active at 05:00 VN with offset 0, and tracks the offset", () => {
    expect(ceremonyAt(vn(31, 5, 0), DURATION_S)).toEqual({
      active: { startsAt: vn(31, 5, 0), offsetSeconds: 0 },
      next: vn(31, 18, 0),
    });
    expect(ceremonyAt(vn(31, 5, 7, 30), DURATION_S).active?.offsetSeconds).toBe(450);
  });

  it("is active at 18:00 VN", () => {
    expect(ceremonyAt(vn(31, 18, 0), DURATION_S).active?.startsAt).toBe(vn(31, 18, 0));
  });

  it("ends after the duration", () => {
    const s = ceremonyAt(vn(31, 5, 20), DURATION_S);
    expect(s.active).toBeNull();
    expect(s.next).toBe(vn(31, 18, 0));
  });

  it("points past midnight to tomorrow's 05:00", () => {
    const s = ceremonyAt(vn(31, 23, 30), DURATION_S);
    expect(s.active).toBeNull();
    expect(s.next).toBe(vn(32, 5, 0));
  });

  it("just after VN midnight (still the previous UTC day) points to the same VN morning", () => {
    expect(ceremonyAt(vn(31, 0, 30), DURATION_S).next).toBe(vn(31, 5, 0));
  });

  it("keeps a long chant that crosses midnight active", () => {
    const s = ceremonyAt(vn(32, 0, 30), 8 * 3600);
    expect(s.active?.startsAt).toBe(vn(31, 18, 0));
    expect(s.active?.offsetSeconds).toBe(6.5 * 3600);
  });
});
