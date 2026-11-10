import { TAP_MAX_MS, TAP_MAX_PX, ownedByUi, type MoveAxes } from "../controls/input.ts";
import "./joystick.css";

/** Maximum thumb travel from the floating centre (px). */
const MAX_RADIUS_PX = 38;
/** Deadzone near the centre to ignore tiny finger jitter (px). */
const DEADZONE_PX = 6;

export interface JoystickOptions {
  parent?: HTMLElement;
  /** Quick tap inside the zone without dragging forwards to floor tap-to-walk. */
  onTap?: (clientX: number, clientY: number) => void;
}

/**
 * Floating virtual joystick for touch devices (phones / tablets):
 * - Invisible when idle so the temple scenery is unobstructed.
 * - Spawns at the touch point inside the bottom-left touch zone and fades out on release.
 * - Hidden on mouse / desktop devices via CSS media query and `pointerType === "touch"` guard.
 */
export class Joystick {
  private readonly zone: HTMLDivElement;
  private readonly ring: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly onTap: ((clientX: number, clientY: number) => void) | undefined;
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private startAt = 0;
  private dragged = false;
  private forwardVal = 0;
  private rightVal = 0;

  constructor(opts: JoystickOptions = {}) {
    const parent = opts.parent ?? document.body;
    this.onTap = opts.onTap;

    this.zone = document.createElement("div");
    this.zone.className = "joystick-zone";
    this.zone.setAttribute("aria-hidden", "true");

    this.ring = document.createElement("div");
    this.ring.className = "joystick-ring";

    this.knob = document.createElement("div");
    this.knob.className = "joystick-knob";

    this.ring.append(this.knob);
    this.zone.append(this.ring);
    parent.append(this.zone);

    this.zone.addEventListener("pointerdown", this.onDown);
    this.zone.addEventListener("pointermove", this.onMove);
    this.zone.addEventListener("pointerup", this.onUp);
    this.zone.addEventListener("pointercancel", this.onCancel);
    window.addEventListener("blur", this.reset);
    document.addEventListener("visibilitychange", this.reset);
  }

  /** Writes the current analog joystick axes (−1…1) into `out` (zero allocation per frame). */
  axes(out: MoveAxes): MoveAxes {
    if (this.pointerId !== null && this.zone.ownerDocument?.querySelector("dialog[open]") !== null) {
      this.reset();
    }
    out.forward = this.forwardVal;
    out.right = this.rightVal;
    return out;
  }

  /** Clears active touch state and hides the joystick immediately. */
  readonly reset = (): void => {
    if (this.pointerId !== null) {
      if (this.zone.hasPointerCapture(this.pointerId)) {
        try {
          this.zone.releasePointerCapture(this.pointerId);
        } catch {
          // Pointer already released by browser.
        }
      }
      this.pointerId = null;
    }
    this.dragged = false;
    this.forwardVal = 0;
    this.rightVal = 0;
    this.ring.classList.remove("joystick-ring--active");
    this.knob.style.transform = "translate3d(0px, 0px, 0) translate(-50%, -50%)";
  };

  dispose(): void {
    this.reset();
    this.zone.removeEventListener("pointerdown", this.onDown);
    this.zone.removeEventListener("pointermove", this.onMove);
    this.zone.removeEventListener("pointerup", this.onUp);
    this.zone.removeEventListener("pointercancel", this.onCancel);
    window.removeEventListener("blur", this.reset);
    document.removeEventListener("visibilitychange", this.reset);
    this.zone.remove();
  }

  private readonly onDown = (e: PointerEvent): void => {
    // Only respond to touch input on mobile / tablet; ignore mouse or when a dialog is open.
    if (e.pointerType !== "touch" || this.pointerId !== null || ownedByUi(e.target)) return;
    e.stopPropagation();
    this.pointerId = e.pointerId;
    this.originX = e.clientX;
    this.originY = e.clientY;
    this.startAt = e.timeStamp;
    this.dragged = false;
    this.forwardVal = 0;
    this.rightVal = 0;
    this.zone.setPointerCapture(e.pointerId);

    this.ring.style.transform = `translate3d(${this.originX}px, ${this.originY}px, 0) translate(-50%, -50%) scale(1)`;
    this.knob.style.transform = "translate3d(0px, 0px, 0) translate(-50%, -50%)";
    this.ring.classList.add("joystick-ring--active");
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    e.stopPropagation();
    const dx = e.clientX - this.originX;
    const dy = e.clientY - this.originY;
    const dist = Math.hypot(dx, dy);

    if (dist > TAP_MAX_PX) {
      this.dragged = true;
    }

    const clamped = Math.min(dist, MAX_RADIUS_PX);
    const nx = dist > 0 ? dx / dist : 0;
    const ny = dist > 0 ? dy / dist : 0;
    const kx = Math.round(nx * clamped * 2) / 2;
    const ky = Math.round(ny * clamped * 2) / 2;
    this.knob.style.transform = `translate3d(${kx}px, ${ky}px, 0) translate(-50%, -50%)`;

    if (dist <= DEADZONE_PX) {
      this.forwardVal = 0;
      this.rightVal = 0;
      return;
    }

    const strength = Math.min(1, (dist - DEADZONE_PX) / (MAX_RADIUS_PX - DEADZONE_PX));
    this.rightVal = nx * strength;
    this.forwardVal = -ny * strength;
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    e.stopPropagation();
    const isTap =
      !this.dragged &&
      e.timeStamp - this.startAt <= TAP_MAX_MS &&
      Math.hypot(e.clientX - this.originX, e.clientY - this.originY) <= TAP_MAX_PX;
    const tapX = e.clientX;
    const tapY = e.clientY;
    this.reset();
    if (isTap) {
      this.onTap?.(tapX, tapY);
    }
  };

  private readonly onCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    e.stopPropagation();
    this.reset();
  };
}
