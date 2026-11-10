import { CHAT_LIMITS } from "@santinh/shared";
import { vi } from "../i18n/vi.ts";
import { closeOnBackdrop } from "./dialog.ts";
import "./base.css";

export const OFFERING_STORAGE_KEY = "santinh.offering.v1";

export interface OfferingStats {
  incense: number;
  lantern: number;
}

export interface OfferingHandlers {
  onIncense(wish: string): void;
  onLantern(wish: string): void;
  onBell?(): void;
  onWoodblock?(): void;
}

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadOfferingStats(store: Pick<Storage, "getItem"> | null = safeStorage()): OfferingStats {
  try {
    const raw = store?.getItem(OFFERING_STORAGE_KEY);
    if (!raw) return { incense: 0, lantern: 0 };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { incense: 0, lantern: 0 };
    const r = parsed as Record<string, unknown>;
    const incense = typeof r["incense"] === "number" && Number.isSafeInteger(r["incense"]) && r["incense"] >= 0 ? r["incense"] : 0;
    const lantern = typeof r["lantern"] === "number" && Number.isSafeInteger(r["lantern"]) && r["lantern"] >= 0 ? r["lantern"] : 0;
    return { incense, lantern };
  } catch {
    return { incense: 0, lantern: 0 };
  }
}

export function saveOfferingStats(stats: OfferingStats, store: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    store?.setItem(OFFERING_STORAGE_KEY, JSON.stringify(stats));
  } catch {
    // Quota or private browsing: session state still works.
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Offering dialog ("Cúng dường · Tâm nguyện"): lets the visitor offer incense at the main altar,
 * release a floating lotus lantern on the pond, ring the deep temple bell or tap the wooden block.
 */
export class OfferingDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly wishInput: HTMLInputElement;
  private readonly statsText: HTMLElement;
  private readonly verseText: HTMLElement;
  private readonly offBackdrop: () => void;
  private stats: OfferingStats;
  private verseIndex = 0;

  constructor(
    private readonly handlers: OfferingHandlers,
    parent: HTMLElement = document.body,
  ) {
    const t = vi.offering;
    this.stats = loadOfferingStats();
    this.verseIndex = Math.floor(Math.random() * t.verses.length);

    this.dialog = el("dialog", "dialog");
    this.dialog.setAttribute("aria-labelledby", "offering-title");
    this.dialog.setAttribute("aria-describedby", "offering-desc");

    const head = el("header", "dialog-head");
    const title = el("h2", "", t.title);
    title.id = "offering-title";
    const close = el("button", "dialog-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", t.close);
    close.addEventListener("click", () => this.close());
    head.append(title, close);

    const desc = el("p", "dialog-desc", t.desc);
    desc.id = "offering-desc";

    const body = el("div", "dialog-body");

    // Peaceful wish input.
    const wishWrap = el("div", "section");
    const wishLabel = el("label", "field");
    const wishSpan = el("span", "", t.wishLabel);
    this.wishInput = el("input", "invite-link");
    this.wishInput.type = "text";
    this.wishInput.maxLength = CHAT_LIMITS.free.maxChars;
    this.wishInput.placeholder = t.wishPlaceholder;
    this.wishInput.autocomplete = "off";
    wishLabel.append(wishSpan, this.wishInput);
    wishWrap.append(wishLabel);

    // 1. Offer Incense row.
    const incenseBtn = el("button", "btn", t.incenseAction);
    incenseBtn.type = "button";
    incenseBtn.addEventListener("click", () => this.offerIncense());
    const incenseSec = this.actionSection(t.incenseTitle, t.incenseDesc, incenseBtn);

    // 2. Release Lotus Lantern row.
    const lanternBtn = el("button", "btn btn--ghost", t.lanternAction);
    lanternBtn.type = "button";
    lanternBtn.addEventListener("click", () => this.offerLantern());
    const lanternSec = this.actionSection(t.lanternTitle, t.lanternDesc, lanternBtn);

    // 3. Ring Temple Bell row.
    const bellBtn = el("button", "btn btn--ghost", t.bellAction);
    bellBtn.type = "button";
    bellBtn.addEventListener("click", () => {
      this.close();
      this.handlers.onBell?.();
    });
    const bellSec = this.actionSection(t.bellTitle, t.bellDesc, bellBtn);

    // 4. Tap Wooden Temple Block row (stays open for rhythmic tapping).
    const woodblockBtn = el("button", "btn btn--ghost", t.woodblockAction);
    woodblockBtn.type = "button";
    woodblockBtn.addEventListener("click", () => this.handlers.onWoodblock?.());
    const woodblockSec = this.actionSection(t.woodblockTitle, t.woodblockDesc, woodblockBtn);

    // Dharma verse & accumulated stats.
    const footerSec = el("section", "section");
    const verseHead = el("h3", "", t.verseTitle);
    this.verseText = el("small", "section-note");
    this.statsText = el("small", "section-note");
    footerSec.append(verseHead, this.verseText, this.statsText);

    body.append(wishWrap, incenseSec, lanternSec, bellSec, woodblockSec, footerSec);
    this.dialog.append(head, desc, body);
    this.offBackdrop = closeOnBackdrop(this.dialog);
    parent.append(this.dialog);
    this.render();
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  open(): void {
    this.verseIndex = (this.verseIndex + 1) % vi.offering.verses.length;
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  dispose(): void {
    this.close();
    this.offBackdrop();
    this.dialog.remove();
  }

  private actionSection(title: string, desc: string, button: HTMLButtonElement): HTMLElement {
    const s = el("section", "section");
    const row = el("div", "section-head");
    const text = el("div", "section-text");
    text.append(el("h3", "", title), el("small", "", desc));
    row.append(text, button);
    s.append(row);
    return s;
  }

  private cleanWish(): string {
    return this.wishInput.value.trim().replace(/\s+/g, " ");
  }

  private offerIncense(): void {
    const wish = this.cleanWish();
    this.stats = { ...this.stats, incense: this.stats.incense + 1 };
    saveOfferingStats(this.stats);
    this.wishInput.value = "";
    this.close();
    this.handlers.onIncense(wish);
  }

  private offerLantern(): void {
    const wish = this.cleanWish();
    this.stats = { ...this.stats, lantern: this.stats.lantern + 1 };
    saveOfferingStats(this.stats);
    this.wishInput.value = "";
    this.close();
    this.handlers.onLantern(wish);
  }

  private render(): void {
    const t = vi.offering;
    this.verseText.textContent = `“${t.verses[this.verseIndex] ?? t.verses[0]}”`;
    this.statsText.textContent = t.stats
      .replace("{incense}", String(this.stats.incense))
      .replace("{lantern}", String(this.stats.lantern));
  }
}
