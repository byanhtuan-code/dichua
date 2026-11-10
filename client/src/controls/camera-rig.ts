import { MathUtils, Raycaster, Vector2, Vector3, type PerspectiveCamera } from "three";
import { CAMERA, type SpaceDef, type Vec2, type Vec2Yaw } from "@santinh/shared";
import { cameraSolidsOf, type CameraSolids } from "../world/spaces.ts";
import { dampAngle } from "./movement.ts";

/** What the camera collides with: the space's walking surface plus its 3D solids. */
export interface CameraWorld {
  groundY(x: number, z: number): number;
  solids: CameraSolids;
}

export function cameraWorldOf(space: SpaceDef): CameraWorld {
  return { groundY: space.groundY, solids: cameraSolidsOf(space.id) };
}

/** Look-at point above the feet (chest of the novice). */
export const TARGET_HEIGHT = 1.0;
const MIN_PITCH = MathUtils.degToRad(CAMERA.minPitchDeg);
const MAX_PITCH = MathUtils.degToRad(CAMERA.maxPitchDeg);
/** Radians per dragged pixel. */
const ROTATE_SPEED = 0.006;
const FOLLOW_DAMP = 10;
/** Easing back out after a wall stopped pulling the camera in (pulling in is instant). */
const RELEASE_DAMP = 4;
/** Easing the camera behind a click walk; held off for a while after the user rotated by hand. */
const AUTO_YAW_DAMP = 1.2;
const AUTO_YAW_HOLD_S = 1.5;
/** Camera keeps this far from any wall / roof / ground surface. */
const CLEARANCE = 0.3;
const MIN_SHOWN_DISTANCE = 0.6;
const MARCH_STEP = 0.12;
const PICK_MAX_DISTANCE = 120;
const PICK_STEP = 0.08;

/** Solid for the camera: ground, hall walls, roof. */
export function cameraBlocked(world: CameraWorld, x: number, y: number, z: number): boolean {
  return y < world.groundY(x, z) + CLEARANCE || world.solids.blocksView(x, y, z, CLEARANCE);
}

/**
 * How far the camera may sit from (fx, fy, fz) along the unit direction (dx, dy, dz) before a wall,
 * the roof or the ground gets between it and the player.
 */
export function clearDistance(world: CameraWorld, fx: number, fy: number, fz: number, dx: number, dy: number, dz: number, max: number): number {
  for (let d = MARCH_STEP; d <= max; d += MARCH_STEP) {
    if (cameraBlocked(world, fx + dx * d, fy + dy * d, fz + dz * d)) return Math.max(MIN_SHOWN_DISTANCE, d - MARCH_STEP);
  }
  return max;
}

/**
 * First floor point along a ray, or null when a wall / roof / column / the sky comes first.
 * The world's collision lives in shared/ as 2D shapes, so the floor is marched analytically instead of
 * raycasting ~300k triangles of merged scenery.
 */
export function floorAlongRay(world: CameraWorld, origin: Vector3, dir: Vector3, max = PICK_MAX_DISTANCE): Vec2 | null {
  let prev = 0;
  for (let d = PICK_STEP; d <= max; d += PICK_STEP) {
    const x = origin.x + dir.x * d;
    const y = origin.y + dir.y * d;
    const z = origin.z + dir.z * d;
    if (y <= world.groundY(x, z)) {
      // Refine the crossing between the previous sample (above floor) and this one.
      let lo = prev;
      let hi = d;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        const mx = origin.x + dir.x * mid;
        const mz = origin.z + dir.z * mid;
        if (origin.y + dir.y * mid <= world.groundY(mx, mz)) hi = mid;
        else lo = mid;
      }
      return { x: origin.x + dir.x * hi, z: origin.z + dir.z * hi };
    }
    if (world.solids.blocksPick(x, y, z)) return null;
    prev = d;
  }
  return null;
}

const raycaster = new Raycaster();
const ndc = new Vector2();

/** Floor point under a screen pixel (client coordinates), or null. */
export function pickFloor(world: CameraWorld, camera: PerspectiveCamera, clientX: number, clientY: number, width: number, height: number): Vec2 | null {
  ndc.set((clientX / width) * 2 - 1, -(clientY / height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return floorAlongRay(world, raycaster.ray.origin, raycaster.ray.direction);
}

/**
 * Third-person camera (stack §3, no OrbitControls): follows behind the player with damping,
 * drag = yaw/pitch, wheel/pinch = zoom, pulls in when a wall or the roof would hide the player.
 */
export class CameraRig {
  /** Orbit yaw: the camera looks along (sin yaw, cos yaw) — same convention as Vec2Yaw. */
  yaw: number;
  pitch: number;
  distance: number = CAMERA.distance;
  private shown: number = CAMERA.distance;
  private readonly focus = new Vector3();
  private sinceManual = Infinity;

  constructor(
    private readonly camera: PerspectiveCamera,
    start: Vec2Yaw,
    private readonly world: CameraWorld,
  ) {
    this.yaw = start.yaw;
    this.pitch = MathUtils.clamp(Math.atan2(CAMERA.height - TARGET_HEIGHT, CAMERA.distance), MIN_PITCH, MAX_PITCH);
    this.snap(start.x, world.groundY(start.x, start.z), start.z);
  }

  readonly rotate = (dxPx: number, dyPx: number): void => {
    this.yaw -= dxPx * ROTATE_SPEED;
    this.pitch = MathUtils.clamp(this.pitch + dyPx * ROTATE_SPEED, MIN_PITCH, MAX_PITCH);
    this.sinceManual = 0;
  };

  /** factor > 1 moves away. */
  readonly zoom = (factor: number): void => {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.distance = MathUtils.clamp(this.distance * factor, CAMERA.minDistance, CAMERA.maxDistance);
  };

  /** Jump straight to the player (spawn, teleport) without easing. */
  snap(x: number, y: number, z: number): void {
    this.focus.set(x, y + TARGET_HEIGHT, z);
    this.shown = this.distance;
    this.place(0, true);
  }

  /** `followYaw` = heading to ease behind (click walk), null to leave the yaw to the user. */
  update(dt: number, x: number, y: number, z: number, followYaw: number | null): void {
    this.sinceManual += dt;
    const f = this.focus;
    f.x = MathUtils.damp(f.x, x, FOLLOW_DAMP, dt);
    f.y = MathUtils.damp(f.y, y + TARGET_HEIGHT, FOLLOW_DAMP, dt);
    f.z = MathUtils.damp(f.z, z, FOLLOW_DAMP, dt);
    if (followYaw !== null && this.sinceManual > AUTO_YAW_HOLD_S) this.yaw = dampAngle(this.yaw, followYaw, AUTO_YAW_DAMP, dt);
    this.place(dt, false);
  }

  private place(dt: number, instant: boolean): void {
    const cp = Math.cos(this.pitch);
    // Unit vector from the focus back to the camera.
    const bx = -Math.sin(this.yaw) * cp;
    const by = Math.sin(this.pitch);
    const bz = -Math.cos(this.yaw) * cp;
    const f = this.focus;
    const limit = clearDistance(this.world, f.x, f.y, f.z, bx, by, bz, this.distance);
    this.shown = instant || limit < this.shown ? limit : MathUtils.damp(this.shown, limit, RELEASE_DAMP, dt);
    this.camera.position.set(f.x + bx * this.shown, f.y + by * this.shown, f.z + bz * this.shown);
    this.camera.lookAt(f);
  }
}
