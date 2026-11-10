import { Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, type WebGLRenderer } from "three";
import { VISITOR_COLORS } from "@santinh/shared";
import { createDebugOverlay } from "../debug/overlay.ts";
import { params } from "../debug/params.ts";
import { FrameStats } from "../engine/frame-stats.ts";
import { Loop } from "../engine/loop.ts";
import { vi } from "../i18n/vi.ts";
import { hideBoot } from "../ui/boot.ts";
import { Avatar } from "./avatar.ts";
import { ContactShadows } from "./contact-shadow.ts";
import { MonkFactory } from "./monk-model.ts";
import { POSES, type PoseName } from "./poses.ts";

const BACKGROUND = 0xd8d6cc;
const SPIN = 0.3;
/** Swings between a three-quarter front view and the side, where the bow reads best. */
const SPIN_CENTER = 0.5;
const SPIN_RANGE = 1.1;
const SPACING = 0.62;
const PREVIEW_WALK_SPEED = 1.4;
/** The hello gesture lasts 2 s; the preview repeats it so it can be looked at (and screenshotted). */
const HELLO_REPEAT = 3;
const POSE_NAMES = Object.keys(POSES) as PoseName[];
const isPoseName = (v: string | null): v is PoseName => v !== null && (POSE_NAMES as string[]).includes(v);

function applyPose(avatars: readonly Avatar[], pose: PoseName): void {
  for (const a of avatars) {
    a.setAsleep(pose === "sleep");
    a.setPose(pose === "idle" || pose === "sleep" ? "walk" : pose);
    a.setMoving(pose === "walk" ? PREVIEW_WALK_SPEED : 0);
  }
}

/** Dev-only pose switcher (top-left). */
function createPoseButtons(onPick: (pose: PoseName) => void, initial: PoseName): HTMLElement {
  const bar = document.createElement("div");
  bar.setAttribute("role", "group");
  bar.setAttribute("aria-label", vi.debug.poses);
  bar.style.cssText = "position:fixed;top:12px;left:12px;z-index:10;display:flex;flex-wrap:wrap;gap:6px;max-width:calc(100vw - 24px)";
  const buttons = POSE_NAMES.map((pose) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = vi.debug.pose[pose];
    b.style.cssText = "min-height:40px;padding:6px 14px;border:1px solid #5d6550;border-radius:20px;background:#f4f2ea;color:#2f342a;font:600 14px system-ui,sans-serif";
    b.addEventListener("click", () => {
      onPick(pose);
      for (const other of buttons) other.setAttribute("aria-pressed", String(other === b));
    });
    b.setAttribute("aria-pressed", String(pose === initial));
    return b;
  });
  bar.append(...buttons);
  return bar;
}

/** `?avatar=1[&pose=…]` (dev): a full novice and a remote LOD side by side, animated, with pose buttons. */
export function startAvatarPreview(renderer: WebGLRenderer, opts: { debug: boolean }): void {
  const scene = new Scene();
  scene.background = new Color(BACKGROUND);
  const camera = new PerspectiveCamera(32, window.innerWidth / window.innerHeight, 0.05, 50);
  const fit = (): void => {
    camera.aspect = window.innerWidth / window.innerHeight;
    // Portrait screens: step back so both figures fit the width.
    const back = camera.aspect < 1 ? 3.7 / camera.aspect : 3.2;
    camera.position.set(0, 0.9, back);
    camera.lookAt(0, 0.58, 0);
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  fit();

  scene.add(new HemisphereLight(0xeef2f4, 0x6b6150, 1.6));
  const key = new DirectionalLight(0xfff1dc, 2.2);
  key.position.set(1.5, 3, 2.5);
  scene.add(key);

  const factory = new MonkFactory();
  const full = factory.create(VISITOR_COLORS[0] ?? "#b9c3c7", "full");
  const remote = factory.create(VISITOR_COLORS[0] ?? "#b9c3c7", "remote");
  full.mesh.position.x = -SPACING;
  remote.mesh.position.x = SPACING;
  scene.add(full.mesh, remote.mesh);
  // Different breathing clocks, same bowAt: both bow in step as two clients would.
  const avatars = [new Avatar(full), new Avatar(remote, 1.3)];
  const requested = params().pose;
  let picked: PoseName = isPoseName(requested) ? requested : "idle";
  let sinceHello = 0;
  const pick = (pose: PoseName): void => {
    picked = pose;
    sinceHello = 0;
    applyPose(avatars, pose);
  };
  pick(picked);

  const shadows = new ContactShadows(scene, 2);
  shadows.setCount(2);
  shadows.place(0, -SPACING, 0, 0);
  shadows.place(1, SPACING, 0, 0);

  document.body.prepend(renderer.domElement);
  const stats = new FrameStats();
  const loop = new Loop(renderer, () => renderer.render(scene, camera), stats);
  loop.add((dt, t) => {
    const yaw = SPIN_CENTER + Math.sin(t * SPIN) * SPIN_RANGE;
    const now = Date.now();
    sinceHello += dt;
    if (picked === "hello" && sinceHello >= HELLO_REPEAT) pick("hello");
    for (const a of avatars) {
      a.object.rotation.y = yaw;
      a.update(dt, now);
    }
  });
  document.body.append(createPoseButtons(pick, picked));
  if (opts.debug) {
    loop.add(
      createDebugOverlay(() => {
        const s = stats.summary();
        return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, fps: s.fps, p95: s.p95 };
      }).update,
    );
  }
  window.addEventListener("resize", fit);
  loop.onFirstFrame(hideBoot);
  loop.start();
}
