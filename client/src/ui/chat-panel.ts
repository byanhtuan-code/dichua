import {
  CHAT_HISTORY,
  CHAT_LIMITS,
  ChatThrottle,
  QUIET_ROOM_COUNT,
  ROOMS,
  normalizeChatText,
  type ChatDeniedReason,
  type ChatLine,
  type ChatTier,
  type ConnectionStatus,
} from "@santinh/shared";
import { vi } from "../i18n/vi.ts";
import type { NetDriver } from "../net/net-driver.ts";
import type { AccountMode } from "./account-dialog.ts";
import { icons } from "./icons.ts";
import "./base.css";
import "./chat-panel.css";

/** The counter shows up when this few characters are left. */
export const CHAT_COUNTER_FROM = 20;
/** A refusal line stays under the input this long. */
export const CHAT_DENIED_MS = 4000;
const TICK_MS = 250;
/** The server answers every line (echo or refusal); past this we stop waiting so the field is not stuck. */
const PENDING_MS = 5000;

/**
 * Length the server will count (code points of the normalised text, P4-D7).
 * Over the limit the raw count is used: it is never smaller, so "over" stays over.
 */
export function chatLength(raw: string, tier: ChatTier): number {
  const r = normalizeChatText(raw, tier);
  if (r.ok) return [...r.text].length;
  return r.reason === "empty" ? 0 : [...raw].length;
}

export interface CounterState {
  /** Counter text, or "" when hidden. */
  text: string;
  over: boolean;
}

export function counterState(raw: string, tier: ChatTier): CounterState {
  const left = CHAT_LIMITS[tier].maxChars - chatLength(raw, tier);
  if (left < 0) return { text: vi.chat.over.replace("{n}", String(-left)), over: true };
  if (left < CHAT_COUNTER_FROM) return { text: vi.chat.left.replace("{n}", String(left)), over: false };
  return { text: "", over: false };
}

/** Whole seconds shown on the send button while waiting (never 0 while still blocked). */
export function cooldownSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

/** Adds a line at the end, keeping the newest `CHAT_HISTORY`; a line already there (same id) is not doubled. */
export function appendLine(lines: readonly ChatLine[], line: ChatLine): ChatLine[] {
  if (lines.some((l) => l.id === line.id)) return [...lines];
  return [...lines, line].slice(-CHAT_HISTORY);
}

/** History replaces what we had (it is the room's whole recent log), capped like live lines. */
export function historyLines(lines: readonly ChatLine[]): ChatLine[] {
  return lines.slice(-CHAT_HISTORY);
}

export function deniedText(reason: ChatDeniedReason, tier: ChatTier, retryInMs?: number): string {
  if (reason === "too-fast") return vi.chat.denied["too-fast"].replace("{n}", String(cooldownSeconds(retryInMs ?? 0)));
  if (reason === "too-long") return vi.chat.denied["too-long"].replace("{n}", String(CHAT_LIMITS[tier].maxChars));
  return vi.chat.denied[reason];
}

/** "sang phòng 4–10": numbers from the room table, not the copy. */
export function quietHintText(): string {
  return vi.chat.quietHint.replace("{first}", String(QUIET_ROOM_COUNT + 1)).replace("{last}", String(ROOMS.length));
}

