import {
  BOW_PERIOD_MS,
  HELLO_COOLDOWN_MS,
  MOVE_SPEED,
  WALK_RADIUS,
  cushionOf,
  findPath,
  pathLength,
  type Circle,
  type SpaceDef,
  type Pose,
  type Vec2,
  type Vec2Yaw,
} from "@santinh/shared";
import { HELLO_SECONDS } from "../avatar/poses.ts";
import type { SetPoseOptions } from "../avatar/avatar.ts";
import { ownedByUi } from "../controls/input.ts";
import { vi } from "../i18n/vi.ts";
import type { NetDriver } from "../net/net-driver.ts";

/** `rising` = the bow before standing up (P3-D11): still on the cushion, stands when it ends. */
export type ActionState = "idle" | "walking" | "seeking-seat" | "kneeling" | "rising" | "beads" | "hello";
type Base = "idle" | "walking" | "seeking-seat" | "kneeling" | "rising";
type Overlay = "beads" | "hello" | null;

/** L4: one greeting per HELLO_COOLDOWN_MS (shared with the server). */
export { HELLO_COOLDOWN_MS };
/** Longest walk (s) to the granted cushion; longer and Lạy is refused, so AC8's 10 s (reply + walk) still holds. */
export const SEEK_WALK_MAX_S = 8.5;
/** A walk to the cushion that has not arrived by then (blocked, slow frames) snaps onto it. */
export const SEEK_TIMEOUT_S = 9.5;
/** Closer than this the walk counts as arrived. */
const ARRIVE_DIST = 0.05;
/** Bow phase where the forehead touches the floor: the small bell rings there (bowAmount peaks 0.4–0.6). */
const BELL_PHASE = 0.4;

export type ToastKind = "info" | "warn";
export interface ActionToast {
  text: string;
  kind: ToastKind;
}

export interface ActionEvents {
  state: ActionState;
  toast: ActionToast;
  /** Once per bow (sitting down, standing up): the small bell. */
  bell: void;
  /** Our own Chắp tay went out (soft palms sound). */
  hello: void;
  /** Bead screen open / closed (T13 draws the screen). */
  beads: boolean;
  /** We were put somewhere without walking (camera should snap). */
  teleport: Vec2Yaw;
}

type Listener<T> = (value: T) => void;

/** The parts of Movement the actions drive. */
export interface ActionMover {
  readonly position: Vec2Yaw;
  readonly walking: boolean;
  walkTo(point: Vec2 | null): boolean;
  followPath(points: readonly Vec2[]): boolean;
  stop(): void;
  teleport(p: Vec2Yaw): void;
}

export interface ActionAvatar {
  setPose(pose: Pose, opts?: SetPoseOptions): void;
  setAsleep(asleep: boolean): void;
}

export interface ActionDeps {
  space: SpaceDef;
  net: Pick<NetDriver, "requestSeat" | "stand" | "hello" | "sendMove" | "bead" | "bow" | "setAsleep">;
  mover: ActionMover;
  avatar: ActionAvatar;
  connected(): boolean;
  /** Server ms (bow sync, cooldowns). */
  serverNow(): number;
  /** People sitting on cushions (Movement obstacles). */
  obstacles(): readonly Circle[];
}

/**
 * Our own action state machine (L3–L5, P3-D11): Lạy (seek cushion → walk the route → kneel + one bow; again = one more bow → stand),
 * Chắp tay (3 s cooldown), Tràng hạt (bead pose while the screen is open).
 * `base` is where we are (walking / on a cushion); `overlay` is a pose shown on top of it.
 */
export class Actions {
  private base: Base = "idle";
  private overlay: Overlay = null;
  private cushionId: number | null = null;
  /** Bumped on every request / cancel so late seat replies are ignored. */
  private requestToken = 0;
  private walkingToSeat = false;
  private seekElapsed = 0;
  private bowAt = 0;
  /** The current bow has not reached the bell yet. */
  private bellPending = false;
  private lastHelloAt = -Infinity;
  private helloElapsed = 0;
  private reported: ActionState = "idle";
  private dozing = false;
  private readonly listeners: { [K in keyof ActionEvents]: Set<Listener<ActionEvents[K]>> } = {
    state: new Set(),
    toast: new Set(),
    bell: new Set(),
    hello: new Set(),
    beads: new Set(),
    teleport: new Set(),
  };

