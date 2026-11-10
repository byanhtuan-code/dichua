import { Bone, Vector3 } from "three";

/** Same 17 bone names as the source rig (stack §3), in skin-index order. */
export const BONE_NAMES = [
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  "upper_arm.L",
  "forearm.L",
  "hand.L",
  "upper_arm.R",
  "forearm.R",
  "hand.R",
  "thigh.L",
  "shin.L",
  "foot.L",
  "thigh.R",
  "shin.R",
  "foot.R",
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

/** Bone index used in skinIndex. */
export const BONE: Readonly<Record<BoneName, number>> = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as Record<BoneName, number>;

// Bind pose in metres, model space: feet on y = 0, facing +z, character's left (.L) on +x.
const SHOULDER_X = 0.18;
const HIP_X = 0.075;
export const JOINT = {
  hips: new Vector3(0, 0.44, 0),
  spine: new Vector3(0, 0.5, 0),
  chest: new Vector3(0, 0.62, 0),
  neck: new Vector3(0, 0.72, 0),
  head: new Vector3(0, 0.76, 0),
  shoulder: new Vector3(SHOULDER_X, 0.69, 0),
  elbow: new Vector3(SHOULDER_X, 0.56, 0),
  wrist: new Vector3(SHOULDER_X, 0.45, 0),
  hip: new Vector3(HIP_X, 0.42, 0),
  knee: new Vector3(HIP_X, 0.25, 0),
  ankle: new Vector3(HIP_X, 0.08, 0),
} as const;

const PARENT: Readonly<Record<BoneName, BoneName | null>> = {
  hips: null,
  spine: "hips",
  chest: "spine",
  neck: "chest",
  head: "neck",
  "upper_arm.L": "chest",
  "forearm.L": "upper_arm.L",
  "hand.L": "forearm.L",
  "upper_arm.R": "chest",
  "forearm.R": "upper_arm.R",
  "hand.R": "forearm.R",
  "thigh.L": "hips",
  "shin.L": "thigh.L",
  "foot.L": "shin.L",
  "thigh.R": "hips",
  "shin.R": "thigh.R",
  "foot.R": "shin.R",
};

/** World-space bind position of each bone's joint. */
export function bindPosition(name: BoneName): Vector3 {
  const side = name.endsWith(".R") ? -1 : 1;
  const mirror = (v: Vector3): Vector3 => new Vector3(v.x * side, v.y, v.z);
  switch (name) {
    case "hips":
    case "spine":
    case "chest":
    case "neck":
    case "head":
      return JOINT[name].clone();
    case "upper_arm.L":
    case "upper_arm.R":
      return mirror(JOINT.shoulder);
    case "forearm.L":
    case "forearm.R":
      return mirror(JOINT.elbow);
    case "hand.L":
    case "hand.R":
      return mirror(JOINT.wrist);
    case "thigh.L":
    case "thigh.R":
      return mirror(JOINT.hip);
    case "shin.L":
    case "shin.R":
      return mirror(JOINT.knee);
    case "foot.L":
    case "foot.R":
      return mirror(JOINT.ankle);
  }
}

export interface Rig {
  readonly root: Bone;
  /** Indexed like BONE_NAMES (the Skeleton's bone order). */
  readonly list: readonly Bone[];
  readonly bones: Readonly<Record<BoneName, Bone>>;
}

/** Fresh bone hierarchy in the bind pose (each avatar needs its own). */
export function createRig(): Rig {
  const bones = {} as Record<BoneName, Bone>;
  for (const name of BONE_NAMES) {
    const bone = new Bone();
    bone.name = name;
    bones[name] = bone;
  }
  for (const name of BONE_NAMES) {
    const parent = PARENT[name];
    const pos = bindPosition(name);
    if (parent) {
      pos.sub(bindPosition(parent));
      bones[parent].add(bones[name]);
    }
    bones[name].position.copy(pos);
  }
  return { root: bones.hips, list: BONE_NAMES.map((n) => bones[n]), bones };
}
