import { Color, type Camera, type Scene } from "three";
import type { SpaceId } from "@santinh/shared";
import type { Assets } from "./assets.ts";
import { createGarden } from "./garden.ts";
import { createGrass } from "./grass.ts";
import { createGround } from "./ground.ts";
import { HALL_CAMERA_SOLIDS } from "./hall-camera.ts";
import { createHallExterior } from "./hall-exterior.ts";
import { createHallInterior } from "./hall-interior.ts";
import { createLanternGlow } from "./lantern-glow.ts";
import { createMaterials } from "./materials.ts";
import { createNature } from "./nature.ts";
import { createPond } from "./pond.ts";
import { Regions } from "./regions.ts";
import { createWishingTree } from "./wishing-tree.ts";

/** 3D solids the walkers' 2D collision map does not cover (walls up to the roof, the roof itself). */
export interface CameraSolids {
  /** Camera must stay `pad` metres clear of this point's solids. */
  blocksView(x: number, y: number, z: number, pad: number): boolean;
  /** A floor-pick ray stops here (walls, roof, columns). */
  blocksPick(x: number, y: number, z: number): boolean;
}

export interface SceneContext {
  scene: Scene;
  assets: Assets;
}

export interface BuiltScene {
  lightIncense(): void;
  releaseLantern(): void;
  hangWish(): void;
  update(dt: number, t: number, daylight: number, camera: Camera): void;
}

interface SpaceScene {
  camera: CameraSolids;
  build(ctx: SceneContext): Promise<BuiltScene>;
}

async function buildTichMacDuong({ scene, assets }: SceneContext): Promise<BuiltScene> {
  const groundPromise = createGround(scene, assets);
  const materialsPromise = createMaterials(assets);

  const regions = new Regions(scene);
  const wishingTree = createWishingTree(regions.group("gate"));
  const grass = createGrass(regions);
  const nature = createNature(scene);

  const materials = await materialsPromise;
  const exterior = createHallExterior(scene, materials);
  regions.track("hall", exterior.group);

  const [garden, interior] = await Promise.all([
    createGarden(scene, assets, materials, regions),
    createHallInterior(scene, assets, materials),
    groundPromise,
  ]);
  regions.track("hall", interior.group);

  const pond = createPond(regions.group("garden-east"), materials, scene.fog?.color ?? new Color());
  const glow = createLanternGlow(scene, garden.lanterns);
  regions.finalize();

  return {
    lightIncense() {
      interior.lightIncense();
    },
    releaseLantern() {
      pond.releaseLantern();
    },
    hangWish() {
      wishingTree.hangWish();
    },
    update(dt, t, day, camera) {
      regions.update(camera);
      interior.update(dt, t, day);
      garden.update(day);
      pond.update(t, day);
      wishingTree.update(t, day);
      grass.update(t);
      glow.update(day);
      nature.update(dt, t, day);
    },
  };
}

/** Space id → its 3D scene. Adding a space = one entry here (+ shared/src/spaces/<id>.ts). */
const SCENES: Record<SpaceId, SpaceScene> = {
  "tich-mac-duong": { camera: HALL_CAMERA_SOLIDS, build: buildTichMacDuong },
};

/** Builds the space's scenery; the sky / light (environment) must already be in the scene (fog colour). */
export function buildSpace(id: SpaceId, ctx: SceneContext): Promise<BuiltScene> {
  return SCENES[id].build(ctx);
}

export function cameraSolidsOf(id: SpaceId): CameraSolids {
  return SCENES[id].camera;
}
