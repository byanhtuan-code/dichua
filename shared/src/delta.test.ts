import { describe, expect, it } from "vitest";
import { DELTA_HEADER_BYTES, DELTA_RECORD_BYTES, decodeDelta, encodeDelta, type DeltaFrame, type DeltaRecord } from "./delta.ts";
import { WIRE_POSES } from "./protocol.ts";

function frame(records: DeltaRecord[], extra: Partial<DeltaFrame> = {}): DeltaFrame {
  return { revision: 42, serverTime: 1_762_000_000_123.5, room: "san-03", profiles: [], removed: [], records, ...extra };
}

function record(i: number, more: Partial<DeltaRecord> = {}): DeltaRecord {
  return { slot: i, cushion: null, pose: WIRE_POSES[i % WIRE_POSES.length] ?? "walk", x: i * 0.37 - 5, z: 30 - i * 1.1, yaw: (i * 0.4) % 6.28, ...more };
}

const headerOnly = (f: DeltaFrame): number => encodeDelta({ ...f, records: [] }).byteLength;

describe("encodeDelta / decodeDelta", () => {
  it("round-trips 0, 1 and 30 records", () => {
    for (const n of [0, 1, 30]) {
      const f = frame(Array.from({ length: n }, (_, i) => record(i)));
      expect(decodeDelta(encodeDelta(f)), `${n} records`).toEqual(f);
    }
  });

  it("round-trips profiles with Vietnamese names and removed ids", () => {
    const f = frame([record(1, { cushion: 7, pose: "kneel", bowAt: 1_762_000_000_000 })], {
      profiles: [{ slot: 1, id: "v:abc123", name: "Tâm An Thiện Lạc ữ", color: "#c9a46a", joinedAt: 1_761_999_000_000 }],
      removed: ["v:gone", "bot:3"],
    });
    expect(decodeDelta(encodeDelta(f))).toEqual(f);
  });

  it("cushion null ↔ -1, 0 stays 0, bowAt only when present", () => {
    const f = frame([record(0, { cushion: null }), record(1, { cushion: 0, bowAt: 5 }), record(2, { cushion: 29 })]);
    const back = decodeDelta(encodeDelta(f));
    expect(back?.records.map((r) => r.cushion)).toEqual([null, 0, 29]);
    expect(back?.records.map((r) => "bowAt" in r)).toEqual([false, true, false]);
  });

  it("asleep rides in the flags byte with bowAt, only when true (D25)", () => {
    const f = frame([record(0, { asleep: true }), record(1, { asleep: true, bowAt: 7 }), record(2)]);
    const back = decodeDelta(encodeDelta(f));
    expect(back).toEqual(f);
    expect(back?.records.map((r) => "asleep" in r)).toEqual([true, true, false]);
    expect(encodeDelta(frame([record(0, { asleep: true })])).byteLength).toBe(encodeDelta(frame([record(0)])).byteLength);
  });

  it("each record is 30 bytes, +8 with bowAt; header is 28 bytes + JSON", () => {
    const base = frame([]);
    expect(headerOnly(base)).toBe(DELTA_HEADER_BYTES + JSON.stringify({ room: "san-03", profiles: [], removed: [] }).length);
    expect(encodeDelta(frame([record(0)])).byteLength - headerOnly(base)).toBe(DELTA_RECORD_BYTES);
    expect(encodeDelta(frame([record(0), record(1)])).byteLength - headerOnly(base)).toBe(2 * 30);
    expect(encodeDelta(frame([record(0, { bowAt: 1 })])).byteLength - headerOnly(base)).toBe(38);
  });

  it("wrong magic → null", () => {
    const buf = encodeDelta(frame([record(0)]));
    new DataView(buf).setUint32(0, 0x53544e32, true);
    expect(decodeDelta(buf)).toBeNull();
  });

  it("truncated or padded buffers → null", () => {
    const buf = encodeDelta(frame([record(0, { bowAt: 9 }), record(1)]));
    for (const len of [0, 10, DELTA_HEADER_BYTES - 1, DELTA_HEADER_BYTES + 5, buf.byteLength - 1, buf.byteLength - 8]) {
      expect(decodeDelta(buf.slice(0, len)), `len ${len}`).toBeNull();
    }
    const padded = new Uint8Array(buf.byteLength + 1);
    padded.set(new Uint8Array(buf));
    expect(decodeDelta(padded.buffer)).toBeNull();
  });

  it("bad pose code, flags, cushion or JSON → null", () => {
    const f = frame([record(0)]);
    const jsonEnd = headerOnly(f);
    const corrupt = (at: number, write: (v: DataView) => void): ArrayBuffer => {
      const buf = encodeDelta(f);
      write(new DataView(buf, at));
      return buf;
    };
    expect(decodeDelta(corrupt(jsonEnd, (v) => v.setUint8(4, 9)))).toBeNull();
    // Unknown flag bits (bit 0 = bowAt, bit 1 = asleep).
    expect(decodeDelta(corrupt(jsonEnd, (v) => v.setUint8(5, 4)))).toBeNull();
    expect(decodeDelta(corrupt(jsonEnd, (v) => v.setInt16(2, -2, true)))).toBeNull();
    expect(decodeDelta(corrupt(jsonEnd, (v) => v.setFloat64(6, Number.NaN, true)))).toBeNull();
    expect(decodeDelta(corrupt(DELTA_HEADER_BYTES, (v) => v.setUint8(0, 0xff)))).toBeNull();
  });

  it("encode refuses values the layout cannot hold or the decoder would drop", () => {
    expect(() => encodeDelta(frame([record(0, { slot: 70_000 })]))).toThrow(RangeError);
    expect(() => encodeDelta(frame([record(0, { cushion: -3 })]))).toThrow(RangeError);
    expect(() => encodeDelta(frame([record(0, { x: Number.NaN })]))).toThrow(RangeError);
    expect(() => encodeDelta(frame([record(0, { yaw: Infinity })]))).toThrow(RangeError);
    expect(() => encodeDelta(frame([record(0, { bowAt: Number.NaN })]))).toThrow(RangeError);
    expect(() => encodeDelta(frame([], { serverTime: Number.NaN }))).toThrow(RangeError);
  });

  it("encode also refuses a JSON head or slots every client would drop", () => {
    const p = { slot: 5, id: "v:a", name: "An", color: "#fff", joinedAt: 1 };
    expect(() => encodeDelta(frame([], { profiles: [{ ...p, joinedAt: Number.NaN }] }))).toThrow(RangeError);
    expect(() => encodeDelta(frame([], { profiles: [{ ...p, slot: 70_000 }] }))).toThrow(RangeError);
    expect(() => encodeDelta(frame([], { profiles: [p, { ...p, id: "v:b" }] }))).toThrow(RangeError);
    expect(() => encodeDelta(frame([record(2), record(2)]))).toThrow(RangeError);
    expect(() => encodeDelta(frame([], { removed: [3 as unknown as string] }))).toThrow(RangeError);
    expect(() => encodeDelta(frame([], { revision: 5.5 }))).toThrow(RangeError);
  });

  it("decode refuses a revision that is not a safe integer (the client orders frames by revision + 1)", () => {
    const at = (rev: number) => {
      const buf = encodeDelta(frame([record(1)]));
      new DataView(buf).setFloat64(10, rev, true);
      return decodeDelta(buf);
    };
    expect(at(7)?.revision).toBe(7);
    expect(at(5.5)).toBeNull();
    expect(at(2 ** 53 + 2)).toBeNull();
  });

  it("decodes from a view inside a larger buffer (Node Buffer pool), not the whole backing store", () => {
    const f = frame([record(3, { bowAt: 7 })], { removed: ["v:x"] });
    const bytes = new Uint8Array(encodeDelta(f));
    const pool = new Uint8Array(bytes.length + 64).fill(0xab);
    pool.set(bytes, 17);
    const view = pool.subarray(17, 17 + bytes.length);
    expect(decodeDelta(view)).toEqual(f);
    expect(decodeDelta(pool.buffer)).toBeNull();
  });
});
