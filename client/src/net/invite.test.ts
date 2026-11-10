import { afterEach, describe, expect, it, vi as vitest } from "vitest";
import { copyText, inviteUrl, readNear } from "./invite.ts";

describe("inviteUrl / readNear", () => {
  it("round-trips room and id", () => {
    const url = new URL(inviteUrl("san-04", "v:abc123", "https://santinh.com"));
    expect(url.origin).toBe("https://santinh.com");
    expect(url.searchParams.get("room")).toBe("san-04");
    expect(readNear(url.search)).toBe("v:abc123");
  });

  it("writes a short link without %3A and still reads old encoded links", () => {
    const link = inviteUrl("san-03", "v:abc", "https://santinh.com");
    expect(link).toBe("https://santinh.com/?room=san-03&near=v:abc");
    expect(link).not.toContain("%3A");
    expect(readNear(new URL(link).search)).toBe("v:abc");
    expect(readNear("?room=san-03&near=v%3Aabc")).toBe("v:abc");
  });

  it("encodes anything it could not check", () => {
    const url = new URL(inviteUrl("x&y", "v:a b", "https://santinh.com"));
    expect(url.searchParams.get("room")).toBe("x&y");
    expect(url.searchParams.get("near")).toBe("v:a b");
  });

  it("keeps the id when a share target glued the share text onto the link", () => {
    // Real link from the macOS share sheet's Copy.
    const pasted = "?room=san-03&near=v%3Ajystto1s01%20%C4%90%E1%BA%BFn%20ng%E1%BB%93i%20c%E1%BA%A1nh%20t%C3%B4i%20%E1%BB%9F%20S%C3%A2n%20T%C4%A9nh%20nh%C3%A9.";
    expect(readNear(pasted)).toBe("v:jystto1s01");
    expect(readNear("?near=v:abc+hi")).toBe("v:abc");
  });

  it("rejects malformed near", () => {
    expect(readNear("?near=abc")).toBeNull();
    expect(readNear("?near=v:UPPER")).toBeNull();
    expect(readNear("?near=v:" + "a".repeat(17))).toBeNull();
    expect(readNear("?room=san-01")).toBeNull();
  });
});

describe("copyText", () => {
  afterEach(() => vitest.unstubAllGlobals());

  it("writes the clipboard, or reports failure", async () => {
    const writeText = vitest.fn().mockResolvedValue(undefined);
    vitest.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("u")).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("u");
    vitest.stubGlobal("navigator", { clipboard: { writeText: vitest.fn().mockRejectedValue(new Error("no")) } });
    expect(await copyText("u")).toBe("failed");
    vitest.stubGlobal("navigator", {});
    expect(await copyText("u")).toBe("failed");
  });
});
