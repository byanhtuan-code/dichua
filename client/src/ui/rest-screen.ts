import { vi } from "../i18n/vi.ts";
import { overlayDialog } from "./dialog.ts";
import { icons } from "./icons.ts";
import "./base.css";

/** No input for this long → doze in place (D25). */
export const SLEEP_MS = 3 * 60_000;
/** Dozing this long → rest: leave the room and free the slot / cushion (D25). */
export const SLEEP_REST_MS = 60 * 60_000;
const IDLE_CHECK_MS = 15_000;
/** A hidden tab counts as away only after this long, so a quick tab switch changes nothing. */
export const HIDDEN_MS = 60_000;
const ACTIVITY = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;

export interface RestOptions {
  /** Inactive: doze. False = not now (mid seat walk), asked again on the next check. */
  onSleep(): boolean;
  /** Input (or the tab shown again) after onSleep. */
  onWake(): void;
  /** The tab stayed hidden for HIDDEN_MS with background play off (true), or is shown again (false): sound follows it. */
  onAway?(away: boolean): void;
  /** Dozed for SLEEP_REST_MS: leave the room. */
  onRest(): void;
  /** "Tiếp tục ở lại". */
  onResume(): void;
  /** Settings "phát nền khi đổi tab" (T12); while true a hidden tab keeps playing (it still dozes once idle). */
  backgroundPlay?(): boolean;
  sleepMs?: number;
  restMs?: number;
  hiddenMs?: number;
}

/** Inactivity (D25): doze after SLEEP_MS, then "Đang tạm nghỉ" (design/rest.html) after SLEEP_REST_MS asleep. */
export class RestScreen {
  private readonly dialog: HTMLDialogElement;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly sleepMs: number;
  private readonly restMs: number;
  private readonly hiddenMs: number;
  private hiddenTimer: ReturnType<typeof setTimeout> | undefined;
  private lastActivity = performance.now();
  private asleepAt: number | null = null;
  private away = false;

  constructor(
    private readonly o: RestOptions,
    parent: HTMLElement = document.body,
  ) {
    this.sleepMs = o.sleepMs ?? SLEEP_MS;
    this.restMs = o.restMs ?? SLEEP_REST_MS;
    this.hiddenMs = o.hiddenMs ?? HIDDEN_MS;
    this.dialog = overlayDialog("overlay--dark", "rest-title", () => o.onResume());
    const mark = document.createElement("span");
    mark.className = "mark mark--lantern";
    mark.innerHTML = icons.temple;
    const title = document.createElement("h1");
    title.id = "rest-title";
    title.textContent = vi.rest.title;
    const body = document.createElement("p");
    body.textContent = vi.rest.body;
    const resume = document.createElement("button");
    resume.type = "button";
    resume.className = "btn";
    resume.textContent = vi.rest.resume;
    resume.addEventListener("click", () => o.onResume());
    this.dialog.append(mark, title, body, resume);
    parent.append(this.dialog);

    document.addEventListener("visibilitychange", this.onVisibility);
    for (const type of ACTIVITY) window.addEventListener(type, this.onActivity, { passive: true, capture: true });
    // A short test doze (`?sleep=`) needs a check that keeps up with it.
    this.timer = setInterval(this.checkIdle, Math.min(IDLE_CHECK_MS, Math.ceil(this.sleepMs / 4)));
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  get asleep(): boolean {
    return this.asleepAt !== null;
  }

  show(): void {
    if (!this.dialog.open) this.dialog.showModal();
  }

  /** Back from rest: awake, the idle clock starts over. */
  hide(): void {
    this.lastActivity = performance.now();
    this.asleepAt = null;
    if (this.dialog.open) this.dialog.close();
  }

  dispose(): void {
    clearInterval(this.timer);
    clearTimeout(this.hiddenTimer);
    document.removeEventListener("visibilitychange", this.onVisibility);
    for (const type of ACTIVITY) window.removeEventListener(type, this.onActivity, { capture: true });
    this.hide();
    this.dialog.remove();
  }

  private readonly onActivity = (): void => {
    this.lastActivity = performance.now();
    if (!document.hidden) this.wake();
  };

  private readonly onVisibility = (): void => {
    clearTimeout(this.hiddenTimer);
    if (!document.hidden) {
      this.lastActivity = performance.now();
      this.setAway(false);
      this.wake();
      return;
    }
    this.hiddenTimer = setTimeout(() => {
      if (!document.hidden || this.o.backgroundPlay?.()) return;
      this.setAway(true);
      this.trySleep();
    }, this.hiddenMs);
  };

  private readonly checkIdle = (): void => {
    if (this.dialog.open) return;
    const now = performance.now();
    if (this.asleepAt === null) {
      if (now - this.lastActivity >= this.sleepMs) this.trySleep();
    } else if (now - this.asleepAt >= this.restMs) {
      this.asleepAt = null;
      this.o.onRest();
    }
  };

  private trySleep(): void {
    if (this.asleepAt !== null || this.dialog.open) return;
    if (this.o.onSleep()) this.asleepAt = performance.now();
  }

  private wake(): void {
    // The rest screen has its own way back ("Tiếp tục ở lại").
    if (this.asleepAt === null || this.dialog.open) return;
    this.asleepAt = null;
    this.o.onWake();
  }

  private setAway(away: boolean): void {
    if (away === this.away) return;
    this.away = away;
    this.o.onAway?.(away);
  }
}
