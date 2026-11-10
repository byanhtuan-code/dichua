import { CHAT_LIMITS } from "@santinh/shared";
import { safeLocalStorage } from "../beads/counter.ts";
import { vi } from "../i18n/vi.ts";
import { closeOnBackdrop } from "./dialog.ts";
import "./base.css";

const WISH_TREE_STORAGE_KEY = "santinh.wishtree.v1";
const MAX_SAVED_WISHES = 20;
const BASE_TREE_PLAQUES = 16;

interface StoredWishes {
  wishes: string[];
}

function loadMyWishes(): string[] {
  try {
    const raw = safeLocalStorage()?.getItem(WISH_TREE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<StoredWishes>;
    if (!Array.isArray(parsed.wishes)) return [];
    return parsed.wishes
      .filter((w): w is string => typeof w === "string" && w.trim().length > 0)
      .slice(0, MAX_SAVED_WISHES);
  } catch {
    return [];
  }
}

function saveMyWishes(wishes: readonly string[]): void {
  try {
    safeLocalStorage()?.setItem(
      WISH_TREE_STORAGE_KEY,
      JSON.stringify({ wishes: wishes.slice(0, MAX_SAVED_WISHES) }),
    );
  } catch {
    // Ignore storage quota errors in private browsing.
  }
}

export interface WishTreeDialogHandlers {
  onHangWish?(wishText: string): void;
  onEmptyWish?(): void;
}

/**
 * Dialog for the 3D Wishing Bodhi Tree ("Cây Bồ Đề Ước Nguyện"):
 * lets visitors write a peace wish onto a vermilion-and-gold plaque, hangs it on the 3D tree,
 * and displays the collection of wishes fluttering on the branches.
 */
export class WishTreeDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly input: HTMLInputElement;
  private readonly board: HTMLUListElement;
  private readonly statsEl: HTMLParagraphElement;
  private readonly handlers: WishTreeDialogHandlers;
  private readonly offBackdrop: () => void;
  private myWishes: string[];

  constructor(handlers: WishTreeDialogHandlers = {}, parent: HTMLElement = document.body) {
    this.handlers = handlers;
    this.myWishes = loadMyWishes();

    this.dialog = document.createElement("dialog");
    this.dialog.className = "dialog";
    this.dialog.setAttribute("aria-label", vi.wishTree.title);

    const head = document.createElement("div");
    head.className = "dialog-head";
    const h2 = document.createElement("h2");
    h2.textContent = vi.wishTree.title;
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "dialog-close";
    closeBtn.setAttribute("aria-label", vi.wishTree.close);
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.close());
    head.append(h2, closeBtn);

    const desc = document.createElement("p");
    desc.className = "dialog-desc";
    desc.textContent = vi.wishTree.desc;

    const body = document.createElement("div");
    body.className = "dialog-body";

    const form = document.createElement("form");
    form.className = "wish-form";
    const label = document.createElement("label");
    label.textContent = vi.wishTree.inputLabel;

    const inputRow = document.createElement("div");
    inputRow.className = "wish-input-row";

    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "invite-link";
    this.input.maxLength = CHAT_LIMITS.free.maxChars;
    this.input.placeholder = vi.wishTree.inputPlaceholder;

    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "btn";
    submitBtn.textContent = vi.wishTree.hangBtn;

    inputRow.append(this.input, submitBtn);
    form.append(label, inputRow);

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = this.input.value.trim().replace(/\s+/g, " ");
      if (!text) {
        this.handlers.onEmptyWish?.();
        this.input.focus();
        return;
      }
      this.input.value = "";
      this.recordWish(text);
      this.handlers.onHangWish?.(text);
    });

    const boardTitle = document.createElement("h3");
    boardTitle.className = "wish-section-title";
    boardTitle.textContent = vi.wishTree.boardTitle;

    this.board = document.createElement("ul");
    this.board.className = "wish-board";

    this.statsEl = document.createElement("p");
    this.statsEl.className = "wish-stats";

    body.append(form, boardTitle, this.board, this.statsEl);
    this.dialog.append(head, desc, body);

    this.offBackdrop = closeOnBackdrop(this.dialog);

    parent.append(this.dialog);
    this.renderBoard();
  }

  /** Number of personal wishes saved in localStorage. */
  get savedCount(): number {
    return this.myWishes.length;
  }

  /** Records a wish plaque (e.g. from the Wish Tree dialog or Offering dialog) without duplicating consecutive entries. */
  recordWish(wishText: string): void {
    const clean = wishText.trim().replace(/\s+/g, " ");
    if (!clean) return;
    if (this.myWishes[0] !== clean) {
      this.myWishes.unshift(clean);
      if (this.myWishes.length > MAX_SAVED_WISHES) {
        this.myWishes.length = MAX_SAVED_WISHES;
      }
      saveMyWishes(this.myWishes);
    }
    this.renderBoard();
  }

  open(): void {
    this.renderBoard();
    if (!this.dialog.open) {
      this.dialog.showModal();
    }
  }

  close(): void {
    if (this.dialog.open) {
      this.dialog.close();
    }
  }

  dispose(): void {
    this.close();
    this.offBackdrop();
    this.dialog.remove();
  }

  private renderBoard(): void {
    this.board.innerHTML = "";

    const renderItem = (text: string, isMine: boolean): void => {
      const li = document.createElement("li");
      li.className = isMine ? "wish-plaque wish-plaque--mine" : "wish-plaque";

      const head = document.createElement("div");
      head.className = "wish-plaque-head";
      const badge = document.createElement("span");
      badge.textContent = isMine ? `✦ ${vi.wishTree.mineBadge}` : `❀ ${vi.wishTree.visitorBadge}`;
      head.append(badge);

      const p = document.createElement("p");
      p.className = "wish-plaque-text";
      p.textContent = text;

      li.append(head, p);
      this.board.append(li);
    };

    for (const w of this.myWishes) {
      renderItem(w, true);
    }
    for (const w of vi.wishTree.seedWishes) {
      renderItem(w, false);
    }

    const totalPlaques = Math.min(36, BASE_TREE_PLAQUES + this.myWishes.length);
    this.statsEl.textContent = vi.wishTree.stats
      .replace("{total}", String(totalPlaques))
      .replace("{mine}", String(this.myWishes.length));
  }
}
