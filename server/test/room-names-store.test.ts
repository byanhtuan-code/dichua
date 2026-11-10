import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM_NAMES } from "@santinh/shared";
import { RoomNamesStore } from "../src/room-names-store.ts";

describe("RoomNamesStore (D26)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "santinh-names-"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("no file or a broken one → defaults", () => {
    expect(new RoomNamesStore(dir).current).toEqual(DEFAULT_ROOM_NAMES);
    writeFileSync(join(dir, "room-names.json"), "{nope");
    expect(new RoomNamesStore(dir).current).toEqual(DEFAULT_ROOM_NAMES);
  });

  it("a saved rename survives a restart (the file holds { names })", async () => {
    const names = DEFAULT_ROOM_NAMES.map((n, i) => (i === 0 ? "Am Mây" : n));
    expect(await new RoomNamesStore(dir).save({ names })).toEqual(names);
    expect(readdirSync(dir)).toEqual(["room-names.json"]);
    expect(new RoomNamesStore(dir).current).toEqual(names);
  });
});
