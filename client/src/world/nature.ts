import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  Sphere,
  SRGBColorSpace,
  Vector3,
  type Scene,
} from "three";
import { HALL, POND } from "@santinh/shared";
import { radialTexture } from "../engine/radial-texture.ts";
import { IS_MOBILE, maxAnisotropy } from "../engine/renderer.ts";
import { seeded } from "./random.ts";

const FIREFLY_COUNT = IS_MOBILE ? 36 : 56;
const LEAF_COUNT = IS_MOBILE ? 36 : 54;
const BUTTERFLY_COUNT = IS_MOBILE ? 12 : 16;

/** Bounding sphere covering the outdoor courtyard, west/east gardens, pond, and gate path. */
const OUTDOOR_BOUNDS = new Sphere(new Vector3(3, 3, 12), 42);

const m4 = new Matrix4();
const q = new Quaternion();
const v3 = new Vector3();
const s3 = new Vector3();
const tmpEuler = new Euler();

/** Returns true if (x, z) lies inside the main temple hall plus a safety margin. */
function insideHall(x: number, z: number, pad = 2.0): boolean {
  return x > HALL.xMin - pad && x < HALL.xMax + pad && z > HALL.zMin - pad && z < HALL.zMax + pad;
}

/** Pushes any coordinate that drifted into the Hall out into the nearest courtyard side. */
function keepOutsideHall(x: number, z: number, pad = 1.8): { x: number; z: number } {
  if (!insideHall(x, z, pad)) return { x, z };
  if (z >= 4) return { x, z: HALL.zMax + pad + 1.5 };
  if (x < 0) return { x: HALL.xMin - pad - 1.5, z };
  return { x: HALL.xMax + pad + 1.5, z };
}

/** Picks an evenly distributed outdoor point across the entire courtyard, west/east gardens, gate path & pond. */
function pickOutdoorPoint(rand: () => number): { x: number; z: number } {
  for (let attempt = 0; attempt < 24; attempt++) {
    const x = -28 + rand() * 60;
    const z = -14 + rand() * 50;
    if (!insideHall(x, z, 2.2)) return { x, z };
  }
  const side = rand() < 0.5 ? -1 : 1;
  return { x: side * (16 + rand() * 10), z: 16 + rand() * 16 };
}

interface FireflyData {
  ax: number;
  ay: number;
  az: number;
  rx: number;
  rz: number;
  speed: number;
  phase: number;
}

interface LeafData {
  ox: number;
  oz: number;
  y: number;
  fallSpeed: number;
  driftX: number;
  driftZ: number;
  swayAmp: number;
  swayFreq: number;
  rx: number;
  ry: number;
  rz: number;
  phase: number;
  scale: number;
}

interface ButterflyData {
  cx: number;
  cz: number;
  radius: number;
  angle: number;
  speed: number;
  y: number;
  amplitude: number;
  frequency: number;
  phase: number;
}

const FALLING_MAPLE_PALETTE: readonly number[] = [
  0xc92519, // Đỏ phong thẫm
  0xe84d22, // Đỏ cam
  0xf29b24, // Vàng nghệ
  0xd9381e, // Cam cháy
  0xf5b83d, // Vàng hổ phách
  0xa81d15, // Đỏ rượu vang
];

/**
 * Draws a detailed 7-lobed palmate Japanese Maple Leaf (`Lá Phong Mùa Thu`)
 * in a bright neutral-warm tone so `instanceColor` tints each falling leaf into
 * crimson, burnt orange, or golden amber.
 */
