import {
  AmbientLight,
  BackSide,
  Color,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  type Camera,
  type Scene,
} from "three";
import { dayPhase } from "@santinh/shared";
import { SHADOW_MAP_SIZE } from "../engine/renderer.ts";
import type { Assets } from "./assets.ts";

interface Palette {
  /** Multiplies the panorama: white = as photographed, soft blue = night. */
  skyTint: Color;
  fog: Color;
  fogNear: number;
  fogFar: number;
  hemiSky: Color;
  hemiGround: Color;
  hemiIntensity: number;
  ambient: Color;
  ambientIntensity: number;
  sun: Color;
  sunIntensity: number;
  /** Direction towards the light (sun by day, moon by night). */
  sunDir: Vector3;
}

/**
 * `fogNear = 110` sits past the farthest Tier 4 forest ring (~106m max view distance),
 * keeping all trees crisp and fog-free, while `fogFar = 210` fades the outer edge of the
 * 420x420 ground plane (`ground.ts`) seamlessly into the horizon.
 */
const DAY: Palette = {
  skyTint: new Color(0xffffff),
  fog: new Color(0xd6e6e0),
  fogNear: 110,
  fogFar: 210,
  hemiSky: new Color(0xebf5fa),
  hemiGround: new Color(0x827864),
  hemiIntensity: 1.58,
  ambient: new Color(0xfffcf5),
  ambientIntensity: 0.44,
  sun: new Color(0xfff5e0),
  sunIntensity: 2.88,
  sunDir: new Vector3(0.45, 0.82, 0.35).normalize(),
};

const NIGHT: Palette = {
  skyTint: new Color(0x6882ad),
  fog: new Color(0x3b4f6b),
  fogNear: 85,
  fogFar: 195,
  hemiSky: new Color(0x88a4d4),
  hemiGround: new Color(0x4c463c),
  hemiIntensity: 1.38,
  ambient: new Color(0xa8bee0),
  ambientIntensity: 0.45,
  sun: new Color(0xd6e4ff),
  sunIntensity: 1.45,
  sunDir: new Vector3(-0.35, 0.78, 0.52).normalize(),
};

const SKY_RADIUS = 400;
/**
 * Low horizon blend (-0.01 to 0.055 instead of 0.22):
 * Matches the ground fog at y <= 0 so the ground edge never shows a seam,
 * while keeping the sky behind the tree canopies clear and realistic.
 */
const HAZE_FROM = -0.01;
const HAZE_TO = 0.055;
const SUN_DISTANCE = 60;
/** Half-size of the shadow camera box around the focus point (metres). */
const SHADOW_EXTENT = 16;
/** World-space size of one shadow-map texel; snapping focus to this grid prevents shadow edge swimming when walking. */
const SHADOW_TEXEL_SIZE = (SHADOW_EXTENT * 2) / SHADOW_MAP_SIZE;
/** Light colours change slowly; no need to recompute every frame. */
const REFRESH_S = 0.5;

export interface Environment {
  readonly sun: DirectionalLight;
  /** Shadows and the sun follow this point (the player once T8 exists). */
  setFocus(x: number, y: number, z: number): void;
  update(dt: number, camera: Camera): void;
  /** Current daylight 0 (night) … 1 (day) — lanterns etc. read this. */
  readonly daylight: number;
  dispose(): void;
}

