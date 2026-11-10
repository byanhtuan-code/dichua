export type Pose = "walk" | "kneel" | "beads" | "hello";

/** Ground position (metres) + heading. Forward direction is (sin yaw, cos yaw). */
export interface Vec2Yaw {
  x: number;
  z: number;
  yaw: number;
}

export interface Vec2 {
  x: number;
  z: number;
}

export interface Visitor {
  id: string;
  name: string;
  color: string;
  joinedAt: number;
  pose: Pose;
  cushion: number | null;
  position: Vec2Yaw;
  /** Server time (ms) the current bow cycle started — keeps every client bowing in sync. */
  bowAt?: number;
  /** Inactive (D25): dozes where they are, a cushion kept. Missing = awake. */
  asleep?: boolean;
}

export interface RoomInfo {
  id: string;
  number: number;
  /** D26: display name (admin can change it). */
  name: string;
  count: number;
  capacity: number;
}

export interface VisitorEvent {
  eventId: string;
  visitorId: string;
  type: "hello" | "bow" | "bead";
  at: number;
}

/** `limited`: turned away because this network (IP) already has too many people in the room. */
export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "full" | "limited" | "offline";

export interface Circle {
  x: number;
  z: number;
  r: number;
}
