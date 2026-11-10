import { QUIET_ROOM_COUNT, ROOMS, roomAllowsChat, roomNameOf, roomNumber, type RoomInfo } from "@santinh/shared";
import { vi } from "../i18n/vi.ts";
import type { NetDriver } from "../net/net-driver.ts";
import { closeOnBackdrop } from "./dialog.ts";
import { icons } from "./icons.ts";
import "./base.css";

/** Skeleton cards while counting (design/rooms.html "đang tải"). */
const SKELETONS = 6;

/** `?room=san-NN` (a real feature, not a debug switch); null when absent or not one of the 10 rooms. */
export function roomFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get("room");
  return id !== null && roomNumber(id) !== null ? id : null;
}

/** Puts the room in the URL without reloading (L6); other params stay. */
export function writeRoomToUrl(id: string): void {
  const url = new URL(location.href);
  url.searchParams.set("room", id);
  history.replaceState(history.state, "", url);
}

/** Least crowded room with space (L1 without `?room=`); ties → lowest number. */
export function emptiestRoom(rooms: readonly RoomInfo[]): string | null {
  let best: RoomInfo | null = null;
  for (const r of rooms) if (r.count < r.capacity && (!best || r.count < best.count)) best = r;
  return best?.id ?? null;
}

/** Card tag for a room: silent or chat (P4-D1, only via `roomAllowsChat`). */
export function roomKindText(id: string): string {
  return roomAllowsChat(id) ? vi.rooms.badgeChat : vi.rooms.badgeQuiet;
}

/** Legend under the grid; room numbers come from the room table, not the copy. */
export function chatNoteText(): { quiet: string; chat: string } {
  return {
    quiet: vi.rooms.legendQuiet.replace("{quiet}", String(QUIET_ROOM_COUNT)),
    chat: vi.rooms.legendChat
      .replace("{first}", String(QUIET_ROOM_COUNT + 1))
      .replace("{last}", String(ROOMS.length)),
  };
}

function kindIcon(chat: boolean): HTMLElement {
  const el = document.createElement("span");
  el.className = "room-kind";
  el.innerHTML = chat ? icons.chat : icons.chatOff;
  return el;
}

export interface RoomsDialogDeps {
  net: Pick<NetDriver, "listRooms" | "switchRoom" | "connect">;
  /** Room we are in (or were turned away from). */
  currentRoom(): string;
  /** True while connected to a room: switching goes through `switchRoom`; otherwise we `connect` afresh. */
  inRoom(): boolean;
  /** Room in another space: the page reloads into it (returns true) instead of switching in place. */
  reloadIfOtherSpace(id: string): boolean;
  /** A switch / reconnect to `id` started or succeeded (the snapshot that follows confirms it). */
  onSwitched(id: string): void;
}

/** `full`: turned away from `room` — it is full, or (`limited`) our network already has too many people there. */
type Bar = { kind: "current" } | { kind: "loading" } | { kind: "switching" } | { kind: "failed" } | { kind: "full"; room: string; limited: boolean };

