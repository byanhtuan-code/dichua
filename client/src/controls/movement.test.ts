import { describe, expect, it } from "vitest";
import { COLUMN_RADIUS, TICH_MAC_DUONG_LANDMARKS, WALK_RADIUS, isWalkable as isWalkableIn, pickSpawn, spaceOf, type Vec2 } from "@santinh/shared";
import { MOVE_SEND_INTERVAL_MS, Movement } from "./movement.ts";

const DT = 1 / 60;
const space = spaceOf("san-01");
const map = space.collision;
const isWalkable = (x: number, z: number): boolean => isWalkableIn(map, x, z);
const { columns: COLUMNS, hallBackZ, pond: POND } = TICH_MAC_DUONG_LANDMARKS;

function run(m: Movement, seconds: number, onFrame?: () => void): void {
  for (let i = 0, t = 0; i < seconds / DT; i++, t += DT * 1000) {
    m.update(DT, t);
    onFrame?.();
  }
}

describe("Movement", () => {
  it("click walk stops in front of a column, never inside it", () => {
    const col = COLUMNS.find((c) => c.x === 12.5 && c.z === -4);
    if (!col) throw new Error("column");
    const m = new Movement(space, { x: col.x, z: col.z + 4, yaw: Math.PI });
    expect(m.walkTo({ x: col.x, z: col.z - 4 })).toBe(true);
    run(m, 5, () => expect(isWalkable(m.position.x, m.position.z)).toBe(true));
    expect(m.position.z).toBeGreaterThan(col.z + COLUMN_RADIUS + WALK_RADIUS - 0.01);
    expect(m.walking).toBe(false);
  });

  it("refuses a click into the pond with invalid-floor", () => {
    const m = new Movement(space, { x: POND.x - POND.rx - 3, z: POND.z, yaw: 0 });
    const invalid: (Vec2 | null)[] = [];
    m.on("invalid-floor", (p) => invalid.push(p));
    expect(m.walkTo({ x: POND.x, z: POND.z })).toBe(false);
    expect(m.walkTo(null)).toBe(false);
    expect(invalid).toHaveLength(2);
  });

  it("walking across the pond by keys never enters it", () => {
    const m = new Movement(space, { x: POND.x - POND.rx - 2, z: POND.z, yaw: 0 });
    m.setDirection(1, 0);
    run(m, 6, () => expect(isWalkable(m.position.x, m.position.z)).toBe(true));
    expect(m.position.x).toBeLessThan(POND.x - POND.rx);
  });

  it("keys slide along a wall instead of stopping dead", () => {
    const m = new Movement(space, { x: 7, z: hallBackZ + 1, yaw: Math.PI });
    m.setDirection(1, -1);
    const x0 = m.position.x;
    run(m, 1, () => expect(isWalkable(m.position.x, m.position.z)).toBe(true));
    expect(m.position.x).toBeGreaterThan(x0 + 1);
  });

  it("emits move at most every 200 ms, walking on/off, and stop() halts", () => {
    const m = new Movement(space, { x: 0, z: 30, yaw: Math.PI });
    const sent: number[] = [];
    const walking: boolean[] = [];
    let t = 0;
    m.on("move", () => sent.push(t));
    m.on("walking", (w) => walking.push(w));
    m.walkTo({ x: 0, z: 26 });
    for (; t < 1000; t += DT * 1000) m.update(DT, t);
    expect(sent.length).toBeGreaterThan(2);
    expect(sent.length).toBeLessThanOrEqual(1000 / MOVE_SEND_INTERVAL_MS + 1);
    for (let i = 1; i < sent.length; i++) expect((sent[i] ?? 0) - (sent[i - 1] ?? 0)).toBeGreaterThanOrEqual(MOVE_SEND_INTERVAL_MS);
    m.stop();
    const z = m.position.z;
    m.update(DT, t);
    expect(m.position.z).toBe(z);
    expect(walking).toEqual([true, false]);
  });

  it("spawns on walkable ground near SPAWN", () => {
    let s = 1;
    const rng = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 50; i++) {
      const p = pickSpawn(space, rng);
      expect(isWalkable(p.x, p.z)).toBe(true);
    }
  });
});
