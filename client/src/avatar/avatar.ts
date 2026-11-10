import { Euler, MathUtils, Quaternion, Sphere, Vector3, type SkinnedMesh } from "three";
import { MOVE_SPEED, type Pose } from "@santinh/shared";
import type { MonkModel } from "./monk-model.ts";
import {
  HELLO_SECONDS,
  POSES,
  STRIDE_LENGTH,
  createBoneRotations,
  type BoneRotations,
  type PoseContext,
} from "./poses.ts";
import { BONE_NAMES, JOINT, type BoneName } from "./rig.ts";

export type GestureKind = "bowGreet" | "kinhHanh" | "gardenSit" | "blessing";

export const BLEND_SECONDS = 0.25;
/** Nodding off / waking up is slower than a pose change. */
export const SLEEP_BLEND_SECONDS = 1.2;
/** Duration of one rhythmic mallet strike onto the woodblock (seconds). */
const TAP_DURATION = 0.24;
/** Seconds the novice keeps holding the woodblock & mallet raised after the last tap. */
const WOODBLOCK_HOLD_SECONDS = 1.45;
/** Speed at which the arms raise/lower into the woodblock-holding posture. */
const HOLD_DAMP = 15;
/** Speed at which custom gestures blend in and out. */
const GESTURE_DAMP = 9;
/** Duration of the timed "Xá chào" deep bow greeting (seconds). */
const BOW_GREET_SECONDS = 2.6;
/** Duration of the timed "Chúc phúc" blessing gesture (seconds). */
const BLESSING_SECONDS = 2.8;
/** How fast the shown stride follows setMoving (1/s, for MathUtils.damp). */
const STRIDE_DAMP = 10;
/** Below this the cadence would look like slow motion; the stride shrinks instead. */
const MIN_CADENCE = 1.2;
/**
 * Covers every pose (standing head top, forehead + palms on the floor ahead when bowing).
 * The geometry's bind-pose sphere (r 0.6) misses the bowed head, so the avatar was culled at screen edges.
 */
const POSED_BOUNDS = new Sphere(new Vector3(0, 0.5, 0.15), 0.8);

const ARM_BONES: readonly BoneName[] = [
  "upper_arm.L",
  "forearm.L",
  "hand.L",
  "upper_arm.R",
  "forearm.R",
  "hand.R",
];

const LEFT_ARM_BONES: readonly BoneName[] = ["upper_arm.L", "forearm.L", "hand.L"];

const LEG_BONES: readonly BoneName[] = [
  "thigh.L",
  "shin.L",
  "foot.L",
  "thigh.R",
  "shin.R",
  "foot.R",
];

const tmpEuler = new Euler();
const tmpQuat = new Quaternion();

function setQuatEuler(x: number, y: number, z: number): Quaternion {
  return tmpQuat.setFromEuler(tmpEuler.set(x, y, z, "XYZ"));
}

export interface SetPoseOptions {
  /** Server ms the bow cycle started (kneel). Missing → the next update's `now`. */
  bowAt?: number;
}

/**
 * One novice on screen: drives the rig from the current procedural pose and
 * slerps from whatever was shown when the pose changes.
 */
export class Avatar {
  readonly model: MonkModel;
  private current: Pose = "walk";
  /** Where `hello` goes back to after HELLO_SECONDS. */
  private returnTo: Pose = "walk";
  private bowAt = 0;
  private bowAtPending = true;
  private t: number;
  private elapsed = 0;
  private targetSpeed = 0;
  /** Shown speed, eased towards targetSpeed. */
  private speed = 0;
  private walkPhase = 0;
  private blend = BLEND_SECONDS;
  private blendSeconds = BLEND_SECONDS;
  private dozing = false;
  private tapTimer = 0;
  private woodblockHold = 0;
  private holdWeight = 0;
  private activeGesture: GestureKind | null = null;
  private shownGesture: GestureKind | null = null;
  private gestureElapsed = 0;
  private gestureWeight = 0;

  private readonly from = createBoneRotations();
  private readonly target = createBoneRotations();
  private readonly shown = createBoneRotations();
  private readonly gestureRot = createBoneRotations();
  private readonly fromRoot = new Vector3();
  private readonly targetRoot = new Vector3();
  private readonly shownRoot = new Vector3();
  private readonly gestureRoot = new Vector3();
  private readonly ctx: PoseContext = { now: 0, bowAt: 0, elapsed: 0, stride: 0, walkPhase: 0, seated: false };
  private readonly gestureCtx: PoseContext = {
    now: 0,
    bowAt: 0,
    elapsed: HELLO_SECONDS * 0.5,
    stride: 0,
    walkPhase: 0,
    seated: false,
  };

