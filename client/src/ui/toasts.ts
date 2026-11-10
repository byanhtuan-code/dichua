export type ToastKind = "info" | "warn" | "error";

/** How long one toast stays up. */
export const TOAST_MS = 3000;
/** Shown at once; the rest wait their turn. */
const MAX_VISIBLE = 3;
/** Waiting toasts beyond this are dropped (oldest first) so a burst cannot back up for minutes. */
const MAX_QUEUED = 6;

interface Item {
  text: string;
  kind: ToastKind;
}

/** Toast stack under the top HUD (design .toasts): a `role=status` live region, FIFO queue, 3 s each. */
export class Toasts {
  readonly element: HTMLDivElement;
  private readonly queue: Item[] = [];
  private readonly timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();

  constructor(parent: HTMLElement = document.body) {
    this.element = document.createElement("div");
    this.element.className = "toasts";
    this.element.setAttribute("role", "status");
    parent.append(this.element);
  }

  show(text: string, kind: ToastKind = "info"): void {
    // Same message already up or waiting: one copy is enough (WASD spam, repeated hellos).
    for (const el of this.timers.keys()) if (el.textContent === text) return;
    if (this.queue.some((q) => q.text === text)) return;
    this.queue.push({ text, kind });
    if (this.queue.length > MAX_QUEUED) this.queue.shift();
    this.pump();
  }

  /** A toast that stays until the returned release is called (connection lost: AC14). */
  hold(text: string, kind: ToastKind = "info"): () => void {
    const el = this.make(text, kind);
    this.element.prepend(el);
    return () => el.remove();
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.queue.length = 0;
    this.element.remove();
  }

  private pump(): void {
    while (this.timers.size < MAX_VISIBLE) {
      const next = this.queue.shift();
      if (!next) return;
      const el = this.make(next.text, next.kind);
      this.element.append(el);
      this.timers.set(
        el,
        setTimeout(() => {
          this.timers.delete(el);
          el.remove();
          this.pump();
        }, TOAST_MS),
      );
    }
  }

  private make(text: string, kind: ToastKind): HTMLDivElement {
    const el = document.createElement("div");
    el.className = kind === "info" ? "toast" : `toast toast--${kind}`;
    el.textContent = text;
    return el;
  }
}
