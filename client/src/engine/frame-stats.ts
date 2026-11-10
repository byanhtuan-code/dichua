const CAPACITY = 600;

export interface FrameSummary {
  fps: number;
  median: number;
  p95: number;
  worst: number;
}

/** Ring buffer of frame times (ms). No allocations per frame. */
export class FrameStats {
  private readonly samples = new Float32Array(CAPACITY);
  private readonly scratch = new Float32Array(CAPACITY);
  private readonly result: FrameSummary = { fps: 0, median: 0, p95: 0, worst: 0 };
  private next = 0;
  private count = 0;

  push(ms: number): void {
    this.samples[this.next] = ms;
    this.next = (this.next + 1) % CAPACITY;
    this.count = Math.min(this.count + 1, CAPACITY);
  }

  get size(): number {
    return this.count;
  }

  clear(): void {
    this.next = 0;
    this.count = 0;
  }

  /** Stats over the newest `lastN` frames (all by default). The returned object is reused. */
  summary(lastN: number = this.count): FrameSummary {
    const n = Math.min(lastN, this.count);
    const r = this.result;
    if (n === 0) {
      r.fps = r.median = r.p95 = r.worst = 0;
      return r;
    }
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const v = this.samples[(this.next - 1 - i + CAPACITY) % CAPACITY] ?? 0;
      this.scratch[i] = v;
      sum += v;
    }
    const sorted = this.scratch.subarray(0, n).sort();
    r.fps = sum > 0 ? (1000 * n) / sum : 0;
    r.median = sorted[Math.floor((n - 1) / 2)] ?? 0;
    r.p95 = sorted[Math.min(n - 1, Math.ceil(n * 0.95) - 1)] ?? 0;
    r.worst = sorted[n - 1] ?? 0;
    return r;
  }
}