  constructor(private readonly d: ActionDeps) {}

  on<K extends keyof ActionEvents>(type: K, fn: Listener<ActionEvents[K]>): () => void {
    const set = this.listeners[type] as Set<Listener<ActionEvents[K]>>;
    set.add(fn);
    return () => set.delete(fn);
  }

  get state(): ActionState {
    return this.overlay ?? this.base;
  }

  /** Granted cushion (from the grant until we stand), else null. */
  get cushion(): number | null {
    return this.cushionId;
  }

  /** Sitting on the cushion (body rests on its top). */
  get seated(): boolean {
    return this.base === "kneeling" || this.base === "rising";
  }

  /** Seeking or on a cushion (the dock's Lạy reads Dừng), whatever overlay is on top. */
  get bowing(): boolean {
    return this.base === "seeking-seat" || this.seated;
  }

  get beadsOpen(): boolean {
    return this.overlay === "beads";
  }

  /** D25: dozing where we are (a cushion kept). */
  get asleep(): boolean {
    return this.dozing;
  }

  /**
   * Inactive (D25): close beads / drop a greeting, then doze in place. Returns false while a seat walk or the
   * standing-up bow is in flight (seconds long): the caller tries again on its next check.
   */
  sleep(): boolean {
    if (this.dozing) return true;
    if (this.base === "seeking-seat" || this.base === "rising") return false;
    if (this.overlay === "beads") this.closeBeads();
    this.cancelHello();
    this.d.mover.stop();
    this.dozing = true;
    this.d.avatar.setAsleep(true);
    this.d.net.setAsleep(true);
    return true;
  }

  /** Any input after sleep(): back to the pose we dozed off in. */
  wake(): void {
    if (!this.dozing) return;
    this.dozing = false;
    this.d.avatar.setAsleep(false);
    this.d.net.setAsleep(false);
  }

  /** Lạy / Dừng (key 1, E, Space). */
  bow(): void {
    if (this.base === "kneeling" && this.canRise()) {
      this.rise();
      return;
    }
    if (this.base === "seeking-seat" || this.seated) {
      this.standUp();
      return;
    }
    if (this.overlay === "beads") this.closeBeads();
    if (!this.d.connected()) {
      this.toast(vi.toast.notConnected, "warn");
      return;
    }
    const p = this.d.mover.position;
    // No walk is shorter than the straight line: refuse before reserving anything.
    if (this.nearestCushionDist(p) / MOVE_SPEED > SEEK_WALK_MAX_S) {
      this.toast(vi.toast.tooFarToBow, "info");
      return;
    }
    this.d.mover.stop();
    this.cancelHello();
    this.base = "seeking-seat";
    this.walkingToSeat = false;
    const token = ++this.requestToken;
    this.report();
    this.d.net.requestSeat({ x: p.x, z: p.z }).then(
      (seat) => this.onSeatReply(token, seat),
      () => {
        if (token !== this.requestToken) return;
        this.base = "idle";
        this.toast(vi.toast.notConnected, "warn");
        this.report();
      },
    );
  }

  /** Chắp tay (key 3): pose for HELLO_SECONDS + network hello, at most once per HELLO_COOLDOWN_MS. */
  hello(): void {
    if (this.overlay === "beads") return;
    const now = this.d.serverNow();
    if (now - this.lastHelloAt < HELLO_COOLDOWN_MS) return;
    this.lastHelloAt = now;
    // Greeting is done standing still (or kneeling); a click walk would glide in the hello pose.
    if (!this.seated && this.base !== "seeking-seat") this.d.mover.stop();
    this.overlay = "hello";
    this.helloElapsed = 0;
    if (this.base !== "seeking-seat") {
      this.d.avatar.setPose("hello");
    }
    this.d.net.hello();
    this.emit("hello", undefined);
    this.toast(vi.toast.helloSent, "info");
    this.report();
  }

  /** Tràng hạt (key 2): opens the bead screen; pressed again closes it. */
  toggleBeads(): void {
    if (this.overlay === "beads") {
      this.closeBeads();
      return;
    }
    this.cancelHello();
    // The bead pose would hide the rising bow: stand now.
    if (this.base === "seeking-seat" || this.base === "rising") this.standUp();
    this.d.mover.stop();
    this.overlay = "beads";
    this.setPose("beads");
    this.emit("beads", true);
    this.report();
  }

