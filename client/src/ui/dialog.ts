/** Closes a modal <dialog> on a click on its ::backdrop (the event lands on the dialog itself, outside its box). */
export function closeOnBackdrop(dialog: HTMLDialogElement): () => void {
  const onClick = (e: MouseEvent): void => {
    if (e.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dialog.close();
  };
  dialog.addEventListener("click", onClick);
  return () => dialog.removeEventListener("click", onClick);
}

/**
 * Full-screen modal <dialog> (top layer → the game behind is inert, keys stay out of WASD via `ownedByUi`).
 * Esc means the primary action, never a silent close.
 */
export function overlayDialog(className: string, labelledBy: string, onPrimary: () => void): HTMLDialogElement {
  const d = document.createElement("dialog");
  d.className = `overlay ${className}`;
  d.setAttribute("aria-labelledby", labelledBy);
  d.addEventListener("cancel", (e) => {
    e.preventDefault();
    onPrimary();
  });
  return d;
}
