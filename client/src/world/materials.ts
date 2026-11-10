import { Color, DoubleSide, MeshStandardMaterial, Vector2, type Texture } from "three";
import { maxAnisotropy } from "../engine/renderer.ts";
import type { Assets } from "./assets.ts";

/** Shared, named materials. Geometry is UV'd in metres (see merge.ts), so textures repeat once per metre. */
export interface Materials {
  stone: MeshStandardMaterial;
  wood: MeshStandardMaterial;
  /** Red-lacquered columns: wood relief, painted colour. */
  paintRed: MeshStandardMaterial;
  darkWood: MeshStandardMaterial;
  plaster: MeshStandardMaterial;
  /** Hanji paper behind the window lattice; seen from both sides. */
  paper: MeshStandardMaterial;
  roof: MeshStandardMaterial;
  roofTrim: MeshStandardMaterial;
  cloth: MeshStandardMaterial;
  dispose(): void;
}

type PbrSet = { map: Texture; normalMap: Texture; roughnessMap: Texture };

async function pbr(assets: Assets, folder: string): Promise<PbrSet> {
  const aniso = maxAnisotropy();
  const [map, normalMap, roughnessMap] = await Promise.all([
    assets.texture(`materials/${folder}/color.jpg`, { srgb: true, repeat: 1, anisotropy: aniso }),
    assets.texture(`materials/${folder}/normal.jpg`, { repeat: 1, anisotropy: aniso }),
    assets.texture(`materials/${folder}/roughness.jpg`, { repeat: 1, anisotropy: aniso }),
  ]);
  for (const t of [map, normalMap, roughnessMap]) t.anisotropy = aniso;
  return { map, normalMap, roughnessMap };
}

export async function createMaterials(assets: Assets): Promise<Materials> {
  const [stone, wood, plaster, roof, cloth] = await Promise.all(
    ["stone", "wood", "plaster", "roof", "cloth"].map((f) => pbr(assets, f)),
  ) as [PbrSet, PbrSet, PbrSet, PbrSet, PbrSet];

  const named = (name: string, m: MeshStandardMaterial): MeshStandardMaterial => {
    m.name = name;
    return m;
  };

  const all = {
    stone: named(
      "stone",
      new MeshStandardMaterial({
        ...stone,
        normalScale: new Vector2(1.3, 1.3),
        color: new Color(0xc9c4b8),
        metalness: 0,
      }),
    ),
    wood: named(
      "wood",
      new MeshStandardMaterial({
        ...wood,
        normalScale: new Vector2(1.2, 1.2),
        color: new Color(0xb08a66),
        metalness: 0,
      }),
    ),
    paintRed: named(
      "paintRed",
      new MeshStandardMaterial({
        normalMap: wood.normalMap,
        roughnessMap: wood.roughnessMap,
        normalScale: new Vector2(1.15, 1.15),
        color: new Color(0x6e2318),
        roughness: 0.72,
        metalness: 0,
      }),
    ),
    darkWood: named(
      "darkWood",
      new MeshStandardMaterial({
        ...wood,
        normalScale: new Vector2(1.2, 1.2),
        color: new Color(0x4a3426),
        metalness: 0,
      }),
    ),
    plaster: named(
      "plaster",
      new MeshStandardMaterial({
        normalMap: plaster.normalMap,
        roughnessMap: plaster.roughnessMap,
        normalScale: new Vector2(1.15, 1.15),
        color: new Color(0xd8d0bd),
        metalness: 0,
      }),
    ),
    paper: named(
      "paper",
      new MeshStandardMaterial({
        normalMap: plaster.normalMap,
        color: new Color(0xe8dcc0),
        roughness: 0.95,
        metalness: 0,
        side: DoubleSide,
      }),
    ),
    roof: named(
      "roof",
      new MeshStandardMaterial({
        ...roof,
        normalScale: new Vector2(1.35, 1.35),
        color: new Color(0x6d6f70),
        metalness: 0,
      }),
    ),
    roofTrim: named(
      "roofTrim",
      new MeshStandardMaterial({ map: wood.map, color: new Color(0x2a2522), roughness: 0.9, metalness: 0 }),
    ),
    cloth: named("cloth", new MeshStandardMaterial({ ...cloth, metalness: 0 })),
  };

  return {
    ...all,
    dispose() {
      for (const m of Object.values(all)) m.dispose();
    },
  };
}

export type MaterialKey = Exclude<keyof Materials, "dispose">;
