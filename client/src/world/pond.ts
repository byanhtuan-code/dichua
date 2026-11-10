import {
  CircleGeometry,
  Color,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  RingGeometry,
  Sphere,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Group,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { LOTUS_FLOWERS, POND } from "@santinh/shared";
import { registerCameraPreset } from "../debug/params.ts";
import type { Materials } from "./materials.ts";
import { seeded } from "./random.ts";

/** Water sits just above the ground plane (which runs under the pond). */
const WATER_Y = 0.04;
/** Stone bank: ring from the water edge outwards, as a fraction of the pond radii. */
const BANK_OUTER = 1.12;
const LEAF_COUNT = 16;
const FLOWER_SCALE = 1.8;
const MAX_LANTERNS = 12;
const INITIAL_LANTERNS = 4;
const LANTERN_SCALE = 1.45;
const KOI_COUNT = 18;
const RIPPLE_COUNT = 16;

const m4 = new Matrix4();
const q = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();
const Y = new Vector3(0, 1, 0);
const tmpEuler = new Euler();

function fillVertexColors(g: BufferGeometry, hex: number): void {
  const c = new Color(hex);
  const n = g.getAttribute("position").count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(arr, 3));
}

/** One lotus: two rings of petals (squashed spheres) around a yellow seed head, coloured per vertex. */
function flowerGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry, color: number): void => {
    fillVertexColors(g, color);
    parts.push(g);
  };
  const ring = (count: number, len: number, tilt: number, color: number, phase: number): void => {
    for (let i = 0; i < count; i++) {
      const g = new SphereGeometry(1, 8, 6);
      g.scale(0.05, 0.022, len);
      g.translate(0, 0, len * 0.9);
      g.rotateX(-tilt);
      g.rotateY((i / count) * Math.PI * 2 + phase);
      add(g, color);
    }
  };
  ring(8, 0.12, 0.45, 0xe9a3b4, 0);
  ring(6, 0.09, 0.95, 0xf4ccd4, 0.4);
  const head = new SphereGeometry(0.045, 10, 6);
  head.scale(1, 0.6, 1);
  head.translate(0, 0.04, 0);
  add(head, 0xe2c04a);
  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  if (!merged) throw new Error("merge: lotus flower");
  return merged;
}

/** Floating lotus lantern: wooden base, warm golden-pink petals and a bright candle core. */
function lanternGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry, color: number): void => {
    fillVertexColors(g, color);
    parts.push(g);
  };
  const base = new SphereGeometry(0.14, 12, 6);
  base.scale(1, 0.16, 1);
  add(base, 0x4a2e1b);

  const ring = (count: number, len: number, tilt: number, color: number, phase: number): void => {
    for (let i = 0; i < count; i++) {
      const g = new SphereGeometry(1, 8, 6);
      g.scale(0.048, 0.024, len);
      g.translate(0, 0.01, len * 0.85);
      g.rotateX(-tilt);
      g.rotateY((i / count) * Math.PI * 2 + phase);
      add(g, color);
    }
  };
  ring(8, 0.11, 0.42, 0xf59e6c, 0);
  ring(8, 0.085, 0.88, 0xffd98e, Math.PI / 8);

  const flame = new SphereGeometry(0.048, 10, 8);
  flame.scale(1, 1.45, 1);
  flame.translate(0, 0.065, 0);
  add(flame, 0xfff6d6);

  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  if (!merged) throw new Error("merge: lotus lantern");
  return merged;
}

/**
 * Sculpted 3D Koi fish facing +Z: tapered multi-segment body, high-contrast dorsal markings,
 * raised pectoral & pelvic fins, dorsal ridge, dark eyes, and a sweeping forked tail fin.
 */
function koiGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry, color: number): void => {
    fillVertexColors(g, color);
    parts.push(g);
  };

  const head = new SphereGeometry(1, 10, 6);
  head.scale(0.048, 0.011, 0.075);
  head.translate(0, 0.002, 0.11);
  add(head, 0xfff8ee);

  const chest = new SphereGeometry(1, 10, 6);
  chest.scale(0.056, 0.012, 0.095);
  chest.translate(0, 0.003, 0.03);
  add(chest, 0xffffff);

  const midBody = new SphereGeometry(1, 10, 6);
  midBody.scale(0.045, 0.011, 0.085);
  midBody.translate(0, 0.003, -0.055);
  add(midBody, 0xfff6ea);

  const tailStalk = new SphereGeometry(1, 8, 5);
  tailStalk.scale(0.024, 0.008, 0.068);
  tailStalk.translate(0, 0.002, -0.135);
  add(tailStalk, 0xfff0df);

  const headSpot = new SphereGeometry(1, 8, 5);
  headSpot.scale(0.035, 0.006, 0.045);
  headSpot.translate(0, 0.011, 0.105);
  add(headSpot, 0xf03e18);

  const backPatch = new SphereGeometry(1, 9, 5);
  backPatch.scale(0.045, 0.007, 0.07);
  backPatch.translate(0, 0.012, 0.015);
  add(backPatch, 0xe83212);

  const rearSpot = new SphereGeometry(1, 8, 5);
  rearSpot.scale(0.032, 0.006, 0.046);
  rearSpot.translate(0, 0.01, -0.075);
  add(rearSpot, 0xf0451d);

  const dorsal = new SphereGeometry(1, 8, 5);
  dorsal.scale(0.009, 0.009, 0.065);
  dorsal.translate(0, 0.014, -0.015);
  add(dorsal, 0xfffdf7);

  for (const side of [-1, 1] as const) {
    const pec = new SphereGeometry(1, 8, 4);
    pec.scale(0.058, 0.0035, 0.032);
    pec.rotateY(side * -0.42);
    pec.translate(side * 0.06, 0.0025, 0.045);
    add(pec, 0xfffaf2);

    const pel = new SphereGeometry(1, 6, 4);
    pel.scale(0.032, 0.003, 0.02);
    pel.rotateY(side * -0.52);
    pel.translate(side * 0.035, 0.002, -0.055);
    add(pel, 0xfff6eb);

    const eye = new SphereGeometry(1, 6, 4);
    eye.scale(0.008, 0.005, 0.009);
    eye.translate(side * 0.036, 0.007, 0.135);
    add(eye, 0x1c1614);
  }

  for (const side of [-1, 1] as const) {
    const lobe = new SphereGeometry(1, 8, 4);
    lobe.scale(0.025, 0.0035, 0.07);
    lobe.rotateY(side * 0.28);
    lobe.translate(side * 0.022, 0.0025, -0.21);
    add(lobe, 0xfff9f0);
  }

  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  if (!merged) throw new Error("merge: koi fish");
  return merged;
}

/** Concentric double water-ripple ring on the pond surface. */
function rippleGeometry(): BufferGeometry {
  const outer = new RingGeometry(0.88, 1.0, 28, 1);
  outer.rotateX(-Math.PI / 2);
  const inner = new RingGeometry(0.48, 0.56, 24, 1);
  inner.rotateX(-Math.PI / 2);
  const merged = mergeGeometries([outer, inner]);
  outer.dispose();
  inner.dispose();
  if (!merged) throw new Error("merge: pond ripple");
  return merged;
}

interface DriftingLantern {
  active: boolean;
  angle: number;
  radius: number;
  speed: number;
  phase: number;
}

interface KoiState {
  baseAngle: number;
  speed: number;
  radius: number;
  radialAmp: number;
  radialFreq: number;
  lobeFreq: number;
  swimFreq: number;
  phase: number;
  scale: number;
  dir: 1 | -1;
}

interface RippleState {
  followLantern: boolean;
  targetIndex: number;
  rate: number;
  phase: number;
}

const KOI_TINTS = [
  0xffffff,
  0xffe27a,
  0xffb870,
  0xfff5d6,
  0xffcf6e,
  0xff9e66,
] as const;

export interface Pond {
  /** Releases a glowing lotus lantern onto the pond water. */
  releaseLantern(): void;
  update(t: number, daylight: number): void;
  dispose(): void;
}

