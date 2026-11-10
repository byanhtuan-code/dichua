import type { Camera } from "three";

/** Test/debug switches from the URL. Read once; later tasks use this, never `location.search` directly. */
export interface DebugParams {
  e2e: boolean;
  debug: boolean;
  /** `?time=HH:MM` as ms since Vietnam midnight, or null. */
  timeOfDayMs: number | null;
  cam: string | null;
  avatar: boolean;
  pose: string | null;
  mock: string | null;
  /** `?shadows=1` forces shadows on even with `e2e=1` (perf measurements). */
  shadows: boolean;
  /** `?sleep=<ms>` (e2e only): doze after this much idle instead of SLEEP_MS, so a test does not wait 3 minutes. */
  sleepMs: number | null;
}

const OFF: DebugParams = {
  e2e: false,
  debug: false,
  timeOfDayMs: null,
  cam: null,
  avatar: false,
  pose: null,
  mock: null,
  shadows: false,
  sleepMs: null,
};

export function parseTimeOfDay(value: string | null): number | null {
  const m = value ? /^(\d{1,2}):(\d{2})$/.exec(value) : null;
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return (h * 60 + min) * 60_000;
}

export function parseParams(search: string, dev: boolean): DebugParams {
  const q = new URLSearchParams(search);
  const e2e = q.get("e2e") === "1";
  // Production builds ignore test switches unless the e2e flag is set explicitly.
  if (!dev && !e2e) return OFF;
  return {
    e2e,
    debug: q.get("debug") === "1",
    timeOfDayMs: parseTimeOfDay(q.get("time")),
    cam: q.get("cam"),
    avatar: q.get("avatar") === "1",
    pose: q.get("pose"),
    mock: q.get("mock"),
    shadows: q.get("shadows") === "1",
    sleepMs: e2e ? positiveInt(q.get("sleep")) : null,
  };
}

function positiveInt(v: string | null): number | null {
  const n = Number(v);
  return v !== null && Number.isSafeInteger(n) && n > 0 ? n : null;
}

let cached: DebugParams | null = null;

export function params(): DebugParams {
  cached ??= parseParams(location.search, import.meta.env.DEV);
  return cached;
}

export interface CameraPreset {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
}

const presets = new Map<string, CameraPreset>();

export function registerCameraPreset(name: string, preset: CameraPreset): void {
  presets.set(name, preset);
}

/** Moves the camera to `?cam=<name>` if such a preset exists. Returns true when applied. */
export function applyCameraPreset(camera: Camera, name: string | null = params().cam): boolean {
  const preset = name ? presets.get(name) : undefined;
  if (!preset) return false;
  camera.position.set(...preset.position);
  camera.lookAt(...preset.target);
  return true;
}
