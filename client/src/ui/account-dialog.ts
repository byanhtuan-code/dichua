import {
  MAX_NAME_CHARS,
  PASSWORD_MAX,
  PASSWORD_MIN,
  ROOMS,
  USERNAME_MAX,
  USERNAME_MIN,
  isValidPassword,
  normalizeUsername,
  normalizeVisitorName,
  roomAllowsChat,
  type AccountView,
} from "@santinh/shared";
import type { AccountApi, AccountFailure } from "../net/account-api.ts";
import { vi } from "../i18n/vi.ts";
import { closeOnBackdrop } from "./dialog.ts";
import "./base.css";

export type AccountMode = "register" | "login";

export interface AccountDone {
  token: string;
  account: AccountView;
}

export interface AccountOpenOptions {
  /** Pre-fills "Tên nhân vật" (the name in use now). */
  suggestedName: string;
  onDone: (done: AccountDone) => void;
}

export interface AccountFields {
  username: string;
  password: string;
  displayName: string;
}

type Field = keyof AccountFields;

export interface InputProblem {
  field: Field;
  text: string;
}

const t = vi.account;

/** "phòng 4–10": read from ROOMS so the copy follows the room table (P4-D1). */
export function registerDescText(): string {
  const chat = ROOMS.filter((r) => roomAllowsChat(r.id)).map((r) => r.number);
  return t.registerDesc.replace("{from}", String(Math.min(...chat))).replace("{to}", String(Math.max(...chat)));
}

/** Same checks the server makes (shared helpers), so most mistakes never cost a request or a rate-limit slot. */
export function checkAccountInput(mode: AccountMode, f: AccountFields): InputProblem | null {
  if (mode === "login") {
    if (f.username.trim() === "" || f.password === "") return { field: f.username.trim() === "" ? "username" : "password", text: t.missing };
    // A name or password the server could never have stored cannot match.
    if (normalizeUsername(f.username) === null || !isValidPassword(f.password)) return { field: "username", text: t.badCredentials };
    return null;
  }
  if (normalizeUsername(f.username) === null) {
    return { field: "username", text: t.badUsername.replace("{min}", String(USERNAME_MIN)).replace("{max}", String(USERNAME_MAX)) };
  }
  if (!isValidPassword(f.password)) {
    return { field: "password", text: t.badPassword.replace("{min}", String(PASSWORD_MIN)).replace("{max}", String(PASSWORD_MAX)) };
  }
  if (normalizeVisitorName(f.displayName) === null) return { field: "displayName", text: t.badDisplayName };
  return null;
}

/** Server / network failure → one plain line (never mentions tiers, P4 principle 11). */
export function accountErrorText(f: AccountFailure): string {
  switch (f.error) {
    case "taken":
      return t.taken;
    case "bad-credentials":
      return t.badCredentials;
    case "rate-limit": {
      if (f.retryAfterMs === undefined) return t.rateLimitSoon;
      const min = Math.max(1, Math.ceil(f.retryAfterMs / 60_000));
      // The register limit is per day: "1380 phút" reads worse than "23 giờ".
      return min > 60 ? t.rateLimitHours.replace("{n}", String(Math.ceil(min / 60))) : t.rateLimit.replace("{n}", String(min));
    }
    case "bad-input":
      return t.badInput;
    case "unauthorized":
    case "network":
      return t.network;
  }
}

function field(
  label: string,
  input: HTMLInputElement,
  hint?: string,
): { wrap: HTMLLabelElement; hint: HTMLElement | null } {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const span = document.createElement("span");
  span.textContent = label;
  input.className = "invite-link";
  input.spellcheck = false;
  wrap.append(span, input);
  let hintEl: HTMLElement | null = null;
  if (hint !== undefined) {
    hintEl = document.createElement("small");
    hintEl.textContent = hint;
    wrap.append(hintEl);
  }
  return { wrap, hint: hintEl };
}

