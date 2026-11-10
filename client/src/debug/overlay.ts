import { vi } from "../i18n/vi.ts";
import type { PerfInfo } from "./e2e-hooks.ts";

const REFRESH_S = 0.5;

/** `?debug=1` corner readout. Returns an updater for the loop and a disposer. */
export function createDebugOverlay(perf: () => PerfInfo): { update: (dt: number) => void; dispose: () => void } {
  const el = document.createElement("pre");
  el.className = "debug-overlay";
  el.setAttribute("aria-hidden", "true");
  document.body.append(el);
  let since = REFRESH_S;
  const l = vi.debug;

  return {
    update(dt) {
      since += dt;
      if (since < REFRESH_S) return;
      since = 0;
      const p = perf();
      el.textContent =
        `${l.fps} ${p.fps.toFixed(0)}  ${l.p95} ${p.p95.toFixed(1)} ms\n` +
        `${l.calls} ${p.calls}  ${l.triangles} ${(p.triangles / 1000).toFixed(1)}k`;
    },
    dispose() {
      el.remove();
    },
  };
}