export function createPond(group: Group, materials: Materials, sky: Color): Pond {
  const rand = seeded(0x90d);
  const uniforms = { uTime: { value: 0 }, uSky: { value: sky }, uNight: { value: 0 } };
  const pondBounds = new Sphere(new Vector3(POND.x, WATER_Y, POND.z), Math.max(POND.rx, POND.rz) * 1.15);

  const waterGeo = new CircleGeometry(1, 64);
  waterGeo.rotateX(-Math.PI / 2);
  const waterMat = new MeshStandardMaterial({
    color: 0x063452,
    emissive: new Color(0x031d30),
    emissiveIntensity: 0.14,
    roughness: 0.14,
    metalness: 0.06,
  });
  waterMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWaterPos;\nvarying vec2 vPondLocal;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvPondLocal = transformed.xz;\nvWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uTime;\nuniform vec3 uSky;\nuniform float uNight;\nvarying vec3 vWaterPos;\nvarying vec2 vPondLocal;",
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        vec2 wp = vWaterPos.xz;
        vec2 slope = vec2(0.05 * cos(wp.x * 1.3 + uTime * 0.9), 0.05 * cos(wp.y * 1.7 - uTime * 0.7));
        slope += 0.03 * cos((wp.x + wp.y) * 2.6 + uTime * 1.6);
        normal = normalize((viewMatrix * vec4(normalize(vec3(-slope.x, 1.0, -slope.y)), 0.0)).xyz);`,
      )
      .replace(
        "#include <opaque_fragment>",
        `float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
        float radial = clamp(length(vPondLocal), 0.0, 1.0);
        vec3 oceanCenter = vec3(0.018, 0.135, 0.245);
        vec3 oceanDeep = vec3(0.008, 0.065, 0.145);
        vec3 seaTone = mix(oceanCenter, oceanDeep, smoothstep(0.12, 0.95, radial));
        float caustic = 0.5 + 0.5 * sin(wp.x * 2.8 + uTime * 1.4) * cos(wp.y * 2.6 - uTime * 1.1);
        seaTone += vec3(0.012, 0.042, 0.068) * caustic * (1.0 - 0.55 * uNight);
        outgoingLight = mix(outgoingLight * 0.55, seaTone, 0.65);
        vec3 skyRefl = clamp(uSky * 0.36, vec3(0.015, 0.065, 0.13), vec3(0.11, 0.24, 0.38));
        outgoingLight = mix(outgoingLight, skyRefl, 0.05 + 0.32 * fres);
        vec2 gc = wp * 2.2 + slope * 6.0;
        vec2 cell = floor(gc);
        float h = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
        vec2 jit = vec2(h, fract(h * 7.31)) * 0.6 + 0.2;
        float tw = 0.5 + 0.5 * sin(uTime * (1.3 + 2.0 * h) + h * 40.0);
        float glint = step(0.82, h) * smoothstep(0.1, 0.0, length(fract(gc) - jit)) * tw * tw;
        outgoingLight += vec3(1.0, 0.84, 0.52) * glint * uNight * 1.5;
        #include <opaque_fragment>`,
      );
  };
  const water = new Mesh(waterGeo, waterMat);
  water.position.set(POND.x, WATER_Y, POND.z);
  water.scale.set(POND.rx, 1, POND.rz);
  water.receiveShadow = true;
  water.name = "pond-water";

  const bankGeo = new RingGeometry(0.98, BANK_OUTER, 64, 1);
  bankGeo.rotateX(-Math.PI / 2);
  const bankMat = new MeshStandardMaterial({
    map: materials.stone.map,
    normalMap: materials.stone.normalMap,
    roughnessMap: materials.stone.roughnessMap,
    color: 0x9c9587,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const bank = new Mesh(bankGeo, bankMat);
  bank.position.set(POND.x, WATER_Y + 0.02, POND.z);
  bank.scale.set(POND.rx, 1, POND.rz);
  bank.receiveShadow = true;
  bank.name = "pond-bank";

  const leafGeo = new CircleGeometry(1, 18, 0.25, Math.PI * 2 - 0.5);
  leafGeo.rotateX(-Math.PI / 2);
  const leafMat = new MeshStandardMaterial({ color: 0x3b8038, roughness: 0.55, side: DoubleSide });
  const leaves = new InstancedMesh(leafGeo, leafMat, LEAF_COUNT);
  for (let i = 0; i < LEAF_COUNT; i++) {
    const f = LOTUS_FLOWERS[i % LOTUS_FLOWERS.length];
    let x: number;
    let z: number;
    if (f && i < LOTUS_FLOWERS.length * 3) {
      x = f.x + (rand() - 0.5) * 2.2;
      z = f.z + (rand() - 0.5) * 2.2;
    } else {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 0.75;
      x = POND.x + Math.cos(a) * POND.rx * r;
      z = POND.z + Math.sin(a) * POND.rz * r;
    }
    const s = 0.35 + rand() * 0.35;
    leaves.setMatrixAt(i, m4.compose(v3.set(x, WATER_Y + 0.016 + i * 0.0005, z), q.setFromAxisAngle(Y, rand() * Math.PI * 2), s3.set(s, 1, s)));
  }
  leaves.receiveShadow = true;
  leaves.name = "lotus-leaves";

  const flowerGeo = flowerGeometry();
  const flowerMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  const flowers = new InstancedMesh(flowerGeo, flowerMat, LOTUS_FLOWERS.length);
  LOTUS_FLOWERS.forEach((f, i) => {
    flowers.setMatrixAt(i, m4.compose(v3.set(f.x, WATER_Y + 0.05, f.z), q.setFromAxisAngle(Y, rand() * Math.PI), s3.setScalar(FLOWER_SCALE)));
  });
  flowers.castShadow = true;
  flowers.name = "lotus-flowers";

  const lanternGeo = lanternGeometry();
  const lanternMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.45,
    emissive: new Color(0xffae42),
    emissiveIntensity: 0.85,
  });
  const lanterns = new InstancedMesh(lanternGeo, lanternMat, MAX_LANTERNS);
  lanterns.boundingSphere = pondBounds.clone();
  lanterns.frustumCulled = true;
  lanterns.name = "lotus-lanterns";

  const states: DriftingLantern[] = Array.from({ length: MAX_LANTERNS }, (_, i) => ({
    active: i < INITIAL_LANTERNS,
    angle: (i / INITIAL_LANTERNS) * Math.PI * 2 + rand() * 0.5,
    radius: 0.28 + rand() * 0.38,
    speed: 0.035 + rand() * 0.025,
    phase: rand() * Math.PI * 2,
  }));
  let nextSlot = INITIAL_LANTERNS % MAX_LANTERNS;

  const koiGeo = koiGeometry();
  const koiMat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.22,
    metalness: 0.05,
    emissive: new Color(0x381906),
    emissiveIntensity: 0.22,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  koiMat.onBeforeCompile = (shader) => {
    shader.uniforms["uTime"] = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        float koiPhase = (instanceMatrix[3][0] + instanceMatrix[3][2]) * 1.35;
        float tailWeight = clamp((0.12 - transformed.z) / 0.36, 0.0, 1.0);
        transformed.x += sin(uTime * 8.2 + koiPhase - transformed.z * 15.0) * tailWeight * tailWeight * 0.038;`,
      );
  };
  const koiMesh = new InstancedMesh(koiGeo, koiMat, KOI_COUNT);
  koiMesh.boundingSphere = pondBounds.clone();
  koiMesh.frustumCulled = true;
  koiMesh.name = "pond-koi";

  const koiColor = new Color();
  const koiStates: KoiState[] = Array.from({ length: KOI_COUNT }, (_, i) => {
    const hex = KOI_TINTS[i % KOI_TINTS.length] ?? 0xffffff;
    koiMesh.setColorAt(i, koiColor.setHex(hex));
    return {
      baseAngle: (i / KOI_COUNT) * Math.PI * 2 + rand() * 0.45,
      speed: 0.11 + rand() * 0.09,
      radius: 0.22 + rand() * 0.54,
      radialAmp: 0.08 + rand() * 0.12,
      radialFreq: 0.35 + rand() * 0.35,
      lobeFreq: i % 2 === 0 ? 1 : 2,
      swimFreq: 6.5 + rand() * 3.0,
      phase: rand() * Math.PI * 2,
      scale: 0.88 + rand() * 0.4,
      dir: i % 3 === 0 ? -1 : 1,
    };
  });
  if (koiMesh.instanceColor) koiMesh.instanceColor.needsUpdate = true;

  const rippleGeo = rippleGeometry();
  const rippleMat = new MeshStandardMaterial({
    color: 0x6fbcd9,
    emissive: new Color(0x0e4463),
    emissiveIntensity: 0.22,
    roughness: 0.24,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
    side: DoubleSide,
  });
  const ripples = new InstancedMesh(rippleGeo, rippleMat, RIPPLE_COUNT);
  ripples.boundingSphere = pondBounds.clone();
  ripples.frustumCulled = true;
  ripples.name = "pond-ripples";

  const rippleStates: RippleState[] = Array.from({ length: RIPPLE_COUNT }, (_, i) => ({
    followLantern: i < 6,
    targetIndex: i < 6 ? i % MAX_LANTERNS : (i - 6) % KOI_COUNT,
    rate: 0.42 + rand() * 0.28,
    phase: rand(),
  }));

  const evalKoiPos = (st: KoiState, t: number, out: { x: number; z: number }): void => {
    const a = st.baseAngle + st.dir * t * st.speed;
    const r = Math.min(0.84, Math.max(0.14, st.radius + Math.sin(t * st.radialFreq + st.phase) * st.radialAmp));
    const swerve = 0.05 * Math.sin(a * st.lobeFreq + st.phase);
    out.x = POND.x + Math.cos(a + swerve) * POND.rx * r;
    out.z = POND.z + Math.sin(a - swerve) * POND.rz * r;
  };

  const pNow = { x: 0, z: 0 };
  const pAhead = { x: 0, z: 0 };

  const updateDynamicPond = (t: number): void => {
    for (let i = 0; i < MAX_LANTERNS; i++) {
      const st = states[i]!;
      if (!st.active) {
        lanterns.setMatrixAt(i, m4.compose(v3.set(POND.x, WATER_Y - 1, POND.z), q.identity(), s3.setScalar(0)));
        continue;
      }
      const a = st.angle + t * st.speed;
      const r = st.radius + 0.04 * Math.sin(t * 0.25 + st.phase);
      const x = POND.x + Math.cos(a) * POND.rx * r;
      const z = POND.z + Math.sin(a) * POND.rz * r;
      const y = WATER_Y + 0.04 + 0.008 * Math.sin(t * 2.2 + st.phase);
      const yaw = a + Math.PI * 0.5 + 0.2 * Math.sin(t * 0.8 + st.phase);
      lanterns.setMatrixAt(i, m4.compose(v3.set(x, y, z), q.setFromAxisAngle(Y, yaw), s3.setScalar(LANTERN_SCALE)));
    }
    lanterns.instanceMatrix.needsUpdate = true;

    const dtLook = 0.05;
    for (let i = 0; i < KOI_COUNT; i++) {
      const k = koiStates[i];
      if (!k) continue;
      evalKoiPos(k, t, pNow);
      evalKoiPos(k, t + dtLook, pAhead);
      const dx = pAhead.x - pNow.x;
      const dz = pAhead.z - pNow.z;
      const heading = Math.atan2(dx, dz);

      const wag = Math.sin(t * k.swimFreq + k.phase);
      const yaw = heading + wag * 0.06;
      const roll = wag * 0.035;
      const y = WATER_Y + 0.0085 + 0.0008 * Math.sin(t * 1.9 + k.phase);

      tmpEuler.set(0, yaw, roll, "YXZ");
      q.setFromEuler(tmpEuler);
      koiMesh.setMatrixAt(i, m4.compose(v3.set(pNow.x, y, pNow.z), q, s3.setScalar(k.scale)));
    }
    koiMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < RIPPLE_COUNT; i++) {
      const rp = rippleStates[i];
      if (!rp) continue;
      const cycle = (t * rp.rate + rp.phase) % 1;
      let rx = POND.x;
      let rz = POND.z;
      let visible = true;

      if (rp.followLantern) {
        const lSt = states[rp.targetIndex];
        if (!lSt || !lSt.active) {
          visible = false;
        } else {
          const a = lSt.angle + t * lSt.speed;
          const r = lSt.radius + 0.04 * Math.sin(t * 0.25 + lSt.phase);
          rx = POND.x + Math.cos(a) * POND.rx * r;
          rz = POND.z + Math.sin(a) * POND.rz * r;
        }
      } else {
        const kSt = koiStates[rp.targetIndex];
        if (kSt) {
          evalKoiPos(kSt, t - cycle * 0.55, pNow);
          rx = pNow.x;
          rz = pNow.z;
        }
      }

      if (!visible) {
        ripples.setMatrixAt(i, m4.compose(v3.set(POND.x, WATER_Y - 1, POND.z), q.identity(), s3.setScalar(0)));
        continue;
      }

      const envelope = Math.sin(cycle * Math.PI);
      const radiusScale = (0.16 + cycle * 0.52) * envelope;
      ripples.setMatrixAt(
        i,
        m4.compose(v3.set(rx, WATER_Y + 0.0025, rz), q.identity(), s3.set(radiusScale, 1, radiusScale)),
      );
    }
    ripples.instanceMatrix.needsUpdate = true;
  };

  updateDynamicPond(0);

  for (const o of [water, bank, leaves, flowers, lanterns, koiMesh, ripples]) {
    o.matrixAutoUpdate = false;
    o.updateMatrix();
    group.add(o);
  }
  leaves.computeBoundingSphere();
  flowers.computeBoundingSphere();

  registerCameraPreset("pond", { position: [POND.x - 12, 4.5, POND.z + 14], target: [POND.x, 0, POND.z] });

  return {
    releaseLantern() {
      const st = states[nextSlot]!;
      const nowT = uniforms.uTime.value;
      const spawnAngle = Math.PI + (Math.random() - 0.5) * 0.8;
      st.active = true;
      st.speed = 0.04 + Math.random() * 0.025;
      st.angle = spawnAngle - nowT * st.speed;
      st.radius = 0.45 + Math.random() * 0.28;
      st.phase = Math.random() * Math.PI * 2;
      nextSlot = (nextSlot + 1) % MAX_LANTERNS;
      updateDynamicPond(nowT);
    },
    update(t, daylight) {
      uniforms.uTime.value = t;
      // Skip all per-frame Koi/lantern/ripple CPU matrix math & GPU buffer uploads when the pond region is culled!
      if (!group.visible) return;
      const night = 1 - daylight;
      uniforms.uNight.value = night;
      waterMat.emissiveIntensity = 0.1 + daylight * 0.06;
      lanternMat.emissiveIntensity = 0.7 + night * 1.6 + 0.12 * Math.sin(t * 3.1);
      koiMat.emissiveIntensity = 0.22 + night * 0.28;
      rippleMat.opacity = 0.2 + daylight * 0.1;
      updateDynamicPond(t);
    },
    dispose() {
      for (const o of [water, bank, leaves, flowers, lanterns, koiMesh, ripples]) group.remove(o);
      leaves.dispose();
      flowers.dispose();
      lanterns.dispose();
      koiMesh.dispose();
      ripples.dispose();
      for (const g of [waterGeo, bankGeo, leafGeo, flowerGeo, lanternGeo, koiGeo, rippleGeo]) g.dispose();
      for (const m of [waterMat, bankMat, leafMat, flowerMat, lanternMat, koiMat, rippleMat]) m.dispose();
    },
  };
}
