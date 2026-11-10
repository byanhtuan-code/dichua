import type { WebGLRenderer } from "three";
import { basePixelRatio } from "./renderer.ts";
import type { FrameStats } from "./frame-stats.ts";

/**
 * Pixel-ratio caps: never drops below 1.5 on High-DPI screens so the 3D scene
 * never becomes blurry even if a background tab or network spike causes a slow frame.
 */
const CAPS = [Number.POSITIVE_INFINITY, 1.75, 1.5] as const;
const WARMUP_S = 6.0;
const WINDOW_S = 4.0;
const SLOW_P95_MS = 35;
const FAST_P95_MS = 18;

function isInteractiveVisualRun(): boolean {
  if (typeof location === "undefined") return false;
  const q = new URLSearchParams(location.search);
  return q.get("debug") === "1" || q.get("shadows") === "1";
}

export class Quality {
  private level = 0;
  private warmup = 0;
  private elapsed = 0;
  private frames = 0;
  private fastStreak = 0;
  private readonly effectiveFixedRatio: number | null;

  constructor(
    private readonly renderer: WebGLRenderer,
    private readonly stats: FrameStats,
    /** e2e runs pin the ratio to 1 for headless screenshot tests, unless `?debug=1` or `?shadows=1` is used interactively. */
    fixedRatio: number | null,
  ) {
    this.effectiveFixedRatio = isInteractiveVisualRun() ? null : fixedRatio;
    this.apply();
  }

  get pixelRatio(): number {
    return this.effectiveFixedRatio ?? Math.min(basePixelRatio(), CAPS[this.level] ?? 1.5);
  }

  /** Re-apply size + ratio (window resize, quality change). */
  apply(): void {
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  readonly update = (dt: number): void => {
    if (this.effectiveFixedRatio !== null) return;
    if (this.warmup < WARMUP_S) {
      this.warmup += dt;
      return;
    }
    this.elapsed += dt;
    this.frames++;
    if (this.elapsed < WINDOW_S) return;

    const p95 = this.stats.summary(this.frames).p95;
    this.elapsed = 0;
    this.frames = 0;

    if (p95 > SLOW_P95_MS) {
      this.fastStreak = 0;
      if (this.level < CAPS.length - 1) {
        this.level++;
        this.apply();
      }
      return;
    }

    if (p95 > 0 && p95 < FAST_P95_MS && this.level > 0) {
      this.fastStreak++;
      if (this.fastStreak >= 2) {
        this.fastStreak = 0;
        this.level--;
        this.apply();
      }
    } else {
      this.fastStreak = 0;
    }
  };
}
