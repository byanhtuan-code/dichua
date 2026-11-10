/** Beads on one mala; the guru bead closes the round and is not counted. */
export const BEADS_PER_ROUND = 108;
export const BEADS_STORAGE_KEY = "santinh.beads";

export interface BeadsCount {
  /** Current round, 1-based. A round that just reached 108 stays current until the next bead. */
  round: number;
  total: number;
}

/** Round number for a running total: 0–108 → 1, 109–216 → 2… */
export function roundOf(total: number): number {
  return total <= 0 ? 1 : Math.floor((total - 1) / BEADS_PER_ROUND) + 1;
}

/** Beads counted in the current round: 0 only before the very first bead, then 1…108. */
export function inRound(total: number): number {
  return total <= 0 ? 0 : total - (roundOf(total) - 1) * BEADS_PER_ROUND;
}

/**
 * Ever-increasing ring slot shown at the centre (slot mod 109; slot 0 = guru bead).
 * 0 beads → slot 1, 108 → guru; the next round starts past the guru on slot 2 again.
 */
export function centreSlot(total: number): number {
  if (total <= 0) return 1;
  const r = roundOf(total);
  const n = inRound(total);
  return (r - 1) * (BEADS_PER_ROUND + 1) + (n === BEADS_PER_ROUND ? BEADS_PER_ROUND + 1 : n + 1);
}

export function loadBeads(storage: Pick<Storage, "getItem"> | null): BeadsCount {
  try {
    const raw = storage?.getItem(BEADS_STORAGE_KEY);
    if (!raw) return { round: 1, total: 0 };
    const v: unknown = JSON.parse(raw);
    const total = typeof v === "object" && v !== null && "total" in v ? v.total : 0;
    // `round` is derived from `total`; a stale or hand-edited round must not desync the two.
    const t = typeof total === "number" && Number.isSafeInteger(total) && total > 0 ? total : 0;
    return { round: roundOf(t), total: t };
  } catch {
    return { round: 1, total: 0 };
  }
}

export function saveBeads(storage: Pick<Storage, "setItem"> | null, c: BeadsCount): void {
  try {
    storage?.setItem(BEADS_STORAGE_KEY, JSON.stringify({ round: c.round, total: c.total }));
  } catch {
    // Private mode / quota: counting still works for this session.
  }
}

/** `localStorage` itself throws on access in some locked-down browsers. */
export function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Counts one bead; `completed` = rounds finished when this bead closed one (toast), else null. */
export function addBead(c: BeadsCount): {
  next: BeadsCount;
  completed: number | null;
} {
  const total = c.total + 1;
  const next = { round: roundOf(total), total };
  return {
    next,
    completed: inRound(total) === BEADS_PER_ROUND ? total / BEADS_PER_ROUND : null,
  };
}
