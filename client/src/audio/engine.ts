import { createAmbient, type Ambient } from "./ambient.ts";
import { Sfx } from "./sfx.ts";

/** User choices kept across visits. Sound is on by default (D22); it starts at the first gesture (autoplay rules). */
export interface AudioSettings {
  /** HUD speaker (master). */
  soundOn: boolean;
  /** "Nghe tụng kinh" (own listening; ceremonies follow their own schedule). */
  chantOn: boolean;
  ambientOn: boolean;
  /** 0..1 */
  ambientVolume: number;
  chantVolume: number;
  sfxOn: boolean;
  sfxVolume: number;
  /** "Phát khi đổi tab": keep playing (and keep the room) while the tab is hidden. */
  backgroundPlay: boolean;
}

/** design/settings.html defaults. */
export const DEFAULT_SETTINGS: Readonly<AudioSettings> = {
  soundOn: true,
  chantOn: true,
  ambientOn: true,
  ambientVolume: 0.35,
  chantVolume: 0.3,
  sfxOn: true,
  sfxVolume: 0.4,
  backgroundPlay: false,
};

export const SETTINGS_KEY = "santinh.audio.v1";

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

/** `localStorage` itself throws in some sandboxed / private modes. */
export function browserStorage(): KeyValueStore | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const unit = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
const flag = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

/** Saved settings over the defaults; any storage / parse error → defaults. */
export function loadSettings(store: KeyValueStore | null): AudioSettings {
  const d = DEFAULT_SETTINGS;
  let raw: unknown;
  try {
    const text = store?.getItem(SETTINGS_KEY);
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  const r = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    soundOn: flag(r.soundOn, d.soundOn),
    chantOn: flag(r.chantOn, d.chantOn),
    ambientOn: flag(r.ambientOn, d.ambientOn),
    ambientVolume: unit(r.ambientVolume, d.ambientVolume),
    chantVolume: unit(r.chantVolume, d.chantVolume),
    sfxOn: flag(r.sfxOn, d.sfxOn),
    sfxVolume: unit(r.sfxVolume, d.sfxVolume),
    backgroundPlay: flag(r.backgroundPlay, d.backgroundPlay),
  };
}

/** Best effort: a full / blocked storage only loses the setting, never the game. */
export function saveSettings(store: KeyValueStore | null, s: AudioSettings): boolean {
  try {
    store?.setItem(SETTINGS_KEY, JSON.stringify(s));
    return store !== null;
  } catch {
    return false;
  }
}

/** Gain ramps: short enough to feel instant, long enough not to click. */
const RAMP_S = 0.08;
const UNLOCK_EVENTS = ["pointerdown", "keydown", "touchend"] as const;

export interface AudioEngineEvents {
  /** Settings or master mute changed. */
  change: void;
  /** The AudioContext exists (first gesture); the chant hooks its element in here. */
  unlock: AudioContext;
}

type Listener<T> = (value: T) => void;

