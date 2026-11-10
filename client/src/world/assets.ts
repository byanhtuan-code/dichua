import { ImageLoader, LoadingManager, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { maxAnisotropy } from "../engine/renderer.ts";
import { showBootError } from "../ui/boot.ts";

export const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;

/** Google's official static CDN for the Three.js Draco WASM/JS decoder. */
const DRACO_DECODER_URL = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";

/** HTTP/2 multiplexes 6 concurrent image streams cleanly without starving a 0.1 vCPU instance. */
const MAX_CONCURRENT_TEXTURES = 6;

/**
 * Maximum time (ms) `texture()` waits for high-priority colour (albedo) maps before opening the gate.
 * Fast/cached visits get 100% sharp textures before frame 1; slow connections open at 1.2s with
 * colour-matched stone/wood/grass placeholders (never white) and sharpen seamlessly in place.
 */
const COLOR_WAIT_BUDGET_MS = 1200;

export class AssetLoadError extends Error {
  constructor(readonly url: string, cause?: unknown) {
    super(`asset failed to load: ${url}`, { cause });
    this.name = "AssetLoadError";
  }
}

export interface TextureOptions {
  /** Colour textures are sRGB; data maps (normal, roughness) stay linear. */
  srgb?: boolean;
  repeat?: number;
  anisotropy?: number;
}

/**
 * Picks a natural temple surface colour matching the texture's role so meshes never flash white (#ffffff)
 * while waiting for high-resolution JPEGs to stream in.
 */
function pickPlaceholderColor(cleanPath: string, opts: TextureOptions): string {
  const p = cleanPath.toLowerCase();
  if (!opts.srgb) {
    if (p.includes("normal") || p.includes("nor") || p.includes("nrm")) return "#8080ff";
    return "#b8b8b8"; // Neutral mid-high roughness so surfaces never look glossy or chalk-white
  }
  if (p.includes("woodland") || p.includes("sky") || p.includes("env")) return "#d6e6e0";
  if (p.includes("grass") || p.includes("moss") || p.includes("leaf") || p.includes("foliage")) return "#556b47";
  if (p.includes("gravel") || p.includes("sand") || p.includes("dirt") || p.includes("soil")) return "#9c9282";
  if (p.includes("roof") || p.includes("slate")) return "#45484d";
  if (p.includes("wood") || p.includes("bark") || p.includes("timber") || p.includes("plank")) return "#785133";
  if (p.includes("plaster") || p.includes("wall") || p.includes("stucco")) return "#ddd0b8";
  if (p.includes("cloth") || p.includes("fabric")) return "#8c2e24";
  if (p.includes("stone") || p.includes("paving") || p.includes("tile") || p.includes("brick") || p.includes("rock")) {
    return "#848078";
  }
  return "#8c857b";
}

function makePlaceholderCanvas(hex: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 2;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, 2, 2);
  }
  return canvas;
}

