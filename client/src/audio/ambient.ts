// Synthesised mountain ambience (docs/stack.md §4): no audio file to license or download.

export interface Ambient {
  dispose(): void;
}

const NOISE_SECONDS = 4;
/** Wind: band centre drifts around WIND_HZ by ±WIND_SWING_HZ over ~14 s. */
const WIND_HZ = 420;
const WIND_SWING_HZ = 260;
const WIND_LFO_HZ = 0.07;
/** Gusts: loudness swells more slowly than the colour shifts. */
const GUST_LFO_HZ = 0.045;
const WIND_LEVEL = 0.55;
const GUST_DEPTH = 0.3;
/** Birds are sparse: one short call every BIRD_MIN_S..BIRD_MAX_S. */
const BIRD_MIN_S = 4;
const BIRD_MAX_S = 14;
const BIRD_LEVEL = 0.07;

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SECONDS), ctx.sampleRate);
  const data = buf.getChannelData(0);
  // Brown-ish noise: softer than white, closer to wind.
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last * 3.5;
  }
  return buf;
}

function lfo(ctx: AudioContext, hz: number, depth: number, target: AudioParam): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.frequency.value = hz;
  const amount = ctx.createGain();
  amount.gain.value = depth;
  osc.connect(amount).connect(target);
  osc.start();
  return osc;
}

/** One bird call: 2–4 quick upward chirps. */
function chirp(ctx: AudioContext, out: AudioNode): void {
  const t0 = ctx.currentTime + 0.02;
  const base = 2600 + Math.random() * 1400;
  const notes = 2 + Math.floor(Math.random() * 3);
  const pan = ctx.createStereoPanner();
  pan.pan.value = Math.random() * 1.6 - 0.8;
  pan.connect(out);
  for (let i = 0; i < notes; i++) {
    const t = t0 + i * (0.11 + Math.random() * 0.05);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(base, t);
    osc.frequency.exponentialRampToValueAtTime(base * 1.45, t + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(BIRD_LEVEL, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(g).connect(pan);
    osc.start(t);
    osc.stop(t + 0.1);
    osc.onended = () => g.disconnect();
  }
  setTimeout(() => pan.disconnect(), 1000);
}

/** Wind (looped noise → wandering bandpass) + sparse random bird chirps into `out`. */
export function createAmbient(ctx: AudioContext, out: AudioNode): Ambient {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = WIND_HZ;
  band.Q.value = 0.8;
  const level = ctx.createGain();
  level.gain.value = WIND_LEVEL;
  src.connect(band).connect(level).connect(out);
  src.start();
  const oscs = [lfo(ctx, WIND_LFO_HZ, WIND_SWING_HZ, band.frequency), lfo(ctx, GUST_LFO_HZ, GUST_DEPTH, level.gain)];

  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = (): void => {
    timer = setTimeout(
      () => {
        // A suspended context (exit / rest) would pile the calls up for later.
        if (ctx.state === "running") chirp(ctx, out);
        schedule();
      },
      (BIRD_MIN_S + Math.random() * (BIRD_MAX_S - BIRD_MIN_S)) * 1000,
    );
  };
  schedule();

  return {
    dispose(): void {
      if (timer !== null) clearTimeout(timer);
      for (const o of [src, ...oscs]) o.stop();
      level.disconnect();
    },
  };
}
