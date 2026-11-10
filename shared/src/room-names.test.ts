import { describe, expect, it } from "vitest";
import { DEFAULT_ROOM_NAMES, MAX_ROOM_NAME_CHARS, parseRoomNames, roomNameOf } from "./room-names.ts";
import { ROOM_COUNT } from "./world.ts";

describe("room names (D26)", () => {
  it("ten distinct defaults within the length cap", () => {
    expect(DEFAULT_ROOM_NAMES).toHaveLength(ROOM_COUNT);
    expect(new Set(DEFAULT_ROOM_NAMES).size).toBe(ROOM_COUNT);
    for (const n of DEFAULT_ROOM_NAMES) expect([...n].length).toBeLessThanOrEqual(MAX_ROOM_NAME_CHARS);
  });

  it("parseRoomNames cleans names; wrong count, blank, duplicate or non-string → null", () => {
    const names = [...DEFAULT_ROOM_NAMES];
    names[0] = "  Am‮  Mây ";
    expect(parseRoomNames({ names })?.[0]).toBe("Am Mây");
    expect(parseRoomNames({ names: names.slice(1) })).toBeNull();
    expect(parseRoomNames({ names: names.map((n, i) => (i === 3 ? "" : n)) })).toBeNull();
    expect(parseRoomNames({ names: names.map((n, i) => (i === 3 ? names[1] : n)) })).toBeNull();
    expect(parseRoomNames({ names: names.map((n, i) => (i === 3 ? 4 : n)) })).toBeNull();
    expect(parseRoomNames(names)).toBeNull();
  });

  it("roomNameOf falls back to the default", () => {
    expect(roomNameOf(null, 3)).toBe(DEFAULT_ROOM_NAMES[2]);
    expect(roomNameOf(["A"], 1)).toBe("A");
    expect(roomNameOf(["A"], 2)).toBe(DEFAULT_ROOM_NAMES[1]);
  });
});
