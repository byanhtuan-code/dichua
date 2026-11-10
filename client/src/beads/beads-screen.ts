import { vi } from "../i18n/vi.ts";
import { overlayDialog } from "../ui/dialog.ts";
import { icons } from "../ui/icons.ts";
import { TOAST_MS } from "../ui/toasts.ts";
import { addBead, inRound, loadBeads, saveBeads, type BeadsCount } from "./counter.ts";
import "../ui/base.css";
import "./beads.css";

/** Vertical drag per bead. */
const SWIPE_PX = 44;
/** Wheel travel per bead (pixels after normalising line / page modes). */
const WHEEL_PX = 60;
/** At most this many beads from one wheel event (a mouse wheel notch can report hundreds of px). */
const WHEEL_MAX_STEPS = 2;
/** Release speed (px/ms) above which a flick keeps counting a little. */
const FLING_MIN_SPEED = 0.5;
const FLING_MAX_BEADS = 4;
/** Gaps between the extra beads of a flick: they slow down like a real strand. */
const FLING_GAPS_MS = [90, 130, 180, 240];
/** Held arrow keys repeat at the OS rate; cap it so the clicks stay distinct. */
const KEY_REPEAT_MS = 80;

export interface BeadsScreenOptions {
  /** "Quay lại" / Esc. */
  onClose(): void;
  /** One bead counted: the "tách" sound + the network event. */
  onBead(): void;
  /** New count (also on open); `animate` false = jump straight there. */
  onCount(c: BeadsCount, animate: boolean): void;
  toggleSound(): void;
  storage: Storage | null;
  parent?: HTMLElement;
}

function roundLabel(round: number): string {
  return round <= 1 ? vi.beads.roundFirst : vi.beads.round.replace("{n}", String(round));
}

/**
 * Bead screen chrome (design/beads.html) over the bead scene: header, count, hint, its own toast.
 * Swipe / ↑↓ / wheel count one bead each; the count lives in localStorage.
 */
export class BeadsScreen {
  private readonly dialog: HTMLDialogElement;
  private readonly sound: HTMLButtonElement;
  private readonly roundEl: HTMLElement;
  private readonly countEl: HTMLElement;
  private readonly toastBox: HTMLDivElement;
  private c: BeadsCount;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private flingTimer: ReturnType<typeof setTimeout> | null = null;
  private dragId: number | null = null;
  private dragAcc = 0;
  private lastY = 0;
  private lastT = 0;
  private speed = 0;
  private wheelAcc = 0;
  private lastKeyStep = 0;

  constructor(private readonly o: BeadsScreenOptions) {
    this.c = loadBeads(o.storage);
    this.dialog = overlayDialog("beads", "beads-title", () => o.onClose());

    const head = document.createElement("header");
    head.className = "beads-head";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "tool glass";
    back.innerHTML = icons.back;
    const backLabel = document.createElement("span");
    backLabel.textContent = vi.beads.back;
    back.append(backLabel);
    back.addEventListener("click", () => o.onClose());
    const title = document.createElement("h2");
    title.id = "beads-title";
    title.textContent = vi.beads.title;
    this.sound = document.createElement("button");
    this.sound.type = "button";
    this.sound.className = "tool tool-circle glass";
    this.sound.addEventListener("click", () => o.toggleSound());
    head.append(back, title, this.sound);

    const strand = document.createElement("div");
    strand.className = "beads-strand";
    const count = document.createElement("div");
    count.className = "beads-count";
    count.setAttribute("aria-live", "polite");
    this.roundEl = document.createElement("strong");
    this.countEl = document.createElement("span");
    count.append(this.roundEl, this.countEl);
    strand.append(count);

    const foot = document.createElement("footer");
    foot.className = "beads-foot";
    foot.textContent = vi.beads.hint;

    this.toastBox = document.createElement("div");
    this.toastBox.className = "toasts beads-toasts";
    this.toastBox.setAttribute("role", "status");

    this.dialog.append(head, strand, foot, this.toastBox);
    // Chrome's close watcher may close the dialog on a repeated Esc without `cancel`: keep Actions in sync.
    this.dialog.addEventListener("close", () => {
      this.close();
      o.onClose();
    });
    this.dialog.addEventListener("keydown", this.onKey);
    this.dialog.addEventListener("wheel", this.onWheel, { passive: false });
    this.dialog.addEventListener("pointerdown", this.onDown);
    this.dialog.addEventListener("pointermove", this.onMove);
    this.dialog.addEventListener("pointerup", this.onUp);
    this.dialog.addEventListener("pointercancel", this.onCancel);
    (o.parent ?? document.body).append(this.dialog);
    this.setSound(false);
    this.render();
  }