/**
 * One AudioContext, created on the first user gesture (autoplay rules), with
 * ambient / chant / effect buses into a master gain. Master mute = the HUD speaker.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private ambientBus: GainNode | null = null;
  private chantBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private ambient: Ambient | null = null;
  private sfx: Sfx | null = null;
  private s: AudioSettings;
  private muted_: boolean;
  private suspended = false;
  private readonly listeners: { [K in keyof AudioEngineEvents]: Set<Listener<AudioEngineEvents[K]>> } = {
    change: new Set(),
    unlock: new Set(),
  };

  constructor(private readonly store: KeyValueStore | null = browserStorage()) {
    this.s = loadSettings(store);
    this.muted_ = !this.s.soundOn;
    this.listenUnlock();
  }

  get settings(): Readonly<AudioSettings> {
    return this.s;
  }

  get muted(): boolean {
    return this.muted_;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  /** Bus the chant's MediaElementSource plays into (null before the first gesture). */
  get chantOutput(): GainNode | null {
    return this.chantBus;
  }

  /** True when sound would actually come out (unlocked, unmuted, not paused for exit / rest). */
  get audible(): boolean {
    return this.ctx !== null && !this.muted_ && !this.suspended;
  }

  on<K extends keyof AudioEngineEvents>(type: K, fn: Listener<AudioEngineEvents[K]>): () => void {
    const set = this.listeners[type] as Set<Listener<AudioEngineEvents[K]>>;
    set.add(fn);
    return () => set.delete(fn);
  }

  /** Creates / resumes the context. Must run inside a user gesture; safe to call often. */
  readonly unlock = (): void => {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      try {
        this.build(new Ctor());
      } catch (err) {
        console.warn(err);
        return;
      }
    }
    const state = this.ctx?.state as string | undefined;
    if (!this.suspended && state !== undefined && state !== "running" && state !== "closed") {
      void this.ctx?.resume().catch(() => undefined);
    }
    if (this.ctx?.state === "running") {
      this.unlistenUnlock();
    }
  };

  setMuted(muted: boolean): void {
    if (!muted) this.unlock();
    this.muted_ = muted;
    if (this.s.soundOn === muted) {
      this.s = { ...this.s, soundOn: !muted };
      saveSettings(this.store, this.s);
    }
    this.startAmbient();
    this.applyGains();
    this.emit("change", undefined);
  }

  toggleMuted(): void {
    this.setMuted(!this.muted_);
  }

  update(patch: Partial<AudioSettings>): void {
    this.s = { ...this.s, ...patch };
    saveSettings(this.store, this.s);
    this.applyGains();
    this.emit("change", undefined);
  }

  /** Exit / rest screens: everything stops; resume picks up where it was. */
  setSuspended(suspended: boolean): void {
    this.suspended = suspended;
    if (!this.ctx) return;
    if (suspended) void this.ctx.suspend().catch(() => undefined);
    else void this.ctx.resume().catch(() => undefined);
    this.emit("change", undefined);
  }

  /** Small bell at the bottom of each bow. */
  bell(): void {
    if (this.audible && this.s.sfxOn) this.sfx?.bell();
  }

  /** Deep bronze temple bell ("Đại hồng chung"). */
  templeBell(): void {
    if (this.audible && this.s.sfxOn) this.sfx?.templeBell();
  }

  /** Wooden temple block ("Mõ gỗ"). */
  woodblock(): void {
    if (this.audible && this.s.sfxOn) this.sfx?.woodblock();
  }

  /** Bead "tách" (T13). */
  bead(): void {
    if (this.audible && this.s.sfxOn) this.sfx?.bead();
  }

  /** Soft palms-together for Chắp tay. */
  hello(): void {
    if (this.audible && this.s.sfxOn) this.sfx?.hello();
  }

  dispose(): void {
    this.unlistenUnlock();
    this.ambient?.dispose();
    this.sfx?.dispose();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    for (const set of Object.values(this.listeners)) set.clear();
  }

  private listenUnlock(): void {
    for (const type of UNLOCK_EVENTS) window.addEventListener(type, this.unlock, { capture: true, passive: true });
  }

  private unlistenUnlock(): void {
    for (const type of UNLOCK_EVENTS) window.removeEventListener(type, this.unlock, { capture: true });
  }

  private build(ctx: AudioContext): void {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.ambientBus = ctx.createGain();
    this.chantBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    for (const bus of [this.ambientBus, this.chantBus, this.sfxBus]) {
      bus.gain.value = 0;
      bus.connect(this.master);
    }
    this.sfx = new Sfx(ctx, this.sfxBus);
    // Created during an exit / rest screen: stay silent until it resumes.
    if (this.suspended) void ctx.suspend().catch(() => undefined);
    ctx.addEventListener("statechange", () => {
      if (this.ctx !== ctx) return;
      const st = ctx.state as string;
      if (st === "running") {
        this.unlistenUnlock();
        this.emit("change", undefined);
      } else if (!this.suspended && st !== "closed") {
        this.listenUnlock();
      }
    });
    this.startAmbient();
    this.applyGains(true);
    this.emit("unlock", ctx);
    // Sound on by default: the chant starts inside this same gesture (play() outside one is blocked).
    this.emit("change", undefined);
  }

  /** Ambient starts once sound is on and unlocked: no point synthesising wind nobody hears. */
  private startAmbient(): void {
    if (!this.muted_ && !this.ambient && this.ctx && this.ambientBus) this.ambient = createAmbient(this.ctx, this.ambientBus);
  }

  private applyGains(instant = false): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.ambientBus || !this.chantBus || !this.sfxBus) return;
    const s = this.s;
    const set = (g: GainNode, v: number): void => {
      if (instant) g.gain.value = v;
      else g.gain.setTargetAtTime(v, ctx.currentTime, RAMP_S / 3);
    };
    set(this.master, this.muted_ ? 0 : 1);
    set(this.ambientBus, s.ambientOn ? s.ambientVolume : 0);
    set(this.chantBus, s.chantVolume);
    set(this.sfxBus, s.sfxOn ? s.sfxVolume : 0);
  }

  private emit<K extends keyof AudioEngineEvents>(type: K, value: AudioEngineEvents[K]): void {
    for (const fn of this.listeners[type] as Set<Listener<AudioEngineEvents[K]>>) fn(value);
  }
}
