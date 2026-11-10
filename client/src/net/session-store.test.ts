import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY, clearSession, loadSession, saveSession } from "./session-store.ts";

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Buffer.from(bytes).toString("base64url");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("session-store", () => {
  it("saves under santinh.session, reads back, clears", () => {
    const store = memoryStorage();
    vi.stubGlobal("localStorage", store);
    const token = randomToken();
    expect(loadSession()).toBeNull();
    saveSession(token);
    expect(store.data.get(SESSION_STORAGE_KEY)).toBe(token);
    expect(loadSession()).toBe(token);
    clearSession();
    expect(loadSession()).toBeNull();
    expect(store.data.size).toBe(0);
  });

  it("a value that is not token-shaped is neither saved nor loaded", () => {
    const store = memoryStorage();
    vi.stubGlobal("localStorage", store);
    saveSession("short");
    expect(store.data.size).toBe(0);
    store.data.set(SESSION_STORAGE_KEY, `${randomToken()}!`);
    expect(loadSession()).toBeNull();
  });

  it("a storage that throws never breaks the page", () => {
    const boom = (): never => {
      throw new Error("denied");
    };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom });
    expect(loadSession()).toBeNull();
    expect(() => saveSession(randomToken())).not.toThrow();
    expect(() => clearSession()).not.toThrow();
  });

  it("localStorage itself throwing on access → null / ignored", () => {
    vi.stubGlobal("localStorage", undefined);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("SecurityError");
      },
    });
    expect(loadSession()).toBeNull();
    expect(() => saveSession(randomToken())).not.toThrow();
    expect(() => clearSession()).not.toThrow();
  });
});
