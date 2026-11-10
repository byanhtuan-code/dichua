import { CHAT_HISTORY, CHAT_LIMITS, type ChatLine } from "@santinh/shared";
import { describe, expect, it } from "vitest";
import { vi } from "../i18n/vi.ts";
import { CHAT_COUNTER_FROM, appendLine, chatLength, cooldownSeconds, counterState, deniedText, historyLines, quietHintText } from "./chat-panel.ts";

const max = CHAT_LIMITS.free.maxChars;
const line = (id: number): ChatLine => ({ id: String(id), visitorId: "v1", name: "An", text: `tin ${id}`, at: id });

describe("chat character count", () => {
  it("counts code points of the normalised text, like the server", () => {
    expect(chatLength("", "free")).toBe(0);
    expect(chatLength("   ", "free")).toBe(0);
    expect(chatLength("  a   b  ", "free")).toBe(3);
    expect(chatLength("🙏".repeat(3), "free")).toBe(3);
    expect(chatLength("a​b", "free")).toBe(2);
  });

  it("stays over the limit when the text is too long", () => {
    expect(chatLength("🙏".repeat(max + 1), "free")).toBe(max + 1);
  });

  it("shows the counter only near the limit, red when over", () => {
    expect(counterState("a".repeat(max - CHAT_COUNTER_FROM), "free")).toEqual({ text: "", over: false });
    expect(counterState("a".repeat(max - 5), "free")).toEqual({ text: vi.chat.left.replace("{n}", "5"), over: false });
    expect(counterState("🙏".repeat(max), "free")).toEqual({ text: vi.chat.left.replace("{n}", "0"), over: false });
    expect(counterState("🙏".repeat(max + 2), "free")).toEqual({ text: vi.chat.over.replace("{n}", "2"), over: true });
  });
});

describe("cooldown seconds", () => {
  it("rounds up and never shows 0 while blocked", () => {
    expect(cooldownSeconds(2999)).toBe(3);
    expect(cooldownSeconds(3000)).toBe(3);
    expect(cooldownSeconds(3001)).toBe(4);
    expect(cooldownSeconds(10)).toBe(1);
    expect(cooldownSeconds(0)).toBe(1);
  });
});

describe("chat lines", () => {
  it("keeps the newest CHAT_HISTORY lines in order", () => {
    let lines: ChatLine[] = [];
    for (let i = 1; i <= CHAT_HISTORY + 5; i++) lines = appendLine(lines, line(i));
    expect(lines).toHaveLength(CHAT_HISTORY);
    expect(lines[0]?.id).toBe("6");
    expect(lines.at(-1)?.id).toBe(String(CHAT_HISTORY + 5));
  });

  it("does not double a line it already has", () => {
    const lines = appendLine([line(1), line(2)], line(2));
    expect(lines.map((l) => l.id)).toEqual(["1", "2"]);
  });

  it("history replaces and is capped", () => {
    const many = Array.from({ length: CHAT_HISTORY + 3 }, (_, i) => line(i + 1));
    const h = historyLines(many);
    expect(h).toHaveLength(CHAT_HISTORY);
    expect(h[0]?.id).toBe("4");
  });
});

describe("refusal text", () => {
  it("says something for every reason, with numbers filled in", () => {
    expect(deniedText("too-fast", "free", 2100)).toBe(vi.chat.denied["too-fast"].replace("{n}", "3"));
    expect(deniedText("too-long", "free")).toBe(vi.chat.denied["too-long"].replace("{n}", String(max)));
    expect(deniedText("login", "free")).toContain(vi.chat.needAccount);
    for (const r of ["quiet-room", "duplicate", "empty"] as const) expect(deniedText(r, "free")).toBe(vi.chat.denied[r]);
  });

  it("never mentions plans (P4 principle 11)", () => {
    const all = JSON.stringify(vi.chat).toLowerCase();
    for (const word of ["gói", "free", "pro", "nâng cấp", "miễn phí"]) expect(all).not.toContain(word);
  });
});

describe("quiet room note", () => {
  it("points to the chat rooms by number from the room table", () => {
    expect(quietHintText()).toBe("Mọi người ngồi yên ở đây. Muốn trò chuyện thì sang phòng 4–10.");
  });
});
