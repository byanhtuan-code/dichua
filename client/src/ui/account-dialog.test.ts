import { ROOMS, roomAllowsChat } from "@santinh/shared";
import { describe, expect, it } from "vitest";
import { vi } from "../i18n/vi.ts";
import { accountErrorText, checkAccountInput, registerDescText } from "./account-dialog.ts";

// Random per run: no fixed secrets in tests (P4 principle 3).
const pw = (): string => `pw-${Math.random().toString(36).slice(2, 10)}`;
const ok = (over: Partial<{ username: string; password: string; displayName: string }> = {}) => ({
  username: "an.nhien_1",
  password: pw(),
  displayName: "An",
  ...over,
});

describe("account input checks", () => {
  it("accepts a valid registration and login", () => {
    expect(checkAccountInput("register", ok())).toBeNull();
    expect(checkAccountInput("login", ok({ displayName: "" }))).toBeNull();
  });

  it("points at the field that is wrong when registering", () => {
    expect(checkAccountInput("register", ok({ username: "ab" }))?.field).toBe("username");
    expect(checkAccountInput("register", ok({ username: "có dấu" }))?.field).toBe("username");
    expect(checkAccountInput("register", ok({ password: "12345" }))?.field).toBe("password");
    expect(checkAccountInput("register", ok({ displayName: "   " }))?.field).toBe("displayName");
  });

  it("login: empty fields ask for both, impossible ones read as bad credentials", () => {
    expect(checkAccountInput("login", ok({ username: " " }))).toEqual({ field: "username", text: vi.account.missing });
    expect(checkAccountInput("login", ok({ password: "" }))).toEqual({ field: "password", text: vi.account.missing });
    expect(checkAccountInput("login", ok({ password: "123" }))?.text).toBe(vi.account.badCredentials);
  });
});

describe("account error text", () => {
  it("maps each failure to a plain line", () => {
    expect(accountErrorText({ ok: false, error: "taken" })).toBe(vi.account.taken);
    expect(accountErrorText({ ok: false, error: "bad-credentials" })).toBe(vi.account.badCredentials);
    expect(accountErrorText({ ok: false, error: "network" })).toBe(vi.account.network);
    expect(accountErrorText({ ok: false, error: "rate-limit" })).toBe(vi.account.rateLimitSoon);
  });

  it("rounds the rate-limit wait up to whole minutes, at least 1", () => {
    expect(accountErrorText({ ok: false, error: "rate-limit", retryAfterMs: 5_000 })).toContain("1 phút");
    expect(accountErrorText({ ok: false, error: "rate-limit", retryAfterMs: 61_000 })).toContain("2 phút");
    expect(accountErrorText({ ok: false, error: "rate-limit", retryAfterMs: 60 * 60_000 })).toContain("60 phút");
    expect(accountErrorText({ ok: false, error: "rate-limit", retryAfterMs: 23 * 60 * 60_000 + 1 })).toContain("24 giờ");
  });

  it("never mentions plans or tiers", () => {
    const all = Object.values(vi.account).join(" ").toLowerCase();
    for (const word of ["gói", "free", "pro", "nâng cấp"]) expect(all).not.toContain(word);
  });
});

describe("register description", () => {
  it("names the chat rooms from the room table", () => {
    const chat = ROOMS.filter((r) => roomAllowsChat(r.id)).map((r) => r.number);
    expect(registerDescText()).toContain(`phòng ${Math.min(...chat)}–${Math.max(...chat)}`);
  });
});
