import { isWalkable } from "../collision.ts";
import { ROOM_COUNT, roomId, roomNumber } from "../world.ts";
import type { Vec2Yaw } from "../types.ts";
import { TICH_MAC_DUONG } from "./tich-mac-duong.ts";
import type { SpaceDef, SpaceId } from "./types.ts";

export type * from "./types.ts";
export { TICH_MAC_DUONG_LANDMARKS } from "./tich-mac-duong.ts";

export const SPACES: Readonly<Record<SpaceId, SpaceDef>> = {
  "tich-mac-duong": TICH_MAC_DUONG,
};

export interface RoomDef {
  id: string;
  number: number;
  spaceId: SpaceId;
  /** P4-D1: chat room (true) or quiet room (false). Read through roomAllowsChat, never by room number. */
  chat: boolean;
}

/** Rooms 1…QUIET_ROOM_COUNT stay silent; the rest allow chat (P4-D1). */
export const QUIET_ROOM_COUNT = 3;

/** Room → space. Client and server both read this table, so the map never travels over the network. */
export const ROOMS: readonly RoomDef[] = Array.from({ length: ROOM_COUNT }, (_, i) => ({
  id: roomId(i + 1),
  number: i + 1,
  spaceId: "tich-mac-duong" as const,
  chat: i + 1 > QUIET_ROOM_COUNT,
}));

/** Unknown room → false: a chat message for it is never accepted. */
export function roomAllowsChat(id: string): boolean {
  return ROOMS.find((r) => r.id === id)?.chat ?? false;
}

/** Throws for an unknown room: callers check `roomNumber` first. */
export function spaceOf(id: string): SpaceDef {
  const n = roomNumber(id);
  const room = n === null ? undefined : ROOMS[n - 1];
  if (!room) throw new RangeError(`room ${id}`);
  return SPACES[room.spaceId];
}

/** Throws for a cushion the space does not have: callers hand out indices from this same space. */
export function cushionOf(space: SpaceDef, i: number): Vec2Yaw {
  const c = space.cushions[i];
  if (!c) throw new RangeError(`cushion ${i}`);
  return c;
}

/** Random walkable point within the space's spawn jitter; falls back to the spawn point itself. */
export function pickSpawn(space: SpaceDef, rng: () => number = Math.random): Vec2Yaw {
  const spawn = space.spawn;
  for (let i = 0; i < 12; i++) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * space.spawnJitter;
    const x = spawn.x + Math.cos(a) * r;
    const z = spawn.z + Math.sin(a) * r;
    if (isWalkable(space.collision, x, z)) return { x, z, yaw: spawn.yaw };
  }
  return { ...spawn };
}
