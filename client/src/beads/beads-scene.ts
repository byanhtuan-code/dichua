import {
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Quaternion,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { seeded } from "../world/random.ts";
import { BEADS_PER_ROUND } from "./counter.ts";

const SLOTS = BEADS_PER_ROUND + 1;
const STEP = (Math.PI * 2) / SLOTS;
const BEAD_R = 0.05;
/** Ring radius so neighbouring beads almost touch. */
const RING_R = (BEAD_R * 2.12 * SLOTS) / (Math.PI * 2);
/** Centre bead grows by this much; the bump fades out over one slot either side. */
const CENTRE_BOOST = 0.3;
/** Past the neighbours each slot shrinks this much, down to BEAD_MIN (design: near / far beads). */
const SHRINK_PER_SLOT = 0.1;
const BEAD_MIN = 0.55;
/** Guru bead length / width. */
const GURU_LENGTH = 1.4;
const FOV = 30;
const CAMERA_DIST = 3.1;
/** Looking from a little to the side shows the strand as a loop, the far side fading left. */
const CAMERA_SIDE = -0.38;
/** Per-second rate the ring eases toward the target slot (light inertia). */
const EASE_RATE = 11;
const PAPER_IN = "#f8f5ee";
const PAPER_OUT = "#e9e3d6";
const WOOD = new Color("#7a4a28");
const GURU = "#c4924a";
const GOLD = "#ac8241";

function paperTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(128, 115, 0, 128, 115, 180);
    grad.addColorStop(0, PAPER_IN);
    grad.addColorStop(1, PAPER_OUT);
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Signed angle of `slot` relative to the front of the ring, wrapped to (−π, π]. */
function relAngle(slot: number, pos: number): number {
  let a = ((slot - pos) * STEP) % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * The mala (T13): its own scene + camera drawn by the game's renderer while the bead screen is open.
 * 108 wooden beads (one InstancedMesh) on a vertical ring, an elongated guru bead in slot 0, the string,
 * and a gold ring marking the centre bead. Higher slots sit above the front, so counting pulls beads down.
 */
export class BeadsScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 20);
  private readonly beads: InstancedMesh;
  private readonly guru: Mesh;
  private readonly background: CanvasTexture;
  private readonly disposables: { dispose(): void }[] = [];
  private pos = 1;
  private target = 1;
  private drawn = Number.NaN;
  // Scratch objects: update() runs every frame.
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly s = new Vector3();
  private readonly axis = new Vector3(1, 0, 0);

  constructor() {
    this.background = paperTexture();
    this.scene.background = this.background;
    this.scene.fog = new Fog(PAPER_OUT, CAMERA_DIST + 0.2, CAMERA_DIST + RING_R * 2.1);

    this.scene.add(new HemisphereLight("#fff6e8", "#a88a68", 1.6));
    const key = new DirectionalLight("#ffe9cc", 2.4);
    key.position.set(-1.5, 2.5, RING_R + 3);
    this.scene.add(key);

    const beadGeo = new SphereGeometry(BEAD_R, 20, 14);
    const wood = new MeshStandardMaterial({ roughness: 0.42, metalness: 0 });
    this.beads = new InstancedMesh(beadGeo, wood, BEADS_PER_ROUND);
    const rand = seeded(108);
    const tint = new Color();
    for (let i = 0; i < BEADS_PER_ROUND; i++) {
      // Real wood beads differ a little in tone.
      tint.copy(WOOD).offsetHSL((rand() - 0.5) * 0.02, (rand() - 0.5) * 0.08, (rand() - 0.5) * 0.06);
      this.beads.setColorAt(i, tint);
    }
    this.beads.frustumCulled = false;
    this.scene.add(this.beads);

    const guruGeo = new SphereGeometry(BEAD_R * 0.95, 20, 14);
    const guruMat = new MeshStandardMaterial({
      color: GURU,
      roughness: 0.3,
      metalness: 0.05,
    });
    this.guru = new Mesh(guruGeo, guruMat);
    this.guru.scale.set(1, GURU_LENGTH, 1);
    this.scene.add(this.guru);

    const stringGeo = new TorusGeometry(RING_R, 0.004, 6, 360);
    const stringMat = new MeshStandardMaterial({
      color: "#6b4a2e",
      roughness: 0.8,
    });
    const string = new Mesh(stringGeo, stringMat);
    string.rotation.y = Math.PI / 2;
    this.scene.add(string);

    const haloGeo = new TorusGeometry(BEAD_R * (1 + CENTRE_BOOST) * 1.18, 0.0055, 8, 64);
    const haloMat = new MeshBasicMaterial({
      color: GOLD,
      transparent: true,
      opacity: 0.85,
      toneMapped: false,
    });
    const halo = new Mesh(haloGeo, haloMat);
    halo.position.set(0, 0, RING_R);
    this.scene.add(halo);

    this.camera.position.set(Math.sin(CAMERA_SIDE) * CAMERA_DIST, 0.05, RING_R + Math.cos(CAMERA_SIDE) * CAMERA_DIST);
    this.camera.lookAt(0, 0, RING_R);
    halo.quaternion.copy(this.camera.quaternion);

    this.disposables.push(beadGeo, wood, guruGeo, guruMat, stringGeo, stringMat, haloGeo, haloMat, this.background);
  }

  /** Slot to bring to the front (from `centreSlot`); `snap` skips the easing (screen just opened). */
  setTarget(slot: number, snap = false): void {
    this.target = slot;
    if (snap) this.pos = slot;
  }

  update(dt: number): void {
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    if (aspect !== this.camera.aspect) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    const gap = this.target - this.pos;
    this.pos = Math.abs(gap) < 1e-3 ? this.target : this.pos + gap * (1 - Math.exp(-EASE_RATE * dt));
    if (this.pos === this.drawn) return;
    this.drawn = this.pos;
    for (let i = 0; i < BEADS_PER_ROUND; i++) {
      this.place(relAngle(i + 1, this.pos));
      this.beads.setMatrixAt(i, this.m);
    }
    this.beads.instanceMatrix.needsUpdate = true;
    const a = relAngle(0, this.pos);
    this.guru.position.set(0, Math.sin(a) * RING_R, Math.cos(a) * RING_R);
    // Long axis along the string.
    this.guru.rotation.x = -a;
    // Half the centre boost: it is already longer and would push into its neighbours.
    const g = 1 + (this.boost(a) - 1) * 0.5;
    this.guru.scale.set(g, GURU_LENGTH * g, g);
  }

  dispose(): void {
    this.beads.dispose();
    for (const d of this.disposables) d.dispose();
    this.scene.clear();
  }

  private boost(a: number): number {
    const k = Math.abs(a) / STEP;
    if (k < 1) return 1 + CENTRE_BOOST * (1 - k);
    return Math.max(BEAD_MIN, 1 - SHRINK_PER_SLOT * (k - 1));
  }

  private place(a: number): void {
    this.v.set(0, Math.sin(a) * RING_R, Math.cos(a) * RING_R);
    this.q.setFromAxisAngle(this.axis, -a);
    const k = this.boost(a);
    this.s.set(k, k, k);
    this.m.compose(this.v, this.q, this.s);
  }
}
