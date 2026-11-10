import type { Circle, Vec2, Vec2Yaw } from "../types.ts";

export interface Ellipse {
  x: number;
  z: number;
  rx: number;
  rz: number;
}

export interface Segment {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

/** Axis-aligned rectangle on the ground. */
export interface Box {
  xMin: number;
  xMax: number;
  zMin: number;
  zMax: number;
}

/** Everything a walker can bump into, as plain data (no functions) so one collision routine serves every space. */
export interface CollisionMap {
  /** Walkers stay inside this ellipse. */
  boundary: Ellipse;
  /** Nothing south of this z is walkable (the gate). */
  maxZ: number;
  /** Ellipses nobody may enter (ponds). */
  blocked: readonly Ellipse[];
  walls: readonly Segment[];
  wallThickness: number;
  circles: readonly Circle[];
  boxes: readonly Box[];
}

/** Grows into a union as new spaces are added. */
export type SpaceId = "tich-mac-duong";

/**
 * A kind of place (map, collision, seats, spawn, where fake visitors stroll, look).
 * A room is one populated copy of a space — see `spaceOf(roomId)`.
 */
export interface SpaceDef {
  id: SpaceId;
  /** `body[data-space]` value the UI themes on. */
  theme: string;
  collision: CollisionMap;
  /** Cushion index → where the sitter kneels and faces. */
  cushions: readonly Vec2Yaw[];
  /** Cushions the four resident NPCs keep. */
  residentCushions: readonly number[];
  spawn: Vec2Yaw;
  /** New arrivals land within this many metres of `spawn`. */
  spawnJitter: number;
  /** Places fake visitors like to wander to. */
  botSpots: readonly Vec2[];
  /** Corners a computed walk may turn at (doorways, aisles): `findPath` nodes for the player's walk to a cushion and bots leaving. */
  navPoints: readonly Vec2[];
  zones: readonly string[];
  /** Zone where people kneel: a fake visitor standing in it may go for a cushion. */
  seatZone: string;
  groundY(x: number, z: number): number;
  zoneOf(x: number, z: number): string;
}
