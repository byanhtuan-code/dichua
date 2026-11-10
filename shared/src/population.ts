// How busy each room looks (P-D6, P3-D7). Pure functions of (room, time, config): client and server get the same answer.
import { seeded } from "./random.ts";
import { VN_OFFSET_MS } from "./schedule.ts";
import { ROOM_COUNT, roomNumber } from "./world.ts";

export type RoomTier = "full" | "busy" | "medium" | "quiet";
export type BotTier = Exclude<RoomTier, "full">;

/** Bot population settings, editable at runtime (`/admin`); a `full` room fills whatever capacity is left. */
export interface PopulationConfig {
  /** How many rooms get each tier in a slot (sums to ROOM_COUNT). */
  layout: Readonly<Record<RoomTier, number>>;
  /** Bot count range per tier, inclusive. */
  bots: Readonly<Record<BotTier, readonly [number, number]>>;
  /** Fake visitors a room keeps whenever there is room for them. */
  minBots: number;
}

export const DEFAULT_POPULATION: PopulationConfig = {
  layout: { full: 0, busy: 2, medium: 4, quiet: 4 },
  bots: { busy: [8, 12], medium: [4, 6], quiet: [1, 3] },
  minBots: 1,
};

export const MAX_MIN_BOTS = 5;
/** Tiers reshuffle every 3 hours of Vietnam time. */
export const SLOT_MS = 3 * 3_600_000;
/** The target drifts ±WAVE_AMP over WAVE_MS so the head count "breathes". */
const WAVE_MS = 10 * 60_000;
const WAVE_AMP = 2;
const TIER_ORDER: readonly RoomTier[] = ["full", "busy", "medium", "quiet"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isCount(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
}

/**
 * Untrusted input (admin form, file on disk) → a fresh config, or null when anything is off.
 * - `full` stays below ROOM_COUNT: room 1 is never full;
 * - a range tops out at `capacity − 1` so a real visitor always fits.
 */
export function parsePopulation(raw: unknown, capacity: number): PopulationConfig | null {
  if (!isRecord(raw) || !isRecord(raw.layout) || !isRecord(raw.bots)) return null;
  const layout: Record<RoomTier, number> = { full: 0, busy: 0, medium: 0, quiet: 0 };
  for (const tier of TIER_ORDER) {
    const n = raw.layout[tier];
    if (!isCount(n, 0, ROOM_COUNT)) return null;
    layout[tier] = n;
  }
  if (layout.busy + layout.medium + layout.quiet + layout.full !== ROOM_COUNT || layout.full >= ROOM_COUNT) return null;
  const range = (v: unknown): readonly [number, number] | null => {
    if (!Array.isArray(v) || v.length !== 2) return null;
    const [lo, hi]: unknown[] = v;
    return isCount(lo, 0, capacity - 1) && isCount(hi, lo, capacity - 1) ? [lo, hi] : null;
  };
  const busy = range(raw.bots.busy);
  const medium = range(raw.bots.medium);
  const quiet = range(raw.bots.quiet);
  if (!busy || !medium || !quiet || !isCount(raw.minBots, 0, MAX_MIN_BOTS)) return null;
  return { layout, bots: { busy, medium, quiet }, minBots: raw.minBots };
}

export function slotOf(now: number): number {
  return Math.floor((now + VN_OFFSET_MS) / SLOT_MS);
}

function slotSeed(slot: number, salt: number): number {
  return Math.imul(slot, 0x9e3779b1) ^ salt;
}

// Keyed by the layout values, not the object: a saved config is a new object, an edited one may be the same.
let cachedKey = "";
let cachedTiers: readonly RoomTier[] = [];

/** Tier of every room (index = room number − 1) during the slot holding `now`. */
export function tiersAt(now: number, cfg: PopulationConfig): readonly RoomTier[] {
  const slot = slotOf(now);
  const { layout } = cfg;
  const key = `${slot}:${TIER_ORDER.map((t) => layout[t]).join(",")}`;
  if (key === cachedKey) return cachedTiers;
  const rng = seeded(slotSeed(slot, 0x5157));
  const order = Array.from({ length: ROOM_COUNT }, (_, i) => i + 1);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j] ?? 0, order[i] ?? 0];
  }
  // Room 1 is the default shared link: never turn people away there (swap it just past the full rooms).
  const full = Math.min(layout.full, ROOM_COUNT - 1);
  const at = order.indexOf(1);
  if (at < full) [order[at], order[full]] = [order[full] ?? 0, 1];
  const tiers: RoomTier[] = new Array<RoomTier>(ROOM_COUNT).fill("quiet");
  let k = 0;
  for (const tier of TIER_ORDER) {
    const n = tier === "full" ? full : layout[tier];
    for (let c = 0; c < n && k < ROOM_COUNT; c++, k++) tiers[(order[k] ?? 1) - 1] = tier;
  }
  cachedKey = key;
  cachedTiers = tiers;
  return tiers;
}

export function tierOf(roomId: string, now: number, cfg: PopulationConfig): RoomTier {
  const n = roomNumber(roomId);
  if (n === null) throw new RangeError(`room ${roomId}`);
  return tiersAt(now, cfg)[n - 1] ?? "quiet";
}

/**
 * How many fake visitors the room should hold now, given `realCount` real people inside.
 * Never more than the free places; at least `cfg.minBots` while there is room for them.
 */
export function botTarget(roomId: string, now: number, capacity: number, realCount: number, cfg: PopulationConfig): number {
  const free = Math.max(0, capacity - realCount);
  const tier = tierOf(roomId, now, cfg);
  if (tier === "full") return free;
  const [lo, hi] = cfg.bots[tier];
  const rng = seeded(slotSeed(slotOf(now), roomNumber(roomId) ?? 1));
  const base = lo + rng() * (hi - lo);
  const phase = rng() * Math.PI * 2;
  const wave = base + WAVE_AMP * Math.sin((2 * Math.PI * now) / WAVE_MS + phase);
  const want = Math.round(Math.min(hi, Math.max(lo, wave)));
  return Math.min(free, Math.max(cfg.minBots, want));
}
