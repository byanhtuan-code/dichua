/**
 * Empty allow-list = same origin only (Origin host equals Host). Entries are full origins, or carry one `*`
 * inside the host (`https://*-team.vercel.app`). The `*` never crosses a dot, so
 * `evil-team.vercel.app.attacker.com` cannot match.
 */
export function isAllowedOrigin(origin: string | undefined, host: string | undefined, allowList: readonly string[]): boolean {
  // Browsers always send Origin on a WebSocket; a missing one is a script / curl, which could forge it anyway.
  if (!origin) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.origin !== origin) return false;
  if (allowList.length === 0) return host !== undefined && url.host === host;
  return allowList.some((entry) => matches(entry, origin));
}

function matches(entry: string, origin: string): boolean {
  const star = entry.indexOf("*");
  if (star === -1) return entry === origin;
  if (entry.indexOf("*", star + 1) !== -1) return false;
  const pattern = entry.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace("*", "[a-z0-9-]*");
  return new RegExp(`^${pattern}$`, "i").test(origin);
}
