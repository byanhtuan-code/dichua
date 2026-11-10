import { CHAT_BUBBLE_MS } from "@santinh/shared";
import { Vector3, type Camera } from "three";
import "./labels.css";

/** Labels farther than this from the camera are hidden (unreadable, and they pile up). */
export const LABEL_MAX_DISTANCE = 30;
/** Matches `.chat-bubble` max-width; used when the bubble cannot be measured (label hidden). */
const BUBBLE_MAX_PX = 200;
const EDGE_PX = 6;
const SVG_NS = "http://www.w3.org/2000/svg";

export type TitleTheme = "tinhtam" | "annhien" | "cusi" | "phuochue";

function resolveTitleTheme(title: string): TitleTheme {
  const norm = title.trim().toLowerCase();
  if (norm.includes("an nhiên")) return "annhien";
  if (norm.includes("cư sĩ")) return "cusi";
  if (norm.includes("phước huệ")) return "phuochue";
  return "tinhtam";
}

/** Builds a luminous emerald-green downward-pointing crystal arrow SVG placed before the player's name. */
function createDownArrowSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 14 16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "nametag-arrow-svg");

  // Upper floating chevron crown
  const upper = document.createElementNS(SVG_NS, "path");
  upper.setAttribute("d", "M2.2 1.8 L7 5.8 L11.8 1.8 L7 3.8 Z");
  upper.setAttribute("fill", "currentColor");
  upper.setAttribute("opacity", "0.82");

  // Main downward-pointing emerald crystal arrowhead
  const main = document.createElementNS(SVG_NS, "path");
  main.setAttribute("d", "M1.2 5.2 L7 15.0 L12.8 5.2 L7 8.4 Z");
  main.setAttribute("fill", "currentColor");

  // Pure luminous mint-white inner core
  const core = document.createElementNS(SVG_NS, "path");
  core.setAttribute("d", "M4.2 6.8 L7 12.2 L9.8 6.8 L7 8.4 Z");
  core.setAttribute("fill", "#eafff4");

  svg.append(upper, main, core);
  return svg;
}

interface Label {
  /** Positioned wrapper: stacks the minimalist glowing Dharma title above the character nametag. */
  el: HTMLSpanElement;
  titleEl: HTMLSpanElement;
  tag: HTMLSpanElement;
  zzz: HTMLSpanElement;
  /** Chat bubble above the tag (P4-D9): built once, text swapped per line. */
  bubble: HTMLSpanElement;
  /** `performance.now()`-style time the bubble hides at; 0 = no bubble. */
  bubbleUntil: number;
  /** Half the bubble's width (px) and its sideways nudge that keeps it on screen. */
  bubbleHalf: number;
  bubbleDx: number;
  name: string;
  title: string | null;
  self: boolean;
  placed: boolean;
  shown: boolean;
  /** Last written screen position (px) and scale — skip style writes when unchanged. */
  sx: number;
  sy: number;
  sc: number;
}

/**
 * DOM name tags over people (design `.nametag`): world point → `Vector3.project` → screen px.
 * Per frame: `begin(camera)`, `place(id, x, y, z)` for each visible person, `end()` hides the rest.
 */
export class NameLabels {
  private readonly root: HTMLDivElement;
  private readonly labels = new Map<string, Label>();
  private readonly v = new Vector3();
  private readonly camPos = new Vector3();
  private camera: Camera | null = null;
  private now = 0;
  private width = 1;
  private height = 1;
  private viewportScale = 1;

  constructor(parent: HTMLElement = document.body) {
    this.root = document.createElement("div");
    this.root.className = "visitor-labels";
    this.root.setAttribute("aria-hidden", "true");
    parent.append(this.root);
  }