  /** `clockOffset` (s) de-syncs breathing between people; the bow stays synced through bowAt. */
  constructor(model: MonkModel, clockOffset = 0) {
    this.model = model;
    this.t = clockOffset;
    model.mesh.boundingSphere = POSED_BOUNDS.clone();
  }

  get object(): SkinnedMesh {
    return this.model.mesh;
  }

  get pose(): Pose {
    return this.current;
  }

  get gesture(): GestureKind | null {
    return this.activeGesture;
  }

  /** True while seated in the outdoor meditation posture (`gardenSit`). */
  get sitting(): boolean {
    return this.shownGesture === "gardenSit" && this.gestureWeight > 0.35;
  }

  /** Updates the novice's robe colour in place while keeping the active skeleton and pose. */
  setColor(robeColor: string): void {
    this.model.setColor(robeColor);
    this.model.mesh.boundingSphere = POSED_BOUNDS.clone();
  }

  /** Activates or clears one of the 4 mindfulness gestures from button [5]. */
  setGesture(kind: GestureKind | null): void {
    if (kind !== null) {
      this.shownGesture = kind;
      this.gestureElapsed = 0;
      if (kind !== "gardenSit") {
        this.woodblockHold = 0;
        this.tapTimer = 0;
      }
    }
    this.activeGesture = kind;
  }

  /** Raises the woodblock in the left hand and strikes it with the mallet in the right hand. */
  tap(): void {
    if (this.activeGesture !== null && this.activeGesture !== "gardenSit") {
      this.activeGesture = null;
    }
    this.tapTimer = TAP_DURATION;
    this.woodblockHold = WOODBLOCK_HOLD_SECONDS;
    if (this.holdWeight < 0.45) this.holdWeight = 0.45;
  }

  setPose(pose: Pose, opts: SetPoseOptions = {}): void {
    if (pose === "hello" || pose === "beads" || pose === "kneel") {
      this.woodblockHold = 0;
      this.tapTimer = 0;
      this.activeGesture = null;
    }
    const kneeling = this.current === "kneel" || (this.current === "hello" && this.returnTo === "kneel");
    const bowMoved = opts.bowAt !== undefined && opts.bowAt !== this.bowAt;
    if (opts.bowAt !== undefined) {
      this.bowAt = opts.bowAt;
      this.bowAtPending = false;
    } else if (pose === "kneel" && !kneeling) {
      this.bowAtPending = true;
    }
    if (pose === "hello" && this.current !== "hello") this.returnTo = this.current;
    if (pose === this.current && pose !== "hello") {
      // A new bowAt jumps to another phase of the bow: ease into it instead of snapping.
      if (pose === "kneel" && bowMoved) this.startBlend();
      return;
    }
    this.current = pose;
    this.elapsed = 0;
    this.startBlend();
  }

  get asleep(): boolean {
    return this.dozing;
  }

  /** D25: dozes in seiza over whatever pose is set (standing → sits down where it is); waking goes back to it. */
  setAsleep(asleep: boolean): void {
    if (asleep === this.dozing) return;
    this.dozing = asleep;
    if (asleep) {
      this.woodblockHold = 0;
      this.tapTimer = 0;
      this.activeGesture = null;
    }
    this.startBlend(SLEEP_BLEND_SECONDS);
  }

  /** Ground speed in m/s (0 = standing). Only shows in the walk pose. */
  setMoving(speed: number): void {
    this.targetSpeed = Math.max(0, speed);
    if (this.targetSpeed > 0.05) {
      if (this.activeGesture === "gardenSit" || this.activeGesture === "bowGreet") {
        this.activeGesture = null;
      }
    }
  }