function drawMapleLeafTexture(size = 256): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.clearRect(0, 0, size, size);

  const cx = size * 0.5;
  const cy = size * 0.58;
  const radius = size * 0.42;

  // Slender petiole stem at the bottom
  ctx.strokeStyle = "#6e3b1e";
  ctx.lineWidth = 4.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx, size * 0.94);
  ctx.quadraticCurveTo(cx - 4, size * 0.78, cx, cy + radius * 0.08);
  ctx.stroke();

  const lobeAngles = [-1.95, -1.3, -0.63, 0, 0.63, 1.3, 1.95] as const;
  const lobeLengths = [0.46, 0.76, 0.96, 1.1, 0.96, 0.76, 0.46] as const;
  const lobeWidths = [0.12, 0.17, 0.2, 0.22, 0.2, 0.17, 0.12] as const;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.moveTo(0, radius * 0.1);

  for (let i = 0; i < lobeAngles.length; i++) {
    const a = lobeAngles[i]! - Math.PI * 0.5;
    const len = radius * lobeLengths[i]!;
    const wid = radius * lobeWidths[i]!;
    const perp = a + Math.PI * 0.5;

    const tipX = Math.cos(a) * len;
    const tipY = Math.sin(a) * len;

    const l1x = Math.cos(a) * (len * 0.4) - Math.cos(perp) * (wid * 0.82);
    const l1y = Math.sin(a) * (len * 0.4) - Math.sin(perp) * (wid * 0.82);
    const l2x = Math.cos(a) * (len * 0.74) - Math.cos(perp) * (wid * 0.48);
    const l2y = Math.sin(a) * (len * 0.74) - Math.sin(perp) * (wid * 0.48);

    const r2x = Math.cos(a) * (len * 0.74) + Math.cos(perp) * (wid * 0.48);
    const r2y = Math.sin(a) * (len * 0.74) + Math.sin(perp) * (wid * 0.48);
    const r1x = Math.cos(a) * (len * 0.4) + Math.cos(perp) * (wid * 0.82);
    const r1y = Math.sin(a) * (len * 0.4) + Math.sin(perp) * (wid * 0.82);

    ctx.lineTo(l1x, l1y);
    ctx.lineTo(l2x, l2y);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(r2x, r2y);
    ctx.lineTo(r1x, r1y);

    if (i < lobeAngles.length - 1) {
      const nextA = lobeAngles[i + 1]! - Math.PI * 0.5;
      const midA = (a + nextA) * 0.5;
      const notchR = radius * 0.24;
      ctx.lineTo(Math.cos(midA) * notchR, Math.sin(midA) * notchR);
    }
  }
  ctx.closePath();

  const grad = ctx.createRadialGradient(0, 0, radius * 0.08, 0, -radius * 0.2, radius * 1.05);
  grad.addColorStop(0, "#e6dccb");
  grad.addColorStop(0.65, "#faf4e8");
  grad.addColorStop(1, "#ffffff");
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(64, 32, 16, 0.72)";
  ctx.stroke();

  ctx.strokeStyle = "rgba(255, 250, 230, 0.65)";
  ctx.lineWidth = 2.2;
  for (let i = 0; i < lobeAngles.length; i++) {
    const a = lobeAngles[i]! - Math.PI * 0.5;
    const len = radius * lobeLengths[i]! * 0.86;
    ctx.beginPath();
    ctx.moveTo(0, radius * 0.06);
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAnisotropy();
  return tex;
}