  /** Adds or renames a label; `self` adds the glowing green downward arrow before the character name. */
  set(id: string, name: string, self = false): void {
    const existing = this.labels.get(id);
    if (existing && existing.name === name && existing.self === self) return;
    const tag = existing?.tag ?? document.createElement("span");
    const titleEl = existing?.titleEl ?? document.createElement("span");
    const title = existing?.title ?? null;
    this.renderTagContent(tag, name, self);
    this.renderTitleBadge(titleEl, title);
    if (!existing) {
      const el = document.createElement("span");
      el.className = "nametag-wrap";
      el.hidden = true;
      const zzz = document.createElement("span");
      zzz.className = "zzz";
      zzz.hidden = true;
      for (const z of ["z", "z", "Z"]) zzz.append(Object.assign(document.createElement("b"), { textContent: z }));
      const bubble = document.createElement("span");
      bubble.className = "chat-bubble";
      bubble.hidden = true;
      el.append(bubble, titleEl, tag, zzz);
      this.root.append(el);
      this.labels.set(id, {
        el,
        titleEl,
        tag,
        zzz,
        bubble,
        bubbleUntil: 0,
        bubbleHalf: 0,
        bubbleDx: 0,
        name,
        title,
        self,
        placed: false,
        shown: false,
        sx: NaN,
        sy: NaN,
        sc: NaN,
      });
    } else {
      existing.name = name;
      existing.self = self;
    }
  }

  /** Sets or clears an equipped spiritual title (e.g. "Tịnh Tâm") ABOVE a visitor's nametag. */
  setTitle(id: string, title: string | null): void {
    const l = this.labels.get(id);
    if (!l || l.title === title) return;
    l.title = title;
    this.renderTitleBadge(l.titleEl, l.title);
  }

  private renderTagContent(tag: HTMLSpanElement, name: string, self: boolean): void {
    tag.className = self ? "nametag nametag--self" : "nametag nametag--other";
    tag.replaceChildren();
    if (self) {
      const arrowWrap = document.createElement("i");
      arrowWrap.className = "nametag-arrow";
      arrowWrap.append(createDownArrowSvg());
      tag.append(arrowWrap);
    }
    const nameSpan = document.createElement("span");
    nameSpan.className = "nametag-name";
    nameSpan.dataset.text = name;
    nameSpan.textContent = name;
    tag.append(nameSpan);
  }

  private renderTitleBadge(titleEl: HTMLSpanElement, title: string | null): void {
    if (!title) {
      titleEl.hidden = true;
      titleEl.className = "nametag-title-pill";
      titleEl.removeAttribute("data-theme");
      titleEl.replaceChildren();
      return;
    }
    const theme = resolveTitleTheme(title);
    titleEl.className = "nametag-title-pill";
    titleEl.dataset.theme = theme;
    titleEl.hidden = false;

    const aura = document.createElement("span");
    aura.className = "nametag-title-aura";

    const motes = document.createElement("span");
    motes.className = "nametag-title-motes";

    const textSpan = document.createElement("span");
    textSpan.className = "nametag-title-text";
    textSpan.dataset.text = title;
    textSpan.textContent = title;

    titleEl.replaceChildren(aura, motes, textSpan);
  }

  /** D25: floating "z z Z" beside the tag while that person dozes. */
  setAsleep(id: string, asleep: boolean): void {
    const l = this.labels.get(id);
    if (l && l.zzz.hidden === asleep) l.zzz.hidden = !asleep;
  }

  /** P4-D9: shows `text` over that person for CHAT_BUBBLE_MS from `now`; a newer line replaces the old one. */
  say(id: string, text: string, now: number): void {
    const l = this.labels.get(id);
    if (!l) return;
    l.bubble.textContent = text;
    l.bubble.hidden = false;
    l.bubbleUntil = now + CHAT_BUBBLE_MS;
    // One layout read per chat line, not per frame; 0 while the label is hidden (measured once shown in end()).
    l.bubbleHalf = l.el.hidden ? 0 : (l.bubble.offsetWidth || BUBBLE_MAX_PX) / 2;
    l.sx = NaN;
  }