function isEagerTestMode(): boolean {
  return typeof document === "undefined" || (typeof location !== "undefined" && /[?&](e2e|cam)=/.test(location.search));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Loads models/textures under /assets with a shared cache, Draco + Meshopt decoders, and a 2-tier priority queue:
 * - Tier 1 (High priority): Colour/albedo textures (`srgb: true`) start downloading immediately at t=0 and wait up to 1.2s.
 * - Tier 2 (Low priority): Normal & roughness data maps resolve in 0ms with neutral values and stream in after Tier 1 finishes.
 */
export class Assets {
  private readonly manager: LoadingManager;
  private readonly draco: DRACOLoader;
  private readonly gltf: GLTFLoader;
  private readonly textures: TextureLoader;
  private readonly images: ImageLoader;
  private readonly modelCache = new Map<string, Promise<GLTF>>();
  private readonly textureCache = new Map<string, Promise<Texture>>();
  private readonly owned = new Set<Texture>();
  private readonly highQueue: Array<() => void> = [];
  private readonly lowQueue: Array<() => void> = [];
  private activeDownloads = 0;
  private dracoPreloaded = false;
  private disposed = false;

  constructor(onProgress?: (loaded: number, total: number) => void) {
    this.manager = new LoadingManager();
    if (onProgress) this.manager.onProgress = (_url, loaded, total) => onProgress(loaded, total);
    this.draco = new DRACOLoader(this.manager);
    this.draco.setDecoderPath(DRACO_DECODER_URL);
    this.draco.setCrossOrigin("anonymous");
    this.gltf = new GLTFLoader(this.manager)
      .setMeshoptDecoder(MeshoptDecoder)
      .setDRACOLoader(this.draco);
    this.textures = new TextureLoader(this.manager);
    this.images = new ImageLoader(this.manager);
  }

  async model(path: string): Promise<GLTF> {
    const clean = path.replace(/^\/+/, "");
    const url = ASSET_BASE + clean;
    let pending = this.modelCache.get(url);
    if (!pending) {
      if (!this.dracoPreloaded) {
        this.dracoPreloaded = true;
        this.draco.preload();
      }
      pending = this.gltf.loadAsync(url).catch((err: unknown) => {
        this.modelCache.delete(url);
        throw new AssetLoadError(url, err);
      });
      this.modelCache.set(url, pending);
    }
    return pending;
  }

  /** Same path + options → same Texture instance. */
  texture(path: string, opts: TextureOptions = {}): Promise<Texture> {
    const clean = path.replace(/^\/+/, "");
    const url = ASSET_BASE + clean;
    const key = `${url}|${opts.srgb ? 1 : 0}|${opts.repeat ?? 1}`;
    let pending = this.textureCache.get(key);
    if (pending) return pending;

    if (isEagerTestMode()) {
      pending = this.textures.loadAsync(url).then(
        (tex) => {
          this.applyTextureOptions(tex, opts);
          this.owned.add(tex);
          return tex;
        },
        (err: unknown) => {
          this.textureCache.delete(key);
          throw new AssetLoadError(url, err);
        },
      );
      this.textureCache.set(key, pending);
      return pending;
    }

    const placeholderHex = pickPlaceholderColor(clean, opts);
    const tex = new Texture(makePlaceholderCanvas(placeholderHex));
    this.applyTextureOptions(tex, opts);
    tex.needsUpdate = true;
    this.owned.add(tex);

    const highPriority = Boolean(opts.srgb);
    const downloadDone = this.enqueueTextureDownload(url, key, tex, highPriority);

    if (highPriority) {
      // Wait up to COLOR_WAIT_BUDGET_MS for visible colour textures so fast/cached loads have zero pop-in.
      pending = Promise.race([downloadDone, sleep(COLOR_WAIT_BUDGET_MS)]).then(() => tex);
    } else {
      // Normal and roughness maps resolve immediately with neutral values and stream in after colour maps.
      pending = Promise.resolve(tex);
    }

    this.textureCache.set(key, pending);
    return pending;
  }

  private applyTextureOptions(tex: Texture, opts: TextureOptions): void {
    if (opts.srgb) tex.colorSpace = SRGBColorSpace;
    if (opts.repeat !== undefined) {
      tex.wrapS = tex.wrapT = RepeatWrapping;
      tex.repeat.set(opts.repeat, opts.repeat);
    }
    tex.anisotropy = opts.anisotropy ?? maxAnisotropy();
  }

  private enqueueTextureDownload(url: string, key: string, tex: Texture, highPriority: boolean): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const task = (): void => {
        if (this.disposed) {
          resolve();
          return;
        }
        this.activeDownloads++;
        this.images.load(
          url,
          (img) => {
            this.activeDownloads--;
            this.pumpQueue();
            if (!this.disposed) {
              tex.dispose();
              tex.image = img;
              tex.needsUpdate = true;
            }
            resolve();
          },
          undefined,
          (err) => {
            this.activeDownloads--;
            this.pumpQueue();
            if (this.disposed) {
              resolve();
              return;
            }
            this.textureCache.delete(key);
            const loadErr = new AssetLoadError(url, err);
            console.error(loadErr);
            showBootError("load");
            reject(loadErr);
          },
        );
      };

      if (highPriority) {
        this.highQueue.push(task);
        this.pumpQueue();
      } else {
        this.lowQueue.push(task);
        setTimeout(() => this.pumpQueue(), 16);
      }
    });
  }

  private pumpQueue(): void {
    while (!this.disposed && this.activeDownloads < MAX_CONCURRENT_TEXTURES) {
      const next = this.highQueue.shift() ?? this.lowQueue.shift();
      if (!next) break;
      next();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.highQueue.length = 0;
    this.lowQueue.length = 0;
    for (const tex of this.owned) tex.dispose();
    this.owned.clear();
    this.textureCache.clear();
    this.modelCache.clear();
    this.draco.dispose();
  }
}