export interface ChatPanelDeps {
  driver: NetDriver;
  roomAllowsChat(roomId: string): boolean;
  isSignedIn(): boolean;
  openAccount(mode: AccountMode): void;
  /** Room picker, from the quiet-room note. */
  openRooms(): void;
  /** Client clock; tests may pass their own. */
  now?(): number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/**
 * Room chat (P4-D9): a glass panel bottom-left; under 600 px a 💬 button that opens it as a bottom sheet.
 * Quiet rooms have no panel at all. Guests read, and get a "create an account" button instead of the input.
 */
export class ChatPanel {
  private readonly root: HTMLDivElement;
  /** Stands where the panel would be in a quiet room, so the empty corner reads as "silent here", not "broken". */
  private readonly quiet: HTMLButtonElement;
  private readonly fab: HTMLButtonElement;
  private readonly fabDot: HTMLSpanElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly panel: HTMLElement;
  private readonly list: HTMLOListElement;
  private readonly emptyNote: HTMLParagraphElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly counter: HTMLSpanElement;
  private readonly sendBtn: HTMLButtonElement;
  private readonly guestBtn: HTMLButtonElement;
  private readonly denied: HTMLParagraphElement;
  private readonly offs: (() => void)[] = [];
  private readonly throttle = new ChatThrottle();
  private readonly now: () => number;
  private lines: ChatLine[] = [];
  private room: string | null = null;
  private selfId: string | null = null;
  private status: ConnectionStatus = "connecting";
  private tier: ChatTier = "free";
  private open = false;
  private unread = false;
  /** Server-told wait (`chatDenied too-fast`), on top of what our own throttle knows. */
  private blockedUntil = 0;
  /** Normalised text of the line in flight: booked when the server echoes it, put back when refused. */
  private pending: string | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private deniedTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: ChatPanelDeps, parent: HTMLElement = document.body) {
    this.now = deps.now ?? Date.now;
    this.root = el("div", "chat");
    this.root.hidden = true;

    this.fab = el("button", "chat-fab glass");
    this.fab.type = "button";
    this.fab.append(el("span", "", "💬"));
    this.fab.firstElementChild?.setAttribute("aria-hidden", "true");
    this.fabDot = el("span", "chat-fab-dot");
    this.fabDot.hidden = true;
    this.fab.append(this.fabDot);
    this.fab.addEventListener("click", () => this.setOpen(true));

    this.panel = el("section", "chat-panel glass");
    this.panel.setAttribute("aria-label", vi.chat.title);
    const head = el("div", "chat-head");
    const close = (this.closeBtn = el("button", "tool tool-circle chat-close"));
    close.type = "button";
    close.innerHTML = icons.chevron;
    close.setAttribute("aria-label", vi.chat.close);
    close.addEventListener("click", () => this.setOpen(false));
    head.append(el("strong", "", vi.chat.title), close);

    this.list = el("ol", "chat-list");
    this.list.setAttribute("role", "log");
    this.list.setAttribute("aria-label", vi.chat.log);
    this.emptyNote = el("p", "chat-empty", vi.chat.empty);

    this.form = el("form", "chat-form");
    this.input = el("input", "chat-input");
    this.input.type = "text";
    this.input.enterKeyHint = "send";
    this.input.autocomplete = "off";
    this.input.placeholder = vi.chat.placeholder;
    this.input.setAttribute("aria-label", vi.chat.input);
    this.counter = el("span", "chat-counter");
    this.sendBtn = el("button", "chip chat-send", vi.chat.send);
    this.sendBtn.type = "submit";
    this.form.append(this.input, this.counter, this.sendBtn);
    this.form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.send();
    });
    this.input.addEventListener("input", () => this.renderForm());
    this.input.addEventListener("keydown", (e) => {
      // Esc only leaves the field (keys go back to walking); it must not close anything else.
      // Enter that only confirms an IME word (Vietnamese Telex) must not send; Safari reports it as keyCode 229.
      if (e.key === "Enter" && (e.isComposing || e.keyCode === 229)) {
        e.preventDefault();
        return;
      }
      if (e.key === "Escape") {
        e.stopPropagation();
        // In the sheet, focus stays inside it so a second Esc closes it.
        if (this.open) this.closeBtn.focus();
        else this.input.blur();
      }
    });

    this.guestBtn = el("button", "chip chat-guest", vi.chat.needAccount);
    this.guestBtn.type = "button";
    this.guestBtn.addEventListener("click", () => deps.openAccount("register"));

    this.denied = el("p", "chat-denied");
    this.denied.setAttribute("role", "status");

    this.panel.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.open) this.setOpen(false);
    });
    this.panel.append(head, this.list, this.emptyNote, this.form, this.guestBtn, this.denied);
    this.root.append(this.fab, this.panel);

    this.quiet = el("button", "chat-quiet glass");
    this.quiet.type = "button";
    this.quiet.hidden = true;
    const mark = el("span", "chat-quiet-icon");
    mark.innerHTML = icons.chatOff;
    const words = el("span", "chat-quiet-text");
    words.append(el("strong", "", vi.chat.quietTitle), el("small", "", quietHintText()));
    this.quiet.append(mark, words);
    this.quiet.addEventListener("click", () => deps.openRooms());
    parent.append(this.root, this.quiet);

    const d = deps.driver;
    this.offs.push(
      d.on("snapshot", (s) => {
        this.selfId = s.selfId;
        this.setRoom(s.room);
      }),
      d.on("status", (s) => {
        this.status = s;
        // A line in flight when the link drops gets no answer.
        if (s !== "connected") this.settle(true);
        this.renderForm();
      }),
      d.on("account", (a) => {
        if (a) this.tier = a.tier;
        this.refresh();
      }),
      d.on("chatHistory", (lines) => {
        this.lines = historyLines(lines);
        this.renderList(true);
      }),
      d.on("chat", (line) => this.onLine(line)),
      d.on("chatDenied", (r) => this.onDenied(r.reason, r.retryInMs)),
    );
    this.refresh();
  }

  /** Quiet room → no panel and no lines; another chat room → its lines come with `chatHistory`. */
  setRoom(id: string): void {
    if (id === this.room) return;
    this.room = id;
    this.lines = [];
    this.unread = false;
    this.settle(false);
    this.showDenied("");
    const allowed = this.deps.roomAllowsChat(id);
    if (!allowed) this.setOpen(false);
    this.root.hidden = !allowed;
    this.quiet.hidden = allowed;
    this.renderList(true);
    this.renderFab();
  }

  /** Signed in or out (also called by the page when the session changes without an `account` frame). */
  refresh(): void {
    const signedIn = this.deps.isSignedIn();
    this.form.hidden = !signedIn;
    this.guestBtn.hidden = signedIn;
    if (!signedIn) this.settle(false);
    this.renderForm();
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.stopTick();
    if (this.deniedTimer) clearTimeout(this.deniedTimer);
    this.settle(false);
    this.root.remove();
    this.quiet.remove();
  }

  private setOpen(open: boolean): void {
    if (this.open === open) return;
    this.open = open;
    this.root.toggleAttribute("data-open", open);
    if (open) {
      this.unread = false;
      this.renderFab();
      this.list.scrollTop = this.list.scrollHeight;
      this.closeBtn.focus();
    } else if (this.panel.contains(document.activeElement)) {
      this.fab.focus();
    }
  }

  private onLine(line: ChatLine): void {
    const mine = line.visitorId === this.selfId;
    if (mine) {
      this.throttle.record(this.pending ?? line.text, this.now());
      this.settle(false);
      this.renderForm();
    } else if (!this.open && this.fab.getClientRects().length > 0) {
      // Only the collapsed (narrow-screen) form has a dot to light; the wide panel is always in view.
      this.unread = true;
      this.renderFab();
    }
    this.lines = appendLine(this.lines, line);
    this.renderList(mine);
  }

  private onDenied(reason: ChatDeniedReason, retryInMs?: number): void {
    if (reason === "too-fast" && retryInMs !== undefined) this.blockedUntil = this.now() + retryInMs;
    this.settle(true);
    this.showDenied(deniedText(reason, this.tier, retryInMs));
    this.renderForm();
  }

  private send(): void {
    if (this.form.hidden || this.status !== "connected" || this.waitMs() > 0) return;
    const r = normalizeChatText(this.input.value, this.tier);
    if (!r.ok) {
      if (r.reason === "too-long") this.showDenied(deniedText("too-long", this.tier));
      return;
    }
    const verdict = this.throttle.check(r.text, this.now(), this.tier);
    if (!verdict.ok) {
      this.showDenied(deniedText(verdict.reason, this.tier, verdict.retryInMs));
      this.renderForm();
      return;
    }
    this.pending = r.text;
    this.pendingTimer = setTimeout(() => {
      this.settle(true);
      this.renderForm();
    }, PENDING_MS);
    this.deps.driver.sendChat(r.text);
    this.input.value = "";
    this.showDenied("");
    this.renderForm();
  }

  /** Stops waiting for the line in flight; `restore` puts it back in the (cleared) field so nothing typed is lost. */
  private settle(restore: boolean): void {
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
    if (restore && this.pending !== null && this.input.value === "") this.input.value = this.pending;
    this.pending = null;
  }

  /** How long until our next line may go, by our own throttle or the server's word. */
  private waitMs(): number {
    const now = this.now();
    // Any text works for the timing part; duplicates are judged on send.
    const v = this.throttle.check("\u0000", now, this.tier);
    const own = !v.ok && v.reason === "too-fast" ? (v.retryInMs ?? 0) : 0;
    return Math.max(own, this.blockedUntil - now, 0);
  }

  private renderForm(): void {
    const c = counterState(this.input.value, this.tier);
    this.counter.textContent = c.text;
    this.counter.classList.toggle("chat-counter--over", c.over);
    const wait = this.waitMs();
    this.sendBtn.textContent = wait > 0 ? vi.chat.sendIn.replace("{n}", String(cooldownSeconds(wait))) : vi.chat.send;
    this.sendBtn.disabled =
      this.status !== "connected" || wait > 0 || c.over || this.pending !== null || chatLength(this.input.value, this.tier) === 0;
    if (wait > 0) this.startTick();
    else this.stopTick();
  }

  private startTick(): void {
    this.tick ??= setInterval(() => this.renderForm(), TICK_MS);
  }

  private stopTick(): void {
    if (this.tick === null) return;
    clearInterval(this.tick);
    this.tick = null;
  }

  private showDenied(text: string): void {
    if (this.deniedTimer) clearTimeout(this.deniedTimer);
    this.deniedTimer = null;
    this.denied.textContent = text;
    if (text) this.deniedTimer = setTimeout(() => (this.denied.textContent = ""), CHAT_DENIED_MS);
  }

  private renderFab(): void {
    this.fabDot.hidden = !this.unread;
    this.fab.setAttribute("aria-label", this.unread ? `${vi.chat.open} · ${vi.chat.unread}` : vi.chat.open);
  }

  /** `stick`: scroll to the end even if the reader had scrolled up (our own line, a fresh history). */
  private renderList(stick: boolean): void {
    const l = this.list;
    const atEnd = l.scrollHeight - l.scrollTop - l.clientHeight < 8;
    const items = this.lines.map((line) => {
      const li = el("li", "chat-line");
      const mine = line.visitorId === this.selfId;
      const name = el("b", mine ? "chat-name chat-name--self" : "chat-name", mine ? vi.labels.you : line.name);
      li.append(name, document.createTextNode(` ${line.text}`));
      return li;
    });
    l.replaceChildren(...items);
    this.emptyNote.hidden = this.lines.length > 0;
    if (stick || atEnd) l.scrollTop = l.scrollHeight;
  }
}
