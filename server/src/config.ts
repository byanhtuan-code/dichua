import { REGISTER_PER_IP_PER_DAY, ROOM_CAPACITY } from "@santinh/shared";

export interface Config {
  port: number;
  capacity: number;
  fakePopulation: boolean;
  allowedOrigins: string[];
  staticDir: string;
  /** Sockets per client IP in one room; 0 = no limit. No cap across rooms: 10 rooms already bound it. */
  maxConnPerIpRoom: number;
  /** Behind Caddy: take the client IP from the last `X-Forwarded-For` entry. */
  trustProxy: boolean;
  /** Where runtime data (`population.json`) is kept; "" = memory only (tests, local). */
  dataDir: string;
  /** Admin login username for `/admin` (defaults to "admin"). */
  adminUser: string;
  /** Bearer secret / password for `/admin` (defaults to "681995"); "" = admin off (404). Kept verbatim, never logged. */
  adminPassword: string;
  /** Successful sign-ups per IP per day; 0 = no limit (trying many accounts locally). */
  registerPerIpPerDay: number;
}

type Env = Readonly<Record<string, string | undefined>>;

function intVar(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer in ${min}..${max}, got "${raw}"`);
  return n;
}

function onOffVar(env: Env, name: string, fallback: boolean): boolean {
  const raw = (env[name] ?? "").trim().toLowerCase();
  if (raw === "") return fallback;
  if (raw !== "on" && raw !== "off") throw new Error(`${name} must be "on" or "off", got "${env[name]}"`);
  return raw === "on";
}

/**
 * Browsers send `Origin` lowercased with no trailing slash, and the matcher compares exactly — so a typo like
 * `https://Santinh.com/` would 403 every visitor silently. Normalize here, fail loudly on anything else.
 */
export function normalizeOrigin(entry: string): string {
  const bad = new Error(`ALLOWED_ORIGINS: "${entry}" is not an origin (scheme://host[:port], at most one * in the host)`);
  const stars = entry.split("*").length - 1;
  if (stars > 1) throw bad;
  let url: URL;
  try {
    url = new URL(entry.replace("*", "x"));
  } catch {
    throw bad;
  }
  if (url.origin === "null" || url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw bad;
  if (stars === 0) return url.origin;
  const pattern = entry.trim().toLowerCase().replace(/\/$/, "");
  if (pattern.replace("*", "x") !== url.origin) throw bad;
  return pattern;
}

/** Read once at startup; a bad value throws so the process exits with a clear message. */
export function loadConfig(env: Env): Config {
  // Renamed when the cap became per room: a leftover would otherwise be ignored without a word.
  if (env.MAX_CONN_PER_IP !== undefined) throw new Error("MAX_CONN_PER_IP was replaced by MAX_CONN_PER_IP_ROOM (per room)");
  const rawUser = (env.ADMIN_USER ?? "").trim();
  return {
    port: intVar(env, "PORT", 4663, 0, 65535),
    capacity: intVar(env, "CAPACITY", ROOM_CAPACITY, 1, 1000),
    fakePopulation: onOffVar(env, "FAKE_POPULATION", true),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .map(normalizeOrigin),
    staticDir: (env.STATIC_DIR ?? "").trim(),
    maxConnPerIpRoom: intVar(env, "MAX_CONN_PER_IP_ROOM", 10, 0, 10000),
    trustProxy: onOffVar(env, "TRUST_PROXY", false),
    dataDir: (env.DATA_DIR ?? "").trim(),
    adminUser: rawUser === "" ? "admin" : rawUser,
    adminPassword: env.ADMIN_PASSWORD ?? "681995",
    registerPerIpPerDay: intVar(env, "REGISTER_PER_IP_PER_DAY", REGISTER_PER_IP_PER_DAY, 0, 1000),
  };
}
