import { describe, expect, it } from "vitest";
import { PASSWORD_MAX, PASSWORD_MIN, USERNAME_MAX, isValidPassword, normalizeUsername, parseAccountView } from "./account.ts";

describe("normalizeUsername", () => {
  it("trims and lowercases valid names", () => {
    expect(normalizeUsername("  An_Nhien.99 ")).toBe("an_nhien.99");
    expect(normalizeUsername("abc")).toBe("abc");
    expect(normalizeUsername("Ten-Gi-Cung-Duoc")).toBe("ten-gi-cung-duoc");
    expect(normalizeUsername("a".repeat(USERNAME_MAX))).toBe("a".repeat(USERNAME_MAX));
  });

  it("rejects bad names", () => {
    for (const bad of ["ab", "a".repeat(USERNAME_MAX + 1), "an nhien", "ản", ".abc", "abc.", "a@b.c", ""]) {
      expect(normalizeUsername(bad)).toBeNull();
    }
    expect(normalizeUsername(123)).toBeNull();
    expect(normalizeUsername(null)).toBeNull();
  });
});

describe("isValidPassword", () => {
  it("length only, in code points", () => {
    expect(isValidPassword("a".repeat(PASSWORD_MIN))).toBe(true);
    expect(isValidPassword("a".repeat(PASSWORD_MIN - 1))).toBe(false);
    expect(isValidPassword("a".repeat(PASSWORD_MAX))).toBe(true);
    expect(isValidPassword("a".repeat(PASSWORD_MAX + 1))).toBe(false);
    expect(isValidPassword("😀".repeat(PASSWORD_MAX))).toBe(true);
    expect(isValidPassword("😀".repeat(PASSWORD_MAX + 1))).toBe(false);
    expect(isValidPassword("😀😀😀")).toBe(false);
    expect(isValidPassword(123456)).toBe(false);
  });
});

describe("parseAccountView", () => {
  it("accepts a valid view, drops extras, rejects bad ones", () => {
    const view = { username: "an_nhien", displayName: "An", tier: "free" };
    expect(parseAccountView({ ...view, id: 1 })).toEqual(view);
    expect(parseAccountView({ ...view, tier: "gold" })).toBeNull();
    expect(parseAccountView({ ...view, username: "A B" })).toBeNull();
    expect(parseAccountView({ ...view, displayName: " " })).toBeNull();
    expect(parseAccountView("x")).toBeNull();
  });
});
