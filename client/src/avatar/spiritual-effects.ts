import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SRGBColorSpace,
  SphereGeometry,
  type Object3D,
} from "three";
import { radialTexture } from "../engine/radial-texture.ts";
import { maxAnisotropy } from "../engine/renderer.ts";

const RIPPLE_POOL_SIZE = 4;
const RIPPLE_DURATION_S = 1.25;
const MOTE_COUNT = 18;
const MAX_ORBS = 4;

/**
 * Sits 2.5 cm proud of the stone path flagstones (`0.05 m` in `garden.ts`), gravel loop (`0.02 m`),
 * and pond stone bank (`0.06 m` in `pond.ts`) so foot auras (`aura_lotus`, `aura_jade`, `aura_wheel`)
 * and woodblock soundwave ripples are never occluded by floor tiles.
 */
const AURA_BASE_Y = 0.075;

interface RippleSlot {
  mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  age: number;
  active: boolean;
}

interface MoteSlot {
  angle: number;
  radius: number;
  speed: number;
  riseSpeed: number;
  phase: number;
}

interface AuraTheme {
  readonly moteColor: number;
  readonly orbCoreColor: number;
  readonly orbHaloColor: number;
  readonly orbCount: number;
  readonly outerSpeed: number;
  readonly innerSpeed: number;
}

const AURA_THEMES: Readonly<Record<string, AuraTheme>> = {
  aura_lotus: {
    moteColor: 0xffe484,
    orbCoreColor: 0xfff8d6,
    orbHaloColor: 0xffc84a,
    orbCount: 0,
    outerSpeed: 0.24,
    innerSpeed: -0.18,
  },
  aura_jade: {
    moteColor: 0x64ffda,
    orbCoreColor: 0xe6fff7,
    orbHaloColor: 0x26e6b0,
    orbCount: 3,
    outerSpeed: 0.26,
    innerSpeed: -0.22,
  },
  aura_wheel: {
    moteColor: 0xffd866,
    orbCoreColor: 0xffffff,
    orbHaloColor: 0xffae24,
    orbCount: 4,
    outerSpeed: 0.38,
    innerSpeed: -0.28,
  },
};

