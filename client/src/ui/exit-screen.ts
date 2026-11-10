import { vi } from "../i18n/vi.ts";
import { overlayDialog } from "./dialog.ts";
import { icons } from "./icons.ts";
import "./base.css";

/** "Bạn đã nghỉ ngơi đủ chưa?" (design/exit.html): shown after leaving; "Ở lại thêm" rejoins. */
export class ExitScreen {
  private readonly dialog: HTMLDialogElement;

  constructor(onStay: () => void, parent: HTMLElement = document.body) {
    this.dialog = overlayDialog("overlay--paper", "exit-title", onStay);
    const mark = document.createElement("span");
    mark.className = "exit-mark";
    mark.innerHTML = icons.temple;
    const brand = document.createElement("p");
    brand.className = "overlay-brand";
    brand.textContent = vi.exit.brand;
    const title = document.createElement("h1");
    title.id = "exit-title";
    title.textContent = vi.exit.title;
    const body = document.createElement("p");
    vi.exit.body.forEach((line, i) => {
      if (i > 0) body.append(document.createElement("br"));
      body.append(line);
    });
    const stay = document.createElement("button");
    stay.type = "button";
    stay.className = "btn";
    stay.textContent = vi.exit.stay;
    stay.addEventListener("click", onStay);
    this.dialog.append(mark, brand, title, body, stay);
    parent.append(this.dialog);
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  show(): void {
    if (!this.dialog.open) this.dialog.showModal();
  }

  hide(): void {
    if (this.dialog.open) this.dialog.close();
  }

  dispose(): void {
    this.hide();
    this.dialog.remove();
  }
}