  /** One bead counted on the bead screen: others hear about it (L5). */
  bead(): void {
    if (this.overlay === "beads" && this.d.connected()) this.d.net.bead();
  }

  /** Called by the bead screen on "Quay lại" / Esc (T13). */
  closeBeads(): void {
    if (this.overlay !== "beads") return;
    this.overlay = null;
    this.restorePose();
    this.emit("beads", false);
    this.report();
  }

  /** The player started walking (floor tap, WASD): stand up, drop greetings / beads. Cheap when idle. */
  interrupt(): void {
    if (this.overlay === "beads") this.closeBeads();
    if (this.base === "seeking-seat" || this.seated) {
      this.standUp();
      return;
    }
    if (this.overlay === "hello") {
      this.cancelHello();
      this.report();
    }
  }

  /** Room snapshot (join, switch, resync): the server's word on our cushion (seated or reserved) wins. */
  syncSelf(cushion: number | null, reserved: number | null): void {
    if (cushion !== null || (!this.seated && this.base !== "seeking-seat")) return;
    // Resync mid-walk: the server still holds our cushion (or grants it with the reply still on its way) — keep going.
    if (this.base === "seeking-seat" && reserved !== null && (this.cushionId ?? reserved) === reserved) return;
    if (this.base === "seeking-seat") {
      this.d.mover.stop();
      // A reservation the server may still hold: let it go.
      if (this.d.connected()) this.d.net.stand();
    }
    this.requestToken++;
    this.cushionId = null;
    this.walkingToSeat = false;
    if (this.seated && this.overlay !== "beads") this.d.avatar.setPose("walk");
    if (this.overlay === "hello") this.overlay = null;
    this.base = "idle";
    this.report();
  }

  /** Per frame, after Movement.update. */
  update(dt: number): void {
    if (this.overlay === "hello") {
      this.helloElapsed += dt;
      if (this.helloElapsed >= HELLO_SECONDS) {
        this.overlay = null;
        if (this.seated) this.d.avatar.setPose("kneel", { bowAt: this.bowAt });
        else this.d.avatar.setPose("walk");
      }
    }

    if (this.base === "seeking-seat" && this.walkingToSeat && this.cushionId !== null) {
      this.seekElapsed += dt;
      const c = cushionOf(this.d.space, this.cushionId);
      const p = this.d.mover.position;
      const arrived = Math.hypot(c.x - p.x, c.z - p.z) < ARRIVE_DIST;
      // `walking` turns true on the first Movement.update after walkTo; give it one frame.
      const stalled = this.seekElapsed > 0.2 && !this.d.mover.walking;
      if (arrived || stalled || this.seekElapsed > SEEK_TIMEOUT_S) this.kneel();
    } else if (this.base === "idle" || this.base === "walking") {
      this.base = this.d.mover.walking ? "walking" : "idle";
    }

    if (this.seated && this.bellPending && this.d.serverNow() - this.bowAt >= BELL_PHASE * BOW_PERIOD_MS) {
      this.bellPending = false;
      // No bell while an overlay (beads, hello) hides the bow; it is not rung later either.
      if (this.overlay === null) this.emit("bell", undefined);
    }
    if (this.base === "rising" && this.d.serverNow() - this.bowAt >= BOW_PERIOD_MS) this.standUp();
    this.report();
  }

  private onSeatReply(token: number, seat: number | null): void {
    // Cancelled (stood up / switched room) while waiting: stand() already released it on the server.
    if (token !== this.requestToken || this.base !== "seeking-seat") return;
    if (seat === null) {
      this.base = "idle";
      this.toast(vi.toast.noCushion, "warn");
      this.report();
      return;
    }
    this.cushionId = seat;
    const c = cushionOf(this.d.space, seat);
    const p = this.d.mover.position;
    const route =
      Math.hypot(c.x - p.x, c.z - p.z) < 0.3
        ? null
        : findPath(this.d.space.collision, this.d.space.navPoints, p, c, WALK_RADIUS, this.d.obstacles());
    if (route && pathLength(p, route) / MOVE_SPEED > SEEK_WALK_MAX_S) {
      // The free cushion is beyond the walk budget (nearer ones are taken, or the way round is long).
      this.standUp();
      this.toast(vi.toast.tooFarToBow, "info");
      return;
    }
    // No route (boxed in by seated people) or already there: snap onto it.
    if (!route || !this.d.mover.followPath(route)) {
      this.kneel();
      return;
    }
    this.walkingToSeat = true;
    this.seekElapsed = 0;
  }

