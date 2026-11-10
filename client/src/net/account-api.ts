import {
  SESSION_TOKEN,
  isRecord,
  isValidPassword,
  normalizeUsername,
  normalizeVisitorName,
  parseAccountView,
  type AccountView,
} from "@santinh/shared";
import { apiUrl } from "./server-url.ts";

export type AccountError = "taken" | "bad-input" | "bad-credentials" | "rate-limit" | "unauthorized" | "network";

export interface AccountFailure {
  ok: false;
  error: AccountError;
  /** Only with `rate-limit`. */
  retryAfterMs?: number;
}

/** `token` comes with register / login, not with `me`. */
export type AccountResult = { ok: true; token?: string; account: AccountView } | AccountFailure;
/** Logout has no account to return (server answers 204). */
export type LogoutResult = { ok: true } | AccountFailure;

/** P4-D5. UI and game reach accounts only through this, never `fetch` (architecture rule). */
export interface AccountApi {
  register(username: string, password: string, displayName: string): Promise<AccountResult>;
  login(username: string, password: string): Promise<AccountResult>;
  me(token: string): Promise<AccountResult>;
  logout(token: string): Promise<LogoutResult>;
}

export const ACCOUNT_TIMEOUT_MS = 10_000;

const fail = (error: AccountError, retryAfterMs?: number): AccountFailure =>
  retryAfterMs === undefined ? { ok: false, error } : { ok: false, error, retryAfterMs };

/** Server error code + status → short client code. Anything unexpected is the server's fault → `network`. */
function failureOf(status: number, body: unknown, retryHeader: string | null): AccountFailure {
  const code = isRecord(body) ? body["error"] : null;
  if (status === 409 || code === "username-taken") return fail("taken");
  if (status === 429 || code === "rate-limit") {
    const ms = isRecord(body) ? body["retryAfterMs"] : null;
    if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0) return fail("rate-limit", Math.ceil(ms));
    const s = Number(retryHeader);
    return retryHeader !== null && Number.isFinite(s) && s >= 0 ? fail("rate-limit", s * 1000) : fail("rate-limit");
  }
  if (code === "bad-credentials") return fail("bad-credentials");
  if (code === "unauthorized") return fail("unauthorized");
  if (status === 400 || status === 413) return fail("bad-input");
  if (status === 401) return fail("unauthorized");
  return fail("network");
}

function successOf(body: unknown, needToken: boolean): AccountResult {
  if (!isRecord(body)) return fail("network");
  const account = parseAccountView(body["account"]);
  if (account === null) return fail("network");
  if (!needToken) return { ok: true, account };
  const token = body["token"];
  return typeof token === "string" && SESSION_TOKEN.test(token) ? { ok: true, token, account } : fail("network");
}

export class HttpAccountApi implements AccountApi {
  constructor(private readonly fetchFn: typeof fetch = (...args) => fetch(...args)) {}

  register(username: string, password: string, displayName: string): Promise<AccountResult> {
    return this.call("register", "POST", null, { username, password, displayName }, true);
  }

  login(username: string, password: string): Promise<AccountResult> {
    return this.call("login", "POST", null, { username, password }, true);
  }

  me(token: string): Promise<AccountResult> {
    return this.call("me", "GET", token, null, false);
  }

  async logout(token: string): Promise<LogoutResult> {
    const r = await this.request("logout", "POST", token, null);
    if (r === null) return fail("network");
    return r.ok ? { ok: true } : failureOf(r.status, r.body, r.retry);
  }

  private async call(route: string, method: string, token: string | null, payload: object | null, needToken: boolean): Promise<AccountResult> {
    const r = await this.request(route, method, token, payload);
    if (r === null) return fail("network");
    return r.ok ? successOf(r.body, needToken) : failureOf(r.status, r.body, r.retry);
  }

  /** null = no answer (offline, timeout, CORS). Secrets go only in the body / header, never the URL (P4-D4). */
  private async request(
    route: string,
    method: string,
    token: string | null,
    payload: object | null,
  ): Promise<{ ok: boolean; status: number; body: unknown; retry: string | null } | null> {
    // Hand-made timer: AbortSignal.timeout is missing on Safari < 16 (realtime-client rule).
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ACCOUNT_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {};
      if (payload !== null) headers["content-type"] = "application/json";
      if (token !== null) headers["authorization"] = `Bearer ${token}`;
      const res = await this.fetchFn(apiUrl(`/api/account/${route}`), {
        method,
        headers,
        body: payload === null ? null : JSON.stringify(payload),
        signal: ac.signal,
        cache: "no-store",
      });
      let body: unknown = null;
      if (res.status !== 204) {
        try {
          body = await res.json();
        } catch {
          body = null;
        }
      }
      return { ok: res.ok, status: res.status, body, retry: res.headers.get("retry-after") };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}

function randomToken(): string {
  // 32 random bytes as base64url = 43 chars, the same shape the server hands out (SESSION_TOKEN).
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface MockAccount {
  password: string;
  view: AccountView;
}

/** `?mock`: in-memory accounts with the server's rules, gone on reload. Never used against a real server. */
export class MockAccountApi implements AccountApi {
  private readonly accounts = new Map<string, MockAccount>();
  private readonly sessions = new Map<string, string>();

  register(username: string, password: string, displayName: string): Promise<AccountResult> {
    const user = normalizeUsername(username);
    const name = normalizeVisitorName(displayName);
    if (user === null || name === null || !isValidPassword(password)) return Promise.resolve(fail("bad-input"));
    if (this.accounts.has(user)) return Promise.resolve(fail("taken"));
    const view: AccountView = { username: user, displayName: name, tier: "free" };
    this.accounts.set(user, { password: password.normalize("NFC"), view });
    return Promise.resolve(this.open(user, view));
  }

  login(username: string, password: string): Promise<AccountResult> {
    const user = normalizeUsername(username);
    const acc = user === null ? undefined : this.accounts.get(user);
    if (user === null || acc === undefined || typeof password !== "string" || acc.password !== password.normalize("NFC")) {
      return Promise.resolve(fail("bad-credentials"));
    }
    return Promise.resolve(this.open(user, acc.view));
  }

  me(token: string): Promise<AccountResult> {
    const user = this.sessions.get(token);
    const acc = user === undefined ? undefined : this.accounts.get(user);
    return Promise.resolve(acc ? { ok: true, account: { ...acc.view } } : fail("unauthorized"));
  }

  logout(token: string): Promise<LogoutResult> {
    this.sessions.delete(token);
    return Promise.resolve({ ok: true });
  }

  private open(user: string, view: AccountView): AccountResult {
    const token = randomToken();
    this.sessions.set(token, user);
    return { ok: true, token, account: { ...view } };
  }
}
