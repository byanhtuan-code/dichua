/** Realtime server origin; empty means the page's own origin (local `npm run start`, Vite proxy). */
function serverOrigin(): string {
  const configured = import.meta.env.VITE_SERVER_ORIGIN?.trim().replace(/\/+$/, "");
  return configured || location.origin;
}

export function apiUrl(path: string): string {
  return `${serverOrigin()}${path}`;
}

/** `https:` → `wss:`, `http:` → `ws:`. */
export function wsUrl(room: string, near: string | null = null, resume: string | null = null, name: string | null = null): string {
  const url = new URL("/ws", serverOrigin());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("room", room);
  if (near) url.searchParams.set("near", near);
  if (resume) url.searchParams.set("resume", resume);
  if (name) url.searchParams.set("name", name);
  return url.toString();
}
