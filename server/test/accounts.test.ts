import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SESSION_IDLE_MS, SESSION_TOKEN, SESSION_TOUCH_MS } from "@santinh/shared";
import { Accounts } from "../src/accounts.ts";

// Generated per run: no real password sits in the repo.
const pw = (): string => randomBytes(12).toString("base64url");

describe("Accounts", () => {
  const open: Accounts[] = [];
  const dirs: string[] = [];
  const make = (dir = "", clock?: () => number): Accounts => {
    const a = new Accounts(dir, clock);
    open.push(a);
    return a;
  };
  afterEach(() => {
    for (const a of open.splice(0)) a.close();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("register → token + view; the name is canonical; a second register of it is taken", async () => {
    const a = make();
    const p = pw();
    const r = await a.register("  Thu_Nghiem ", p, "  An  ");
    if (typeof r === "string") throw new Error(r);
    expect(SESSION_TOKEN.test(r.token)).toBe(true);
    expect(r.account).toEqual({ username: "thu_nghiem", displayName: "An", tier: "free" });
    expect(await a.register("thu_nghiem", pw(), "Bình")).toBe("taken");
    expect(a.bySession(r.token)?.account.username).toBe("thu_nghiem");
  });

  it("bad input: short username, short password, empty name, non-strings", async () => {
    const a = make();
    expect(await a.register("ab", pw(), "An")).toBe("bad-input");
    expect(await a.register("abc", "12345", "An")).toBe("bad-input");
    expect(await a.register("abc", pw(), "   ")).toBe("bad-input");
    expect(await a.register(42, pw(), "An")).toBe("bad-input");
    expect(await a.register("abc", { length: 8 }, "An")).toBe("bad-input");
  });

  it("login: right password works; wrong password and unknown user both give null", async () => {
    const a = make();
    const p = pw();
    await a.register("minh", p, "Minh");
    const ok = await a.login("MINH", p);
    expect(ok?.account.displayName).toBe("Minh");
    expect(await a.login("minh", pw())).toBeNull();
    expect(await a.login("nobody", p)).toBeNull();
    expect(await a.login("minh", 123)).toBeNull();
  });

  it("logout drops only that session", async () => {
    const a = make();
    const p = pw();
    const r = await a.register("lan", p, "Lan");
    const other = await a.login("lan", p);
    if (typeof r === "string" || !other) throw new Error("setup");
    a.logout(r.token);
    expect(a.bySession(r.token)).toBeNull();
    expect(a.bySession(other.token)).not.toBeNull();
  });

  it("a session unused for 90 days is gone; use within that keeps it alive", async () => {
    let now = 1_000_000_000;
    const a = make("", () => now);
    const r = await a.register("hoa", pw(), "Hoa");
    if (typeof r === "string") throw new Error(r);
    now += SESSION_IDLE_MS - SESSION_TOUCH_MS;
    expect(a.bySession(r.token)).not.toBeNull();
    now += SESSION_IDLE_MS - 1;
    expect(a.bySession(r.token)).not.toBeNull();
    now += SESSION_IDLE_MS;
    expect(a.bySession(r.token)).toBeNull();
    now -= SESSION_IDLE_MS;
    // Deleted, not just hidden.
    expect(a.bySession(r.token)).toBeNull();
  });

  it("setDisplayName saves a valid name only", async () => {
    const a = make();
    const r = await a.register("tuan", pw(), "Tuấn");
    if (typeof r === "string") throw new Error(r);
    const id = a.bySession(r.token)?.id ?? -1;
    expect(a.setDisplayName(id, "  Tuấn   Anh ")).toBe(true);
    expect(a.bySession(r.token)?.account.displayName).toBe("Tuấn Anh");
    expect(a.setDisplayName(id, "")).toBe(false);
    expect(a.setDisplayName(9999, "Ai")).toBe(false);
  });

  it("the DB file survives a reopen and never holds the password or the token", async () => {
    const dir = mkdtempSync(join(tmpdir(), "santinh-acc-"));
    dirs.push(dir);
    const p = pw();
    const first = make(dir);
    const r = await first.register("bao", p, "Bảo");
    if (typeof r === "string") throw new Error(r);
    first.close();

    const again = make(dir);
    expect(again.bySession(r.token)?.account.username).toBe("bao");
    expect(await again.login("bao", p)).not.toBeNull();
    again.close();

    // WAL keeps fresh pages in -wal: read every file of the DB.
    const bytes = readdirSync(dir)
      .filter((f) => f.startsWith("santinh.db"))
      .map((f) => readFileSync(join(dir, f)).toString("latin1"))
      .join("");
    expect(bytes).toContain("bao");
    expect(bytes).not.toContain(p);
    expect(bytes).not.toContain(r.token);
  });
});
