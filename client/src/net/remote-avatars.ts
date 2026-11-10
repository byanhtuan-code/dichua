import type { Object3D } from "three";
import { BOW_PERIOD_MS, CUSHION_TOP, type Circle, type SpaceDef, type Pose, type Visitor, type VisitorEvent } from "@santinh/shared";
import { Avatar } from "../avatar/avatar.ts";
import type { ContactShadows } from "../avatar/contact-shadow.ts";
import type { MonkFactory } from "../avatar/monk-model.ts";
import type { RoomSnapshot, VisitorsUpdate } from "./net-driver.ts";

/** Others are drawn this far in the past so there are two snapshots to blend (stack §6). */
export const INTERP_DELAY_MS = 150;
/** No news for this long → stand still on the last known spot. */
export const STALE_MS = 1000;
/** Legs keep walking while we wait this long for the next sample (hides the gap between 5 Hz ticks). */
const HOLD_WALK_MS = 250;
const BUFFER_SIZE = 8;
/** Distance jump (metres) above which a remote walker snaps instead of gliding through walls. */
const SNAP_DISTANCE = 4;
/** Seated people block the floor for walkers (Movement.setObstacles). */
export const SEATED_RADIUS = 0.4;
/** Events older than this are dropped (stack §6). */
export const EVENT_MAX_AGE_MS = 10_000;
const KNEEL_SHADOW = 1.15;

export interface Sample {
  t: number;
  x: number;
  z: number;
  yaw: number;
}

/** Fixed-size, time-ordered position history of one person (no allocation after construction). */
export class SampleBuffer {
  private readonly items: Sample[] = Array.from({ length: BUFFER_SIZE }, () => ({ t: 0, x: 0, z: 0, yaw: 0 }));
  private n = 0;

  get size(): number {
    return this.n;
  }

  get lastTime(): number {
    return this.n > 0 ? (this.items[this.n - 1]?.t ?? -Infinity) : -Infinity;
  }

  /** Last recorded sample, or undefined when empty. */
  get lastSample(): Readonly<Sample> | undefined {
    return this.n > 0 ? this.items[this.n - 1] : undefined;
  }

  clear(): void {
    this.n = 0;
  }

  push(t: number, x: number, z: number, yaw: number): void {
    if (this.n > 0 && t < this.lastTime) return;
    let slot: Sample | undefined;
    if (this.n > 0 && t === this.lastTime) slot = this.items[this.n - 1];
    else if (this.n < BUFFER_SIZE) slot = this.items[this.n++];
    else {
      // Full: recycle the oldest slot as the newest.
      const first = this.items.shift();
      if (!first) return;
      this.items.push(first);
      slot = first;
    }
    if (!slot) return;
    slot.t = t;
    slot.x = x;
    slot.z = z;
    slot.yaw = yaw;
  }

  /** Writes the blended position at time `rt` into `out`; returns ground speed (m/s). No extrapolation. */
  sample(rt: number, out: Sample): number {
    const items = this.items;
    const n = this.n;
    const first = items[0];
    const last = items[n - 1];
    if (!first || !last || n === 0) return 0;
    if (rt <= first.t || n === 1) {
      copySample(first, out);
      return 0;
    }
    if (rt >= last.t) {
      copySample(last, out);
      const prev = items[n - 2];
      if (!prev || rt - last.t > HOLD_WALK_MS) return 0;
      return segmentSpeed(prev, last);
    }
    for (let i = 1; i < n; i++) {
      const b = items[i];
      const a = items[i - 1];
      if (!a || !b || rt > b.t) continue;
      const w = (rt - a.t) / (b.t - a.t);
      out.t = rt;
      out.x = a.x + (b.x - a.x) * w;
      out.z = a.z + (b.z - a.z) * w;
      out.yaw = a.yaw + Math.atan2(Math.sin(b.yaw - a.yaw), Math.cos(b.yaw - a.yaw)) * w;
      return segmentSpeed(a, b);
    }
    copySample(last, out);
    return 0;
  }
}

function copySample(src: Sample, dst: Sample): void {
  dst.t = src.t;
  dst.x = src.x;
  dst.z = src.z;
  dst.yaw = src.yaw;
}

function segmentSpeed(a: Sample, b: Sample): number {
  const dt = (b.t - a.t) / 1000;
  return dt > 0 ? Math.hypot(b.x - a.x, b.z - a.z) / dt : 0;
}

/** Drops repeated (same eventId) and stale events. */
export class EventFilter {
  private readonly seen = new Map<string, number>();

