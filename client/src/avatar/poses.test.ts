import { describe, expect, it } from "vitest";
import { Quaternion, SkinnedMesh, Vector3 } from "three";
import { Avatar } from "./avatar.ts";
import { BOW_PERIOD_MS } from "@santinh/shared";
import { POSES, bowAmount, bowPhase, createBoneRotations, type PoseContext, type PoseName } from "./poses.ts";
import { BONE_NAMES, createRig } from "./rig.ts";

const ctx = (over: Partial<PoseContext> = {}): PoseContext => ({
  now: 1_700_000_123_456,
  bowAt: 1_700_000_000_000,
  elapsed: 0.7,
  stride: 1,
  walkPhase: 1.1,
  seated: false,
  ...over,
});

const run = (pose: PoseName, t: number, c: PoseContext): { out: ReturnType<typeof createBoneRotations>; root: Vector3 } => {
  const out = createBoneRotations();
  const root = new Vector3();
  POSES[pose](t, out, root, c);
  return { out, root };
};

describe("poses", () => {
  it("every pose writes a normalised quaternion for all 17 bones", () => {
    for (const pose of Object.keys(POSES) as PoseName[]) {
      for (const t of [0, 0.37, 1.9, 3.3]) {
        for (const now of [0, 1000, 2000, 3100]) {
          const { out, root } = run(pose, t, ctx({ now: 1_700_000_000_000 + now, elapsed: t }));
          for (const name of BONE_NAMES) {
            const q = out[name];
            expect(Number.isFinite(q.x + q.y + q.z + q.w), `${pose}/${name}`).toBe(true);
            expect(q.length(), `${pose}/${name}`).toBeCloseTo(1, 5);
          }
          expect(Number.isFinite(root.x + root.y + root.z)).toBe(true);
        }
      }
    }
  });

  it("kneel: same bowAt + server time → same pose on two calls, whatever the local clock", () => {
    const a = run("kneel", 0, ctx({ now: 1_700_000_001_234 }));
    const b = run("kneel", 0, ctx({ now: 1_700_000_001_234 }));
    for (const name of BONE_NAMES) expect(a.out[name].toArray()).toEqual(b.out[name].toArray());
    expect(bowPhase(1500, 1000)).toBeCloseTo(500 / BOW_PERIOD_MS);
    // Before bowAt (clock skew) = not started; after one period = done.
    expect(bowPhase(500, 1000)).toBe(0);
    expect(bowPhase(1000 + BOW_PERIOD_MS * 3, 1000)).toBe(1);
  });

  it("kneel bows once: after one period it stays upright (no repeat)", () => {
    const bowAt = 1_700_000_000_000;
    expect(bowAmount(bowPhase(bowAt + BOW_PERIOD_MS, bowAt))).toBe(0);
    expect(bowAmount(bowPhase(bowAt + 10 * BOW_PERIOD_MS, bowAt))).toBe(0);
    expect(bowAmount(bowPhase(bowAt + 10.5 * BOW_PERIOD_MS, bowAt))).toBe(0);
    const done = run("kneel", 0, ctx({ now: bowAt + BOW_PERIOD_MS, bowAt }));
    const much = run("kneel", 0, ctx({ now: bowAt + 10.5 * BOW_PERIOD_MS, bowAt }));
    const upright = run("kneel", 0, ctx({ now: bowAt, bowAt }));
    for (const name of BONE_NAMES) {
      expect(done.out[name].angleTo(much.out[name])).toBeLessThan(1e-6);
      expect(done.out[name].angleTo(upright.out[name])).toBeLessThan(1e-3);
    }
  });

  it("kneel goes down and comes back once", () => {
    expect(bowAmount(0)).toBe(0);
    expect(bowAmount(0.5)).toBe(1);
    expect(bowAmount(0.95)).toBe(0);
    const up = run("kneel", 0, ctx({ now: 0, bowAt: 0 }));
    const down = run("kneel", 0, ctx({ now: BOW_PERIOD_MS / 2, bowAt: 0 }));
    expect(down.out.hips.angleTo(new Quaternion())).toBeGreaterThan(0.8);
    expect(up.out.hips.angleTo(new Quaternion())).toBeLessThan(1e-6);
    // Kneeling sits much lower than standing.
    expect(up.root.y).toBeLessThan(-0.2);
  });

  it("walk at stride 0 is idle", () => {
    const w = run("walk", 1.2, ctx({ stride: 0 }));
    const i = run("idle", 1.2, ctx());
    for (const name of BONE_NAMES) expect(w.out[name].toArray()).toEqual(i.out[name].toArray());
  });
});

describe("Avatar", () => {
  it("blends to a new pose over 0.25 s and returns from hello after 2 s", () => {
    // Rig only: the real factory draws the face on a canvas, which node has not got.
    const avatar = new Avatar({ mesh: new SkinnedMesh(), rig: createRig(), setColor: () => {}, dispose: () => {} });
    const hips = avatar.model.rig.bones.hips;
    avatar.update(1 / 60, 0);
    const standY = hips.position.y;

    avatar.setPose("kneel", { bowAt: 0 });
    avatar.update(0.1, 100);
    const midY = hips.position.y;
    avatar.update(0.2, 300);
    const kneelY = hips.position.y;
    expect(midY).toBeLessThan(standY);
    expect(midY).toBeGreaterThan(kneelY);

    avatar.setPose("hello");
    expect(avatar.pose).toBe("hello");
    for (let i = 0; i < 25; i++) avatar.update(0.1, 400 + i * 100);
    expect(avatar.pose).toBe("kneel");
  });

  it("bounds still hold the head at the bottom of the bow (no frustum culling while bowing)", () => {
    const rig = createRig();
    const mesh = new SkinnedMesh();
    mesh.add(rig.root);
    const avatar = new Avatar({ mesh, rig, setColor: () => {}, dispose: () => {} });
    avatar.setPose("kneel", { bowAt: 0 });
    avatar.update(1, BOW_PERIOD_MS / 2);
    mesh.updateMatrixWorld(true);
    // Head sphere: centre 0.2 above the head joint along the head bone, radius 0.23.
    const head = new Vector3(0, 0.2, 0).applyMatrix4(rig.bones.head.matrixWorld);
    const bounds = mesh.boundingSphere;
    expect(bounds).not.toBeNull();
    expect(head.distanceTo(bounds?.center ?? new Vector3()) + 0.23).toBeLessThanOrEqual(bounds?.radius ?? 0);
  });
});