  get count(): BeadsCount {
    return { ...this.c };
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  open(): void {
    if (this.dialog.open) return;
    this.o.onCount(this.count, false);
    this.dialog.showModal();
  }

  close(): void {
    this.stopFling();
    this.dragId = null;
    this.wheelAcc = 0;
    this.hideToast();
    if (this.dialog.open) this.dialog.close();
  }

  setSound(on: boolean): void {
    this.sound.innerHTML = on ? icons.sound : icons.muted;
    this.sound.setAttribute("aria-label", on ? vi.hud.soundOff : vi.hud.soundOn);
  }

  dispose(): void {
    this.close();
    this.dialog.remove();
  }

  private step(): void {
    const { next, completed } = addBead(this.c);
    this.c = next;
    saveBeads(this.o.storage, next);
    this.render();
    this.o.onBead();
    this.o.onCount(this.count, true);
    if (completed !== null) this.toast(vi.beads.roundDone.replace("{n}", String(completed)));
  }

  private render(): void {
    this.roundEl.textContent = roundLabel(this.c.round);
    this.countEl.textContent = vi.beads.count
      .replace("{n}", String(inRound(this.c.total)))
      .replace("{total}", String(this.c.total));
  }

  private toast(text: string): void {
    this.hideToast();
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    this.toastBox.append(el);
    this.toastTimer = setTimeout(() => this.hideToast(), TOAST_MS);
  }

  private hideToast(): void {
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = null;
    this.toastBox.replaceChildren();
  }

  private stopFling(): void {
    if (this.flingTimer !== null) clearTimeout(this.flingTimer);
    this.flingTimer = null;
  }

  private fling(left: number, i = 0): void {
    if (left <= 0) return;
    this.flingTimer = setTimeout(
      () => {
        this.flingTimer = null;
        if (!this.dialog.open) return;
        this.step();
        this.fling(left - 1, i + 1);
      },
      FLING_GAPS_MS[i] ?? FLING_GAPS_MS[FLING_GAPS_MS.length - 1],
    );
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code !== "ArrowUp" && e.code !== "ArrowDown") return;
    e.preventDefault();
    const now = performance.now();
    if (e.repeat && now - this.lastKeyStep < KEY_REPEAT_MS) return;
    this.lastKeyStep = now;
    this.stopFling();
    this.step();
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    this.wheelAcc += Math.abs(e.deltaY * unit);
    let steps = 0;
    while (this.wheelAcc >= WHEEL_PX && steps < WHEEL_MAX_STEPS) {
      this.wheelAcc -= WHEEL_PX;
      steps++;
    }
    if (steps === WHEEL_MAX_STEPS) this.wheelAcc = 0;
    if (steps > 0) this.stopFling();
    for (let i = 0; i < steps; i++) this.step();
  };

  private readonly onDown = (e: PointerEvent): void => {
    if (this.dragId !== null || !e.isPrimary) return;
    if (e.target instanceof Element && e.target.closest("button")) return;
    this.stopFling();
    this.dragId = e.pointerId;
    this.dragAcc = 0;
    this.speed = 0;
    this.lastY = e.clientY;
    this.lastT = e.timeStamp;
    this.dialog.setPointerCapture(e.pointerId);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragId) return;
    const dy = Math.abs(e.clientY - this.lastY);
    const dt = e.timeStamp - this.lastT;
    // Smoothed speed so the release velocity is not one noisy sample.
    if (dt > 0) this.speed = this.speed * 0.6 + (dy / dt) * 0.4;
    this.lastY = e.clientY;
    this.lastT = e.timeStamp;
    this.dragAcc += dy;
    while (this.dragAcc >= SWIPE_PX) {
      this.dragAcc -= SWIPE_PX;
      this.step();
    }
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.dragId) return;
    this.dragId = null;
    // A pause before lifting the finger means no flick.
    const fresh = e.timeStamp - this.lastT < 80;
    if (fresh && this.speed > FLING_MIN_SPEED) this.fling(Math.min(FLING_MAX_BEADS, Math.round(this.speed * 2)));
  };

  private readonly onCancel = (e: PointerEvent): void => {
    if (e.pointerId === this.dragId) this.dragId = null;
  };
}
