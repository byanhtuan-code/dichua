import { Euler, MathUtils, Quaternion, Vector3 } from "three";
import { BOW_PERIOD_MS } from "@santinh/shared";
import { BONE_NAMES, JOINT, bindPosition, type BoneName } from "./rig.ts";

/** Local rotation of every bone (relative to its parent, bind pose = identity). */
export type BoneRotations = Record<BoneName, Quaternion>;

/**
 * `idle` is not a network pose: it is `walk` at speed 0, kept separate for the preview and tests.
 * `sleep` is not one either: it replaces whatever pose is set while the visitor is asleep (D25).
 */
export type PoseName = "idle" | "walk" | "kneel" | "beads" | "hello" | "sleep";

export interface PoseContext {
  /** Server clock, ms. */
  now: number;
  /** Server time (ms) the bow cycle started: same `bowAt` + `now` → same phase on every machine. */
  bowAt: number;
  /** Seconds since the pose started (hello envelope). */
  elapsed: number;
  /** 0..1 how much of a full stride the walk shows (0 = standing). */
  stride: number;
  /** Walk cycle angle, radians. */
  walkPhase: number;
  /** Hello while kneeling keeps the legs folded. */
  seated: boolean;
}

/** Writes every bone's local rotation into `out` and the hips offset from bind into `rootOffset`. t = seconds. */
export type PoseFn = (t: number, out: BoneRotations, rootOffset: Vector3, ctx: PoseContext) => void;

export const HELLO_SECONDS = 2;
/** One walk cycle (two steps) covers this many metres at full stride. */
export const STRIDE_LENGTH = 0.78;

export function createBoneRotations(): BoneRotations {
  const out = {} as BoneRotations;
  for (const name of BONE_NAMES) out[name] = new Quaternion();
  return out;
}

/** 0..1 through the one bow that started at `bowAt` (P3-D11: no repeat); 1 = done, kneeling upright. */
export function bowPhase(now: number, bowAt: number): number {
  return MathUtils.clamp((now - bowAt) / BOW_PERIOD_MS, 0, 1);
}

const smooth = (a: number, b: number, x: number): number => MathUtils.smoothstep(x, a, b);

/** How far down the bow is (0 upright … 1 forehead on the floor): pause, go down, stay, rise, pause. */
export function bowAmount(phase: number): number {
  return smooth(0.1, 0.4, phase) - smooth(0.6, 0.88, phase);
}

/** Hands leave the joined position a little before the torso goes down and come back a little after. */
function bowHands(phase: number): number {
  return smooth(0.08, 0.3, phase) - smooth(0.68, 0.92, phase);
}

// Scratch objects: poses run every frame for every avatar.
const euler = new Euler();
const v1 = new Vector3();
const v2 = new Vector3();
const v3 = new Vector3();
const v4 = new Vector3();
const q1 = new Quaternion();
const qa = new Quaternion();
const qb = new Quaternion();
const chestPos = new Vector3();
const chestRot = new Quaternion();

function rot(q: Quaternion, x: number, y = 0, z = 0): Quaternion {
  return q.setFromEuler(euler.set(x, y, z));
}

/** Multiplies an extra local rotation onto a bone. */
function addRot(q: Quaternion, x: number, y = 0, z = 0): void {
  q.multiply(q1.setFromEuler(euler.set(x, y, z)));
}

function reset(out: BoneRotations, rootOffset: Vector3): void {
  for (const name of BONE_NAMES) out[name].identity();
  rootOffset.set(0, 0, 0);
}

const SIDES = [1, -1] as const;
type Side = (typeof SIDES)[number];
const UPPER: Record<Side, BoneName> = { 1: "upper_arm.L", [-1]: "upper_arm.R" };
const FORE: Record<Side, BoneName> = { 1: "forearm.L", [-1]: "forearm.R" };
const HAND: Record<Side, BoneName> = { 1: "hand.L", [-1]: "hand.R" };
const THIGH: Record<Side, BoneName> = { 1: "thigh.L", [-1]: "thigh.R" };
const SHIN: Record<Side, BoneName> = { 1: "shin.L", [-1]: "shin.R" };
const FOOT: Record<Side, BoneName> = { 1: "foot.L", [-1]: "foot.R" };

