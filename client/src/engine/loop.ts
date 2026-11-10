import type { WebGLRenderer } from "three";
import type { FrameStats } from "./frame-stats.ts";

/** dt in seconds (clamped), t = loop clock in seconds. */
export type Updater = (dt: number, t: number) => void;

const MAX_DT = 0.1;

/** setAnimationLoop wrapper: runs updaters then renders; stops while the tab is hidden or paused. */
export class Loop {
  private readonly updaters: Updater[] = [];
  private readonly firstFrame: (() => void)[] = [];
  private last = 0;
  private running = false;
  private paused = false;
  private rendered = false;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly renderFrame: () => void,
    private readonly stats: FrameStats,
  ) {
    document.addEventListener("visibilitychange", this.sync);
  }

  add(fn: Updater): () => void {
    this.updaters.push(fn);
    return () => {
      const i = this.updaters.indexOf(fn);
      if (i >= 0) this.updaters.splice(i, 1);
    };
  }

  onFirstFrame(fn: () => void): void {
    if (this.rendered) fn();
    else this.firstFrame.push(fn);
  }

  start(): void {
    this.running = true;
    this.sync();
  }

  /** Used by the rest screen: pausing stops rendering entirely, not just updates. */
  setPaused(paused: boolean): void {
    this.paused = paused;
    this.sync();
  }

  dispose(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    document.removeEventListener("visibilitychange", this.sync);
  }

  private readonly sync = (): void => {
    const active = this.running && !this.paused && !document.hidden;
    this.renderer.setAnimationLoop(active ? this.tick : null);
    // Resuming must not count the hidden time as one giant frame.
    if (!active) this.last = 0;
  };

  private readonly tick = (time: number): void => {
    const frameMs = this.last > 0 ? time - this.last : 0;
    this.last = time;
    if (frameMs > 0) this.stats.push(frameMs);
    const dt = Math.min(frameMs / 1000, MAX_DT);
    const t = time / 1000;
    for (const fn of this.updaters) fn(dt, t);
    this.renderFrame();
    if (!this.rendered) {
      this.rendered = true;
      for (const fn of this.firstFrame.splice(0)) fn();
    }
  };
}