/** Draws a crisp 4-point celestial star gem at (x, y) on the 2D canvas. */
function drawStarGem(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outerR: number,
  innerR: number,
  fill: string,
  glow: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, outerR * 1.15, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = fill;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (i * Math.PI) / 4;
    const px = Math.cos(a) * r;
    const py = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Draws the OUTER ground halo texture (512×512) with pure radial luminescence,
 * delicate concentric filigree rings, beaded pearl tracks, and star nodes —
 * completely free of crude internal petal loops.
 */
function drawOuterAuraTexture(kind: string): CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const cx = size / 2;
    const cy = size / 2;
    ctx.clearRect(0, 0, size, size);

    if (kind === "aura_jade") {
      // Bích Ngọc Tâm Đăng: Translucent emerald-jade sanctuary glow + fine constellation rings
      const bg = ctx.createRadialGradient(cx, cy, 8, cx, cy, 240);
      bg.addColorStop(0, "rgba(120, 255, 220, 0.28)");
      bg.addColorStop(0.42, "rgba(38, 215, 172, 0.14)");
      bg.addColorStop(0.76, "rgba(24, 175, 138, 0.26)");
      bg.addColorStop(0.9, "rgba(82, 255, 212, 0.18)");
      bg.addColorStop(1, "rgba(12, 95, 76, 0)");
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(cx, cy, 240, 0, Math.PI * 2);
      ctx.fill();

      // Outer luminous jade ring
      ctx.strokeStyle = "rgba(150, 255, 230, 0.78)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(cx, cy, 206, 0, Math.PI * 2);
      ctx.stroke();

      // Secondary hairline ring
      ctx.strokeStyle = "rgba(90, 235, 198, 0.42)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, 194, 0, Math.PI * 2);
      ctx.stroke();

      // Delicate 64-dot pearl track along the outer rim
      const dots = 64;
      for (let i = 0; i < dots; i++) {
        const a = (i / dots) * Math.PI * 2;
        const dx = cx + Math.cos(a) * 200;
        const dy = cy + Math.sin(a) * 200;
        ctx.fillStyle = i % 2 === 0 ? "rgba(210, 255, 244, 0.7)" : "rgba(110, 245, 210, 0.35)";
        ctx.beginPath();
        ctx.arc(dx, dy, i % 8 === 0 ? 2.2 : 1.1, 0, Math.PI * 2);
        ctx.fill();
      }

      // 8 cardinal jade star-lantern nodes on the outer ring
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const nx = cx + Math.cos(a) * 206;
        const ny = cy + Math.sin(a) * 206;
        drawStarGem(ctx, nx, ny, 9, 2.6, "#ffffff", "rgba(72, 255, 210, 0.45)");
      }
    } else if (kind === "aura_wheel") {
      // Kim Cang Pháp Luân: Sovereign golden Dharma wheel with 8 faceted diamond rays
      const bg = ctx.createRadialGradient(cx, cy, 10, cx, cy, 244);
      bg.addColorStop(0, "rgba(255, 238, 170, 0.36)");
      bg.addColorStop(0.48, "rgba(245, 192, 78, 0.16)");
      bg.addColorStop(0.8, "rgba(255, 210, 96, 0.32)");
      bg.addColorStop(0.92, "rgba(255, 235, 160, 0.2)");
      bg.addColorStop(1, "rgba(180, 115, 20, 0)");
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(cx, cy, 244, 0, Math.PI * 2);
      ctx.fill();

      // Double outer rim
      ctx.strokeStyle = "rgba(255, 240, 185, 0.88)";
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(cx, cy, 212, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "rgba(255, 208, 105, 0.52)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(cx, cy, 198, 0, Math.PI * 2);
      ctx.stroke();

      // 8 slender tapered Vajra spokes (only between r = 112 and r = 212 so the center stays clean)
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);

        const spokeGrad = ctx.createLinearGradient(0, 108, 0, 212);
        spokeGrad.addColorStop(0, "rgba(255, 224, 130, 0.15)");
        spokeGrad.addColorStop(0.5, "rgba(255, 244, 195, 0.82)");
        spokeGrad.addColorStop(1, "rgba(255, 250, 220, 0.95)");
        ctx.fillStyle = spokeGrad;
        ctx.beginPath();
        ctx.moveTo(0, 108);
        ctx.lineTo(3.2, 165);
        ctx.lineTo(0, 212);
        ctx.lineTo(-3.2, 165);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        const gx = cx + Math.cos(a) * 212;
        const gy = cy + Math.sin(a) * 212;
        drawStarGem(ctx, gx, gy, 10, 3, "#ffffff", "rgba(255, 208, 84, 0.55)");
      }
    } else {
      // Liên Hoa Tịnh Quang (aura_lotus): Pure warm golden-ivory halo without any crude petal outlines
      const bg = ctx.createRadialGradient(cx, cy, 8, cx, cy, 240);
      bg.addColorStop(0, "rgba(255, 240, 190, 0.32)");
      bg.addColorStop(0.45, "rgba(245, 202, 112, 0.15)");
      bg.addColorStop(0.78, "rgba(255, 218, 136, 0.28)");
      bg.addColorStop(0.9, "rgba(255, 236, 182, 0.18)");
      bg.addColorStop(1, "rgba(190, 135, 45, 0)");
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(cx, cy, 240, 0, Math.PI * 2);
      ctx.fill();

      // Fine golden outer ring
      ctx.strokeStyle = "rgba(255, 238, 185, 0.8)";
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(cx, cy, 204, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "rgba(245, 206, 125, 0.42)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, 192, 0, Math.PI * 2);
      ctx.stroke();

      // 72-dot golden stardust track
      const dots = 72;
      for (let i = 0; i < dots; i++) {
        const a = (i / dots) * Math.PI * 2;
        const dx = cx + Math.cos(a) * 198;
        const dy = cy + Math.sin(a) * 198;
        ctx.fillStyle = i % 2 === 0 ? "rgba(255, 248, 220, 0.72)" : "rgba(245, 208, 128, 0.35)";
        ctx.beginPath();
        ctx.arc(dx, dy, i % 6 === 0 ? 2.0 : 1.0, 0, Math.PI * 2);
        ctx.fill();
      }

      // 12 delicate star-pearls around the golden rim
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const nx = cx + Math.cos(a) * 204;
        const ny = cy + Math.sin(a) * 204;
        drawStarGem(ctx, nx, ny, 7.5, 2.2, "#fffdf2", "rgba(255, 214, 102, 0.45)");
      }
    }
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAnisotropy();
  return tex;
}

/**
 * Draws the INNER counter-rotating ring texture (512×512) with a soft core glow
 * and a delicate stardust filigree ring for parallax depth.
 */