/** Register / log in (P4-D10). No design source: same glass dialog, `.name-form`, `.invite-link`, `.btn` as the name dialog. */
export class AccountDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly title: HTMLHeadingElement;
  private readonly desc: HTMLParagraphElement;
  private readonly inputs: Record<Field, HTMLInputElement>;
  private readonly nameField: HTMLLabelElement;
  private readonly userHint: HTMLElement | null;
  private readonly error: HTMLParagraphElement;
  private readonly submit: HTMLButtonElement;
  private readonly note: HTMLParagraphElement;
  private readonly switchText: HTMLSpanElement;
  private readonly switchBtn: HTMLButtonElement;
  private readonly offBackdrop: () => void;
  private mode: AccountMode = "register";
  private onDone: ((done: AccountDone) => void) | null = null;
  /** Set synchronously on submit, so a double tap / Enter + click sends one request. */
  private busy = false;

  constructor(
    private readonly api: AccountApi,
    parent: HTMLElement = document.body,
  ) {
    this.dialog = document.createElement("dialog");
    this.dialog.className = "dialog";
    this.dialog.setAttribute("aria-labelledby", "account-title");
    this.dialog.setAttribute("aria-describedby", "account-desc");

    const head = document.createElement("header");
    head.className = "dialog-head";
    this.title = document.createElement("h2");
    this.title.id = "account-title";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "dialog-close";
    close.setAttribute("aria-label", t.close);
    close.textContent = "×";
    close.addEventListener("click", () => this.close());
    head.append(this.title, close);

    this.desc = document.createElement("p");
    this.desc.id = "account-desc";
    this.desc.className = "dialog-desc";

    const username = document.createElement("input");
    username.type = "text";
    username.name = "username";
    username.maxLength = USERNAME_MAX;
    username.autocapitalize = "none";
    username.setAttribute("autocorrect", "off");
    username.setAttribute("autocomplete", "username");
    const password = document.createElement("input");
    password.type = "password";
    password.name = "password";
    const displayName = document.createElement("input");
    displayName.type = "text";
    displayName.name = "nickname";
    displayName.maxLength = MAX_NAME_CHARS;
    displayName.setAttribute("autocomplete", "nickname");
    this.inputs = { username, password, displayName };

    const user = field(t.username, username, t.usernameHint);
    this.userHint = user.hint;
    const pass = field(t.password, password);
    const name = field(t.displayName, displayName, t.displayNameHint);
    this.nameField = name.wrap;

    this.error = document.createElement("p");
    this.error.id = "account-error";
    this.error.className = "form-error";
    this.error.setAttribute("role", "alert");

    this.submit = document.createElement("button");
    this.submit.type = "submit";
    this.submit.className = "btn";

    const form = document.createElement("form");
    form.className = "name-form account-form";
    form.noValidate = true;
    form.append(user.wrap, pass.wrap, name.wrap, this.error, this.submit);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      void this.send();
    });
    for (const input of Object.values(this.inputs)) input.addEventListener("input", () => this.clearError());

    this.note = document.createElement("p");
    this.note.className = "dialog-desc account-note";
    this.note.textContent = t.noEmail;

    const switchRow = document.createElement("p");
    switchRow.className = "account-switch";
    this.switchText = document.createElement("span");
    this.switchBtn = document.createElement("button");
    this.switchBtn.type = "button";
    this.switchBtn.className = "btn btn--link";
    this.switchBtn.addEventListener("click", () => this.setMode(this.mode === "register" ? "login" : "register"));
    switchRow.append(this.switchText, this.switchBtn);

    // Scrolls inside the dialog on short phones instead of clipping the button.
    const body = document.createElement("div");
    body.className = "dialog-body";
    body.append(form, this.note, switchRow);

    this.dialog.append(head, this.desc, body);
    this.offBackdrop = closeOnBackdrop(this.dialog);
    parent.append(this.dialog);
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  open(mode: AccountMode, opts: AccountOpenOptions): void {
    this.onDone = opts.onDone;
    // A request still in flight keeps its own outcome; a fresh open starts clean.
    if (!this.busy) {
      this.inputs.password.value = "";
      this.inputs.displayName.value = opts.suggestedName;
    }
    this.setMode(mode);
    if (!this.dialog.open) this.dialog.showModal();
    this.inputs.username.focus();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  dispose(): void {
    this.close();
    this.offBackdrop();
    this.dialog.remove();
  }

  private setMode(mode: AccountMode): void {
    this.mode = mode;
    const reg = mode === "register";
    this.title.textContent = reg ? t.registerTitle : t.loginTitle;
    this.desc.textContent = reg ? registerDescText() : t.loginDesc;
    this.nameField.hidden = !reg;
    if (this.userHint) this.userHint.hidden = !reg;
    this.note.hidden = !reg;
    this.inputs.password.setAttribute("autocomplete", reg ? "new-password" : "current-password");
    this.switchText.textContent = reg ? t.haveAccount : t.noAccount;
    this.switchBtn.textContent = reg ? t.toLogin : t.toRegister;
    this.clearError();
    this.renderBusy();
  }

  private renderBusy(): void {
    this.submit.disabled = this.busy;
    this.switchBtn.disabled = this.busy;
    this.submit.textContent = this.busy ? t.sending : this.mode === "register" ? t.register : t.login;
    this.dialog.setAttribute("aria-busy", String(this.busy));
  }

  private clearError(): void {
    this.error.textContent = "";
    for (const input of Object.values(this.inputs)) {
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
    }
  }

  private showError(text: string, at: Field | null): void {
    this.clearError();
    this.error.textContent = text;
    if (at === null) return;
    const input = this.inputs[at];
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", this.error.id);
    input.focus();
  }

  private async send(): Promise<void> {
    if (this.busy) return;
    const mode = this.mode;
    const f: AccountFields = {
      username: this.inputs.username.value,
      password: this.inputs.password.value,
      displayName: this.inputs.displayName.value,
    };
    const problem = checkAccountInput(mode, f);
    if (problem) {
      this.showError(problem.text, problem.field);
      return;
    }
    this.busy = true;
    this.clearError();
    this.renderBusy();
    const r =
      mode === "register"
        ? await this.api.register(f.username, f.password, normalizeVisitorName(f.displayName) ?? f.displayName)
        : await this.api.login(f.username, f.password);
    this.busy = false;
    this.renderBusy();
    if (!r.ok) {
      this.showError(accountErrorText(r), r.error === "taken" ? "username" : r.error === "bad-credentials" ? "password" : null);
      return;
    }
    // The api only hands out register / login results with a token; guard anyway rather than store nothing.
    if (r.token === undefined) {
      this.showError(t.network, null);
      return;
    }
    this.inputs.password.value = "";
    // The server already holds the new session: apply it even if the dialog was closed meanwhile.
    const done = this.onDone;
    this.close();
    done?.({ token: r.token, account: r.account });
  }
}
