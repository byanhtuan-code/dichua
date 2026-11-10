import { ACESFilmicToneMapping, PCFSoftShadowMap, SRGBColorSpace, WebGLRenderer } from "three";

export type QualityTier = "low" | "medium" | "high" | "ultra";

function detectMobile(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  const smallScreen = Math.min(window.screen.width, window.screen.height) < 768;
  const coarsePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  return smallScreen || coarsePointer || uaMobile;
}

export const IS_MOBILE: boolean = detectMobile();

function detectTier(): QualityTier {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "high";
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;

  if (IS_MOBILE) {
    if (cores <= 4 || mem <= 3) return "low";
    if (cores >= 8 && mem >= 6) return "high";
    return "medium";
  }
  if (cores <= 4 && mem <= 4) return "medium";
  if (cores >= 12 && mem >= 8) return "ultra";
  return "high";
}

export const QUALITY_TIER: QualityTier = detectTier();

export const SHADOW_MAP_SIZE = QUALITY_TIER === "ultra" || QUALITY_TIER === "high" ? 2048 : 1024;

let hwMaxAnisotropy = 8;

/** High anisotropic filtering so ground, stone flagstones, wood columns, and roof tiles stay razor-sharp at oblique angles. */
export function maxAnisotropy(): number {
  const tierCap = IS_MOBILE
    ? QUALITY_TIER === "low"
      ? 4
      : 8
    : QUALITY_TIER === "low"
      ? 4
      : 16;
  return Math.min(hwMaxAnisotropy, tierCap);
}

export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    // Release the probe context right away: browsers cap live WebGL contexts per page.
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return gl !== null;
  } catch {
    return false;
  }
}

/**
 * Crisp native High-DPI pixel ratio (up to 2.0x on Retina/OLED phones & HiDPI monitors).
 * Now that scene triangle count is under ~300k, GPUs can render crisp edges without blurring.
 */
export function basePixelRatio(): number {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  if (IS_MOBILE) {
    return Math.min(dpr, QUALITY_TIER === "low" ? 1.65 : 2.0);
  }
  return Math.min(dpr, 2.0);
}

export interface RendererOptions {
  shadows: boolean;
  onContextLost: () => void;
}

export function createRenderer(opts: RendererOptions): WebGLRenderer {
  const renderer = new WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  hwMaxAnisotropy = Math.max(1, renderer.capabilities.getMaxAnisotropy());
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = opts.shadows;
  renderer.shadowMap.type = PCFSoftShadowMap;
  renderer.setPixelRatio(basePixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.className = "scene-canvas";
  renderer.domElement.addEventListener("webglcontextlost", opts.onContextLost, { once: true });
  return renderer;
}
