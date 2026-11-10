import type { Pose, Vec2Yaw } from "@santinh/shared";
import { inviteUrl } from "../net/invite.ts";

export interface PerfInfo {
  calls: number;
  triangles: number;
  fps: number;
  p95: number;
}

/** Live state written by game modules; tests read a copy through `window.__santinh` (P-D7). */
export interface E2EState {
  ready: boolean;
  self: { position: Vec2Yaw; pose: Pose; cushion: number | null; asleep: boolean } | null;
  room: string | null;
  selfId: string | null;
  /** Our name as the room shows it (the server may have made it "An 2"). */
  selfName: string | null;
  /** Real people in the room, us included, residents (NPC) not. */
  count: number;
  /** Ids of the other visitors whose avatar is in the scene. */
  others: string[];
  /** Ids of the other visitors shown dozing (D25). */
  asleep: string[];
  /** Bead counter (T13), same as `localStorage["santinh.beads"]`; loaded at start, not only when the screen opens. */
  beads: { round: number; total: number };
}

export const e2eState: E2EState = {
  ready: false,
  self: null,
  room: null,
  selfId: null,
  selfName: null,
  count: 0,
  others: [],
  asleep: [],
  beads: { round: 0, total: 0 },
};

export interface SantinhHooks extends Readonly<E2EState> {
  perf(): PerfInfo;
  /** Same link the invite button hands out; null before the first snapshot. */
  inviteUrl(): string | null;
}

declare global {
  interface Window {
    __santinh?: SantinhHooks;
  }
}

/** Exposes a read-only view of e2eState. Only call when `?e2e=1`. */
export function installE2EHooks(perf: () => PerfInfo): void {
  // Getters return copies so a test cannot mutate game state by accident.
  const view: SantinhHooks = {
    get ready() {
      return e2eState.ready;
    },
    get self() {
      const s = e2eState.self;
      return s ? { position: { ...s.position }, pose: s.pose, cushion: s.cushion, asleep: s.asleep } : null;
    },
    get room() {
      return e2eState.room;
    },
    get selfId() {
      return e2eState.selfId;
    },
    get selfName() {
      return e2eState.selfName;
    },
    get count() {
      return e2eState.count;
    },
    get others() {
      return [...e2eState.others];
    },
    get asleep() {
      return [...e2eState.asleep];
    },
    get beads() {
      return { ...e2eState.beads };
    },
    perf: () => ({ ...perf() }),
    inviteUrl: () => (e2eState.room && e2eState.selfId ? inviteUrl(e2eState.room, e2eState.selfId) : null),
  };
  Object.defineProperty(window, "__santinh", { value: Object.freeze(view), configurable: false, writable: false });
}
