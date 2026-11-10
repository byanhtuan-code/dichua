import { roomNameOf, roomNumber, type ConnectionStatus, type Visitor } from "@santinh/shared";
import { vi } from "../i18n/vi.ts";
import type { NetDriver } from "../net/net-driver.ts";
import { closeOnBackdrop } from "./dialog.ts";
import "./base.css";

export interface PersonRow {
  id: string;
  name: string;
  color: string;
  self: boolean;
}

export interface Roster {
  /** Us first, then other visitors by arrival. */
  visitors: PersonRow[];
  residents: PersonRow[];
}

const isResident = (v: Visitor): boolean => v.id.startsWith("resident:");

/** Splits the room into visitors (us first, then by `joinedAt`) and residents. */
export function buildRoster(people: Iterable<Visitor>, selfId: string | null): Roster {
  const visitors: Visitor[] = [];
  const residents: Visitor[] = [];
  for (const v of people) (isResident(v) ? residents : visitors).push(v);
  visitors.sort((a, b) => Number(b.id === selfId) - Number(a.id === selfId) || a.joinedAt - b.joinedAt);
  const row = (v: Visitor): PersonRow => ({ id: v.id, name: v.name, color: v.color, self: v.id === selfId });
  return { visitors: visitors.map(row), residents: residents.map(row) };
}

export interface PeopleHooks {
  /** Opens the invite dialog; the button is hidden without it. */
  invite?: () => void;
  /** Makes our own row a button that opens the rename dialog. */
  rename?: () => void;
}

/** "Ai đang ở đây" (design/people.html): keeps its own roster from snapshot / update, re-renders while open. */
export class PeopleDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly desc: HTMLParagraphElement;
  private readonly body: HTMLDivElement;
  private readonly people = new Map<string, Visitor>();
  private readonly off: (() => void)[] = [];
  private selfId: string | null = null;
  private room: string | null = null;
  private roomName: string | null = null;
  private status: ConnectionStatus = "connecting";

  constructor(
    net: Pick<NetDriver, "on">,
    private readonly currentRoom: () => string,
    parent: HTMLElement = document.body,
    private readonly hooks: PeopleHooks = {},
  ) {
    this.dialog = document.createElement("dialog");
    this.dialog.className = "dialog";
    this.dialog.setAttribute("aria-labelledby", "ppl-title");

    const head = document.createElement("header");
    head.className = "dialog-head";
    const title = document.createElement("h2");
    title.id = "ppl-title";
    title.textContent = vi.people.title;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "dialog-close";
    close.setAttribute("aria-label", vi.people.close);
    close.textContent = "×";
    close.addEventListener("click", () => this.close());
    head.append(title, close);

    this.desc = document.createElement("p");
    this.desc.className = "dialog-desc";
    this.body = document.createElement("div");
    this.body.className = "dialog-body";
    this.dialog.append(head, this.desc, this.body);
    this.off.push(closeOnBackdrop(this.dialog));
    parent.append(this.dialog);

    this.off.push(
      net.on("snapshot", (s) => {
        this.people.clear();
        for (const v of s.visitors) this.people.set(v.id, v);
        this.selfId = s.selfId;
        this.room = s.room;
        this.roomName = s.roomName;
        this.refresh();
      }),
      net.on("update", (u) => {
        let changed = u.removed.length > 0;
        for (const id of u.removed) this.people.delete(id);
        for (const v of u.visitors) {
          const before = this.people.get(v.id);
          // Position-only updates arrive 5×/s; re-render only when the list itself changes.
          if (!before || before.name !== v.name || before.color !== v.color) changed = true;
          this.people.set(v.id, v);
        }
        if (changed) this.refresh();
      }),
      net.on("status", (s) => {
        this.status = s;
        if (s !== "connected") {
          this.people.clear();
          this.selfId = null;
        }
        this.refresh();
      }),
    );
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  open(): void {
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  dispose(): void {
    for (const off of this.off) off();
    this.close();
    this.dialog.remove();
  }

  private refresh(): void {
    if (this.dialog.open) this.render();
  }

  private render(): void {
    const room = this.room ?? this.currentRoom();
    this.desc.textContent = vi.people.desc.replace("{room}", this.roomName ?? roomNameOf(null, roomNumber(room) ?? 1));
    if (this.status !== "connected" || this.selfId === null) {
      this.body.replaceChildren(empty(vi.people.offline));
      return;
    }
    const { visitors, residents } = buildRoster(this.people.values(), this.selfId);
    const nodes: HTMLElement[] = [list(visitors, this.hooks.rename)];
    if (visitors.length <= 1) nodes.push(empty(vi.people.alone));
    else if (residents.length > 0) {
      const label = document.createElement("p");
      label.className = "dialog-desc dialog-section";
      label.textContent = vi.people.residents;
      nodes.push(label, list(residents));
    }
    if (this.hooks.invite) nodes.push(this.inviteBox(this.hooks.invite));
    this.body.replaceChildren(...nodes);
  }

  private inviteBox(invite: () => void): HTMLElement {
    const box = document.createElement("div");
    box.className = "invite";
    const hint = document.createElement("p");
    hint.className = "dialog-desc";
    hint.textContent = vi.people.inviteHint;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.textContent = vi.people.invite;
    btn.addEventListener("click", invite);
    box.append(hint, btn);
    return box;
  }
}

function selfButton(name: string, rename: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute("aria-label", vi.people.renameSelf.replace("{name}", name));
  b.addEventListener("click", rename);
  return b;
}

function empty(text: string): HTMLDivElement {
  const box = document.createElement("div");
  box.className = "empty";
  box.textContent = text;
  return box;
}

function list(rows: readonly PersonRow[], rename?: () => void): HTMLUListElement {
  const ul = document.createElement("ul");
  ul.className = "list";
  for (const p of rows) {
    const row = p.self && rename ? selfButton(p.name, rename) : document.createElement("div");
    row.className = "row";
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = p.color;
    const name = document.createElement("span");
    name.className = "row-main";
    name.textContent = p.name;
    name.title = p.name;
    row.append(swatch, name);
    if (p.self) {
      const badge = document.createElement("span");
      badge.className = "badge badge--accent";
      badge.textContent = vi.labels.you;
      row.append(badge);
    }
    const li = document.createElement("li");
    li.append(row);
    ul.append(li);
  }
  return ul;
}
