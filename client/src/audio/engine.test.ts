import { vnMidnight } from "@santinh/shared";
import { describe, expect, it } from "vitest";
import { ceremonyScheduleText } from "../ui/settings-dialog.ts";
import { chantPosition } from "./chant.ts";
import { DEFAULT_SETTINGS, SETTINGS_KEY, loadSettings, saveSettings } from "./engine.ts";

function memoryStore(): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const throwing: Pick<Storage, "getItem" | "setItem"> = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

describe("audio settings storage", () => {
  it("round-trips volumes and switches", () => {
    const store = memoryStore();
    const s = { ...DEFAULT_SETTINGS, ambientVolume: 0.8, sfxOn: false, backgroundPlay: true };
    expect(saveSettings(store, s)).toBe(true);
    expect(loadSettings(store)).toEqual(s);
  });

  it("falls back to the design defaults when nothing is stored", () => {
    expect(loadSettings(memoryStore())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("has sound and chant on by default, also for a save from before they were stored", () => {
    expect(DEFAULT_SETTINGS.soundOn).toBe(true);
    expect(DEFAULT_SETTINGS.chantOn).toBe(true);
    const store = memoryStore();
    store.data.set(SETTINGS_KEY, JSON.stringify({ ambientOn: false }));
    expect(loadSettings(store)).toMatchObject({ soundOn: true, chantOn: true, ambientOn: false });
  });

  it("remembers sound / chant switched off", () => {
    const store = memoryStore();
    saveSettings(store, { ...DEFAULT_SETTINGS, soundOn: false, chantOn: false });
    expect(loadSettings(store)).toMatchObject({ soundOn: false, chantOn: false });
  });

  it("keeps working when storage throws", () => {
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(throwing, DEFAULT_SETTINGS)).toBe(false);
    expect(saveSettings(null, DEFAULT_SETTINGS)).toBe(false);
  });

  it("ignores garbage and clamps out-of-range values field by field", () => {
    const store = memoryStore();
    store.data.set(SETTINGS_KEY, "{not json");
    expect(loadSettings(store)).toEqual(DEFAULT_SETTINGS);
    store.data.set(SETTINGS_KEY, JSON.stringify({ ambientVolume: 7, chantVolume: -1, sfxVolume: "x", ambientOn: false }));
    expect(loadSettings(store)).toEqual({ ...DEFAULT_SETTINGS, ambientVolume: 1, chantVolume: 0, ambientOn: false });
  });
});

describe("chant", () => {
  it("wraps the shared session offset around the looping file", () => {
    expect(chantPosition(10, 119)).toBe(10);
    expect(chantPosition(250, 119)).toBe(12);
    expect(chantPosition(5, Number.NaN)).toBe(0);
  });
});

describe("ceremony schedule line", () => {
  const H = 3_600_000;
  const day = vnMidnight(Date.UTC(2026, 10, 1, 12));
  it("names the next session in Vietnam time", () => {
    expect(ceremonyScheduleText(day + 10 * H)).toBe("Khóa lễ tối kế tiếp 18:00 · mỗi ngày 05:00 và 18:00 (giờ Việt Nam)");
    expect(ceremonyScheduleText(day + 20 * H)).toBe("Khóa lễ sáng kế tiếp 05:00 · mỗi ngày 05:00 và 18:00 (giờ Việt Nam)");
  });
});
