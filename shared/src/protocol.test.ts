import { describe, expect, it } from "vitest";
import { MAX_CHAT_RAW_CHARS, MAX_FRAME_BYTES, RENAME_COOLDOWN_MS, isChatDeniedReason, parseClientMsg } from "./protocol.ts";

// Random each run: no fixed session token in the repo.
function randomToken(len = 43): string {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  return Array.from({ length: len }, () => abc[Math.floor(Math.random() * abc.length)]).join("");
}

describe("parseClientMsg", () => {
  it("accepts every client message, from text or a parsed value", () => {
    expect(parseClientMsg('{"type":"move","x":1,"z":-2.5,"yaw":3,"pose":"walk"}')).toEqual({ type: "move", x: 1, z: -2.5, yaw: 3, pose: "walk" });
    expect(parseClientMsg({ type: "seat", requestId: 0 })).toEqual({ type: "seat", requestId: 0 });
    for (const type of ["stand", "hello", "bead", "sync", "bow"]) expect(parseClientMsg({ type })).toEqual({ type });
    expect(parseClientMsg({ type: "ping", clientTime: 123.5 })).toEqual({ type: "ping", clientTime: 123.5 });
  });

  it("bow: no fields, extras dropped", () => {
    expect(parseClientMsg('{"type":"bow"}')).toEqual({ type: "bow" });
    expect(parseClientMsg({ type: "bow", at: 1 })).toEqual({ type: "bow" });
  });

  it("drops unknown extra keys", () => {
    expect(parseClientMsg({ type: "hello", admin: true, __proto__: { x: 1 } })).toEqual({ type: "hello" });
    // Older clients still send `near`: accepted, dropped.
    expect(parseClientMsg({ type: "seat", requestId: 1, near: { x: 0, z: 0, evil: 1 } })).toEqual({ type: "seat", requestId: 1 });
  });

  it("rejects NaN / Infinity / non-numbers (JSON text cannot carry NaN, parsed values can)", () => {
    expect(parseClientMsg({ type: "move", x: Number.NaN, z: 0, yaw: 0, pose: "walk" })).toBeNull();
    expect(parseClientMsg({ type: "move", x: 0, z: Infinity, yaw: 0, pose: "walk" })).toBeNull();
    expect(parseClientMsg({ type: "move", x: "1", z: 0, yaw: 0, pose: "walk" })).toBeNull();
    expect(parseClientMsg({ type: "ping", clientTime: -Infinity })).toBeNull();
    expect(parseClientMsg('{"type":"move","x":1e999,"z":0,"yaw":0,"pose":"walk"}')).toBeNull();
  });

  it("rejects unknown poses and types", () => {
    expect(parseClientMsg({ type: "move", x: 0, z: 0, yaw: 0, pose: "fly" })).toBeNull();
    expect(parseClientMsg({ type: "move", x: 0, z: 0, yaw: 0, pose: "toString" })).toBeNull();
    expect(parseClientMsg({ type: "teleport" })).toBeNull();
  });

  it("wraps yaw to (-π, π]: a huge angle is not stored and sent to everyone", () => {
    const yawOf = (yaw: number) => {
      const m = parseClientMsg({ type: "move", x: 0, z: 0, yaw, pose: "walk" });
      return m?.type === "move" ? m.yaw : null;
    };
    expect(yawOf(0.5)).toBeCloseTo(0.5);
    expect(yawOf(0.5 + 4 * Math.PI)).toBeCloseTo(0.5);
    const huge = yawOf(1e300);
    expect(huge).not.toBeNull();
    expect(Math.abs(huge ?? 9)).toBeLessThanOrEqual(Math.PI);
  });

  it("rejects strings that are too long", () => {
    expect(parseClientMsg({ type: "x".repeat(65) })).toBeNull();
    expect(parseClientMsg({ type: "move", x: 0, z: 0, yaw: 0, pose: "walk".repeat(20) })).toBeNull();
    expect(parseClientMsg(JSON.stringify({ type: "hello", pad: "x".repeat(MAX_FRAME_BYTES) }))).toBeNull();
  });

  it("rejects missing fields and bad requestIds", () => {
    expect(parseClientMsg({ type: "move", x: 0, z: 0, pose: "walk" })).toBeNull();
    expect(parseClientMsg({ type: "seat", requestId: -1, near: { x: 0, z: 0 } })).toBeNull();
    expect(parseClientMsg({ type: "seat", requestId: 1.5, near: { x: 0, z: 0 } })).toBeNull();
    expect(parseClientMsg({ type: "seat", requestId: "1" })).toBeNull();
    expect(parseClientMsg({ type: "ping" })).toBeNull();
  });

  it("rejects non-objects and broken JSON", () => {
    for (const raw of [null, undefined, 3, [], "", "{", "null", '["move"]', '"hello"']) expect(parseClientMsg(raw), String(raw)).toBeNull();
  });

  it("sleep: boolean only", () => {
    expect(parseClientMsg(JSON.stringify({ type: "sleep", asleep: true }))).toEqual({ type: "sleep", asleep: true });
    expect(parseClientMsg({ type: "sleep", asleep: false, x: 1 })).toEqual({ type: "sleep", asleep: false });
    expect(parseClientMsg({ type: "sleep", asleep: "yes" })).toBeNull();
    expect(parseClientMsg({ type: "sleep" })).toBeNull();
  });

  it("rename: normalised name; empty, non-string or oversized → dropped", () => {
    expect(RENAME_COOLDOWN_MS).toBe(5000);
    expect(parseClientMsg(JSON.stringify({ type: "rename", name: "  An\u202E  Bình " }))).toEqual({ type: "rename", name: "An Bình" });
    expect(parseClientMsg({ type: "rename", name: "a".repeat(30), extra: 1 })).toEqual({ type: "rename", name: "a".repeat(20) });
    expect(parseClientMsg({ type: "rename", name: "   " })).toBeNull();
    expect(parseClientMsg({ type: "rename", name: 3 })).toBeNull();
    expect(parseClientMsg({ type: "rename" })).toBeNull();
    expect(parseClientMsg({ type: "rename", name: "a".repeat(MAX_FRAME_BYTES + 1) })).toBeNull();
  });

  it("auth: a well-formed token or null; anything else dropped", () => {
    const token = randomToken();
    expect(parseClientMsg(JSON.stringify({ type: "auth", token }))).toEqual({ type: "auth", token });
    expect(parseClientMsg({ type: "auth", token: null, extra: 1 })).toEqual({ type: "auth", token: null });
    expect(parseClientMsg({ type: "auth" })).toBeNull();
    expect(parseClientMsg({ type: "auth", token: randomToken(42) })).toBeNull();
    expect(parseClientMsg({ type: "auth", token: randomToken(44) })).toBeNull();
    expect(parseClientMsg({ type: "auth", token: `${randomToken(42)}=` })).toBeNull();
    expect(parseClientMsg({ type: "auth", token: 1 })).toBeNull();
  });

  it("chat: raw text kept as is (server normalises), capped, strings only", () => {
    expect(parseClientMsg(JSON.stringify({ type: "chat", text: "  chào  " }))).toEqual({ type: "chat", text: "  chào  " });
    expect(parseClientMsg({ type: "chat", text: "", x: 1 })).toEqual({ type: "chat", text: "" });
    expect(parseClientMsg({ type: "chat", text: "a".repeat(MAX_CHAT_RAW_CHARS) })).toEqual({ type: "chat", text: "a".repeat(MAX_CHAT_RAW_CHARS) });
    expect(parseClientMsg({ type: "chat", text: "a".repeat(MAX_CHAT_RAW_CHARS + 1) })).toBeNull();
    expect(parseClientMsg({ type: "chat", text: 5 })).toBeNull();
    expect(parseClientMsg({ type: "chat" })).toBeNull();
  });
});

describe("isChatDeniedReason", () => {
  it("known reasons only", () => {
    for (const r of ["login", "quiet-room", "too-fast", "too-long", "duplicate", "empty"]) expect(isChatDeniedReason(r)).toBe(true);
    expect(isChatDeniedReason("pro")).toBe(false);
    expect(isChatDeniedReason(1)).toBe(false);
  });
});
