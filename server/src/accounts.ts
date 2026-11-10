import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLOutputValue, type StatementSync } from "node:sqlite";
import {
  SESSION_IDLE_MS,
  SESSION_TOUCH_MS,
  isChatTier,
  isValidPassword,
  normalizeUsername,
  normalizeVisitorName,
  type AccountView,
  type ChatTier,
} from "@santinh/shared";

// P4-D2: salt 16 B, N=16384 r=8 p=1, 64 B key (~16 MB per hash, under Node's 32 MB maxmem default).
const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const TOKEN_BYTES = 32;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((ok, fail) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? fail(err) : ok(key))));
}

// NFC: the same Vietnamese password typed on two keyboards may arrive composed or decomposed.
const prep = (password: string): string => password.normalize("NFC");

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(prep(password), salt, KEY_BYTES, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/** Params come from the stored string so a later change of SCRYPT still verifies old hashes. */
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, saltB64, keyB64] = stored.split("$");
  if (kind !== "scrypt" || saltB64 === undefined || keyB64 === undefined) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(prep(password), Buffer.from(saltB64, "base64"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

type Row = Record<string, SQLOutputValue>;

function str(row: Row, key: string): string {
  const v = row[key];
  return typeof v === "string" ? v : "";
}

function num(row: Row, key: string): number {
  const v = row[key];
  return typeof v === "number" ? v : Number(v);
}

function viewOf(row: Row): AccountView {
  const tier = row["tier"];
  return {
    username: str(row, "username"),
    displayName: str(row, "display_name"),
    tier: isChatTier(tier) ? tier : "free",
  };
}

export interface Signed {
  token: string;
  account: AccountView;
}

export interface SessionAccount {
  id: number;
  account: AccountView;
}

export interface AdminAccountRow {
  id: number;
  username: string;
  displayName: string;
  tier: ChatTier;
  createdAt: number;
  activeSessions: number;
  lastSeen: number | null;
}

/** Accounts + sessions in SQLite (P4-D3 / D4). Passwords stored as scrypt, tokens as sha256 only. */
export class Accounts {
  private readonly db: DatabaseSync;
  private readonly clock: () => number;
  private readonly q: Record<
    | "insertAccount"
    | "byUsername"
    | "insertSession"
    | "session"
    | "touch"
    | "deleteSession"
    | "prune"
    | "setName"
    | "countAll"
    | "listAll"
    | "listSearch"
    | "setTier"
    | "setPassword"
    | "deleteAccountSessions"
    | "deleteAccount",
    StatementSync
  >;
  private dummyHash: Promise<string> | null = null;
  private lastPrune = 0;

  /** `dataDir` "" = in-memory DB (tests, local without DATA_DIR). */
  constructor(dataDir: string, clock: () => number = Date.now) {
    this.clock = clock;
    let path = ":memory:";
    if (dataDir !== "") {
      mkdirSync(dataDir, { recursive: true });
      path = join(dataDir, "santinh.db");
    }
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        pass_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        tier TEXT NOT NULL DEFAULT 'free',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_account ON sessions(account_id);
    `);
    this.q = {
      insertAccount: this.db.prepare("INSERT INTO accounts (username, pass_hash, display_name, created_at) VALUES (?, ?, ?, ?) RETURNING *"),
      byUsername: this.db.prepare("SELECT * FROM accounts WHERE username = ?"),
      insertSession: this.db.prepare("INSERT INTO sessions (token_hash, account_id, created_at, last_seen) VALUES (?, ?, ?, ?)"),
      session: this.db.prepare(
        "SELECT a.id, a.username, a.display_name, a.tier, s.last_seen FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ?",
      ),
      touch: this.db.prepare("UPDATE sessions SET last_seen = ? WHERE token_hash = ?"),
      deleteSession: this.db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
      prune: this.db.prepare("DELETE FROM sessions WHERE last_seen <= ?"),
      setName: this.db.prepare("UPDATE accounts SET display_name = ? WHERE id = ?"),
      countAll: this.db.prepare("SELECT COUNT(*) AS total FROM accounts"),
      listAll: this.db.prepare(`
        SELECT a.id, a.username, a.display_name, a.tier, a.created_at,
               COUNT(s.token_hash) AS active_sessions,
               MAX(s.last_seen) AS last_seen
        FROM accounts a
        LEFT JOIN sessions s ON s.account_id = a.id AND s.last_seen > ?
        GROUP BY a.id
        ORDER BY a.id DESC
        LIMIT ?
      `),
      listSearch: this.db.prepare(`
        SELECT a.id, a.username, a.display_name, a.tier, a.created_at,
               COUNT(s.token_hash) AS active_sessions,
               MAX(s.last_seen) AS last_seen
        FROM accounts a
        LEFT JOIN sessions s ON s.account_id = a.id AND s.last_seen > ?
        WHERE a.username LIKE ? OR a.display_name LIKE ?
        GROUP BY a.id
        ORDER BY a.id DESC
        LIMIT ?
      `),
      setTier: this.db.prepare("UPDATE accounts SET tier = ? WHERE id = ?"),
      setPassword: this.db.prepare("UPDATE accounts SET pass_hash = ? WHERE id = ?"),
      deleteAccountSessions: this.db.prepare("DELETE FROM sessions WHERE account_id = ?"),
      deleteAccount: this.db.prepare("DELETE FROM accounts WHERE id = ?"),
    };
  }

  async register(username: unknown, password: unknown, displayName: unknown): Promise<Signed | "taken" | "bad-input"> {
    const user = normalizeUsername(username);
    const name = normalizeVisitorName(displayName);
    if (user === null || name === null || !isValidPassword(password) || typeof password !== "string") return "bad-input";
    // Cheap reject before the ~50 ms hash; the UNIQUE constraint still settles a race between two requests.
    if (this.q.byUsername.get(user) !== undefined) return "taken";
    const hash = await hashPassword(password);
    let row: Row | undefined;
    try {
      row = this.q.insertAccount.get(user, hash, name, this.clock());
    } catch (err) {
      if (isUniqueViolation(err)) return "taken";
      throw err;
    }
    if (row === undefined) throw new Error("insert returned no row");
    return { token: this.newSession(num(row, "id")), account: viewOf(row) };
  }

  /** Wrong username and wrong password look the same, in answer and in time (one scrypt either way). */
  async login(username: unknown, password: unknown): Promise<Signed | null> {
    const user = normalizeUsername(username);
    const pw = isValidPassword(password) && typeof password === "string" ? password : null;
    const row = user === null ? undefined : this.q.byUsername.get(user);
    const stored = row === undefined ? await this.dummy() : str(row, "pass_hash");
    const ok = await verifyPassword(pw ?? "", stored);
    if (!ok || pw === null || row === undefined) return null;
    return { token: this.newSession(num(row, "id")), account: viewOf(row) };
  }

  bySession(token: string): SessionAccount | null {
    const hash = tokenHash(token);
    const row = this.q.session.get(hash);
    if (row === undefined) return null;
    const now = this.clock();
    const lastSeen = num(row, "last_seen");
    if (now - lastSeen >= SESSION_IDLE_MS) {
      this.q.deleteSession.run(hash);
      return null;
    }
    if (now - lastSeen >= SESSION_TOUCH_MS) this.q.touch.run(now, hash);
    return { id: num(row, "id"), account: viewOf(row) };
  }

  logout(token: string): void {
    this.q.deleteSession.run(tokenHash(token));
  }

  /** False when the name breaks the rules or the account is gone. */
  setDisplayName(accountId: number, raw: unknown): boolean {
    const name = normalizeVisitorName(raw);
    if (name === null) return false;
    return Number(this.q.setName.run(name, accountId).changes) > 0;
  }

  // ============================================================================
  // ADMIN ACCOUNT MANAGEMENT METHODS
  // ============================================================================

  /** Total number of registered accounts in SQLite. */
  countAccounts(): number {
    const row = this.q.countAll.get() as Row | undefined;
    return row ? num(row, "total") : 0;
  }

  /** Lists accounts for the `/admin` dashboard (newest first, optional search filter). */
  listAccounts(search = "", limit = 100): AdminAccountRow[] {
    const cap = Math.max(1, Math.min(500, Math.floor(limit)));
    const activeCutoff = this.clock() - SESSION_IDLE_MS;
    const clean = search.trim();
    const rows = (
      clean === ""
        ? this.q.listAll.all(activeCutoff, cap)
        : this.q.listSearch.all(activeCutoff, `%${clean}%`, `%${clean}%`, cap)
    ) as Row[];

    return rows.map((row) => {
      const tier = row["tier"];
      const rawLast = row["last_seen"];
      return {
        id: num(row, "id"),
        username: str(row, "username"),
        displayName: str(row, "display_name"),
        tier: isChatTier(tier) ? tier : "free",
        createdAt: num(row, "created_at"),
        activeSessions: num(row, "active_sessions"),
        lastSeen: typeof rawLast === "number" && Number.isFinite(rawLast) ? rawLast : null,
      };
    });
  }

  /** Updates an account's chat tier ("free" | "pro"). */
  setTier(accountId: number, tier: unknown): boolean {
    if (!Number.isSafeInteger(accountId) || accountId <= 0 || !isChatTier(tier)) return false;
    return Number(this.q.setTier.run(tier, accountId).changes) > 0;
  }

  /** Resets an account's password and revokes its active sessions. */
  async adminResetPassword(accountId: number, newPassword: unknown): Promise<boolean> {
    if (!Number.isSafeInteger(accountId) || accountId <= 0 || !isValidPassword(newPassword) || typeof newPassword !== "string") {
      return false;
    }
    const hash = await hashPassword(newPassword);
    const changed = Number(this.q.setPassword.run(hash, accountId).changes) > 0;
    if (changed) {
      this.q.deleteAccountSessions.run(accountId);
    }
    return changed;
  }

  /** Deletes an account and cascades its sessions. */
  deleteAccount(accountId: number): boolean {
    if (!Number.isSafeInteger(accountId) || accountId <= 0) return false;
    return Number(this.q.deleteAccount.run(accountId).changes) > 0;
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }

  private newSession(accountId: number): string {
    const now = this.clock();
    // Expired sessions are otherwise only dropped when their token comes back, which may be never.
    if (now - this.lastPrune >= SESSION_TOUCH_MS) {
      this.lastPrune = now;
      this.q.prune.run(now - SESSION_IDLE_MS);
    }
    const token = randomBytes(TOKEN_BYTES).toString("base64url");
    this.q.insertSession.run(tokenHash(token), accountId, now, now);
    return token;
  }

  private dummy(): Promise<string> {
    this.dummyHash ??= hashPassword(randomBytes(12).toString("base64url"));
    return this.dummyHash;
  }
}

function isUniqueViolation(err: unknown): boolean {
  // SQLITE_CONSTRAINT_UNIQUE = 2067, SQLITE_CONSTRAINT_PRIMARYKEY = 1555.
  if (!(err instanceof Error) || !("errcode" in err)) return false;
  return err.errcode === 2067 || err.errcode === 1555;
}
