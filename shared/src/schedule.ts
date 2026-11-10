// Day/night and chanting sessions follow Vietnam time (UTC+7, no DST) — D11.

const HOUR = 3_600_000;
const MINUTE = 60_000;
const DAY = 24 * HOUR;
export const VN_OFFSET_MS = 7 * HOUR;

export const DAY_START_HOUR = 6;
export const NIGHT_START_HOUR = 18;
/** Sky/light blend length, centred on 06:00 and 18:00. */
export const TRANSITION_MS = 20 * MINUTE;
export const CEREMONY_HOURS: readonly number[] = [5, 18];
/** How long a shared chanting session (and its banner) lasts. */
export const CEREMONY_DURATION_S = 30 * 60;

/** Milliseconds since midnight, Vietnam time. */
export function vnTimeOfDay(ms: number): number {
  return (((ms + VN_OFFSET_MS) % DAY) + DAY) % DAY;
}

/** UTC ms of the Vietnam midnight that starts the day containing `ms`. */
export function vnMidnight(ms: number): number {
  return ms - vnTimeOfDay(ms);
}

function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

/**
 * `isDay` is true from 06:00 to before 18:00.
 * `t` is daylight amount for colour blending: 0 = full night, 1 = full day.
 */
export function dayPhase(ms: number): { isDay: boolean; t: number } {
  const tod = vnTimeOfDay(ms);
  const dawn = DAY_START_HOUR * HOUR;
  const dusk = NIGHT_START_HOUR * HOUR;
  const half = TRANSITION_MS / 2;
  let t: number;
  if (tod < dawn - half || tod >= dusk + half) t = 0;
  else if (tod < dawn + half) t = smoothstep((tod - (dawn - half)) / TRANSITION_MS);
  else if (tod < dusk - half) t = 1;
  else t = 1 - smoothstep((tod - (dusk - half)) / TRANSITION_MS);
  return { isDay: tod >= dawn && tod < dusk, t };
}

export interface CeremonyState {
  /** Running session, or null. `offsetSeconds` is how far into the chant everyone should be. */
  active: { startsAt: number; offsetSeconds: number } | null;
  /** UTC ms of the next session start strictly after `ms`. */
  next: number;
}

export function ceremonyAt(ms: number, durationS: number): CeremonyState {
  const midnight = vnMidnight(ms);
  const starts: number[] = [];
  for (const d of [-1, 0, 1]) for (const h of CEREMONY_HOURS) starts.push(midnight + d * DAY + h * HOUR);
  starts.sort((a, b) => a - b);

  let active: CeremonyState["active"] = null;
  let next = Number.POSITIVE_INFINITY;
  for (const s of starts) {
    if (s <= ms && ms < s + durationS * 1000) active = { startsAt: s, offsetSeconds: (ms - s) / 1000 };
    if (s > ms && s < next) next = s;
  }
  return { active, next };
}