  accept(e: VisitorEvent, serverNow: number): boolean {
    if (serverNow - e.at > EVENT_MAX_AGE_MS || this.seen.has(e.eventId)) return false;
    this.seen.set(e.eventId, e.at);
    // Anything older than the age limit would be rejected anyway: forget it.
    for (const [id, at] of this.seen) if (serverNow - at > EVENT_MAX_AGE_MS) this.seen.delete(id);
    return true;
  }
}

interface Remote {
  visitor: Visitor;
  avatar: Avatar;
  buffer: SampleBuffer;
  /** Last pose / bowAt applied from the network (the avatar may already show a later one, e.g. after hello). */
  netPose: Pose;
  netBowAt: number | undefined;
  /** Accumulated dt for half-rate breathing skeleton updates on stationary/seated avatars. */
  pendingDt: number;
  dirtyPose: boolean;
}

/** Breathing phase per person so a room does not breathe as one. */
function phaseOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 100;
}

/**
 * Everyone but us: one LOD avatar per visitor id, positions blended from the snapshot buffer
 * INTERP_DELAY_MS in the past. Residents (NPC) just kneel on their cushion.
 */
export class RemoteAvatars {
  private readonly remotes = new Map<string, Remote>();
  private selfId: string | null = null;
  private obstacleList: Circle[] = [];
  private readonly scratch: Sample = { t: 0, x: 0, z: 0, yaw: 0 };
  private changeListener: (() => void) | null = null;
  private frameParity = 0;

  constructor(
    private readonly parent: Object3D,
    private readonly factory: MonkFactory,
    private readonly contacts: ContactShadows,
    private readonly space: SpaceDef,
    /** First contact-shadow slot (0 is ours). */
    private readonly firstSlot = 1,
  ) {}

  /** Called after the set of people, their seats or their names changed (labels, obstacles, head count). */
  onChange(fn: () => void): void {
    this.changeListener = fn;
  }

  /** People in the room who are real visitors (us included, residents not). */
  get realCount(): number {
    let n = this.selfId ? 1 : 0;
    for (const r of this.remotes.values()) if (!isResident(r.visitor)) n++;
    return n;
  }

  get obstacles(): readonly Circle[] {
    return this.obstacleList;
  }

  /** `kneeling`: on a cushion or dozing on the floor (both sit in seiza). */
  forEach(fn: (id: string, name: string, object: Object3D, kneeling: boolean, asleep: boolean) => void): void {
    for (const r of this.remotes.values()) {
      const asleep = r.visitor.asleep === true;
      fn(r.visitor.id, r.visitor.name, r.avatar.object, r.visitor.cushion !== null || asleep, asleep);
    }
  }

  nameOf(id: string): string | null {
    return this.remotes.get(id)?.visitor.name ?? null;
  }

  /** A `hello` event: show the greeting even if no pose update carries it. */
  greet(id: string): void {
    const r = this.remotes.get(id);
    if (r && r.avatar.pose !== "hello") {
      r.avatar.setPose("hello");
      r.dirtyPose = true;
    }
  }

  /** A `bead` event while not in the beads screen pose: show the 3D woodblock tap on this visitor. */
  tap(id: string): boolean {
    const r = this.remotes.get(id);
    if (!r || r.visitor.asleep === true || r.avatar.pose === "beads") return false;
    r.avatar.tap();
    r.dirtyPose = true;
    return r.avatar.object.visible && r.avatar.object.parent !== null;
  }

  applySnapshot(s: RoomSnapshot): void {
    this.clear();
    this.selfId = s.selfId;
    for (const v of s.visitors) if (v.id !== s.selfId) this.upsert(v, s.serverTime);
    this.changed();
  }

  applyUpdate(u: VisitorsUpdate): void {
    let structural = u.removed.length > 0;
    for (const id of u.removed) this.remove(id);
    for (const v of u.visitors) {
      if (v.id === this.selfId) continue;
      const before = this.remotes.get(v.id);
      if (needsRefresh(before?.visitor, v)) structural = true;
      this.upsert(v, u.serverTime);
    }
    if (structural) this.changed();
  }

