import { ImageLoader, LoadingManager, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { maxAnisotropy } from "../engine/renderer.ts";
import { showBootError } from "../ui/boot.ts";

export const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;

/** Google's official static CDN for the Three.js Draco WASM/JS decoder. */
const DRACO_DECODER_URL = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";

/** Max concurrent background texture downloads so a 0.1 vCPU server is never overwhelmed. */
const MAX_CONCURRENT_TEXTURES = 3;

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

function makePlaceholderCanvas(hex: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = hex;
    ctx.fillRect(0, 0, 1, 1);
  }
  return canvas;
}

function isEagerTestMode(): boolean {
  return typeof document === "undefined" || (typeof location !== "undefined" && /[?&](e2e|cam)=/.test(location.search));
}

/**
 * Loads models/textures under /assets with a shared cache, Draco + Meshopt decoders, and progress callback.
 * In normal browser play, textures resolve immediately with a 1x1 placeholder so the gate opens in <1s,
 * and stream their high-res images in a throttled background queue.
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
  private readonly queue: Array<() => void> = [];
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

    const placeholderHex = clean.includes("normal")
      ? "#8080ff"
      : clean.includes("woodland")
        ? "#d6e6e0"
        : "#ffffff";
    const tex = new Texture(makePlaceholderCanvas(placeholderHex));
    this.applyTextureOptions(tex, opts);
    tex.needsUpdate = true;
    this.owned.add(tex);

    this.enqueueTextureDownload(url, key, tex);
    pending = Promise.resolve(tex);
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

  private enqueueTextureDownload(url: string, key: string, tex: Texture): void {
    this.queue.push(() => {
      if (this.disposed) return;
      this.activeDownloads++;
      this.images.load(
        url,
        (img) => {
          this.activeDownloads--;
          this.pumpQueue();
          if (this.disposed) return;
          tex.dispose();
          tex.image = img;
          tex.needsUpdate = true;
        },
        undefined,
        (err) => {
          this.activeDownloads--;
          this.pumpQueue();
          if (this.disposed) return;
          this.textureCache.delete(key);
          console.error(new AssetLoadError(url, err));
          showBootError("load");
        },
      );
    });
    setTimeout(() => this.pumpQueue(), 60);
  }

  private pumpQueue(): void {
    while (!this.disposed && this.activeDownloads < MAX_CONCURRENT_TEXTURES && this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    for (const tex of this.owned) tex.dispose();
    this.owned.clear();
    this.textureCache.clear();
    this.modelCache.clear();
    this.draco.dispose();
  }
}
