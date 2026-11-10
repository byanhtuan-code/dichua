import { vi } from "../i18n/vi.ts";
import { closeOnBackdrop } from "./dialog.ts";
import type { InviteAction } from "./invite-action.ts";
import "./base.css";

const COPIED_MS = 2000;

/** "Mời bạn ngồi cạnh": the link in our own dialog + a copy button (replaces the OS share sheet). */
export class InviteDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly input: HTMLInputElement;
  private readonly copyBtn: HTMLButtonElement;
  private readonly note: HTMLParagraphElement;
  private readonly off: (() => void)[] = [];
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly action: InviteAction,
    parent: HTMLElement = document.body,
  ) {
    this.dialog = document.createElement("dialog");
    this.dialog.className = "dialog";
    this.dialog.setAttribute("aria-labelledby", "invite-title");
    this.dialog.setAttribute("aria-describedby", "invite-desc");

    const head = document.createElement("header");
    head.className = "dialog-head";
    const title = document.createElement("h2");
    title.id = "invite-title";
    title.textContent = vi.invite.title;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "dialog-close";
    close.setAttribute("aria-label", vi.invite.close);
    close.textContent = "×";
    close.addEventListener("click", () => this.close());
    head.append(title, close);

    const desc = document.createElement("p");
    desc.id = "invite-desc";
    desc.className = "dialog-desc";
    desc.textContent = vi.invite.desc;

    const box = document.createElement("div");
    box.className = "invite-copy";
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.readOnly = true;
    this.input.className = "invite-link";
    this.input.spellcheck = false;
    this.input.setAttribute("aria-label", vi.invite.field);
    this.input.addEventListener("focus", () => this.input.select());
    this.copyBtn = document.createElement("button");
    this.copyBtn.type = "button";
    this.copyBtn.className = "btn";
    this.copyBtn.textContent = vi.invite.copy;
    this.copyBtn.addEventListener("click", () => void this.copy());
    this.note = document.createElement("p");
    this.note.className = "dialog-desc invite-note";
    this.note.setAttribute("role", "status");
    box.append(this.input, this.copyBtn, this.note);

    this.dialog.append(head, desc, box);
    this.off.push(closeOnBackdrop(this.dialog), action.onChange(() => this.render()));
    parent.append(this.dialog);
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  open(): void {
    this.note.textContent = "";
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
    this.copyBtn.focus();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  dispose(): void {
    clearTimeout(this.copiedTimer);
    for (const off of this.off) off();
    this.close();
    this.dialog.remove();
  }

  private render(): void {
    const link = this.action.link();
    if (link !== this.input.value) {
      // A new id (reconnect) makes the old "copied" / hand-copy hint wrong.
      this.note.textContent = "";
      this.resetCopied();
    }
    this.input.value = link ?? "";
    this.input.placeholder = link === null ? vi.invite.offline : "";
    this.copyBtn.disabled = link === null;
  }

  private async copy(): Promise<void> {
    const link = this.action.link();
    const result = await this.action.copy();
    // The link changed while the clipboard was busy: what we copied is already stale.
    if (result === null || this.action.link() !== link) return;
    if (result === "copied") {
      this.note.textContent = "";
      this.copyBtn.textContent = vi.invite.copied;
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.resetCopied(), COPIED_MS);
    } else {
      this.note.textContent = vi.invite.manual;
      this.input.focus();
      this.input.select();
    }
  }

  private resetCopied(): void {
    clearTimeout(this.copiedTimer);
    this.copyBtn.textContent = vi.invite.copy;
  }
}
