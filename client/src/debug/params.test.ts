import { describe, expect, it } from "vitest";
import { parseParams, parseTimeOfDay } from "./params.ts";

describe("parseTimeOfDay", () => {
  it("parses HH:MM and rejects junk", () => {
    expect(parseTimeOfDay("12:00")).toBe(12 * 3_600_000);
    expect(parseTimeOfDay("6:05")).toBe((6 * 60 + 5) * 60_000);
    expect(parseTimeOfDay("24:00")).toBeNull();
    expect(parseTimeOfDay("12:60")).toBeNull();
    expect(parseTimeOfDay("noon")).toBeNull();
    expect(parseTimeOfDay(null)).toBeNull();
  });
});

describe("parseParams", () => {
  it("ignores test switches in production without e2e", () => {
    const p = parseParams("?debug=1&time=21:00&cam=altar", false);
    expect(p.debug).toBe(false);
    expect(p.timeOfDayMs).toBeNull();
    expect(p.cam).toBeNull();
  });

  it("reads them in production when e2e=1, and always in dev", () => {
    expect(parseParams("?e2e=1&cam=pond", false)).toMatchObject({ e2e: true, cam: "pond" });
    expect(parseParams("?debug=1&shadows=1&mock=offline", true)).toMatchObject({ debug: true, shadows: true, mock: "offline", e2e: false });
  });
});