  update(dt: number, now: number): void {
    this.t += dt;
    this.elapsed += dt;
    if (this.bowAtPending) {
      this.bowAt = now;
      this.bowAtPending = false;
    }
    if (this.current === "hello" && this.elapsed >= HELLO_SECONDS) {
      this.current = this.returnTo;
      this.elapsed = 0;
      this.startBlend();
    }

    // Slow down stride cadence slightly during Kinh hành walking meditation for a serene pace.
    const effectiveSpeed = this.shownGesture === "kinhHanh" ? this.targetSpeed * 0.78 : this.targetSpeed;
    this.speed = MathUtils.damp(this.speed, this.current === "walk" ? effectiveSpeed : 0, STRIDE_DAMP, dt);
    const amount = MathUtils.clamp(this.speed / MOVE_SPEED, 0, 1);
    const cadence = Math.max(MIN_CADENCE, this.speed / STRIDE_LENGTH);
    this.walkPhase = (this.walkPhase + dt * cadence * Math.PI * 2) % (Math.PI * 2);

    const ctx = this.ctx;
    ctx.now = now;
    ctx.bowAt = this.bowAt;
    ctx.elapsed = this.elapsed;
    ctx.stride = amount;
    ctx.walkPhase = this.walkPhase;
    ctx.seated = this.current === "hello" && (this.returnTo === "kneel" || this.returnTo === "beads");
    POSES[this.dozing ? "sleep" : this.current](this.t, this.target, this.targetRoot, ctx);

    if (this.blend < this.blendSeconds) {
      this.blend = Math.min(this.blendSeconds, this.blend + dt);
      const w = MathUtils.smoothstep(this.blend / this.blendSeconds, 0, 1);
      for (const name of BONE_NAMES) this.shown[name].slerpQuaternions(this.from[name], this.target[name], w);
      this.shownRoot.lerpVectors(this.fromRoot, this.targetRoot, w);
    } else {
      copyRotations(this.target, this.shown);
      this.shownRoot.copy(this.targetRoot);
    }

    const bones = this.model.rig.bones;
    for (const name of BONE_NAMES) bones[name].quaternion.copy(this.shown[name]);
    bones.hips.position.copy(JOINT.hips).add(this.shownRoot);

    // 1. Custom Gesture Layer (Động tác [5]: Xá chào, Kinh hành, Tọa thiền, Chúc phúc).
    if (this.activeGesture !== null) {
      this.gestureElapsed += dt;
      if (this.activeGesture === "bowGreet" && this.gestureElapsed >= BOW_GREET_SECONDS) {
        this.activeGesture = null;
      } else if (this.activeGesture === "blessing" && this.gestureElapsed >= BLESSING_SECONDS) {
        this.activeGesture = null;
      }
    }

    const wantGesture = this.activeGesture !== null && !this.dozing && this.current === "walk" ? 1 : 0;
    this.gestureWeight = MathUtils.damp(this.gestureWeight, wantGesture, GESTURE_DAMP, dt);
    if (this.gestureWeight < 0.01 && wantGesture === 0) {
      this.gestureWeight = 0;
      this.shownGesture = null;
    }

    if (this.gestureWeight > 0 && this.shownGesture !== null) {
      const gw = this.gestureWeight;
      const breath = Math.sin(this.t * 2.0) * 0.018;

      // Sample canonical `POSES.hello` at peak clasp (elapsed = HELLO_SECONDS * 0.5) so both palms meet seamlessly.
      const gCtx = this.gestureCtx;
      gCtx.now = now;
      gCtx.bowAt = this.bowAt;
      gCtx.elapsed = HELLO_SECONDS * 0.5;
      gCtx.seated = this.shownGesture === "gardenSit";
      POSES.hello(this.t, this.gestureRot, this.gestureRoot, gCtx);

      if (this.shownGesture === "bowGreet") {
        // 3-phase reverent bow: smooth bow down (0..0.32), calm hold at bottom (0.32..0.68), smooth rise (0.68..1.0).
        const p = MathUtils.clamp(this.gestureElapsed / BOW_GREET_SECONDS, 0, 1);
        let bow = 0;
        if (p < 0.32) {
          bow = MathUtils.smoothstep(p, 0, 0.32);
        } else if (p < 0.68) {
          bow = 1 - 0.03 * Math.sin(((p - 0.32) / 0.36) * Math.PI);
        } else {
          bow = 1 - MathUtils.smoothstep(p, 0.68, 1.0);
        }

        // Exact clasped palms in front of the heart from POSES.hello.
        for (const b of ARM_BONES) {
          bones[b].quaternion.slerp(this.gestureRot[b], gw);
        }

        // Deep respectful waist + chest + head bow with natural knee softening and hip counterbalance.
        bones.spine.quaternion.slerp(setQuatEuler(0.32 * bow + breath * 0.4, 0, 0), gw);
        bones.chest.quaternion.slerp(setQuatEuler(0.44 * bow + breath * 0.6, 0, 0), gw);
        bones.head.quaternion.slerp(setQuatEuler(0.28 * bow, 0, 0), gw);
        bones["thigh.L"].quaternion.slerp(setQuatEuler(-0.12 * bow, 0, 0), gw);
        bones["thigh.R"].quaternion.slerp(setQuatEuler(-0.12 * bow, 0, 0), gw);
        bones["shin.L"].quaternion.slerp(setQuatEuler(0.22 * bow, 0, 0), gw);
        bones["shin.R"].quaternion.slerp(setQuatEuler(0.22 * bow, 0, 0), gw);
        bones.hips.position.y = MathUtils.lerp(bones.hips.position.y, JOINT.hips.y - 0.025 * bow, gw);
        bones.hips.position.z = MathUtils.lerp(bones.hips.position.z, -0.055 * bow, gw);
      } else if (this.shownGesture === "kinhHanh") {
        // Walking meditation: exact clasped palms from POSES.hello + gentle breathing and step sway while legs walk.
        for (const b of ARM_BONES) {
          bones[b].quaternion.slerp(this.gestureRot[b], gw);
        }
        const stepSway = Math.sin(this.walkPhase) * 0.035 * amount;
        bones["forearm.L"].rotateX((0.025 * Math.sin(this.t * 2.2) + Math.abs(stepSway) * 0.4) * gw);
        bones["forearm.R"].rotateX((0.025 * Math.sin(this.t * 2.2) + Math.abs(stepSway) * 0.4) * gw);
        bones.spine.quaternion.slerp(setQuatEuler(0.04 + breath * 0.5, stepSway * 0.6, stepSway * 0.3), gw);
        bones.chest.quaternion.slerp(setQuatEuler(0.06 + breath, stepSway, -stepSway * 0.3), gw);
        bones.head.quaternion.slerp(setQuatEuler(0.12 + breath * 0.3, -stepSway * 0.5, 0), gw);
      } else if (this.shownGesture === "gardenSit") {
        // Seated meditation in place: exact seated legs & root drop from POSES.hello(seated=true) + clasped mudra hands.
        for (const b of LEG_BONES) {
          bones[b].quaternion.slerp(this.gestureRot[b], gw);
        }
        for (const b of ARM_BONES) {
          bones[b].quaternion.slerp(this.gestureRot[b], gw);
        }
        // Lower the clasped hands slightly toward the lap for calm seated meditation while keeping palms touching.
        bones["upper_arm.L"].rotateX(0.2 * gw);
        bones["upper_arm.R"].rotateX(0.2 * gw);
        bones.hips.position.y = MathUtils.lerp(bones.hips.position.y, JOINT.hips.y + this.gestureRoot.y, gw);
        bones.hips.position.z = MathUtils.lerp(bones.hips.position.z, JOINT.hips.z + this.gestureRoot.z, gw);
        bones.spine.quaternion.slerp(setQuatEuler(0.03 + breath * 0.5, 0, 0), gw);
        bones.chest.quaternion.slerp(setQuatEuler(0.04 + breath, 0, 0), gw);
        bones.head.quaternion.slerp(setQuatEuler(0.12 + breath * 0.4, 0, 0), gw);
      } else if (this.shownGesture === "blessing") {
        // Joyful lotus blessing: left hand folded respectfully at the heart (from POSES.hello), right hand waving warmly.
        const p = MathUtils.clamp(this.gestureElapsed / BLESSING_SECONDS, 0, 1);
        const env = Math.sin(Math.min(1, p * 4) * (Math.PI * 0.5)) * Math.sin(Math.min(1, (1 - p) * 4) * (Math.PI * 0.5));
        const wave = Math.sin(this.gestureElapsed * 6.5) * env;
        const nod = Math.cos(this.gestureElapsed * 6.5) * env;

        for (const b of LEFT_ARM_BONES) {
          bones[b].quaternion.slerp(this.gestureRot[b], gw);
        }

        // Right arm raised comfortably to the right (-Z abduction) waving left-and-right with open palm.
        bones["upper_arm.R"].quaternion.slerp(setQuatEuler(-1.12 + 0.06 * nod, -0.22, -0.28 + 0.08 * wave), gw * env);
        bones["forearm.R"].quaternion.slerp(setQuatEuler(-1.05 + 0.08 * wave, 0.15, 0.26 * wave), gw * env);
        bones["hand.R"].quaternion.slerp(setQuatEuler(-0.15 + 0.12 * nod, 0, 0.32 * wave), gw * env);

        bones.spine.quaternion.slerp(setQuatEuler(0.03 + breath * 0.5, 0.05 * wave, 0.025 * wave), gw);
        bones.chest.quaternion.slerp(setQuatEuler(0.05 + breath, 0.08 * wave, 0.045 * wave), gw);
        bones.head.quaternion.slerp(setQuatEuler(0.08 + 0.04 * Math.abs(wave), 0.09 * wave, -0.07 * wave), gw);
        bones.hips.position.y = MathUtils.lerp(bones.hips.position.y, JOINT.hips.y - 0.012 * Math.abs(wave), gw);
      }
    }

    // 2. Woodblock holding & mallet striking layer.
    if (this.woodblockHold > 0) {
      this.woodblockHold = Math.max(0, this.woodblockHold - dt);
    }
    const wantHold = this.woodblockHold > 0 && !this.dozing && this.current !== "hello" && this.current !== "beads" ? 1 : 0;
    this.holdWeight = MathUtils.damp(this.holdWeight, wantHold, HOLD_DAMP, dt);
    if (this.holdWeight < 0.01 && wantHold === 0) {
      this.holdWeight = 0;
    }

    this.model.setWoodblockVisible?.(this.holdWeight > 0.06);

    if (this.holdWeight > 0) {
      let swing = 0;
      let recoil = 0;
      if (this.tapTimer > 0) {
        this.tapTimer = Math.max(0, this.tapTimer - dt);
        const phase = 1 - this.tapTimer / TAP_DURATION;
        // Phase 0..0.28: wind up slightly (-0.35) then snap down (+1.0) onto the woodblock; 0.28..1: smooth rebound back to 0.
        if (phase < 0.14) {
          swing = -(phase / 0.14) * 0.35;
        } else if (phase < 0.34) {
          swing = -0.35 + ((phase - 0.14) / 0.2) * 1.35;
        } else {
          swing = Math.cos(((phase - 0.34) / 0.66) * (Math.PI * 0.5));
        }
        recoil = phase >= 0.28 ? Math.sin(((phase - 0.28) / 0.72) * Math.PI) : 0;
      }

      const w = this.holdWeight;
      const breath = Math.sin(this.t * 2.1) * 0.015;

      // Keep torso upright and calm (even when seated on a cushion in "kneel" mode).
      bones.spine.quaternion.slerp(setQuatEuler(0.02 + breath * 0.5, 0, 0), w);
      bones.chest.quaternion.slerp(setQuatEuler(0.03 + breath + 0.012 * recoil, 0, 0), w);
      bones.head.quaternion.slerp(setQuatEuler(0.14 + 0.02 * recoil, 0, 0), w);
      if (this.current === "kneel") {
        bones.hips.quaternion.slerp(setQuatEuler(0, 0, 0), w);
        bones.hips.position.y = MathUtils.lerp(bones.hips.position.y, JOINT.hips.y - 0.26, w);
        bones.hips.position.z = MathUtils.lerp(bones.hips.position.z, 0, w);
      }

      // Left arm: reaches well forward (z ≈ 0.22 m, clear of the 0.163 m robe) cradling the woodblock in front of the chest.
      bones["upper_arm.L"].quaternion.slerp(setQuatEuler(-0.78, -0.15, -0.18), w);
      bones["forearm.L"].quaternion.slerp(setQuatEuler(-1.05 + 0.08 * recoil, 0.25, -0.36), w);
      bones["hand.L"].quaternion.slerp(setQuatEuler(0.08 + 0.12 * recoil, 0.05, -0.18), w);

      // Right arm: raised slightly higher and to the right, swinging the mallet down (-X pitch) and inward (+Z) onto the woodblock.
      bones["upper_arm.R"].quaternion.slerp(setQuatEuler(-0.82 + 0.14 * swing, 0.18, 0.22 - 0.1 * swing), w);
      bones["forearm.R"].quaternion.slerp(setQuatEuler(-1.18 + 0.42 * swing, -0.22, 0.16 + 0.35 * swing), w);
      bones["hand.R"].quaternion.slerp(setQuatEuler(-0.28 + 0.55 * swing, -0.12 * swing, -0.08 + 0.42 * swing), w);
    }
  }

  dispose(): void {
    this.model.dispose();
  }

  /** Freezes what is on screen now as the start of a new blend. */
  private startBlend(seconds = BLEND_SECONDS): void {
    copyRotations(this.shown, this.from);
    this.fromRoot.copy(this.shownRoot);
    this.blend = 0;
    this.blendSeconds = seconds;
  }
}

function copyRotations(src: BoneRotations, dst: BoneRotations): void {
  for (const name of BONE_NAMES) dst[name].copy(src[name]);
}
