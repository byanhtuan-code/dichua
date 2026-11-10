import { vi } from "../i18n/vi.ts";
import { icons } from "./icons.ts";
import "./base.css";

export interface WalkChip {
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** "Đang đi · Dừng" chip shown while walking (L2.1); pressing it stops. */
export function createWalkChip(onStop: () => void, parent: HTMLElement = document.body): WalkChip {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chip walk-chip";
  button.innerHTML = icons.stop;
  button.append(vi.walk.stop);
  button.hidden = true;
  const click = (): void => onStop();
  button.addEventListener("click", click);
  parent.append(button);

  let shown = false;
  return {
    setVisible(visible) {
      if (visible === shown) return;
      shown = visible;
      button.hidden = !visible;
    },
    dispose() {
      button.removeEventListener("click", click);
      button.remove();
    },
  };
}
