import { Color, Mesh, MeshStandardMaterial, PlaneGeometry, Vector2, type Scene } from "three";
import { BOUNDARY } from "@santinh/shared";
import { maxAnisotropy } from "../engine/renderer.ts";
import type { Assets } from "./assets.ts";

/** Edges sit past the day fog's far distance, so the ground melts into haze instead of ending in a line. */
const SIZE = 420;
/** Tight 2.1 m texture tiling so soil, moss, and pebbles under the player's feet look crisp and high-resolution. */
const REPEAT = Math.round(SIZE / 2.1);
/** Subtle macro variation to break up tiling without smudging fine ground detail. */
const MACRO_SCALE = 0.14;
const MACRO_AMOUNT = 0.14;

export interface Ground {
  readonly mesh: Mesh;
  dispose(): void;
}

export async function createGround(scene: Scene, assets: Assets): Promise<Ground> {
  const aniso = maxAnisotropy();
  const [map, normalMap, roughnessMap] = await Promise.all([
    assets.texture("materials/ground/color.jpg", { srgb: true, repeat: REPEAT, anisotropy: aniso }),
    assets.texture("materials/ground/normal.jpg", { repeat: REPEAT, anisotropy: aniso }),
    assets.texture("materials/ground/roughness.jpg", { repeat: REPEAT, anisotropy: aniso }),
  ]);
  for (const tex of [map, normalMap, roughnessMap]) tex.anisotropy = aniso;

  const geometry = new PlaneGeometry(SIZE, SIZE);
  geometry.rotateX(-Math.PI / 2);
  const material = new MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new Vector2(1.25, 1.25),
    roughnessMap,
    color: new Color(0xd6e8ce),
    emissive: new Color(0x142612),
    emissiveIntensity: 0.18,
    roughness: 0.9,
    metalness: 0,
  });
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `#include <map_fragment>
      vec3 macroTint = texture2D(map, vMapUv * ${MACRO_SCALE}).rgb;
      diffuseColor.rgb *= mix(vec3(1.02, 1.06, 1.0), macroTint * vec3(1.85, 2.05, 1.75), ${MACRO_AMOUNT});`,
    );
  };
  const mesh = new Mesh(geometry, material);
  mesh.position.set(BOUNDARY.x, 0, BOUNDARY.z);
  mesh.receiveShadow = true;
  mesh.name = "ground";
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();
  scene.add(mesh);

  return {
    mesh,
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