  /** Drops every bubble (room switch: a line said in a chat room must not follow us into a silent one). */
  clearBubbles(): void {
    for (const l of this.labels.values()) {
      if (l.bubbleUntil !== 0) this.hideBubble(l);
    }
  }

  private hideBubble(l: Label): void {
    l.bubbleUntil = 0;
    l.bubbleHalf = 0;
    l.bubbleDx = 0;
    l.bubble.style.marginLeft = "";
    l.bubble.hidden = true;
    l.bubble.textContent = "";
  }

  /** Keeps only the ids in `keep`; a dropped label takes its bubble with it. */
  retain(keep: ReadonlySet<string>): void {
    for (const [id, l] of this.labels) {
      if (keep.has(id)) continue;
      l.el.remove();
      this.labels.delete(id);
    }
  }

  /** `now` uses the same clock as `say` (performance.now() by default). */
  begin(camera: Camera, now = performance.now()): void {
    this.camera = camera;
    this.now = now;
    camera.getWorldPosition(this.camPos);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    // Scale proportionally when the browser frame or mobile viewport is shrunk
    const wRatio = this.width / 520;
    const hRatio = this.height / 720;
    this.viewportScale = Math.max(0.74, Math.min(1.04, Math.min(wRatio, hRatio)));
  }

  /** World point of the label's bottom centre (above the head). */
  place(id: string, x: number, y: number, z: number): void {
    const l = this.labels.get(id);
    const camera = this.camera;
    if (!l || !camera) return;
    const v = this.v.set(x, y, z);
    const dist = v.distanceTo(this.camPos);
    let visible = dist <= LABEL_MAX_DISTANCE;
    if (visible) {
      v.project(camera);
      // z > 1 = behind the camera; far off screen = no point laying it out.
      visible = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
    }
    l.placed = visible;
    if (!visible) return;

    const sx = Math.round((v.x + 1) * 0.5 * this.width * 2) / 2;
    const sy = Math.round((1 - v.y) * 0.5 * this.height * 2) / 2;

    // Scale down smoothly as the camera zooms out (map zoom) or when the viewport frame is smaller
    const distScale = Math.max(0.46, Math.min(1.06, 6.2 / Math.max(5.0, dist)));
    const sc = Math.round(distScale * this.viewportScale * 100) / 100;

    if (sx !== l.sx || sy !== l.sy || sc !== l.sc) {
      l.sx = sx;
      l.sy = sy;
      l.sc = sc;
      l.el.style.transform = `translate3d(${sx}px, ${sy}px, 0) translate(-50%, -100%) scale(${sc})`;
      if (l.bubbleUntil !== 0) this.nudgeBubble(l, sx);
    }
  }

  /** Bubbles are wider than tags: near the screen edge slide them sideways instead of clipping. */
  private nudgeBubble(l: Label, sx: number): void {
    if (l.bubbleHalf === 0 && !l.el.hidden) {
      l.bubbleHalf = (l.bubble.offsetWidth || BUBBLE_MAX_PX) / 2;
    }
    const half = (l.bubbleHalf || BUBBLE_MAX_PX / 2) * (Number.isFinite(l.sc) ? l.sc : 1);
    const dx = Math.max(0, half + EDGE_PX - sx) - Math.max(0, sx + half + EDGE_PX - this.width);
    if (dx !== l.bubbleDx) {
      l.bubbleDx = dx;
      l.bubble.style.marginLeft = dx === 0 ? "" : `${dx}px`;
    }
  }

  end(): void {
    for (const l of this.labels.values()) {
      if (l.bubbleUntil !== 0 && this.now >= l.bubbleUntil) this.hideBubble(l);
      if (l.placed !== l.shown) {
        l.shown = l.placed;
        l.el.hidden = !l.placed;
        if (l.placed && l.bubbleUntil !== 0 && !Number.isNaN(l.sx)) {
          this.nudgeBubble(l, l.sx);
        }
      }
      l.placed = false;
    }
  }

  dispose(): void {
    this.labels.clear();
    this.root.remove();
    this.camera = null;
  }
}
