import { normalizeVisitorName } from "@santinh/shared";

export const NAME_STORAGE_KEY = "santinh.name";

function storage(): Storage | null {
  // `localStorage` itself throws on access in some locked-down browsers.
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The name the visitor chose (P3-D3), normalised like the server does; null when none or unreadable. */
export function loadName(): string | null {
  try {
    return normalizeVisitorName(storage()?.getItem(NAME_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

/** Stores the chosen name (not the one the server hands back, e.g. "An 2"). An empty name is ignored. */
export function saveName(name: string): void {
  const clean = normalizeVisitorName(name);
  if (clean === null) return;
  try {
    storage()?.setItem(NAME_STORAGE_KEY, clean);
  } catch {
    // Private mode / quota: the name still works for this visit.
  }
}
