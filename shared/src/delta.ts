import { isFiniteNumber, isRecord } from "./guards.ts";
import { WIRE_POSES } from "./protocol.ts";
import type { Pose } from "./types.ts";

/** "STN1" read as a little-endian u32. */
export const DELTA_MAGIC = 0x53544e31;
export const DELTA_HEADER_BYTES = 28;
/** Record without bowAt; +8 when it has one. */
export const DELTA_RECORD_BYTES = 30;
/** Record byte 5. */
const FLAG_BOW = 1;
const FLAG_ASLEEP = 2;

/** First sight of a visitor in a frame: binds `slot` to who it is. */
export interface WireProfile {
  slot: number;
  id: string;
  name: string;
  color: string;
  joinedAt: number;
}

export interface DeltaRecord {
  slot: number;
  cushion: number | null;
  pose: Pose;
  x: number;
  z: number;
  yaw: number;
  bowAt?: number;
  /** Missing = awake. */
  asleep?: boolean;
}

export interface DeltaFrame {
  revision: number;
  serverTime: number;
  room: string;
  profiles: WireProfile[];
  removed: string[];
  records: DeltaRecord[];
}

// shared/ has no DOM / Node typings; both runtimes have these globals.
interface Utf8 {
  encode(text: string): Uint8Array;
  decode(bytes: Uint8Array): string;
}
const runtime = globalThis as unknown as {
  TextEncoder: new () => { encode(text: string): Uint8Array };
  TextDecoder: new (label: string, opts: { fatal: boolean }) => { decode(bytes: Uint8Array): string };
};
let utf8: Utf8 | null = null;
function text(): Utf8 {
  if (!utf8) {
    const enc = new runtime.TextEncoder();
    // fatal: broken UTF-8 throws → the frame is rejected instead of decoding to U+FFFD.
    const dec = new runtime.TextDecoder("utf-8", { fatal: true });
    utf8 = { encode: (s) => enc.encode(s), decode: (b) => dec.decode(b) };
  }
  return utf8;
}

function isU16(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 0xffff;
}

/**
 * Throws RangeError on values the layout cannot hold or the decoder would reject (NaN, Infinity):
 * that is a server bug and must fail loudly here, not as a frame every client silently drops.
 */
export function encodeDelta(frame: DeltaFrame): ArrayBuffer {
  const { records } = frame;
  if (!isU16(records.length)) throw new RangeError(`records ${records.length}`);
  if (!Number.isSafeInteger(frame.revision) || !isFiniteNumber(frame.serverTime)) throw new RangeError("revision / serverTime");
  // The JSON head gets the decoder's own checks too: a frame every client would drop must fail here instead.
  if (typeof frame.room !== "string" || !frame.removed.every((id) => typeof id === "string")) throw new RangeError("room / removed");
  for (const p of frame.profiles) if (!readProfile(p)) throw new RangeError(`profile slot ${p.slot}`);
  const unique = (slots: number[]): boolean => new Set(slots).size === slots.length;
  if (!unique(frame.profiles.map((p) => p.slot)) || !unique(records.map((r) => r.slot))) throw new RangeError("duplicate slot");
  const json = text().encode(JSON.stringify({ room: frame.room, profiles: frame.profiles, removed: frame.removed }));
  let size = DELTA_HEADER_BYTES + json.length;
  for (const r of records) size += DELTA_RECORD_BYTES + (r.bowAt === undefined ? 0 : 8);

  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  view.setUint32(0, DELTA_MAGIC, true);
  view.setUint32(4, json.length, true);
  view.setUint16(8, records.length, true);
  view.setFloat64(10, frame.revision, true);
  view.setFloat64(18, frame.serverTime, true);
  view.setUint16(26, 0, true);
  new Uint8Array(buf, DELTA_HEADER_BYTES, json.length).set(json);

  let o = DELTA_HEADER_BYTES + json.length;
  for (const r of records) {
    const pose = WIRE_POSES.indexOf(r.pose);
    const cushion = r.cushion ?? -1;
    if (!isU16(r.slot) || pose < 0 || !Number.isInteger(cushion) || cushion < -1 || cushion > 0x7fff) {
      throw new RangeError(`record slot ${r.slot}`);
    }
    if (!isFiniteNumber(r.x) || !isFiniteNumber(r.z) || !isFiniteNumber(r.yaw) || (r.bowAt !== undefined && !isFiniteNumber(r.bowAt))) {
      throw new RangeError(`record slot ${r.slot}: non-finite number`);
    }
    view.setUint16(o, r.slot, true);
    view.setInt16(o + 2, cushion, true);
    view.setUint8(o + 4, pose);
    view.setUint8(o + 5, (r.bowAt === undefined ? 0 : FLAG_BOW) | (r.asleep ? FLAG_ASLEEP : 0));
    view.setFloat64(o + 6, r.x, true);
    view.setFloat64(o + 14, r.z, true);
    view.setFloat64(o + 22, r.yaw, true);
    o += DELTA_RECORD_BYTES;
    if (r.bowAt !== undefined) {
      view.setFloat64(o, r.bowAt, true);
      o += 8;
    }
  }
  return buf;
}

