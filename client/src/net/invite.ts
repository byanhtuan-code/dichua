import { parseNearId, roomNumber } from "@santinh/shared";

/** `?room=…&near=<our id>`; the id survives reconnects (resume token) but not a reload or a long absence. */
export function inviteUrl(room: string, selfId: string, origin: string = location.origin): string {
  const base = new URL("/", origin).toString();
  // Checked ids are URL-safe: write `near=v:abc` as is (URLSearchParams would give the uglier `v%3Aabc`).
  if (roomNumber(room) !== null && parseNearId(selfId) !== null) return `${base}?room=${room}&near=${selfId}`;
  const url = new URL(base);
  url.searchParams.set("room", room);
  url.searchParams.set("near", selfId);
  return url.toString();
}

export function readNear(search: string): string | null {
  // Some share targets (macOS share sheet → Copy) glue the share text onto the URL: "v:abc Đến ngồi…" → keep the id.
  return parseNearId(new URLSearchParams(search).get("near")?.trim().split(/\s/)[0]);
}

/** Drops `near` once used so a reload or a copied address bar does not reuse it. */
export function stripNearFromUrl(): void {
  const url = new URL(location.href);
  if (!url.searchParams.has("near")) return;
  url.searchParams.delete("near");
  history.replaceState(history.state, "", url);
}

export type CopyResult = "copied" | "failed";

/** "failed" (insecure page, old WebView, permission denied) → the caller selects the link for a hand copy. */
export async function copyText(text: string): Promise<CopyResult> {
  try {
    await navigator.clipboard.writeText(text);
    return "copied";
  } catch {
    return "failed";
  }
}
