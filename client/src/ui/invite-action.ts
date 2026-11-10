import type { NetDriver } from "../net/net-driver.ts";
import { copyText, inviteUrl, type CopyResult } from "../net/invite.ts";

export interface InviteDeps {
  net: Pick<NetDriver, "on">;
  currentRoom: () => string;
  copy?: (text: string) => Promise<CopyResult>;
  origin?: () => string;
}

/** Our invite link, kept current from snapshot / status, and copying it (P3-D6: own dialog, no OS share sheet). */
export class InviteAction {
  private selfId: string | null = null;
  private room: string | null = null;
  private connected = false;
  private readonly listeners = new Set<() => void>();
  private readonly off: (() => void)[];

  constructor(private readonly deps: InviteDeps) {
    this.off = [
      deps.net.on("snapshot", (s) => {
        this.selfId = s.selfId;
        this.room = s.room;
        this.changed();
      }),
      deps.net.on("status", (s) => {
        this.connected = s === "connected";
        // Our id dies with the connection; the next snapshot brings the new one.
        if (!this.connected) this.selfId = null;
        this.changed();
      }),
    ];
  }

  /** Null while offline or before the first snapshot: an old id would seat the friend nowhere. */
  link(): string | null {
    if (!this.connected || this.selfId === null) return null;
    return inviteUrl(this.room ?? this.deps.currentRoom(), this.selfId, this.deps.origin?.());
  }

  /** Fires when the link may have changed (joined, reconnected, dropped). */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Null = no link to copy. */
  async copy(): Promise<CopyResult | null> {
    const url = this.link();
    if (url === null) return null;
    return (this.deps.copy ?? copyText)(url);
  }

  dispose(): void {
    for (const off of this.off) off();
    this.listeners.clear();
  }

  private changed(): void {
    for (const fn of this.listeners) fn();
  }
}
