import { SESSION_TOKEN } from "@santinh/shared";

export const SESSION_STORAGE_KEY = "santinh.session";

function storage(): Storage | null {
  // `localStorage` itself throws on access in some locked-down browsers.
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The saved session token (P4-D4); null when none, unreadable or not token-shaped. */
export function loadSession(): string | null {
  try {
    const token = storage()?.getItem(SESSION_STORAGE_KEY) ?? null;
    return token !== null && SESSION_TOKEN.test(token) ? token : null;
  } catch {
    return null;
  }
}

/** A malformed token is ignored: it could never authenticate. */
export function saveSession(token: string): void {
  if (!SESSION_TOKEN.test(token)) return;
  try {
    storage()?.setItem(SESSION_STORAGE_KEY, token);
  } catch {
    // Private mode / quota: the session still works until the tab closes.
  }
}

export function clearSession(): void {
  try {
    storage()?.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Nothing stored that we can reach.
  }
}
