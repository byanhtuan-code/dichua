import type { Visitor } from "@santinh/shared";
import { describe, expect, it } from "vitest";
import { vi } from "../i18n/vi.ts";
import { ceremonyLabel } from "./ceremony-banner.ts";
import { buildRoster } from "./people-dialog.ts";

const v = (id: string, joinedAt: number): Visitor => ({
  id,
  name: id,
  color: "#fff",
  joinedAt,
  pose: "walk",
  cushion: null,
  position: { x: 0, z: 0, yaw: 0 },
});

describe("people roster", () => {
  it("lists us first, others by arrival, residents apart", () => {
    const r = buildRoster([v("b", 3), v("resident:1", 0), v("me", 9), v("a", 1)], "me");
    expect(r.visitors.map((p) => p.id)).toEqual(["me", "a", "b"]);
    expect(r.visitors[0]?.self).toBe(true);
    expect(r.residents.map((p) => p.id)).toEqual(["resident:1"]);
  });
});

describe("ceremony banner", () => {
  // 2026-11-01 at hh:mm Vietnam time (UTC+7).
  const vn = (h: number, m: number): number => Date.UTC(2026, 10, 1, h - 7, m);
  it("shows morning / evening only during the session", () => {
    expect(ceremonyLabel(vn(5, 10))).toBe(vi.ceremony.morning);
    expect(ceremonyLabel(vn(18, 0))).toBe(vi.ceremony.evening);
    expect(ceremonyLabel(vn(4, 59))).toBeNull();
    expect(ceremonyLabel(vn(12, 0))).toBeNull();
  });
});
