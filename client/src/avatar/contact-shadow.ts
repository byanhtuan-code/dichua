import { CircleGeometry, Color, InstancedMesh, Matrix4, MeshBasicMaterial, type Object3D } from "three";
import { radialTexture } from "../engine/radial-texture.ts";

/** Disc radius under a standing novice (metres). */
export const CONTACT_RADIUS = 0.42;
const OPACITY = 0.38;
/** Just above whatever the feet stand on; polygonOffset handles the rest. */
const LIFT = 0.012;

/**
 * Fake soft shadows under people (stack §2: only the player casts a real one).
 * One InstancedMesh for everyone: one draw call however many people are in the room.
 */
export class ContactShadows {
  readonly mesh: InstancedMesh;
  private readonly geometry = new CircleGeometry(1, 20);
  private readonly material: MeshBasicMaterial;
  private readonly tex = radialTexture();
  private readonly m = new Matrix4();

  constructor(parent: Object3D, readonly capacity: number) {
    this.geometry.rotateX(-Math.PI / 2);
    this.material = new MeshBasicMaterial({
      map: this.tex,
      color: new Color(0x000000),
      transparent: true,
      opacity: OPACITY,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.count = 0;
    this.mesh.name = "contact-shadows";
    // Instances move every frame and span the whole map; a stale bounding sphere would cull them.
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    parent.add(this.mesh);
  }

  /** Number of discs drawn this frame (the first `count` slots). */
  setCount(count: number): void {
    this.mesh.count = Math.min(count, this.capacity);
  }

  /** Places slot i under a person standing at (x, y, z); `scale` shrinks it when kneeling / far up. */
  place(i: number, x: number, y: number, z: number, scale = 1): void {
    if (i < 0 || i >= this.capacity) return;
    const r = CONTACT_RADIUS * scale;
    this.mesh.setMatrixAt(i, this.m.makeScale(r, 1, r).setPosition(x, y + LIFT, z));
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.tex.dispose();
  }
}