function readProfile(v: unknown): WireProfile | null {
  if (!isRecord(v)) return null;
  const { slot, id, name, color, joinedAt } = v;
  if (typeof slot !== "number" || !isU16(slot) || typeof id !== "string" || typeof name !== "string") return null;
  if (typeof color !== "string" || !isFiniteNumber(joinedAt)) return null;
  return { slot, id, name, color, joinedAt };
}

/**
 * Anything that is not a well-formed STN1 frame (wrong magic, short / long buffer, bad JSON or fields) → null.
 * Takes views too: a Node `Buffer` from `ws` is a slice of a shared pool, so `buf.buffer` would read other data.
 */
export function decodeDelta(input: ArrayBuffer | ArrayBufferView): DeltaFrame | null {
  const view = ArrayBuffer.isView(input)
    ? new DataView(input.buffer, input.byteOffset, input.byteLength)
    : new DataView(input);
  const size = view.byteLength;
  if (size < DELTA_HEADER_BYTES) return null;
  if (view.getUint32(0, true) !== DELTA_MAGIC) return null;
  const jsonLen = view.getUint32(4, true);
  const count = view.getUint16(8, true);
  const revision = view.getFloat64(10, true);
  const serverTime = view.getFloat64(18, true);
  // The client orders frames by `revision === last + 1`: a fraction or an imprecise float would loop it on sync.
  if (!Number.isSafeInteger(revision) || !isFiniteNumber(serverTime)) return null;
  if (DELTA_HEADER_BYTES + jsonLen + count * DELTA_RECORD_BYTES > size) return null;

  let head: unknown;
  try {
    head = JSON.parse(text().decode(new Uint8Array(view.buffer, view.byteOffset + DELTA_HEADER_BYTES, jsonLen)));
  } catch {
    return null;
  }
  if (!isRecord(head) || typeof head["room"] !== "string") return null;
  const rawProfiles = head["profiles"];
  const rawRemoved = head["removed"];
  if (!Array.isArray(rawProfiles) || !Array.isArray(rawRemoved)) return null;
  const profiles: WireProfile[] = [];
  for (const p of rawProfiles) {
    const profile = readProfile(p);
    if (!profile) return null;
    profiles.push(profile);
  }
  if (!rawRemoved.every((id) => typeof id === "string")) return null;
  const removed = rawRemoved as string[];

  const records: DeltaRecord[] = [];
  let o = DELTA_HEADER_BYTES + jsonLen;
  for (let i = 0; i < count; i++) {
    if (o + DELTA_RECORD_BYTES > size) return null;
    const slot = view.getUint16(o, true);
    const cushion = view.getInt16(o + 2, true);
    const pose = WIRE_POSES[view.getUint8(o + 4)];
    const flags = view.getUint8(o + 5);
    const x = view.getFloat64(o + 6, true);
    const z = view.getFloat64(o + 14, true);
    const yaw = view.getFloat64(o + 22, true);
    o += DELTA_RECORD_BYTES;
    if (pose === undefined || flags > (FLAG_BOW | FLAG_ASLEEP) || cushion < -1 || !isFiniteNumber(x) || !isFiniteNumber(z) || !isFiniteNumber(yaw)) return null;
    const record: DeltaRecord = { slot, cushion: cushion === -1 ? null : cushion, pose, x, z, yaw };
    if (flags & FLAG_ASLEEP) record.asleep = true;
    if (flags & FLAG_BOW) {
      if (o + 8 > size) return null;
      const bowAt = view.getFloat64(o, true);
      o += 8;
      if (!isFiniteNumber(bowAt)) return null;
      record.bowAt = bowAt;
    }
    records.push(record);
  }
  // Trailing bytes mean the sender and we disagree on the layout.
  if (o !== size) return null;
  return { revision, serverTime, room: head["room"], profiles, removed, records };
}