/** "Chọn phòng" (design/rooms.html): a real <dialog> with a 2-column grid of the 10 rooms. */
export class RoomsDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly barText: HTMLSpanElement;
  private readonly offBackdrop: () => void;
  private readonly barEl: HTMLDivElement;
  private readonly refresh: HTMLButtonElement;
  private readonly body: HTMLDivElement;
  private rooms: RoomInfo[] = [];
  private bar: Bar = { kind: "current" };
  private busy: string | null = null;
  /** Bumped on each load / close so late replies are dropped. */
  private token = 0;

  constructor(
    private readonly d: RoomsDialogDeps,
    parent: HTMLElement = document.body,
  ) {
    this.dialog = document.createElement("dialog");
    this.dialog.className = "dialog";
    this.dialog.setAttribute("aria-labelledby", "room-title");

    const head = document.createElement("header");
    head.className = "dialog-head";
    const title = document.createElement("h2");
    title.id = "room-title";
    title.textContent = vi.rooms.title;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "dialog-close";
    close.setAttribute("aria-label", vi.rooms.close);
    close.textContent = "×";
    close.addEventListener("click", () => this.close());
    head.append(title, close);

    const desc = document.createElement("p");
    desc.className = "dialog-desc";
    desc.textContent = vi.rooms.desc;

    this.barEl = document.createElement("div");
    this.barEl.className = "dialog-bar";
    this.barText = document.createElement("span");
    this.refresh = document.createElement("button");
    this.refresh.type = "button";
    this.refresh.className = "btn--link";
    this.refresh.textContent = vi.rooms.refresh;
    this.refresh.addEventListener("click", () => this.load());
    this.barEl.append(this.barText, this.refresh);

    this.body = document.createElement("div");
    this.body.className = "dialog-body";

    this.dialog.append(head, desc, this.barEl, this.body);
    this.offBackdrop = closeOnBackdrop(this.dialog);
    this.dialog.addEventListener("close", this.onClose);
    parent.append(this.dialog);
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  /** Opens and fetches the list; `fullRoom` = we were turned away from it (AC13), `limited` = by the per-network cap. */
  open(fullRoom?: string, limited = false): void {
    this.bar = fullRoom ? { kind: "full", room: fullRoom, limited } : { kind: "current" };
    this.busy = null;
    if (!this.dialog.open) this.dialog.showModal();
    this.load();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  dispose(): void {
    this.token++;
    this.offBackdrop();
    this.dialog.removeEventListener("close", this.onClose);
    this.close();
    this.dialog.remove();
  }

  private readonly onClose = (): void => {
    this.token++;
    this.busy = null;
  };

  private load(): void {
    const token = ++this.token;
    this.busy = null;
    // A fresh count replaces "failed"; "full" stays until we pick another room.
    if (this.bar.kind === "failed") this.bar = { kind: "current" };
    this.renderBar(true);
    this.body.replaceChildren(this.skeletons());
    this.d.net.listRooms().then(
      (rooms) => {
        if (token !== this.token) return;
        this.rooms = rooms;
        this.renderBar(false);
        this.renderList();
      },
      () => {
        if (token !== this.token) return;
        this.renderBar(false);
        this.renderError();
      },
    );
  }

  private pick(room: RoomInfo): void {
    if (this.busy !== null) return;
    if (room.id === this.d.currentRoom() && this.bar.kind !== "full") {
      this.close();
      return;
    }
    if (this.d.reloadIfOtherSpace(room.id)) return;
    const token = ++this.token;
    this.busy = room.id;
    this.bar = { kind: "switching" };
    this.renderBar(false);
    this.renderList();
    if (!this.d.inRoom()) {
      // Turned away / offline: no room to switch from, join the chosen one directly.
      this.d.net.connect(room.id);
      this.d.onSwitched(room.id);
      this.close();
      return;
    }
    const done = (ok: boolean): void => {
      // The switch happened even if the dialog was closed meanwhile: the HUD still has to follow.
      if (ok) this.d.onSwitched(room.id);
      if (token !== this.token) return;
      this.busy = null;
      if (ok) {
        this.close();
        return;
      }
      this.bar = { kind: "failed" };
      this.renderBar(false);
      this.renderList();
    };
    this.d.net.switchRoom(room.id).then(done, () => done(false));
  }

  private renderBar(loading: boolean): void {
    const b = this.bar;
    let text: string;
    if (b.kind === "switching") text = vi.rooms.switching;
    else if (b.kind === "failed") text = vi.rooms.failed;
    else if (b.kind === "full") text = (b.limited ? vi.rooms.limited : vi.rooms.full).replace("{room}", this.nameOf(b.room));
    else text = loading ? vi.rooms.loading : vi.rooms.current.replace("{room}", this.nameOf(this.d.currentRoom()));
    this.barText.textContent = text;
    this.barEl.classList.toggle("dialog-bar--danger", b.kind === "failed" || b.kind === "full");
    this.refresh.disabled = loading || b.kind === "switching";
  }

  /** From the last list (admin may have renamed it); the default name before the first one. */
  nameOf(id: string): string {
    return this.rooms.find((r) => r.id === id)?.name ?? roomNameOf(null, roomNumber(id) ?? 0);
  }

  private skeletons(): HTMLElement {
    const grid = document.createElement("div");
    grid.className = "room-grid";
    grid.setAttribute("aria-busy", "true");
    for (let i = 0; i < SKELETONS; i++) {
      const s = document.createElement("div");
      s.className = "skeleton";
      grid.append(s);
    }
    return grid;
  }

  private renderError(): void {
    const box = document.createElement("div");
    box.className = "error-box";
    box.append(vi.rooms.error);
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "btn";
    retry.textContent = vi.rooms.retry;
    retry.addEventListener("click", () => this.load());
    box.append(document.createElement("br"), retry);
    this.body.replaceChildren(box);
  }

  private renderList(): void {
    // Keep focus on the same card across re-renders (switching / failed).
    const focusedId = this.body.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.room
      : undefined;
    const current = this.d.currentRoom();
    const turnedAway = this.bar.kind === "full";
    const list = document.createElement("ul");
    list.className = "room-grid";
    list.setAttribute("aria-label", vi.rooms.list);
    for (const room of this.rooms) {
      const full = room.count >= room.capacity;
      const here = room.id === current && !turnedAway;
      const card = document.createElement("button");
      card.type = "button";
      const chat = roomAllowsChat(room.id);
      card.className = chat ? "room-card room-card--chat" : "room-card room-card--quiet";
      card.title = roomKindText(room.id);
      card.dataset.room = room.id;
      card.disabled = full || (this.busy !== null && this.busy !== room.id);
      if (here) card.setAttribute("aria-current", "true");
      if (this.busy === room.id) card.setAttribute("aria-busy", "true");

      const name = document.createElement("strong");
      const title = document.createElement("span");
      title.className = "room-title";
      // The icon is decorative; screen readers get the kind as text.
      const kindText = document.createElement("span");
      kindText.className = "sr-only";
      kindText.textContent = `${roomKindText(room.id)}: `;
      title.append(kindIcon(chat), kindText, room.name);
      name.append(title);
      if (full || here) {
        const badge = document.createElement("span");
        badge.className = full ? "badge badge--danger" : "badge badge--accent";
        badge.textContent = full ? vi.rooms.badgeFull : vi.rooms.badgeCurrent;
        name.append(badge);
      }
      const count = document.createElement("span");
      count.textContent = vi.rooms.count
        .replace("{n}", String(room.number))
        .replace("{count}", String(room.count))
        .replace("{capacity}", String(room.capacity));
      const meter = document.createElement("span");
      meter.className = full ? "meter meter--full" : "meter";
      const fill = document.createElement("span");
      fill.style.width = `${Math.round((Math.min(room.count, room.capacity) / room.capacity) * 100)}%`;
      meter.append(fill);
      card.append(name, count, meter);
      card.addEventListener("click", () => this.pick(room));

      const li = document.createElement("li");
      li.append(card);
      list.append(li);
    }
    const legend = chatNoteText();
    const chatNote = document.createElement("ul");
    chatNote.className = "dialog-desc dialog-note room-legend";
    for (const [chat, text] of [[false, legend.quiet], [true, legend.chat]] as const) {
      const item = document.createElement("li");
      item.className = chat ? "room-legend--chat" : "room-legend--quiet";
      item.append(kindIcon(chat), text);
      chatNote.append(item);
    }
    const note = document.createElement("p");
    note.className = "dialog-desc dialog-note";
    note.textContent = vi.rooms.note;
    this.body.replaceChildren(list, chatNote, note);
    if (focusedId) this.body.querySelector<HTMLElement>(`[data-room="${focusedId}"]`)?.focus();
  }
}
