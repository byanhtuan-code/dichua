import { LoadingManager, RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from "three";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { maxAnisotropy } from "../engine/renderer.ts";

export const ASSET_BASE = `${import.meta.env.BASE_URL}assets/`;

/** Google's official static CDN for the Three.js Draco WASM/JS decoder. */
const DRACO_DECODER_URL = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";

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
 * Loads models/textures under /assets with a shared cache, Draco + Meshopt decoders, and progress callback.
 * Any failure rejects with AssetLoadError so the boot screen can show the load error (P-D8, AC2).
 */
export class Assets {
  private readonly manager: LoadingManager;
  private readonly draco: DRACOLoader;
  private readonly gltf: GLTFLoader;
  private readonly textures: TextureLoader;
  private readonly modelCache = new Map<string, Promise<GLTF>>();
  private readonly textureCache = new Map<string, Promise<Texture>>();
  private readonly owned = new Set<Texture>();

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
  }

  async model(path: string): Promise<GLTF> {
    const clean = path.replace(/^\/+/, "");
    const url = ASSET_BASE + clean;
    let pending = this.modelCache.get(url);
    if (!pending) {
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
    if (!pending) {
      pending = this.textures.loadAsync(url).then(
        (tex) => {
          if (opts.srgb) tex.colorSpace = SRGBColorSpace;
          if (opts.repeat !== undefined) {
            tex.wrapS = tex.wrapT = RepeatWrapping;
            tex.repeat.set(opts.repeat, opts.repeat);
          }
          tex.anisotropy = opts.anisotropy ?? maxAnisotropy();
          this.owned.add(tex);
          return tex;
        },
        (err: unknown) => {
          this.textureCache.delete(key);
          throw new AssetLoadError(url, err);
        },
      );
      this.textureCache.set(key, pending);
    }
    return pending;
  }

  dispose(): void {
    for (const tex of this.owned) tex.dispose();
    this.owned.clear();
    this.textureCache.clear();
    this.modelCache.clear();
    this.draco.dispose();
  }
}
