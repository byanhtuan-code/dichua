import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_TOKEN, type AccountView } from "@santinh/shared";
import { ACCOUNT_TIMEOUT_MS, HttpAccountApi, MockAccountApi } from "./account-api.ts";

const rand = (): string => crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36);
const token = (): string => Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
const user = (): string => `u_${rand()}`;
const pass = (): string => `p-${rand()}-${rand()}`;
const view: AccountView = { username: "an_1", displayName: "An", tier: "free" };

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

function apiWith(answer: () => Response | Promise<Response>) {
  const fetchFn = vi.fn<typeof fetch>(() => Promise.resolve(answer()));
  return { api: new HttpAccountApi(fetchFn), fetchFn };
}

describe("HttpAccountApi", () => {
  beforeEach(() => {
    vi.stubGlobal("location", { origin: "http://localhost:4663" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("201 register → ok with token + account; secrets only in the body", async () => {
    const t = token();
    const { api, fetchFn } = apiWith(() => json(201, { token: t, account: view }));
    const p = pass();
    expect(await api.register("an_1", p, "An")).toEqual({ ok: true, token: t, account: view });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/account\/register$/);
    expect(String(url)).not.toContain(p);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ username: "an_1", password: p, displayName: "An" });
  });

  it("me sends the Bearer header and returns the account without a token", async () => {
    const t = token();
    const { api, fetchFn } = apiWith(() => json(200, { account: view }));
    expect(await api.me(t)).toEqual({ ok: true, account: view });
    const init = fetchFn.mock.calls[0]![1];
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>)["authorization"]).toBe(`Bearer ${t}`);
    expect(String(fetchFn.mock.calls[0]![0])).not.toContain(t);
  });

  it("maps 409 / 401 / 400 / 429 / 500", async () => {
    expect(await apiWith(() => json(409, { error: "username-taken" })).api.register(user(), pass(), "An")).toEqual({ ok: false, error: "taken" });
    expect(await apiWith(() => json(401, { error: "bad-credentials" })).api.login(user(), pass())).toEqual({ ok: false, error: "bad-credentials" });
    expect(await apiWith(() => json(401, { error: "unauthorized" })).api.me(token())).toEqual({ ok: false, error: "unauthorized" });
    expect(await apiWith(() => json(400, { error: "bad-input" })).api.register("x", pass(), "An")).toEqual({ ok: false, error: "bad-input" });
    expect(await apiWith(() => json(429, { error: "rate-limit", retryAfterMs: 1234.5 })).api.login(user(), pass())).toEqual({
      ok: false,
      error: "rate-limit",
      retryAfterMs: 1235,
    });
    expect(await apiWith(() => json(429, {}, { "retry-after": "7" })).api.login(user(), pass())).toEqual({
      ok: false,
      error: "rate-limit",
      retryAfterMs: 7000,
    });
    expect(await apiWith(() => json(500, { error: "boom" })).api.login(user(), pass())).toEqual({ ok: false, error: "network" });
    expect(await apiWith(() => new Response("<html>", { status: 502 })).api.me(token())).toEqual({ ok: false, error: "network" });
  });

  it("a network error or a malformed success → network", async () => {
    const offline = new HttpAccountApi(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await offline.login(user(), pass())).toEqual({ ok: false, error: "network" });
    expect(await offline.logout(token())).toEqual({ ok: false, error: "network" });
    expect(await apiWith(() => json(201, { token: "short", account: view })).api.register(user(), pass(), "An")).toEqual({ ok: false, error: "network" });
    expect(await apiWith(() => json(200, { account: { username: "An!" } })).api.me(token())).toEqual({ ok: false, error: "network" });
  });

  it("logout 204 → ok", async () => {
    expect(await apiWith(() => new Response(null, { status: 204 })).api.logout(token())).toEqual({ ok: true });
  });

  it("gives up after the timeout", async () => {
    vi.useFakeTimers();
    try {
      const api = new HttpAccountApi(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          }),
      );
      const pending = api.me(token());
      await vi.advanceTimersByTimeAsync(ACCOUNT_TIMEOUT_MS);
      expect(await pending).toEqual({ ok: false, error: "network" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("MockAccountApi", () => {
  it("register → me → logout → me unauthorized", async () => {
    const api = new MockAccountApi();
    const u = user();
    const r = await api.register(`  ${u.toUpperCase()} `, pass(), " Hoa ");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.account).toEqual({ username: u, displayName: "Hoa", tier: "free" });
    expect(r.token).toMatch(SESSION_TOKEN);
    expect(await api.me(r.token!)).toEqual({ ok: true, account: r.account });
    expect(await api.logout(r.token!)).toEqual({ ok: true });
    expect(await api.me(r.token!)).toEqual({ ok: false, error: "unauthorized" });
  });

  it("same rules as the server: taken, bad-input, bad-credentials", async () => {
    const api = new MockAccountApi();
    const u = user();
    const p = pass();
    expect((await api.register(u, p, "An")).ok).toBe(true);
    expect(await api.register(u, pass(), "Bình")).toEqual({ ok: false, error: "taken" });
    expect(await api.register("ab", pass(), "An")).toEqual({ ok: false, error: "bad-input" });
    expect(await api.register(user(), "12345", "An")).toEqual({ ok: false, error: "bad-input" });
    expect(await api.register(user(), pass(), "   ")).toEqual({ ok: false, error: "bad-input" });
    expect(await api.login(u, `${p}x`)).toEqual({ ok: false, error: "bad-credentials" });
    expect(await api.login(user(), p)).toEqual({ ok: false, error: "bad-credentials" });
    const ok = await api.login(u.toUpperCase(), p);
    expect(ok.ok && ok.token !== undefined && SESSION_TOKEN.test(ok.token)).toBe(true);
  });
});