function drawInnerAuraTexture(kind: string): CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const cx = size / 2;
    const cy = size / 2;
    ctx.clearRect(0, 0, size, size);

    const isJade = kind === "aura_jade";
    const ringStroke = isJade ? "rgba(155, 255, 232, 0.58)" : "rgba(255, 238, 180, 0.62)";
    const dotFill = isJade ? "rgba(215, 255, 245, 0.78)" : "rgba(255, 250, 225, 0.82)";
    const glowFill = isJade ? "rgba(64, 245, 198, 0.4)" : "rgba(255, 208, 96, 0.42)";

    // Subtle inner ring at r = 148
    ctx.strokeStyle = ringStroke;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 148, 0, Math.PI * 2);
    ctx.stroke();

    // Inner dashed constellation ring at r = 136
    const segments = 36;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = a0 + (Math.PI / segments) * 0.85;
      ctx.strokeStyle = ringStroke;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(cx, cy, 136, a0, a1);
      ctx.stroke();
    }

    // 8 inner star nodes
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const nx = cx + Math.cos(a) * 148;
      const ny = cy + Math.sin(a) * 148;
      drawStarGem(ctx, nx, ny, 6.5, 1.8, dotFill, glowFill);
    }
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAnisotropy();
  return tex;
}

/** High-resolution harmonic soundwave ripple texture for woodblock strikes. */
function drawRippleTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const c = size / 2;

    // Soft radial wave band
    const grad = ctx.createRadialGradient(c, c, 48, c, c, 118);
    grad.addColorStop(0, "rgba(255, 255, 255, 0)");
    grad.addColorStop(0.55, "rgba(255, 255, 255, 0.18)");
    grad.addColorStop(0.85, "rgba(255, 255, 255, 0.55)");
    grad.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(c, c, 118, 0, Math.PI * 2);
    ctx.fill();

    // Crisp outer acoustic ring
    ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(c, c, 104, 0, Math.PI * 2);
    ctx.stroke();

    // Secondary harmonic echo ring
    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(c, c, 84, 0, Math.PI * 2);
    ctx.stroke();

    // 8 luminous nodes along the expanding soundwave
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      drawStarGem(
        ctx,
        c + Math.cos(a) * 104,
        c + Math.sin(a) * 104,
        6,
        1.8,
        "#ffffff",
        "rgba(255, 255, 255, 0.45)",
      );
    }
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = maxAnisotropy();
  return tex;
}

/**
 * 3D spiritual effects attached to the player's avatar root (`self.object`):
 * - Multi-layered Foot Aura (`aura_lotus`, `aura_jade`, `aura_wheel`) with counter-rotating filigree rings,
 *   rising 3D spirit motes, and orbiting 3D Jade/Golden Spirit Lamps (`Tâm Đăng` / `Bảo Châu`).
 * - Woodblock harmonic soundwave ripples (`woodblock_crimson`, `woodblock_jade`).
 */
export class SpiritualEffects {
  private readonly root = new Group();
  private readonly outerGeo = new PlaneGeometry(1.72, 1.72);
  private readonly innerGeo = new PlaneGeometry(1.26, 1.26);
  private readonly rippleGeo = new PlaneGeometry(1.15, 1.15);
  private readonly outerTextures = new Map<string, CanvasTexture>();
  private readonly innerTextures = new Map<string, CanvasTexture>();
  private readonly rippleTexture: CanvasTexture;
  private readonly radialTex: CanvasTexture;

  private readonly outerMat: MeshBasicMaterial;
  private readonly innerMat: MeshBasicMaterial;
  private readonly outerMesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly innerMesh: Mesh<PlaneGeometry, MeshBasicMaterial>;

  private readonly moteGeo: BufferGeometry;
  private readonly moteAttr: Float32BufferAttribute;
  private readonly moteMat: PointsMaterial;
  private readonly motePoints: Points;
  private readonly motes: MoteSlot[] = [];

  private readonly orbCoreGeo = new SphereGeometry(0.024, 12, 10);
  private readonly orbHaloGeo = new PlaneGeometry(0.22, 0.22);
  private readonly orbCoreMat: MeshBasicMaterial;
  private readonly orbHaloMat: MeshBasicMaterial;
  private readonly orbs: Group[] = [];

  private readonly ripples: RippleSlot[] = [];
  private currentAura: string | null = null;
  private currentArtifact: string | null = null;
  private phase = 0;

