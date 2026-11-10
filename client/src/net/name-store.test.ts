import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_NAME_CHARS } from "@santinh/shared";
import { NAME_STORAGE_KEY, loadName, saveName } from "./name-store.ts";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("name-store", () => {
  it("saves the normalised name under santinh.name and reads it back", () => {
    const store = memoryStorage();
    vi.stubGlobal("localStorage", store);
    expect(loadName()).toBeNull();
    saveName("  Hoa \u202E  Sen ");
    expect(store.data.get(NAME_STORAGE_KEY)).toBe("Hoa Sen");
    expect(loadName()).toBe("Hoa Sen");
  });

  it("a blank name is not saved; a hand-edited long value is cut like the server does", () => {
    const store = memoryStorage();
    vi.stubGlobal("localStorage", store);
    saveName("   ");
    expect(store.data.size).toBe(0);
    store.data.set(NAME_STORAGE_KEY, "x".repeat(50));
    expect(loadName()).toBe("x".repeat(MAX_NAME_CHARS));
  });

  it("a storage that throws never breaks the page", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(loadName()).toBeNull();
    expect(() => saveName("An")).not.toThrow();
  });

  it("localStorage itself throwing on access → null / ignored", () => {
    // Stubbed first so unstubAllGlobals restores the real property after the throwing getter.
    vi.stubGlobal("localStorage", undefined);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("SecurityError");
      },
    });
    expect(loadName()).toBeNull();
    expect(() => saveName("An")).not.toThrow();
  });
});
