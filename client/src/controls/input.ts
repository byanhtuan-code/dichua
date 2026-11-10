/** A press that stays within this many px and ms is a tap (walk); anything else is a drag (rotate). Stack §3. */
export const TAP_MAX_PX = 6;
export const TAP_MAX_MS = 250;
/** Wheel delta (px) → zoom factor exponent. */
const WHEEL_ZOOM = 0.0015;
const LINE_PX = 16;

export interface InputHandlers {
  /** Client coordinates of a tap / click. */
  tap(x: number, y: number): void;
  /** Drag delta in px. */
  rotate(dx: number, dy: number): void;
  /** Multiplicative zoom: > 1 = farther. */
  zoom(factor: number): void;
}

/** Camera-relative key axes, each −1…1. */
export interface MoveAxes {
  forward: number;
  right: number;
}

interface Tracked {
  x: number;
  y: number;
  startX: number;
  startY: number;
  startAt: number;
  primary: boolean;
}

type Gesture = "idle" | "press" | "drag" | "pinch" | "spent";

const KEYS: Record<string, keyof typeof AXIS_SIGN> = {
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
};
const AXIS_SIGN = { up: 1, down: -1, left: -1, right: 1 } as const;

/** Keys typed into a field or an open dialog belong to that UI, not to walking. */
export function ownedByUi(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest("input, textarea, select, dialog[open]")) return true;
  if (target.ownerDocument?.querySelector("dialog[open]") !== null) return true;
  return false;
}

/**
 * Pointer Events for mouse + touch on the canvas (tap = walk, drag = rotate, two fingers / wheel = zoom)
 * and WASD / arrows on the window.
 */
export class Input {
  private readonly pointers = new Map<number, Tracked>();
  private gesture: Gesture = "idle";
  private pinchDist = 0;
  private readonly held = new Set<keyof typeof AXIS_SIGN>();

  constructor(private readonly el: HTMLElement, private readonly h: InputHandlers) {
    el.addEventListener("pointerdown", this.onDown);
    el.addEventListener("pointermove", this.onMove);
    el.addEventListener("pointerup", this.onUp);
    el.addEventListener("pointercancel", this.onCancel);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.clearKeys);
    document.addEventListener("visibilitychange", this.clearKeys);
  }

  /** Writes the held movement keys into `out` (no allocation per frame). */
  axes(out: MoveAxes): MoveAxes {
    if (this.held.size > 0 && this.el.ownerDocument?.querySelector("dialog[open]") !== null) {
      this.held.clear();
    }
    const h = this.held;
    out.forward = (h.has("up") ? AXIS_SIGN.up : 0) + (h.has("down") ? AXIS_SIGN.down : 0);
    out.right = (h.has("right") ? AXIS_SIGN.right : 0) + (h.has("left") ? AXIS_SIGN.left : 0);
    return out;
  }

  readonly clearKeys = (): void => {
    this.held.clear();
  };

  dispose(): void {
    const el = this.el;
    el.removeEventListener("pointerdown", this.onDown);
    el.removeEventListener("pointermove", this.onMove);
    el.removeEventListener("pointerup", this.onUp);
    el.removeEventListener("pointercancel", this.onCancel);
    el.removeEventListener("wheel", this.onWheel);
    el.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.clearKeys);
    document.removeEventListener("visibilitychange", this.clearKeys);
    this.pointers.clear();
    this.held.clear();
  }

  private readonly onDown = (e: PointerEvent): void => {
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, {
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      startAt: e.timeStamp,
      primary: e.button === 0,
    });
    if (this.pointers.size === 1) {
      this.gesture = "press";
    } else if (this.pointers.size === 2) {
      this.gesture = "pinch";
      this.pinchDist = this.spread();
    } else {
      this.gesture = "spent";
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;

    if (this.gesture === "pinch") {
      const d = this.spread();
      if (d > 0 && this.pinchDist > 0) this.h.zoom(this.pinchDist / d);
      this.pinchDist = d;
      return;
    }
    if (this.gesture === "press" && Math.hypot(p.x - p.startX, p.y - p.startY) > TAP_MAX_PX) {
      this.gesture = "drag";
      // Include the slop so the view does not lag the finger by 6 px.
      this.h.rotate(p.x - p.startX, p.y - p.startY);
      return;
    }
    if (this.gesture === "drag") this.h.rotate(dx, dy);
  };

  private readonly onUp = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const isTap =
      this.gesture === "press" &&
      p.primary &&
      e.timeStamp - p.startAt <= TAP_MAX_MS &&
      Math.hypot(e.clientX - p.startX, e.clientY - p.startY) <= TAP_MAX_PX;
    this.release(e.pointerId);
    if (isTap) this.h.tap(e.clientX, e.clientY);
  };

  private readonly onCancel = (e: PointerEvent): void => {
    this.release(e.pointerId);
  };

  private release(id: number): void {
    this.pointers.delete(id);
    if (this.el.hasPointerCapture(id)) this.el.releasePointerCapture(id);
    // Lifting one finger of a pinch must not turn the other into a tap or a jumpy drag.
    this.gesture = this.pointers.size === 0 ? "idle" : "spent";
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const px = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * LINE_PX : e.deltaY;
    this.h.zoom(Math.exp(px * WHEEL_ZOOM));
  };

  private readonly onContextMenu = (e: Event): void => {
    // Right-drag rotates; the browser menu would steal the pointer.
    e.preventDefault();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const axis = KEYS[e.code];
    if (!axis || e.ctrlKey || e.metaKey || e.altKey) return;
    if (ownedByUi(e.target)) {
      this.held.clear();
      return;
    }
    // Arrows would scroll anything scrollable behind the canvas.
    e.preventDefault();
    this.held.add(axis);
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const axis = KEYS[e.code];
    if (axis) this.held.delete(axis);
  };

  private spread(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