  private nearestCushionDist(p: Vec2): number {
    let best = Infinity;
    for (const c of this.d.space.cushions) best = Math.min(best, Math.hypot(c.x - p.x, c.z - p.z));
    return best;
  }

  private kneel(): void {
    if (this.cushionId === null) return;
    const c = cushionOf(this.d.space, this.cushionId);
    const p = this.d.mover.position;
    const far = Math.hypot(c.x - p.x, c.z - p.z) > 1;
    const at: Vec2Yaw = { x: c.x, z: c.z, yaw: c.yaw };
    this.d.mover.teleport(at);
    if (far) this.emit("teleport", at);
    this.walkingToSeat = false;
    this.base = "kneeling";
    this.bowAt = this.d.serverNow();
    this.bellPending = true;
    // A greeting started on the way would hand the avatar back to `walk`: kneel instead.
    if (this.overlay === "hello") this.overlay = null;
    this.setPose("kneel", { bowAt: this.bowAt });
    this.toast(vi.toast.bowing, "info");
    this.report();
  }

  /** Offline or behind the bead screen nobody would see the bow: Dừng stands at once. */
  private canRise(): boolean {
    return this.overlay !== "beads" && this.d.connected();
  }

  /**
   * Bow, then standUp() from update() once it is over.
   * Dừng during the sitting-down bow reuses it: the server takes one bow per BOW_PERIOD_MS (T7a).
   */
  private rise(): void {
    this.base = "rising";
    if (this.overlay === "hello") this.overlay = null;
    if (this.d.serverNow() - this.bowAt >= BOW_PERIOD_MS) {
      this.d.net.bow();
      this.bowAt = this.d.serverNow();
      this.bellPending = true;
    }
    // `bow` already tells the room (bowAt + event): no move needed for the pose.
    this.d.avatar.setPose("kneel", { bowAt: this.bowAt });
    this.report();
  }

  private standUp(): void {
    this.requestToken++;
    if (this.base === "seeking-seat") this.d.mover.stop();
    this.d.net.stand();
    this.cushionId = null;
    this.walkingToSeat = false;
    this.base = "idle";
    if (this.overlay === "hello") this.overlay = null;
    if (this.overlay !== "beads") this.d.avatar.setPose("walk");
    this.report();
  }

  private cancelHello(): void {
    if (this.overlay !== "hello") return;
    this.overlay = null;
    this.restorePose();
  }

  private restorePose(): void {
    if (this.seated) this.setPose("kneel", { bowAt: this.bowAt });
    else this.setPose("walk");
  }

  /**
   * Others see our pose through `move`; Movement only sends when we move,
   * so a pose change in place (arrive on the cushion, beads) is sent here.
   */
  private setPose(pose: Pose, opts?: SetPoseOptions): void {
    this.d.avatar.setPose(pose, opts);
    const p = this.d.mover.position;
    this.d.net.sendMove({ x: p.x, z: p.z, yaw: p.yaw }, pose);
  }

  private toast(text: string, kind: ToastKind): void {
    this.emit("toast", { text, kind });
  }

  private report(): void {
    const s = this.state;
    if (s === this.reported) return;
    this.reported = s;
    this.emit("state", s);
  }

  private emit<K extends keyof ActionEvents>(type: K, value: ActionEvents[K]): void {
    for (const fn of this.listeners[type] as Set<Listener<ActionEvents[K]>>) fn(value);
  }
}

/** Keys: 1 / E / Space = Lạy·Dừng, 2 = Tràng hạt, 3 = Chắp tay. Returns the remover. */
export function installActionKeys(actions: Actions, target: Window = window): () => void {
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || ownedByUi(e.target)) return;
    switch (e.code) {
      case "Digit1":
      case "Numpad1":
      case "KeyE":
        actions.bow();
        break;
      case "Space":
        if (actions.beadsOpen) return;
        // Space on a focused button already clicks it.
        if (e.target instanceof HTMLElement && e.target.closest("button, a, [role=button]")) return;
        actions.bow();
        break;
      case "Digit2":
      case "Numpad2":
        actions.toggleBeads();
        break;
      case "Digit3":
      case "Numpad3":
        actions.hello();
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  target.addEventListener("keydown", onKeyDown);
  return () => target.removeEventListener("keydown", onKeyDown);
}