export async function createEnvironment(
  scene: Scene,
  assets: Assets,
  opts: { shadows: boolean; now: () => number },
): Promise<Environment> {
  // Set fog and lights synchronously first so `buildSpace` can run in parallel and read `scene.fog.color` immediately.
  const fog = new Fog(DAY.fog.clone(), DAY.fogNear, DAY.fogFar);
  scene.fog = fog;
  scene.background = fog.color;

  const panorama = await assets.texture("env/woodland.jpg", { srgb: true });
  panorama.mapping = EquirectangularReflectionMapping;

  // A textured inner sphere instead of scene.background so the panorama can be tinted for night.
  const skyGeo = new SphereGeometry(SKY_RADIUS, 48, 24);
  const skyMat = new MeshBasicMaterial({ map: panorama, side: BackSide, fog: false, depthWrite: false });
  skyMat.onBeforeCompile = (shader) => {
    shader.uniforms["uHaze"] = { value: fog.color };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vSkyY;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSkyY = normalize(position).y;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uHaze;\nvarying float vSkyY;")
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>\ndiffuseColor.rgb = mix(uHaze, diffuseColor.rgb, smoothstep(${HAZE_FROM.toFixed(3)}, ${HAZE_TO.toFixed(3)}, vSkyY));`,
      );
  };
  const sky = new Mesh(skyGeo, skyMat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  sky.name = "sky";
  scene.add(sky);

  const hemi = new HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemiIntensity);
  const ambient = new AmbientLight(DAY.ambient, DAY.ambientIntensity);
  const sun = new DirectionalLight(DAY.sun, DAY.sunIntensity);
  sun.castShadow = opts.shadows;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.camera.left = -SHADOW_EXTENT;
  sun.shadow.camera.right = SHADOW_EXTENT;
  sun.shadow.camera.top = SHADOW_EXTENT;
  sun.shadow.camera.bottom = -SHADOW_EXTENT;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = SUN_DISTANCE * 2;
  // three does not refresh the shadow camera's projection itself; without this the box stays at the default ±5 m.
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.00035;
  sun.shadow.normalBias = 0.024;
  scene.add(hemi, ambient, sun, sun.target);

  const focus = new Vector3();
  const snappedFocus = new Vector3();
  const dir = new Vector3();
  let daylight = 1;
  let sinceRefresh = REFRESH_S;

  const placeSun = (): void => {
    const step = SHADOW_TEXEL_SIZE;
    snappedFocus.set(
      Math.round(focus.x / step) * step,
      Math.round(focus.y / step) * step,
      Math.round(focus.z / step) * step,
    );
    sun.position.copy(snappedFocus).addScaledVector(dir, SUN_DISTANCE);
    sun.target.position.copy(snappedFocus);
    sun.target.updateMatrixWorld();
  };

  const refresh = (): void => {
    const t = dayPhase(opts.now()).t;
    daylight = t;
    skyMat.color.lerpColors(NIGHT.skyTint, DAY.skyTint, t);
    fog.color.lerpColors(NIGHT.fog, DAY.fog, t);
    fog.near = NIGHT.fogNear + (DAY.fogNear - NIGHT.fogNear) * t;
    fog.far = NIGHT.fogFar + (DAY.fogFar - NIGHT.fogFar) * t;
    hemi.color.lerpColors(NIGHT.hemiSky, DAY.hemiSky, t);
    hemi.groundColor.lerpColors(NIGHT.hemiGround, DAY.hemiGround, t);
    hemi.intensity = NIGHT.hemiIntensity + (DAY.hemiIntensity - NIGHT.hemiIntensity) * t;
    ambient.color.lerpColors(NIGHT.ambient, DAY.ambient, t);
    ambient.intensity = NIGHT.ambientIntensity + (DAY.ambientIntensity - NIGHT.ambientIntensity) * t;
    sun.color.lerpColors(NIGHT.sun, DAY.sun, t);
    sun.intensity = NIGHT.sunIntensity + (DAY.sunIntensity - NIGHT.sunIntensity) * t;
    dir.lerpVectors(NIGHT.sunDir, DAY.sunDir, t).normalize();
    placeSun();
  };

  refresh();

  return {
    sun,
    get daylight() {
      return daylight;
    },
    setFocus(x, y, z) {
      focus.set(x, y, z);
      placeSun();
    },
    update(dt, camera) {
      sky.position.copy(camera.position);
      sinceRefresh += dt;
      if (sinceRefresh >= REFRESH_S) {
        sinceRefresh = 0;
        refresh();
      }
    },
    dispose() {
      scene.remove(sky, hemi, ambient, sun, sun.target);
      skyGeo.dispose();
      skyMat.dispose();
      sun.shadow.dispose();
      scene.fog = null;
      scene.background = null;
    },
  };
}
