import {
  AdditiveBlending,
  BufferGeometry,
  CircleGeometry,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  type Scene,
  type Vector3,
} from "three";
import { SLAB_TOP, type LanternSpots } from "./garden.ts";
import { radialTexture } from "../engine/radial-texture.ts";

const WARM = new Color(0xffb866);
/** Halo sprite size in world metres (sizeAttenuation on). */
const HALO_SIZE = 1.9;
/** Light pool radius on the ground under each lantern. */
const POOL_STONE = 2.6;
const POOL_LOTUS = 1.9;
/** Above the path slabs, or they would hide the pools that spill onto the path. */
const POOL_Y = SLAB_TOP + 0.01;
const POOL_STRENGTH = 0.55;
/** Below this night level the glow is skipped entirely (no draw calls by day). */
const MIN_NIGHT = 0.02;

export interface LanternGlow {
  update(daylight: number): void;
  dispose(): void;
}

/**
 * Night-only glow for the garden lanterns (stack §2: no real lights outside — emissive lamps + sprite halos):
 * one Points cloud of halos and one instanced set of light pools on the grass.
 */
export function createLanternGlow(scene: Scene, spots: LanternSpots): LanternGlow {
  const tex = radialTexture();
  const all: readonly Vector3[] = [...spots.stone, ...spots.lotus];

  const haloGeo = new BufferGeometry();
  haloGeo.setAttribute("position", new Float32BufferAttribute(all.flatMap((v) => [v.x, v.y, v.z]), 3));
  haloGeo.computeBoundingSphere();
  const haloMat = new PointsMaterial({
    map: tex,
    color: WARM,
    size: HALO_SIZE,
    sizeAttenuation: true,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
  });
  const halos = new Points(haloGeo, haloMat);
  halos.name = "lantern-halos";

  const poolGeo = new CircleGeometry(1, 24);
  poolGeo.rotateX(-Math.PI / 2);
  const poolMat = new MeshBasicMaterial({
    map: tex,
    color: WARM,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  const pools = new InstancedMesh(poolGeo, poolMat, all.length);
  const m = new Matrix4();
  all.forEach((v, i) => {
    const r = i < spots.stone.length ? POOL_STONE : POOL_LOTUS;
    pools.setMatrixAt(i, m.makeScale(r, 1, r).setPosition(v.x, POOL_Y, v.z));
  });
  pools.computeBoundingSphere();
  pools.name = "lantern-pools";

  for (const o of [halos, pools]) {
    o.matrixAutoUpdate = false;
    o.renderOrder = 2;
    scene.add(o);
  }

  return {
    update(daylight) {
      const night = 1 - daylight;
      const on = night > MIN_NIGHT;
      halos.visible = on;
      pools.visible = on;
      haloMat.opacity = night;
      poolMat.opacity = night * POOL_STRENGTH;
    },
    dispose() {
      scene.remove(halos, pools);
      pools.dispose();
      haloGeo.dispose();
      poolGeo.dispose();
      haloMat.dispose();
      poolMat.dispose();
      tex.dispose();
    },
  };
}