// --- Two-bone arm aim -------------------------------------------------------------------------------

const DOWN = new Vector3(0, -1, 0);
const UPPER_LEN = JOINT.shoulder.y - JOINT.elbow.y;
const FORE_LEN = JOINT.elbow.y - JOINT.wrist.y;
const SPINE_OFFSET = bindPosition("spine").sub(bindPosition("hips"));
const CHEST_OFFSET = bindPosition("chest").sub(bindPosition("spine"));
const SHOULDER: Record<Side, Vector3> = {
  1: bindPosition("upper_arm.L").sub(bindPosition("chest")),
  [-1]: bindPosition("upper_arm.R").sub(bindPosition("chest")),
};

/**
 * Bends upper arm + forearm so the wrist reaches `target` (chest space), elbow pushed towards `pole`.
 * Out-of-reach targets get a nearly straight arm pointing at them.
 */
function aimArm(side: Side, target: Vector3, pole: Vector3, upper: Quaternion, fore: Quaternion): void {
  const toTarget = v1.copy(target).sub(SHOULDER[side]);
  const len = toTarget.length();
  const dir = toTarget.divideScalar(len || 1);
  const d = MathUtils.clamp(len, Math.abs(UPPER_LEN - FORE_LEN) + 1e-3, (UPPER_LEN + FORE_LEN) * 0.995);
  const cosA = MathUtils.clamp((UPPER_LEN ** 2 + d * d - FORE_LEN ** 2) / (2 * UPPER_LEN * d), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  const bendDir = v2.copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (bendDir.lengthSq() < 1e-8) bendDir.set(0, 0, -1);
  bendDir.normalize();
  const upperDir = v3.copy(dir).multiplyScalar(cosA).addScaledVector(bendDir, sinA);
  // Forearm: from the elbow to the (clamped) wrist point.
  const foreDir = v4
    .copy(dir)
    .multiplyScalar(d)
    .addScaledVector(upperDir, -UPPER_LEN)
    .normalize();
  upper.setFromUnitVectors(DOWN, upperDir);
  foreDir.applyQuaternion(q1.copy(upper).invert());
  fore.setFromUnitVectors(DOWN, foreDir);
}

/** Model-space position + rotation of the chest bone from the current hips/spine/chest rotations. */
function chestFrame(out: BoneRotations, rootOffset: Vector3): void {
  chestPos.copy(JOINT.hips).add(rootOffset);
  chestRot.copy(out.hips);
  chestPos.add(v1.copy(SPINE_OFFSET).applyQuaternion(chestRot));
  chestRot.multiply(out.spine);
  chestPos.add(v1.copy(CHEST_OFFSET).applyQuaternion(chestRot));
  chestRot.multiply(out.chest);
}

/** Converts a model-space point into the chest space chestFrame() last computed. */
function toChest(world: Vector3, target: Vector3): Vector3 {
  return target.copy(world).sub(chestPos).applyQuaternion(q1.copy(chestRot).invert());
}

// Wrists in front of the chin, palms together (chest space). Arms are short, so the elbows stay bent only a little.
const JOINED: Record<Side, Vector3> = { 1: new Vector3(0.035, 0.035, 0.165), [-1]: new Vector3(-0.035, 0.035, 0.165) };
const JOINED_POLE: Record<Side, Vector3> = { 1: new Vector3(1, -1, -0.4), [-1]: new Vector3(-1, -1, -0.4) };
// Beads held low in front of the chest: left hand cradles, right hand counts.
const BEADS: Record<Side, Vector3> = { 1: new Vector3(0.04, -0.03, 0.15), [-1]: new Vector3(-0.03, -0.01, 0.155) };
// Palms on the floor either side of the head at the bottom of the bow (model space, relative to the avatar origin).
const FLOOR_HANDS: Record<Side, Vector3> = { 1: new Vector3(0.2, 0.05, 0.38), [-1]: new Vector3(-0.2, 0.05, 0.38) };
const tmpTarget = new Vector3();
const tmpFloor = new Vector3();

function joinHands(out: BoneRotations, amount: number): void {
  for (const s of SIDES) {
    aimArm(s, JOINED[s], JOINED_POLE[s], qa, qb);
    out[UPPER[s]].slerp(qa, amount);
    out[FORE[s]].slerp(qb, amount);
    out[HAND[s]].slerp(rot(q1, -0.5, 0, -s * 0.5), amount);
  }
}

// --- Poses ------------------------------------------------------------------------------------------

const BREATH_PERIOD = 4.2;

/** Shared breathing + relaxed arms; every pose starts from it. */
function breathe(t: number, out: BoneRotations, rootOffset: Vector3): void {
  const breath = Math.sin((t * Math.PI * 2) / BREATH_PERIOD);
  rot(out.spine, 0.01 * breath);
  rot(out.chest, -0.015 * breath);
  rot(out.head, 0.04 + 0.015 * Math.sin(t * 0.5), 0.06 * Math.sin(t * 0.23));
  rootOffset.y = 0.004 * breath;
  for (const s of SIDES) {
    // Slightly away from the body so the sleeves do not sink into the robe.
    rot(out[UPPER[s]], 0.02 * breath, 0, s * (0.09 + 0.01 * breath));
    rot(out[FORE[s]], -0.14);
  }
}

export const idle: PoseFn = (t, out, rootOffset) => {
  reset(out, rootOffset);
  breathe(t, out, rootOffset);
};

export const walk: PoseFn = (t, out, rootOffset, ctx) => {
  idle(t, out, rootOffset, ctx);
  const s = MathUtils.clamp(ctx.stride, 0, 1);
  if (s === 0) return;
  const sin = Math.sin(ctx.walkPhase);
  const cos = Math.cos(ctx.walkPhase);
  for (const side of SIDES) {
    // Left leg forward when sin > 0 (a forward swing is a negative X rotation); the knee bends while it swings forward.
    const thigh = -0.6 * s * side * sin;
    const lift = Math.max(0, side * cos);
    const shin = s * (0.1 + 0.65 * lift);
    rot(out[THIGH[side]], thigh);
    rot(out[SHIN[side]], shin);
    rot(out[FOOT[side]], -0.6 * (thigh + shin) + 0.15 * s);
    // Arms swing against the legs.
    addRot(out[UPPER[side]], 0.35 * s * side * sin);
    addRot(out[FORE[side]], -0.25 * s);
  }
  addRot(out.hips, 0, 0.08 * s * sin);
  addRot(out.spine, 0.06 * s);
  addRot(out.chest, 0, -0.1 * s * sin);
  // Straight legs spread lower the hips: lowest at full spread, highest as they pass.
  rootOffset.y -= 0.035 * s * sin * sin;
};

// Seiza on the cushion: knee centres 6.6 cm up (shin radius), thighs tilted forward, shins flat behind.
const THIGH_KNEEL = -1.2;
const SHIN_KNEEL = Math.PI / 2 - THIGH_KNEEL;
const THIGH_LEN = JOINT.hip.y - JOINT.knee.y;
const KNEE_Y = 0.066;
const HIP_Y_KNEEL = KNEE_Y + THIGH_LEN * Math.cos(THIGH_KNEEL);
const KNEEL_DROP = HIP_Y_KNEEL - JOINT.hip.y;
/** Pulls the hips back so the folded body (knees forward) stays centred on the cushion. */
const KNEEL_BACK = -0.06;

function kneelLegs(out: BoneRotations, rootOffset: Vector3, hipPitch: number): void {
  for (const s of SIDES) {
    // The thighs undo the hips' pitch so the legs stay folded on the floor while the torso bows.
    rot(out[THIGH[s]], THIGH_KNEEL - hipPitch, 0, s * 0.08);
    rot(out[SHIN[s]], SHIN_KNEEL);
    rot(out[FOOT[s]], 1.25);
  }
  rootOffset.y += KNEEL_DROP;
  rootOffset.z += KNEEL_BACK;
}

export const kneel: PoseFn = (t, out, rootOffset, ctx) => {
  reset(out, rootOffset);
  breathe(t, out, rootOffset);
  const phase = bowPhase(ctx.now, ctx.bowAt);
  const b = bowAmount(phase);
  const hipPitch = 1.0 * b;
  rot(out.hips, hipPitch);
  addRot(out.spine, 0.3 * b);
  addRot(out.chest, 0.25 * b);
  rot(out.neck, 0.15 * b);
  addRot(out.head, 0.1 * b);
  kneelLegs(out, rootOffset, hipPitch);
  // The bum lifts off the heels as the body goes forward.
  rootOffset.y += 0.06 * b;
  rootOffset.z += 0.04 * b;

  joinHands(out, 1);
  const h = bowHands(phase);
  if (h > 0) {
    chestFrame(out, rootOffset);
    for (const s of SIDES) {
      toChest(tmpFloor.copy(FLOOR_HANDS[s]), tmpTarget);
      // Blend the target, not the rotations, so the hands travel in a straight-ish line to the floor.
      tmpTarget.lerp(JOINED[s], 1 - h);
      aimArm(s, tmpTarget, JOINED_POLE[s], out[UPPER[s]], out[FORE[s]]);
      out[HAND[s]].slerp(rot(q1, 0.9, 0, 0), h);
    }
  }
};

const COUNT_PERIOD = 1.6;

export const beads: PoseFn = (t, out, rootOffset) => {
  reset(out, rootOffset);
  breathe(t, out, rootOffset);
  kneelLegs(out, rootOffset, 0);
  addRot(out.chest, 0.08);
  rot(out.neck, 0.12);
  addRot(out.head, 0.18);
  for (const s of SIDES) {
    aimArm(s, BEADS[s], JOINED_POLE[s], out[UPPER[s]], out[FORE[s]]);
  }
  rot(out["hand.L"], -0.6, 0, -0.4);
  // Right thumb slides one bead per period: a short dip, then rest.
  const count = Math.max(0, Math.sin((t * Math.PI * 2) / COUNT_PERIOD)) ** 2;
  rot(out["hand.R"], -0.5 - 0.3 * count, 0, 0.4);
};

export const hello: PoseFn = (t, out, rootOffset, ctx) => {
  reset(out, rootOffset);
  breathe(t, out, rootOffset);
  if (ctx.seated) kneelLegs(out, rootOffset, 0);
  const el = ctx.elapsed;
  const fade = 1 - smooth(HELLO_SECONDS - 0.4, HELLO_SECONDS, el);
  const hands = smooth(0, 0.35, el) * fade;
  const nod = smooth(0.45, 0.8, el) * (1 - smooth(1.2, 1.6, el));
  addRot(out.spine, 0.15 * nod);
  addRot(out.chest, 0.3 * nod);
  rot(out.neck, 0.15 * nod);
  addRot(out.head, 0.2 * nod);
  joinHands(out, hands);
};

// Hands resting in the lap, a little lower than the beads.
const LAP: Record<Side, Vector3> = { 1: new Vector3(0.05, -0.09, 0.13), [-1]: new Vector3(-0.05, -0.09, 0.13) };
const DOZE_PERIOD = 7;

/** Dozing in seiza (D25): slight slump, head dipped and tilted, a slow nod now and then. */
export const sleep: PoseFn = (t, out, rootOffset) => {
  reset(out, rootOffset);
  breathe(t * 0.7, out, rootOffset);
  kneelLegs(out, rootOffset, 0);
  const nod = Math.max(0, Math.sin((t * Math.PI * 2) / DOZE_PERIOD)) ** 3;
  // The head is big: small angles already read as a drooping head; more looks like a bow.
  addRot(out.spine, 0.04);
  addRot(out.chest, 0.05 + 0.02 * nod);
  rot(out.neck, 0.14 + 0.04 * nod);
  addRot(out.head, 0.12 + 0.06 * nod, 0, 0.2);
  for (const s of SIDES) {
    aimArm(s, LAP[s], JOINED_POLE[s], out[UPPER[s]], out[FORE[s]]);
    rot(out[HAND[s]], -0.3, 0, -s * 0.3);
  }
};

export const POSES: Readonly<Record<PoseName, PoseFn>> = { idle, walk, kneel, beads, hello, sleep };
