import { vi } from "../i18n/vi.ts";

export type BootError = "load" | "webgl";

/** Turn the static boot screen into an error state (AC2). Safe to call more than once. */
export function showBootError(kind: BootError): void {
  const boot = document.getElementById("boot");
  if (!boot) return;
  // The boot overlay is only hidden after the first frame, so late errors (context lost) can reuse it.
  boot.hidden = false;
  const title = boot.querySelector<HTMLElement>('[data-boot="title"]');
  const body = boot.querySelector<HTMLElement>('[data-boot="body"]');
  const retry = boot.querySelector<HTMLAnchorElement>('[data-boot="retry"]');
  boot.querySelector('[data-boot="breath"]')?.remove();

  if (title) title.textContent = kind === "load" ? vi.boot.loadErrorTitle : vi.boot.noWebglTitle;
  if (body) body.textContent = kind === "load" ? vi.boot.loadErrorBody : vi.boot.noWebglBody;
  boot.setAttribute("role", kind === "load" ? "alert" : "status");

  if (!retry) return;
  if (kind === "webgl") {
    // Reloading cannot fix a missing WebGL; the design shows no button here.
    retry.remove();
  } else {
    retry.className = "btn";
  }
}

export function hideBoot(): void {
  const boot = document.getElementById("boot");
  if (boot) boot.hidden = true;
}