  constructor(avatarRoot: Object3D) {
    this.root.position.y = AURA_BASE_Y;
    avatarRoot.add(this.root);

    this.radialTex = radialTexture();

    // 1. Outer & Inner counter-rotating ground halo rings
    this.outerMat = new MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -10,
      polygonOffsetUnits: -10,
      side: DoubleSide,
    });
    this.outerMesh = new Mesh(this.outerGeo, this.outerMat);
    this.outerMesh.rotation.x = -Math.PI / 2;
    this.outerMesh.renderOrder = 3;
    this.outerMesh.visible = false;

    this.innerMat = new MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -11,
      polygonOffsetUnits: -11,
      side: DoubleSide,
    });
    this.innerMesh = new Mesh(this.innerGeo, this.innerMat);
    this.innerMesh.rotation.x = -Math.PI / 2;
    this.innerMesh.position.y = 0.002;
    this.innerMesh.renderOrder = 3;
    this.innerMesh.visible = false;

    this.root.add(this.outerMesh, this.innerMesh);

    // 2. Rising 3D spirit motes swirling gently around the novice
    const motePositions = new Float32Array(MOTE_COUNT * 3);
    this.moteGeo = new BufferGeometry();
    this.moteAttr = new Float32BufferAttribute(motePositions, 3);
    this.moteGeo.setAttribute("position", this.moteAttr);

    for (let i = 0; i < MOTE_COUNT; i++) {
      this.motes.push({
        angle: (i / MOTE_COUNT) * Math.PI * 2,
        radius: 0.34 + (i % 4) * 0.12,
        speed: 0.38 + (i % 3) * 0.14,
        riseSpeed: 0.24 + (i % 5) * 0.06,
        phase: i * 0.618,
      });
    }

    this.moteMat = new PointsMaterial({
      map: this.radialTex,
      color: new Color(0xffe484),
      size: 0.11,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      blending: AdditiveBlending,
      fog: false,
    });
    this.motePoints = new Points(this.moteGeo, this.moteMat);
    this.motePoints.renderOrder = 4;
    this.motePoints.frustumCulled = false;
    this.motePoints.visible = false;
    this.root.add(this.motePoints);

    // 3. Orbiting 3D Spirit Lamps / Pearls ("Tâm Đăng" for Bích Ngọc Tâm Đăng & Kim Cang Pháp Luân)
    this.orbCoreMat = new MeshBasicMaterial({
      color: new Color(0xe6fff7),
      transparent: true,
      opacity: 0.95,
    });
    this.orbHaloMat = new MeshBasicMaterial({
      map: this.radialTex,
      color: new Color(0x26e6b0),
      transparent: true,
      opacity: 0.75,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });

    for (let i = 0; i < MAX_ORBS; i++) {
      const orbGroup = new Group();
      const core = new Mesh(this.orbCoreGeo, this.orbCoreMat);
      const haloH = new Mesh(this.orbHaloGeo, this.orbHaloMat);
      haloH.rotation.x = -Math.PI / 2;
      const haloV = new Mesh(this.orbHaloGeo, this.orbHaloMat);
      core.renderOrder = 5;
      haloH.renderOrder = 4;
      haloV.renderOrder = 4;
      orbGroup.add(core, haloH, haloV);
      orbGroup.visible = false;
      this.root.add(orbGroup);
      this.orbs.push(orbGroup);
    }

    // 4. Woodblock soundwave ripple pool
    this.rippleTexture = drawRippleTexture();
    for (let i = 0; i < RIPPLE_POOL_SIZE; i++) {
      const mat = new MeshBasicMaterial({
        map: this.rippleTexture,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -12,
        polygonOffsetUnits: -12,
        side: DoubleSide,
      });
      const mesh = new Mesh(this.rippleGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = 0.008;
      mesh.renderOrder = 3;
      mesh.visible = false;
      this.root.add(mesh);
      this.ripples.push({ mesh, age: 0, active: false });
    }
  }

  setAura(auraId: string | null): void {
    if (this.currentAura === auraId) return;
    this.currentAura = auraId;
    if (!auraId) {
      this.outerMesh.visible = false;
      this.innerMesh.visible = false;
      this.motePoints.visible = false;
      for (const orb of this.orbs) orb.visible = false;
      return;
    }

    let outerTex = this.outerTextures.get(auraId);
    if (!outerTex) {
      outerTex = drawOuterAuraTexture(auraId);
      this.outerTextures.set(auraId, outerTex);
    }
    this.outerMat.map = outerTex;
    this.outerMat.needsUpdate = true;

    let innerTex = this.innerTextures.get(auraId);
    if (!innerTex) {
      innerTex = drawInnerAuraTexture(auraId);
      this.innerTextures.set(auraId, innerTex);
    }
    this.innerMat.map = innerTex;
    this.innerMat.needsUpdate = true;

    const theme = AURA_THEMES[auraId] ?? AURA_THEMES["aura_lotus"]!;
    this.moteMat.color.setHex(theme.moteColor);
    this.orbCoreMat.color.setHex(theme.orbCoreColor);
    this.orbHaloMat.color.setHex(theme.orbHaloColor);

    this.outerMesh.visible = true;
    this.innerMesh.visible = true;
    this.motePoints.visible = true;
    this.orbs.forEach((orb, idx) => {
      orb.visible = idx < theme.orbCount;
    });
  }

  setArtifact(artifactId: string | null): void {
    this.currentArtifact = artifactId;
  }

  /** Spawns an expanding 3D harmonic soundwave ring when tapping the woodblock. */
  triggerTap(): void {
    if (!this.currentArtifact) return;
    let slot = this.ripples.find((r) => !r.active);
    if (!slot) {
      slot = this.ripples[0];
    }
    if (!slot) return;
    slot.active = true;
    slot.age = 0;
    slot.mesh.visible = true;
    slot.mesh.scale.setScalar(0.38);
    slot.mesh.material.color.setHex(this.currentArtifact === "woodblock_jade" ? 0x52ffd1 : 0xffd466);
    slot.mesh.material.opacity = 0.88;
  }

  update(dt: number): void {
    this.phase += dt;
    if (this.outerMesh.visible && this.currentAura) {
      const theme = AURA_THEMES[this.currentAura] ?? AURA_THEMES["aura_lotus"]!;

      // Counter-rotating outer & inner sacred rings with gentle breathing pulse
      this.outerMesh.rotation.z = this.phase * theme.outerSpeed;
      this.innerMesh.rotation.z = this.phase * theme.innerSpeed;

      const breath = Math.sin(this.phase * 2.0);
      this.outerMesh.scale.setScalar(0.97 + breath * 0.035);
      this.innerMesh.scale.setScalar(1.0 - breath * 0.04);
      this.outerMat.opacity = 0.78 + breath * 0.12;
      this.innerMat.opacity = 0.72 - breath * 0.1;

      // Update rising 3D spirit motes
      for (let i = 0; i < MOTE_COUNT; i++) {
        const m = this.motes[i];
        if (!m) continue;
        const cycle = (this.phase * m.riseSpeed + m.phase) % 1;
        const a = m.angle + this.phase * m.speed;
        const r = m.radius + Math.sin(this.phase * 1.4 + i) * 0.05;
        const mx = Math.cos(a) * r;
        const mz = Math.sin(a) * r;
        const my = 0.02 + cycle * 0.72;
        this.moteAttr.setXYZ(i, mx, my, mz);
      }
      this.moteAttr.needsUpdate = true;
      this.moteMat.opacity = 0.62 + 0.18 * Math.sin(this.phase * 2.8);

      // Update orbiting 3D Spirit Lamps ("Tâm Đăng")
      const count = theme.orbCount;
      for (let i = 0; i < count; i++) {
        const orb = this.orbs[i];
        if (!orb) continue;
        const a = this.phase * 0.85 + (i / count) * Math.PI * 2;
        const r = 0.56 + 0.03 * Math.sin(this.phase * 1.8 + i);
        const oy = 0.24 + 0.07 * Math.sin(this.phase * 2.2 + i * 2.1);
        orb.position.set(Math.cos(a) * r, oy, Math.sin(a) * r);
        orb.rotation.y = -a;
        const sc = 0.92 + 0.14 * Math.sin(this.phase * 3.2 + i * 1.7);
        orb.scale.setScalar(sc);
      }
    }

    for (const r of this.ripples) {
      if (!r.active) continue;
      r.age += dt;
      const t = r.age / RIPPLE_DURATION_S;
      if (t >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const easeOut = 1 - Math.pow(1 - t, 2.4);
      const scale = 0.38 + easeOut * 1.95;
      r.mesh.scale.setScalar(scale);
      r.mesh.rotation.z = t * 0.35;
      r.mesh.material.opacity = (1 - t) * (1 - t) * 0.85;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.outerGeo.dispose();
    this.innerGeo.dispose();
    this.rippleGeo.dispose();
    this.moteGeo.dispose();
    this.orbCoreGeo.dispose();
    this.orbHaloGeo.dispose();
    this.outerMat.dispose();
    this.innerMat.dispose();
    this.moteMat.dispose();
    this.orbCoreMat.dispose();
    this.orbHaloMat.dispose();
    this.radialTex.dispose();
    for (const tex of this.outerTextures.values()) tex.dispose();
    for (const tex of this.innerTextures.values()) tex.dispose();
    this.outerTextures.clear();
    this.innerTextures.clear();
    this.rippleTexture.dispose();
    for (const r of this.ripples) r.mesh.material.dispose();
  }
}