  /** Per frame: blend positions, drive poses, place contact shadows. */
  update(dt: number, serverNow: number): void {
    this.frameParity = (this.frameParity + 1) & 1;
    const rt = serverNow - INTERP_DELAY_MS;
    const s = this.scratch;
    let slot = this.firstSlot;
    let idx = 0;

    for (const r of this.remotes.values()) {
      const obj = r.avatar.object;
      let y: number;
      let speed = 0;
      if (r.visitor.cushion !== null) {
        y = CUSHION_TOP;
        r.avatar.setMoving(0);
      } else {
        const stale = serverNow - r.buffer.lastTime > STALE_MS;
        speed = r.buffer.sample(stale ? Infinity : rt, s);
        obj.position.x = s.x;
        obj.position.z = s.z;
        obj.rotation.y = s.yaw;
        y = this.space.groundY(s.x, s.z);
        r.avatar.setMoving(stale ? 0 : speed);
      }
      obj.position.y = y;

      // Full-rate skeleton evaluation for walking/bowing/greeting avatars;
      // half-rate staggered evaluation for stationary/seated breathing avatars to save mobile CPU.
      const bowActive =
        r.visitor.bowAt !== undefined && serverNow - r.visitor.bowAt <= BOW_PERIOD_MS + 600;
      const highPriority =
        r.dirtyPose || speed > 0.01 || bowActive || r.avatar.pose === "hello";

      r.pendingDt += dt;
      if (highPriority || (idx & 1) === this.frameParity) {
        r.avatar.update(r.pendingDt, serverNow);
        r.pendingDt = 0;
        r.dirtyPose = false;
      }

      this.contacts.place(slot++, obj.position.x, y, obj.position.z, r.visitor.cushion !== null ? KNEEL_SHADOW : 1);
      idx++;
    }
    this.contacts.setCount(slot);
  }

  clear(): void {
    for (const id of [...this.remotes.keys()]) this.remove(id);
    this.selfId = null;
    this.contacts.setCount(this.firstSlot);
  }

  dispose(): void {
    this.clear();
    this.changeListener = null;
  }

  private upsert(v: Visitor, serverTime: number): void {
    let r = this.remotes.get(v.id);
    if (!r) {
      const avatar = new Avatar(this.factory.create(v.color, "remote"), phaseOf(v.id));
      this.parent.add(avatar.object);
      r = {
        visitor: v,
        avatar,
        buffer: new SampleBuffer(),
        netPose: "walk",
        netBowAt: undefined,
        pendingDt: 0,
        dirtyPose: true,
      };
      this.remotes.set(v.id, r);
      r.avatar.setPose(v.pose, v.bowAt === undefined ? {} : { bowAt: v.bowAt });
      r.netPose = v.pose;
      r.netBowAt = v.bowAt;
    } else {
      if (v.color !== r.visitor.color) r.avatar.setColor(v.color);
      if (v.pose !== r.netPose || v.bowAt !== r.netBowAt) {
        r.avatar.setPose(v.pose, v.bowAt === undefined ? {} : { bowAt: v.bowAt });
        r.netPose = v.pose;
        r.netBowAt = v.bowAt;
        r.dirtyPose = true;
      }
    }
    if (Boolean(r.visitor.asleep) !== Boolean(v.asleep)) {
      r.dirtyPose = true;
    }
    r.visitor = v;
    r.avatar.setAsleep(v.asleep === true);

    if (v.cushion !== null) {
      const c = this.space.cushions[v.cushion] ?? v.position;
      r.buffer.clear();
      r.buffer.push(serverTime, c.x, c.z, c.yaw);
      const obj = r.avatar.object;
      obj.position.set(c.x, CUSHION_TOP, c.z);
      obj.rotation.y = c.yaw;
    } else {
      const prev = r.buffer.lastSample;
      if (
        prev &&
        (serverTime - prev.t > STALE_MS || Math.hypot(v.position.x - prev.x, v.position.z - prev.z) > SNAP_DISTANCE)
      ) {
        r.buffer.clear();
      }
      r.buffer.push(serverTime, v.position.x, v.position.z, v.position.yaw);
    }
  }

  private remove(id: string): void {
    const r = this.remotes.get(id);
    if (!r) return;
    r.avatar.dispose();
    this.remotes.delete(id);
  }

  private changed(): void {
    const list: Circle[] = [];
    for (const r of this.remotes.values()) {
      if (r.visitor.cushion === null) continue;
      const c = this.space.cushions[r.visitor.cushion];
      if (!c) continue;
      list.push({ x: c.x, z: c.z, r: SEATED_RADIUS });
    }
    this.obstacleList = list;
    this.changeListener?.();
  }
}

/** A delta that changes what `onChange` listeners show: someone new, a seat taken / left, a rename or dozing (labels). */
export function needsRefresh(before: Visitor | undefined, next: Visitor): boolean {
  return !before || before.cushion !== next.cushion || before.name !== next.name || Boolean(before.asleep) !== Boolean(next.asleep);
}

function isResident(v: Visitor): boolean {
  return v.id.startsWith("resident:");
}

/** Label height above the feet: head top + a little air. */
export function labelHeight(kneeling: boolean): number {
  return kneeling ? 1.05 : 1.32;
}
