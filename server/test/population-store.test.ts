import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_POPULATION, ROOM_CAPACITY, type PopulationConfig } from "@santinh/shared";
import { PopulationStore } from "../src/population-store.ts";

const CHANGED: PopulationConfig = {
  layout: { full: 1, busy: 2, medium: 3, quiet: 4 },
  bots: { busy: [10, 15], medium: [5, 8], quiet: [2, 4] },
  minBots: 2,
};

describe("PopulationStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "santinh-pop-"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("no file → defaults", () => {
    expect(new PopulationStore(dir, ROOM_CAPACITY).current).toEqual(DEFAULT_POPULATION);
  });

  it("a broken or invalid file → defaults and one warning", () => {
    for (const text of ["{not json", JSON.stringify({ ...CHANGED, minBots: 9 })]) {
      writeFileSync(join(dir, "population.json"), text);
      const warn = vi.mocked(console.warn);
      warn.mockClear();
      expect(new PopulationStore(dir, ROOM_CAPACITY).current).toEqual(DEFAULT_POPULATION);
      expect(warn).toHaveBeenCalledTimes(1);
    }
  });

  it("a file valid for 30 but not for the server's capacity → defaults", () => {
    writeFileSync(join(dir, "population.json"), JSON.stringify(CHANGED));
    expect(new PopulationStore(dir, 12).current).toEqual(DEFAULT_POPULATION);
  });

  it("save applies at once, a new store reads it back, and no .tmp is left", async () => {
    const store = new PopulationStore(dir, ROOM_CAPACITY);
    expect(await store.save(CHANGED)).toEqual(CHANGED);
    expect(store.current).toEqual(CHANGED);
    expect(new PopulationStore(dir, ROOM_CAPACITY).current).toEqual(CHANGED);
    expect(readdirSync(dir)).toEqual(["population.json"]);
  });

  it("an invalid save returns null and changes nothing", async () => {
    const store = new PopulationStore(dir, ROOM_CAPACITY);
    expect(await store.save({ ...CHANGED, layout: { full: 0, busy: 0, medium: 0, quiet: 0 } })).toBeNull();
    expect(store.current).toEqual(DEFAULT_POPULATION);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("back-to-back saves end with the last one on disk", async () => {
    const store = new PopulationStore(dir, ROOM_CAPACITY);
    const second: PopulationConfig = { ...CHANGED, minBots: 4 };
    await Promise.all([store.save(CHANGED), store.save(second)]);
    expect(store.current).toEqual(second);
    expect(new PopulationStore(dir, ROOM_CAPACITY).current).toEqual(second);
    expect(readdirSync(dir)).toEqual(["population.json"]);
  });

  it("a failed write rejects, keeps the old config, and the next save still runs", async () => {
    const file = join(dir, "not-a-dir");
    writeFileSync(file, "");
    const broken = new PopulationStore(file, ROOM_CAPACITY);
    await expect(broken.save(CHANGED)).rejects.toThrow();
    expect(broken.current).toEqual(DEFAULT_POPULATION);
    await expect(broken.save(CHANGED)).rejects.toThrow();
  });

  it("empty dataDir keeps it in memory only", async () => {
    const store = new PopulationStore("", ROOM_CAPACITY);
    expect(store.current).toEqual(DEFAULT_POPULATION);
    expect(await store.save(CHANGED)).toEqual(CHANGED);
    expect(store.current).toEqual(CHANGED);
  });
});
