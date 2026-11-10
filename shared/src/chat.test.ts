import { describe, expect, it } from "vitest";
import { CHAT_DUPLICATE_MS, CHAT_LIMITS, ChatThrottle, normalizeChatText, parseChatLine } from "./chat.ts";

const free = CHAT_LIMITS.free;

describe("normalizeChatText", () => {
  it("collapses whitespace, trims, keeps the words apart across newlines", () => {
    expect(normalizeChatText("  chào \n\t cả   nhà  ", "free")).toEqual({ ok: true, text: "chào cả nhà" });
  });

  it("drops control and zero-width characters", () => {
    expect(normalizeChatText("a​b\u0007c﻿‮", "free")).toEqual({ ok: true, text: "abc" });
    expect(normalizeChatText("​‌ ⁠", "free")).toEqual({ ok: false, reason: "empty" });
  });

  it("keeps ZWJ so emoji sequences survive", () => {
    const family = "👨‍👩‍👧";
    expect(normalizeChatText(family, "free")).toEqual({ ok: true, text: family });
  });

  it("empty / spaces only → empty", () => {
    expect(normalizeChatText("", "free")).toEqual({ ok: false, reason: "empty" });
    expect(normalizeChatText("   \n ", "free")).toEqual({ ok: false, reason: "empty" });
  });

  it("counts code points: 80 emoji ok, 81 too long; never cut", () => {
    expect(normalizeChatText("😀".repeat(free.maxChars), "free")).toEqual({ ok: true, text: "😀".repeat(free.maxChars) });
    expect(normalizeChatText("😀".repeat(free.maxChars + 1), "free")).toEqual({ ok: false, reason: "too-long" });
    expect(normalizeChatText("a".repeat(free.maxChars + 1), "free")).toEqual({ ok: false, reason: "too-long" });
    expect(normalizeChatText("a".repeat(free.maxChars + 1), "pro")).toMatchObject({ ok: true });
  });
});

describe("ChatThrottle", () => {
  it("first line passes; check does not record", () => {
    const t = new ChatThrottle();
    expect(t.check("a", 0, "free")).toEqual({ ok: true });
    expect(t.check("a", 0, "free")).toEqual({ ok: true });
    expect(t.lastAt).toBe(Number.NEGATIVE_INFINITY);
  });

  it("cooldown: too-fast with the wait until sending is allowed", () => {
    const t = new ChatThrottle();
    t.record("a", 1000);
    expect(t.check("b", 1000 + 1200, "free")).toEqual({ ok: false, reason: "too-fast", retryInMs: free.cooldownMs - 1200 });
    expect(t.check("b", 1000 + free.cooldownMs, "free")).toEqual({ ok: true });
    expect(t.check("b", 1000 + 1200, "pro")).toEqual({ ok: true });
  });

  it("burst: at most `burst` lines per window", () => {
    const t = new ChatThrottle();
    for (let i = 0; i < free.burst; i++) t.record(`m${i}`, i * free.cooldownMs);
    const now = free.burst * free.cooldownMs;
    // Cooldown is over, the window is not: wait until the oldest of the last `burst` lines leaves it.
    expect(t.check("next", now, "free")).toEqual({ ok: false, reason: "too-fast", retryInMs: free.burstWindowMs - now });
    expect(t.check("next", free.burstWindowMs, "free")).toEqual({ ok: true });
  });

  it("duplicate of the last line (any case) within CHAT_DUPLICATE_MS", () => {
    const t = new ChatThrottle();
    t.record("Chào cả nhà", 0);
    expect(t.check("chào CẢ nhà", 10_000, "free")).toEqual({ ok: false, reason: "duplicate" });
    expect(t.check("chào cả nhà!", 10_000, "free")).toEqual({ ok: true });
    expect(t.check("chào cả nhà", CHAT_DUPLICATE_MS, "free")).toEqual({ ok: true });
    expect(t.lastAt).toBe(0);
  });
});

describe("parseChatLine", () => {
  it("rebuilds a valid line, drops extras, rejects bad fields", () => {
    const line = { id: "1", visitorId: "v:a", name: "An", text: "hi", at: 5 };
    expect(parseChatLine({ ...line, username: "x" })).toEqual(line);
    expect(parseChatLine({ ...line, at: "5" })).toBeNull();
    expect(parseChatLine({ ...line, text: 1 })).toBeNull();
    expect(parseChatLine(null)).toBeNull();
  });
});
