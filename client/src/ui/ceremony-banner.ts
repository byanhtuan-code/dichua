import { CEREMONY_DURATION_S, ceremonyAt, vnTimeOfDay } from "@santinh/shared";
import { vi } from "../i18n/vi.ts";
import "./base.css";

/** Re-check the schedule this often; a session starts on the hour so ±15 s is fine. */
const CHECK_MS = 15_000;
const NOON_MS = 12 * 3_600_000;

/** Banner text while a shared chanting session runs (05:00 / 18:00 VN), else null. */
export function ceremonyLabel(ms: number): string | null {
  const { active } = ceremonyAt(ms, CEREMONY_DURATION_S);
  if (!active) return null;
  return vnTimeOfDay(active.startsAt) < NOON_MS ? vi.ceremony.morning : vi.ceremony.evening;
}

/** "Khóa lễ sáng · đang nghe cùng mọi người" chip (design/game.html P1 block); hidden outside sessions. */
export class CeremonyBanner {
  readonly element: HTMLSpanElement;
  private readonly timer: ReturnType<typeof setInterval>;

  /** `now` honours `?time=` so the banner can be checked at any hour. */
  constructor(private readonly now: () => number) {
    this.element = document.createElement("span");
    this.element.className = "chip chip--banner";
    this.element.setAttribute("role", "status");
    this.update();
    this.timer = setInterval(() => this.update(), CHECK_MS);
  }

  update(): void {
    const text = ceremonyLabel(this.now());
    this.element.hidden = text === null;
    if (text !== null && this.element.textContent !== text) this.element.textContent = text;
  }

  dispose(): void {
    clearInterval(this.timer);
    this.element.remove();
  }
}
