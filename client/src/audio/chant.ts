import { CEREMONY_DURATION_S, ceremonyAt } from "@santinh/shared";
import type { AudioEngine } from "./engine.ts";

export const CHANT_URL = `${import.meta.env.BASE_URL}audio/chant.mp3`;
/** Schedule check; sessions start on the hour so a few seconds late is fine. */
const CHECK_MS = 5_000;
/** Shared listening re-seeks only past this drift (seeking glitches the sound). */
const MAX_DRIFT_S = 2;
const RETRY_EVENTS = ["pointerdown", "keydown", "touchend"] as const;

/** Where in a looping chant of `durationS` everyone should be, `offsetSeconds` into a session. */
export function chantPosition(offsetSeconds: number, durationS: number): number {
  if (!(durationS > 0) || !Number.isFinite(offsetSeconds)) return 0;
  return ((offsetSeconds % durationS) + durationS) % durationS;
}

export interface ChantState {
  /** "Nghe tụng kinh" is on (own listening, or the shared session we have not opted out of). */
  on: boolean;
  /** A shared session (05:00 / 18:00 VN) is what is playing. */
  ceremony: boolean;
  /** The file failed to load / play; the next press retries. */
  error: boolean;
}

/**
 * Chant mp3 through an HTMLAudioElement → MediaElementSource → the engine's chant bus.
 * Own listening loops from where it stopped; during a ceremony everyone seeks to `now − startsAt`.
 */
export class Chant {
  private el: HTMLAudioElement | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private solo: boolean;
  /** startsAt of the session the user switched off; it stays off until the next one. */
  private dismissed: number | null = null;
  private error = false;
  private waitingGesture = false;
  private last: ChantState = { on: false, ceremony: false, error: false };
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly offEngine: () => void;
  private readonly listeners = new Set<(s: ChantState) => void>();

  /** `now` honours `?time=` so a session can be checked at any hour. */
  constructor(
    private readonly engine: AudioEngine,
    private readonly now: () => number,
    private readonly url = CHANT_URL,
  ) {
    this.solo = engine.settings.chantOn;
    this.timer = setInterval(() => this.sync(), CHECK_MS);
    this.offEngine = engine.on("change", () => this.sync());
    // Chip shows the saved choice before the first gesture.
    this.sync();
  }

  get state(): ChantState {
    return this.last;
  }

  onChange(fn: (s: ChantState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** HUD chip / settings button. Must run in a user gesture (it may unmute). */
  toggle(): void {
    this.disarmGestureRetry();
    // Muted with listening on: the chip reads on, so a press means "let me hear it", not "stop".
    if (this.solo && !this.error && this.engine.muted) {
      this.engine.setMuted(false);
      return;
    }
    const active = this.activeSession();
    if (this.error) {
      this.error = false;
      this.el?.load();
      this.solo = true;
      this.dismissed = null;
    } else if (this.last.on) {
      this.solo = false;
      if (active !== null) this.dismissed = active;
    } else {
      this.solo = true;
      this.dismissed = null;
    }
    // A load error turning solo off is not a choice; only presses are saved.
    if (this.engine.settings.chantOn !== this.solo) this.engine.update({ chantOn: this.solo });
    if (this.solo && this.engine.muted) this.engine.setMuted(false);
    else this.sync();
  }

  dispose(): void {
    clearInterval(this.timer);
    this.disarmGestureRetry();
    this.offEngine();
    this.listeners.clear();
    if (this.el) {
      this.el.pause();
      this.el.removeAttribute("src");
      this.el.load();
    }
    this.source?.disconnect();
  }

  /** Re-evaluates what should play; runs on a timer and on every engine change. */
  sync(): void {
    const session = ceremonyAt(this.now(), CEREMONY_DURATION_S).active;
    const inCeremony = session !== null && this.dismissed !== session.startsAt && !this.error;
    if (session === null) this.dismissed = null;
    const wanted = (this.solo || inCeremony) && !this.error;
    const el = wanted && this.engine.audible ? this.element() : this.el;
    if (wanted && this.engine.audible && el) {
      if (inCeremony && session) this.seek(el, session.offsetSeconds);
      if (el.paused) el.play().catch((err: unknown) => this.onPlayError(err));
    } else {
      this.disarmGestureRetry();
      el?.pause();
    }
    this.report({ on: wanted && (this.solo || this.engine.audible), ceremony: inCeremony && wanted, error: this.error });
  }

  private activeSession(): number | null {
    return ceremonyAt(this.now(), CEREMONY_DURATION_S).active?.startsAt ?? null;
  }

  private element(): HTMLAudioElement | null {
    if (this.el) return this.el;
    const out = this.engine.chantOutput;
    const ctx = this.engine.context;
    if (!ctx || !out) return null;
    const el = new Audio();
    el.loop = true;
    el.preload = "auto";
    el.addEventListener("error", this.onLoadError);
    el.src = this.url;
    this.source = ctx.createMediaElementSource(el);
    this.source.connect(out);
    this.el = el;
    return el;
  }

  private seek(el: HTMLAudioElement, offsetSeconds: number): void {
    const apply = (): void => {
      const target = chantPosition(offsetSeconds, el.duration);
      if (Math.abs(el.currentTime - target) > MAX_DRIFT_S) el.currentTime = target;
    };
    if (el.readyState >= HTMLMediaElement.HAVE_METADATA) apply();
    else el.addEventListener("loadedmetadata", apply, { once: true });
  }

  private readonly onLoadError = (): void => this.fail();

  private readonly onGestureRetry = (): void => {
    this.disarmGestureRetry();
    this.engine.unlock();
    this.sync();
  };

  private armGestureRetry(): void {
    if (this.waitingGesture || typeof window === "undefined") return;
    this.waitingGesture = true;
    for (const type of RETRY_EVENTS) window.addEventListener(type, this.onGestureRetry, { capture: true, passive: true });
  }

  private disarmGestureRetry(): void {
    if (!this.waitingGesture || typeof window === "undefined") return;
    this.waitingGesture = false;
    for (const type of RETRY_EVENTS) window.removeEventListener(type, this.onGestureRetry, { capture: true });
  }

  private onPlayError(err: unknown): void {
    // A pause() racing play() rejects with AbortError: not a failure.
    if (err instanceof DOMException && err.name === "AbortError") return;
    // Autoplay blocked when a scheduled ceremony starts on a timer tick: retry on the next user gesture instead of failing.
    if (err instanceof DOMException && err.name === "NotAllowedError") {
      this.armGestureRetry();
      return;
    }
    this.fail();
  }

  private fail(): void {
    if (this.error) return;
    this.disarmGestureRetry();
    this.error = true;
    this.solo = false;
    this.el?.pause();
    this.sync();
  }

  private report(s: ChantState): void {
    const l = this.last;
    if (l.on === s.on && l.ceremony === s.ceremony && l.error === s.error) return;
    this.last = s;
    for (const fn of this.listeners) fn(s);
  }
}