/** Draws a top-down Swallowtail Butterfly (Con Bướm) with antennae, body, forewings, hindwings, and markings. */
function drawButterflyTexture(size = 256): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  ctx.clearRect(0, 0, size, size);

  const drawWingSide = (dir: -1 | 1): void => {
    ctx.save();
    ctx.translate(128, 128);
    ctx.scale(dir, 1);

    const foreGrad = ctx.createRadialGradient(12, -10, 8, 54, -28, 108);
    foreGrad.addColorStop(0, "#fff49c");
    foreGrad.addColorStop(0.55, "#ffba38");
    foreGrad.addColorStop(0.88, "#d95f16");
    foreGrad.addColorStop(1, "#2a1608");

    ctx.beginPath();
    ctx.moveTo(4, -22);
    ctx.bezierCurveTo(38, -88, 106, -98, 118, -54);
    ctx.bezierCurveTo(124, -26, 98, 8, 58, 12);
    ctx.lineTo(4, 4);
    ctx.closePath();
    ctx.fillStyle = foreGrad;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#2b1608";
    ctx.stroke();

    const hindGrad = ctx.createRadialGradient(10, 12, 6, 42, 42, 86);
    hindGrad.addColorStop(0, "#ffe880");
    hindGrad.addColorStop(0.6, "#f59824");
    hindGrad.addColorStop(1, "#2b1608");

    ctx.beginPath();
    ctx.moveTo(4, 2);
    ctx.lineTo(62, 10);
    ctx.bezierCurveTo(96, 26, 92, 74, 64, 92);
    ctx.bezierCurveTo(52, 100, 46, 114, 38, 112);
    ctx.bezierCurveTo(32, 110, 34, 94, 24, 90);
    ctx.bezierCurveTo(12, 86, 6, 62, 3, 36);
    ctx.closePath();
    ctx.fillStyle = hindGrad;
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = "#2b1608";
    ctx.stroke();

    ctx.strokeStyle = "rgba(43, 22, 8, 0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(6, -10);
    ctx.quadraticCurveTo(56, -44, 106, -54);
    ctx.moveTo(6, -6);
    ctx.quadraticCurveTo(58, -18, 104, -22);
    ctx.moveTo(6, 10);
    ctx.quadraticCurveTo(44, 36, 72, 58);
    ctx.moveTo(6, 16);
    ctx.quadraticCurveTo(32, 52, 42, 96);
    ctx.stroke();

    ctx.fillStyle = "#fff8d6";
    for (const [sx, sy, r] of [
      [106, -58, 4.5],
      [108, -36, 4.2],
      [98, -14, 3.8],
      [78, 42, 3.8],
      [64, 68, 3.8],
    ] as const) {
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  };

  drawWingSide(-1);
  drawWingSide(1);

  ctx.strokeStyle = "#241307";
  ctx.lineWidth = 2.6;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(125, 76);
  ctx.quadraticCurveTo(114, 42, 96, 34);
  ctx.moveTo(131, 76);
  ctx.quadraticCurveTo(142, 42, 160, 34);
  ctx.stroke();

  ctx.fillStyle = "#241307";
  ctx.beginPath();
  ctx.arc(128, 78, 6.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(128, 104, 7.5, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(128, 152, 5.5, 32, 0, 0, Math.PI * 2);
  ctx.fill();

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAnisotropy();
  return tex;
}

/** Gently curved 3D quad carrying the Maple leaf texture. */
function buildLeafGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  const positions = new Float32Array([
    -0.12, 0.12, -0.012,
    0, 0.12, 0.015,
    0.12, 0.12, -0.012,
    -0.12, -0.12, 0.012,
    0, -0.12, -0.015,
    0.12, -0.12, 0.012,
  ]);
  const uvs = new Float32Array([
    0, 1,
    0.5, 1,
    1, 1,
    0, 0,
    0.5, 0,
    1, 0,
  ]);
  const indices = [
    0, 3, 1, 1, 3, 4,
    1, 4, 2, 2, 4, 5,
  ];
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** V-hinged 3D butterfly geometry. */
function buildButterflyGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  const w = 0.14;
  const l = 0.13;
  const positions = new Float32Array([
    -w, w, l,
    0, 0, l,
    w, w, l,
    -w, w, -l,
    0, 0, -l,
    w, w, -l,
  ]);
  const uvs = new Float32Array([
    0, 1,
    0.5, 1,
    1, 1,
    0, 0,
    0.5, 0,
    1, 0,
  ]);
  const indices = [
    0, 3, 1, 1, 3, 4,
    1, 4, 2, 2, 4, 5,
  ];
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

export interface Nature {
  update(dt: number, t: number, daylight: number): void;
  dispose(): void;
}

export function createNature(scene: Scene): Nature {
  const rand = seeded(0x5a7);

  // 1. Night fireflies evenly distributed across the outdoor temple grounds.
  const fireflyGeo = new BufferGeometry();
  const fireflyPositions = new Float32Array(FIREFLY_COUNT * 3);
  const fireflyAttr = new Float32BufferAttribute(fireflyPositions, 3);
  fireflyGeo.setAttribute("position", fireflyAttr);
  fireflyGeo.boundingSphere = OUTDOOR_BOUNDS.clone();
  const fireflies: FireflyData[] = [];

  for (let i = 0; i < FIREFLY_COUNT; i++) {
    const pt = pickOutdoorPoint(rand);
    const ay = 0.45 + rand() * 2.1;
    fireflyPositions[i * 3] = pt.x;
    fireflyPositions[i * 3 + 1] = ay;
    fireflyPositions[i * 3 + 2] = pt.z;
    fireflies.push({
      ax: pt.x,
      ay,
      az: pt.z,
      rx: 0.65 + rand() * 1.25,
      rz: 0.65 + rand() * 1.25,
      speed: 0.42 + rand() * 0.6,
      phase: rand() * Math.PI * 2,
    });
  }

  const fireflyTex = radialTexture();
  const fireflyMat = new PointsMaterial({
    map: fireflyTex,
    color: new Color(0xd8ff66),
    size: 0.22,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
  });
  const fireflyPoints = new Points(fireflyGeo, fireflyMat);
  fireflyPoints.name = "nature-fireflies";
  fireflyPoints.frustumCulled = true;
  fireflyPoints.matrixAutoUpdate = false;
  fireflyPoints.updateMatrix();
  scene.add(fireflyPoints);

  // 2. Daytime falling & wind-drifting Autumn Maple Leaves (Crimson, Red-Orange, Gold, Amber).
  const leafGeo = buildLeafGeometry();
  const leafTex = drawMapleLeafTexture();
  const leafMat = new MeshStandardMaterial({
    map: leafTex,
    alphaTest: 0.22,
    transparent: false,
    roughness: 0.65,
    metalness: 0.02,
    side: DoubleSide,
  });
  const leafMesh = new InstancedMesh(leafGeo, leafMat, LEAF_COUNT);
  leafMesh.name = "nature-leaves";
  leafMesh.boundingSphere = OUTDOOR_BOUNDS.clone();
  leafMesh.frustumCulled = true;
  leafMesh.matrixAutoUpdate = false;
  leafMesh.updateMatrix();
  const leaves: LeafData[] = [];
  const leafColor = new Color();

  for (let i = 0; i < LEAF_COUNT; i++) {
    const pt = pickOutdoorPoint(rand);
    const hex = FALLING_MAPLE_PALETTE[i % FALLING_MAPLE_PALETTE.length] ?? 0xe84d22;
    leafMesh.setColorAt(i, leafColor.setHex(hex));
    leaves.push({
      ox: pt.x,
      oz: pt.z,
      y: 0.3 + rand() * 6.8,
      // Slow, meditative fall & horizontal breeze drift across the courtyard
      fallSpeed: 0.28 + rand() * 0.24,
      driftX: 0.22 + rand() * 0.25,
      driftZ: -0.08 + (rand() - 0.5) * 0.16,
      swayAmp: 0.55 + rand() * 0.65,
      swayFreq: 0.55 + rand() * 0.55,
      rx: rand() * Math.PI * 2,
      ry: rand() * Math.PI * 2,
      rz: rand() * Math.PI * 2,
      phase: rand() * Math.PI * 2,
      scale: 0.72 + rand() * 0.48,
    });
  }
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  scene.add(leafMesh);

  // 3. Daytime butterflies fluttering around the garden and pond.
  const bflyGeo = buildButterflyGeometry();
  const bflyTex = drawButterflyTexture();
  const bflyMat = new MeshStandardMaterial({
    map: bflyTex,
    alphaTest: 0.2,
    transparent: false,
    roughness: 0.5,
    metalness: 0.05,
    emissive: new Color(0x281904),
    side: DoubleSide,
  });
  const bflyMesh = new InstancedMesh(bflyGeo, bflyMat, BUTTERFLY_COUNT);
  bflyMesh.name = "nature-butterflies";
  bflyMesh.boundingSphere = OUTDOOR_BOUNDS.clone();
  bflyMesh.frustumCulled = true;
  bflyMesh.matrixAutoUpdate = false;
  bflyMesh.updateMatrix();
  const butterflies: ButterflyData[] = [];

  for (let i = 0; i < BUTTERFLY_COUNT; i++) {
    const nearPond = i < Math.floor(BUTTERFLY_COUNT * 0.35);
    const pt = nearPond
      ? { x: POND.x + (rand() - 0.5) * POND.rx * 1.5, z: POND.z + (rand() - 0.5) * POND.rz * 1.5 }
      : pickOutdoorPoint(rand);
    butterflies.push({
      cx: pt.x,
      cz: pt.z,
      radius: 1.6 + rand() * 2.5,
      angle: rand() * Math.PI * 2,
      speed: 0.52 + rand() * 0.42,
      y: 0.75 + rand() * 1.4,
      amplitude: 0.22 + rand() * 0.28,
      frequency: 2.1 + rand() * 1.3,
      phase: rand() * Math.PI * 2,
    });
  }
  scene.add(bflyMesh);

  return {
    update(dt, t, daylight) {
      const night = Math.max(0, Math.min(1, 1 - daylight));

      // 1. Update fireflies at night.
      if (night > 0.08) {
        fireflyPoints.visible = true;
        fireflyMat.opacity = Math.min(0.92, night * 1.15);
        fireflyMat.size = 0.2 + 0.05 * Math.sin(t * 2.4);
        for (let i = 0; i < FIREFLY_COUNT; i++) {
          const f = fireflies[i];
          if (!f) continue;
          const a = t * f.speed + f.phase;
          const rawX = f.ax + Math.cos(a) * f.rx + Math.sin(a * 0.7) * 0.25;
          const rawZ = f.az + Math.sin(a * 0.85) * f.rz;
          const safe = keepOutsideHall(rawX, rawZ, 1.8);
          const fy = f.ay + Math.sin(t * (f.speed * 1.6) + f.phase) * 0.28;
          fireflyAttr.setXYZ(i, safe.x, fy, safe.z);
        }
        fireflyAttr.needsUpdate = true;
      } else {
        fireflyPoints.visible = false;
      }

      // 2. Update falling & wind-drifting Japanese Maple leaves (daytime).
      if (daylight > 0.25) {
        leafMesh.visible = true;
        for (let i = 0; i < LEAF_COUNT; i++) {
          const l = leaves[i];
          if (!l) continue;
          l.y -= l.fallSpeed * dt;
          l.ox += l.driftX * dt;
          l.oz += l.driftZ * dt;
          if (l.ox > 32) l.ox -= 60;
          if (l.oz < -16) l.oz += 52;
          if (l.oz > 38) l.oz -= 52;

          // Gentle, slow tumbling rotation as the maple leaf glides on the breeze
          l.rx += dt * 0.55;
          l.ry += dt * 0.48;
          l.rz += dt * 0.38;
          if (l.y < 0.06) {
            l.y = 6.2 + ((i * 0.43) % 2.2);
          }
          const swayX = Math.sin(t * l.swayFreq + l.phase) * l.swayAmp;
          const swayZ = Math.cos(t * (l.swayFreq * 0.8) + l.phase) * l.swayAmp;
          const safe = keepOutsideHall(l.ox + swayX, l.oz + swayZ, 1.8);
          tmpEuler.set(l.rx, l.ry, l.rz, "XYZ");
          q.setFromEuler(tmpEuler);
          leafMesh.setMatrixAt(i, m4.compose(v3.set(safe.x, l.y, safe.z), q, s3.setScalar(l.scale)));
        }
        leafMesh.instanceMatrix.needsUpdate = true;
      } else {
        leafMesh.visible = false;
      }

      // 3. Update daytime butterflies.
      if (daylight > 0.25) {
        bflyMesh.visible = true;
        for (let i = 0; i < BUTTERFLY_COUNT; i++) {
          const b = butterflies[i];
          if (!b) continue;
          b.angle += b.speed * dt;
          const rawX = b.cx + Math.cos(b.angle) * b.radius;
          const rawZ = b.cz + Math.sin(b.angle * 2) * (b.radius * 0.55);
          const safe = keepOutsideHall(rawX, rawZ, 1.8);
          const by = b.y + Math.sin(t * b.frequency + b.phase) * b.amplitude;
          const dx = -Math.sin(b.angle) * b.radius;
          const dz = Math.cos(b.angle * 2) * (b.radius * 1.1);
          const yaw = Math.atan2(dx, dz);
          const pitch = Math.cos(t * b.frequency + b.phase) * 0.16;

          const flapAngle = 0.26 + Math.sin(t * 17 + b.phase * 3) * 0.75;
          const wingX = Math.cos(flapAngle);
          const wingY = Math.sin(flapAngle);

          tmpEuler.set(pitch, yaw, 0, "YXZ");
          q.setFromEuler(tmpEuler);
          bflyMesh.setMatrixAt(i, m4.compose(v3.set(safe.x, by, safe.z), q, s3.set(wingX, wingY, 1)));
        }
        bflyMesh.instanceMatrix.needsUpdate = true;
      } else {
        bflyMesh.visible = false;
      }
    },
    dispose() {
      scene.remove(fireflyPoints);
      scene.remove(leafMesh);
      scene.remove(bflyMesh);
      fireflyPoints.geometry.dispose();
      fireflyMat.dispose();
      fireflyTex.dispose();
      leafMesh.dispose();
      leafGeo.dispose();
      leafMat.dispose();
      leafTex.dispose();
      bflyMesh.dispose();
      bflyGeo.dispose();
      bflyMat.dispose();
      bflyTex.dispose();
    },
  };
}
