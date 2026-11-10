import { MAX_NAME_CHARS, normalizeVisitorName } from "@santinh/shared";
import { vi } from "../i18n/vi.ts";
import { closeOnBackdrop } from "./dialog.ts";
import "./base.css";

/** `enter`: first visit, every way out means "Vào". `rename`: "Lưu" or close to keep the old name. */
export type NameMode = "enter" | "rename";

/** Empty after normalising → the fallback (the suggestion, or the current name when renaming). */
export function chosenName(raw: string, fallback: string): string {
  return normalizeVisitorName(raw) ?? normalizeVisitorName(fallback) ?? fallback;
}

/** Name dialog (P3-D4): asks before the first connect, and later renames (T5b). */
export class NameDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly title: HTMLHeadingElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly input: HTMLInputElement;
  private readonly submit: HTMLButtonElement;
  private readonly offBackdrop: () => void;
  private mode: NameMode = "enter";
  private fallback = "";
  /** Cleared on the first submit, so a double tap (or Enter + click) sends once. */
  private pending: ((name: string) => void) | null = null;

  constructor(parent: HTMLElement = document.body) {
    this.dialog = document.createElement("dialog");
    this.dialog.className = "dialog";
    this.dialog.setAttribute("aria-labelledby", "name-title");
    this.dialog.setAttribute("aria-describedby", "name-desc");

    const head = document.createElement("header");
    head.className = "dialog-head";
    this.title = document.createElement("h2");
    this.title.id = "name-title";
    this.closeBtn = document.createElement("button");
    this.closeBtn.type = "button";
    this.closeBtn.className = "dialog-close";
    this.closeBtn.setAttribute("aria-label", vi.name.close);
    this.closeBtn.textContent = "×";
    this.closeBtn.addEventListener("click", () => this.dialog.close());
    head.append(this.title, this.closeBtn);

    const desc = document.createElement("p");
    desc.id = "name-desc";
    desc.className = "dialog-desc";
    desc.textContent = vi.name.desc;

    const form = document.createElement("form");
    form.className = "name-form";
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "invite-link";
    this.input.maxLength = MAX_NAME_CHARS;
    this.input.setAttribute("autocomplete", "nickname");
    this.input.spellcheck = false;
    this.input.autofocus = true;
    this.input.setAttribute("aria-label", vi.name.field);
    this.submit = document.createElement("button");
    this.submit.type = "submit";
    this.submit.className = "btn";
    form.append(this.input, this.submit);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.finish();
    });

    this.dialog.append(head, desc, form);
    this.offBackdrop = closeOnBackdrop(this.dialog);
    // Esc and the backdrop both end in `close`; on the first visit that still means "Vào" with what is typed.
    this.dialog.addEventListener("close", () => {
      // `close` is queued: a dismiss followed by a quick reopen must not submit the new prompt.
      if (this.dialog.open) return;
      if (this.mode === "enter") this.finish();
      else this.pending = null;
    });
    parent.append(this.dialog);
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  /** Shows the dialog with `value` filled in and selected; `onDone` gets the chosen name once. */
  open(mode: NameMode, value: string, onDone: (name: string) => void): void {
    this.mode = mode;
    this.fallback = value;
    this.pending = onDone;
    this.title.textContent = mode === "enter" ? vi.name.title : vi.name.renameTitle;
    this.submit.textContent = mode === "enter" ? vi.name.enter : vi.name.save;
    this.closeBtn.hidden = mode === "enter";
    this.input.value = value;
    if (!this.dialog.open) this.dialog.showModal();
    this.input.focus();
    this.input.select();
  }

  /** Closes without a choice (the page is suspending); `open` again later to ask again. */
  dismiss(): void {
    this.pending = null;
    if (this.dialog.open) this.dialog.close();
  }

  dispose(): void {
    this.dismiss();
    this.offBackdrop();
    this.dialog.remove();
  }

  private finish(): void {
    const done = this.pending;
    if (!done) return;
    this.pending = null;
    if (this.dialog.open) this.dialog.close();
    done(chosenName(this.input.value, this.fallback));
  }
}
