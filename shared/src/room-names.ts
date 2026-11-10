import { isRecord } from "./guards.ts";
import { normalizeLabel } from "./names.ts";
import { ROOM_COUNT } from "./world.ts";

export const MAX_ROOM_NAME_CHARS = 24;

/** D26: shown instead of "Phòng N"; the admin page can rename them (stored on the server). */
export const DEFAULT_ROOM_NAMES: readonly string[] = [
  "Tĩnh Tâm",
  "An Nhiên",
  "Thanh Tịnh",
  "Vô Ưu",
  "Liên Hoa",
  "Bạch Vân",
  "Minh Nguyệt",
  "Tịnh Thủy",
  "Tùng Phong",
  "Hỷ Lạc",
];

export function normalizeRoomName(raw: unknown): string | null {
  return normalizeLabel(raw, MAX_ROOM_NAME_CHARS);
}

/** `{ names: [...] }` from the admin page → ROOM_COUNT cleaned names; wrong count, a blank or a duplicate → null. */
export function parseRoomNames(raw: unknown): string[] | null {
  if (!isRecord(raw) || !Array.isArray(raw["names"]) || raw["names"].length !== ROOM_COUNT) return null;
  const names: string[] = [];
  for (const n of raw["names"] as unknown[]) {
    const clean = normalizeRoomName(n);
    if (clean === null) return null;
    names.push(clean);
  }
  return new Set(names).size === names.length ? names : null;
}

/** Name of room `n` (1-based) from a list that may be short or missing. */
export function roomNameOf(names: readonly string[] | null | undefined, n: number): string {
  return names?.[n - 1] ?? DEFAULT_ROOM_NAMES[n - 1] ?? `${n}`;
}
