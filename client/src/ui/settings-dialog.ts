import {
  CEREMONY_DURATION_S,
  CEREMONY_HOURS,
  VISITOR_COLORS,
  ceremonyAt,
  vnTimeOfDay,
  type ConnectionStatus,
} from "@santinh/shared";
import type { Chant } from "../audio/chant.ts";
import type { AudioEngine, AudioSettings } from "../audio/engine.ts";
import { vi } from "../i18n/vi.ts";
import { closeOnBackdrop } from "./dialog.ts";
import "./base.css";

const HOUR_MS = 3_600_000;
const NOON_MS = 12 * HOUR_MS;

const hhmm = (msOfDay: number): string => {
  const m = Math.floor(msOfDay / 60_000);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** "Khóa lễ tối kế tiếp 18:00 · mỗi ngày 05:00 và 18:00 (giờ Việt Nam)" for the moment `ms`. */
export function ceremonyScheduleText(ms: number): string {
  const next = vnTimeOfDay(ceremonyAt(ms, CEREMONY_DURATION_S).next);
  const [a = 0, b = 0] = CEREMONY_HOURS;
  return vi.settings.nextCeremony
    .replace("{session}", next < NOON_MS ? vi.settings.morning : vi.settings.evening)
    .replace("{time}", hhmm(next))
    .replace("{hours}", vi.settings.hoursPair.replace("{a}", hhmm(a * HOUR_MS)).replace("{b}", hhmm(b * HOUR_MS)));
}

const percent = (v: number): string => vi.settings.percent.replace("{n}", String(Math.round(v * 100)));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function lines(parent: HTMLElement, texts: readonly string[]): void {
  texts.forEach((t, i) => {
    if (i > 0) parent.append(document.createElement("br"));
    parent.append(t);
  });
}

type VolumeKey = "ambientVolume" | "chantVolume" | "sfxVolume";

/** The "Tài khoản" row's two actions (start.ts owns the session). */
export interface AccountActions {
  signIn: () => void;
  signOut: () => void;
}

/** Secondary HUD actions moved into SettingsDialog. */
export interface SettingsQuickActions {
  openPeople?: () => void;
  openInvite?: () => void;
  openOffering?: () => void;
  openRooms?: () => void;
  exitGame?: () => void;
}

/** "Cài đặt" (design/settings.html): our name, robe colour, account & exit, room/social tools, master sound, ambient / chant / effects, background play, controls, credits. */
export class SettingsDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly desc: HTMLParagraphElement;
  private readonly masterSoundToggle: HTMLButtonElement;
  private readonly masterSoundDesc: HTMLElement;
  private readonly ambientToggle: HTMLButtonElement;
  private readonly sfxToggle: HTMLButtonElement;
  private readonly bgToggle: HTMLButtonElement;
  private readonly bgDesc: HTMLElement;
  private readonly chantDesc: HTMLElement;
  private readonly chantBtn: HTMLButtonElement;
  private readonly schedule: HTMLElement;
  private readonly nameText: HTMLElement;
  private readonly accountText: HTMLElement;
  private readonly accountBtn: HTMLButtonElement;
  private readonly socialDescEl: HTMLElement;
  private readonly peopleBtn: HTMLButtonElement;
  private readonly inviteBtn: HTMLButtonElement;
  private readonly roomsBtn: HTMLButtonElement;
  private readonly offeringBtn: HTMLButtonElement;
  private readonly exitBtn: HTMLButtonElement;
  private readonly colorButtons: HTMLButtonElement[] = [];
  private username: string | null = null;
  private roomNumber = 1;
  private roomName = "Tĩnh Tâm";
  private peopleCount = 0;
  private connStatus: ConnectionStatus = "connecting";
  private readonly sliders: { key: VolumeKey; input: HTMLInputElement; output: HTMLOutputElement }[] = [];
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly audio: AudioEngine,
    private readonly chant: Chant,
    private readonly now: () => number,
    onRename: () => void,
    private readonly account: AccountActions,
    parent: HTMLElement = document.body,
    private readonly onColorChange?: (color: string) => void,
    private readonly quickActions: SettingsQuickActions = {},
  ) {
    const t = vi.settings;
    this.dialog = el("dialog", "dialog");
    this.dialog.setAttribute("aria-labelledby", "set-title");

    const head = el("header", "dialog-head");
    const title = el("h2", "", t.title);
    title.id = "set-title";
    const close = el("button", "dialog-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", t.close);
    close.addEventListener("click", () => this.close());
    head.append(title, close);
    this.desc = el("p", "dialog-desc");

    const body = el("div", "dialog-body");

    const renameBtn = el("button", "btn btn--ghost", t.rename);
    renameBtn.type = "button";
    renameBtn.setAttribute("aria-label", t.renameLabel);
    renameBtn.addEventListener("click", onRename);
    const nameSection = this.section(t.name, "", renameBtn);
    this.nameText = nameSection.querySelector("small") ?? el("small");
    this.nameText.classList.add("section-name");
    body.append(nameSection);

    // Robe colour picker section (Màu pháp phục).
    const colorWrap = el("section", "section");
    const colorHead = el("div", "section-text");
    colorHead.append(el("h3", "", t.robeColor), el("small", "", t.robeColorDesc));
    const colorRow = el("div", "section-head");
    colorRow.style.justifyContent = "flex-start";
    colorRow.style.gap = "10px";
    colorRow.style.marginTop = "8px";

    VISITOR_COLORS.forEach((hex, i) => {
      const label = t.robeColorNames[i] ?? hex;
      const btn = el("button", "tool tool-circle");
      btn.type = "button";
      btn.style.width = "30px";
      btn.style.height = "30px";
      btn.style.borderRadius = "50%";
      btn.style.border = "2px solid rgba(255,255,255,0.45)";
      btn.style.backgroundColor = hex;
      btn.style.cursor = "pointer";
      btn.title = label;
      btn.setAttribute("aria-label", `${t.robeColor}: ${label}`);
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", () => {
        this.setColor(hex);
        this.onColorChange?.(hex);
      });
      this.colorButtons.push(btn);
      colorRow.append(btn);
    });
    colorWrap.append(colorHead, colorRow);
    body.append(colorWrap);

    this.accountBtn = el("button", "btn btn--ghost");
    this.accountBtn.type = "button";
    this.accountBtn.addEventListener("click", () => (this.username === null ? this.account.signIn() : this.account.signOut()));
    const accountSection = this.section(t.account, "", this.accountBtn);
    this.accountText = accountSection.querySelector("small") ?? el("small");
    this.accountText.classList.add("section-name");
    body.append(accountSection);
    this.renderAccount();

    // Room, People, Invite, Offering & Exit section (integrated secondary HUD buttons)
    const socialSection = el("section", "section");
    const socialHead = el("div", "section-text");
    socialHead.append(el("h3", "", "Không gian & Đạo hữu"));
    this.socialDescEl = el("small", "", "");
    socialHead.append(this.socialDescEl);

    const quickGrid = el("div", "settings-quick-grid");

    this.peopleBtn = el("button", "btn btn--ghost", "Ai đang ở đây");
    this.peopleBtn.type = "button";
    this.peopleBtn.addEventListener("click", () => {
      this.close();
      this.quickActions.openPeople?.();
    });

    this.inviteBtn = el("button", "btn btn--ghost", vi.hud.invite);
    this.inviteBtn.type = "button";
    this.inviteBtn.setAttribute("aria-label", vi.hud.invite);
    this.inviteBtn.addEventListener("click", () => {
      this.close();
      this.quickActions.openInvite?.();
    });

    this.offeringBtn = el("button", "btn btn--ghost", vi.hud.offering);
    this.offeringBtn.type = "button";
    this.offeringBtn.addEventListener("click", () => {
      this.close();
      this.quickActions.openOffering?.();
    });

    this.roomsBtn = el("button", "btn btn--ghost", "Chọn phòng");
    this.roomsBtn.type = "button";
    this.roomsBtn.addEventListener("click", () => {
      this.close();
      this.quickActions.openRooms?.();
    });

    quickGrid.append(this.peopleBtn, this.inviteBtn, this.offeringBtn, this.roomsBtn);
    socialSection.append(socialHead, quickGrid);
    body.append(socialSection);

    // Master Sound Toggle (Bật / Tắt tiếng tổng)
    this.masterSoundToggle = this.toggle("Âm thanh tổng", () => this.audio.toggleMuted());
    const masterSection = this.section("Âm thanh tổng", "Bật hoặc tắt toàn bộ tiếng trong chùa", this.masterSoundToggle);
    this.masterSoundDesc = masterSection.querySelector("small") ?? el("small");
    body.append(masterSection);

    this.ambientToggle = this.toggle(t.ambient, () => this.flip("ambientOn"));
    body.append(this.section(t.ambient, t.ambientDesc, this.ambientToggle, "ambientVolume"));

    this.chantBtn = el("button", "btn btn--ghost");
    this.chantBtn.type = "button";
    this.chantBtn.setAttribute("aria-label", vi.hud.chant);
    this.chantBtn.addEventListener("click", () => chant.toggle());
    const chantSection = this.section(t.chant, t.chantDesc, this.chantBtn, "chantVolume");
    this.chantDesc = chantSection.querySelector("small") ?? el("small");
    this.schedule = el("small", "section-note");
    chantSection.append(this.schedule);
    body.append(chantSection);

    this.sfxToggle = this.toggle(t.sfx, () => this.flip("sfxOn"));
    body.append(this.section(t.sfx, t.sfxDesc, this.sfxToggle, "sfxVolume"));

    this.bgToggle = this.toggle(t.background, () => audio.update({ backgroundPlay: !audio.settings.backgroundPlay }));
    const bgSection = this.section(t.background, t.backgroundOff, this.bgToggle);
    this.bgDesc = bgSection.querySelector("small") ?? el("small");
    body.append(bgSection);

    // Exit / Leave Temple section moved inside Settings per user request
    this.exitBtn = el("button", "btn btn--ghost", vi.hud.exit);
    this.exitBtn.type = "button";
    this.exitBtn.setAttribute("aria-label", vi.hud.exit);
    this.exitBtn.addEventListener("click", () => {
      this.close();
      this.quickActions.exitGame?.();
    });
    const exitSection = this.section(
      "Rời chùa tạm nghỉ",
      "Tạm rời phòng tu tập và dừng âm thanh",
      this.exitBtn,
    );
    body.append(exitSection);

    const info = el("section", "section");
    const controls = el("details");
    const controlsBody = el("p");
    lines(controlsBody, t.controlsBody);
    controls.append(el("summary", "", t.controls), controlsBody);
    const author = el("p", "author");
    const mail = el("a", "", t.author);
    mail.href = `mailto:${t.authorMail}`;
    author.append(mail);
    info.append(controls, author);
    body.append(info);

    this.dialog.append(head, this.desc, body);
    this.offs.push(closeOnBackdrop(this.dialog));
    this.offs.push(audio.on("change", () => this.render()));
    this.offs.push(chant.onChange(() => this.render()));
    parent.append(this.dialog);
    this.setColor(VISITOR_COLORS[0] ?? "#b9c3c7");
    this.renderSocial();
    this.render();
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  open(): void {
    this.renderSocial();
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  /** The name we picked (not the room's "An 2" variant, P3-D3). */
  setName(name: string): void {
    this.nameText.textContent = name;
    this.nameText.title = name;
  }

  /** Highlights the active robe colour swatch in the settings dialog. */
  setColor(color: string): void {
    VISITOR_COLORS.forEach((hex, i) => {
      const btn = this.colorButtons[i];
      if (!btn) return;
      const active = hex === color;
      btn.setAttribute("aria-pressed", String(active));
      btn.style.outline = active ? "2px solid #f4e8cc" : "none";
      btn.style.outlineOffset = active ? "2px" : "0";
      btn.style.transform = active ? "scale(1.12)" : "scale(1)";
    });
  }

  /** Our username (only we ever see it, P4-D2), or null as a guest. */
  setAccount(username: string | null): void {
    this.username = username;
    this.renderAccount();
  }

  /** Updates the current room info displayed inside Settings. */
  setRoomInfo(n: number, name: string): void {
    this.roomNumber = n;
    this.roomName = name;
    this.renderSocial();
  }

  /** Updates the current visitor count & connection status displayed inside Settings. */
  setPeopleStatus(count: number, status: ConnectionStatus): void {
    this.peopleCount = count;
    this.connStatus = status;
    this.renderSocial();
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.close();
    this.dialog.remove();
  }

  private renderSocial(): void {
    const connected = this.connStatus === "connected";
    const statusText = connected
      ? `${this.peopleCount} người đang ở đây`
      : this.connStatus === "connecting"
        ? "Đang kết nối…"
        : "Mất kết nối";
    this.socialDescEl.textContent = `Phòng ${this.roomNumber} · ${this.roomName} (${statusText})`;
    this.peopleBtn.textContent = connected ? `Đạo hữu (${this.peopleCount})` : "Ai đang ở đây";
    const peopleLabel = connected
      ? vi.hud.people.replace("{n}", String(this.peopleCount))
      : this.connStatus === "connecting"
        ? vi.hud.peopleConnecting
        : vi.hud.peopleOffline;
    this.peopleBtn.setAttribute("aria-label", peopleLabel);
    this.inviteBtn.disabled = !connected;
  }

  private renderAccount(): void {
    const t = vi.settings;
    const signedIn = this.username !== null;
    this.accountText.textContent = this.username ?? t.accountGuest;
    this.accountText.title = this.username ?? "";
    this.accountText.classList.toggle("section-name--muted", !signedIn);
    this.accountBtn.textContent = signedIn ? t.signOut : t.signIn;
  }

  /** While muted every switch reads off (design "tiếng tổng đang tắt"); turning one on unmutes. */
  private flip(key: "ambientOn" | "sfxOn"): void {
    const shownOn = this.audio.settings[key] && !this.audio.muted;
    if (shownOn) this.audio.update({ [key]: false });
    else {
      this.audio.update({ [key]: true });
      if (this.audio.muted) this.audio.setMuted(false);
    }
  }

  private toggle(label: string, onClick: () => void): HTMLButtonElement {
    const b = el("button", "toggle");
    b.type = "button";
    b.setAttribute("role", "switch");
    b.setAttribute("aria-label", label);
    b.addEventListener("click", onClick);
    return b;
  }

  private section(title: string, desc: string, control: HTMLElement, volume?: VolumeKey): HTMLElement {
    const s = el("section", "section");
    const headRow = el("div", "section-head");
    const text = el("div", "section-text");
    text.append(el("h3", "", title), el("small", "", desc));
    headRow.append(text, control);
    s.append(headRow);
    if (volume) {
      const label = el("label", "slider");
      const input = el("input");
      input.type = "range";
      input.min = "0";
      input.max = "100";
      input.setAttribute("aria-label", `${vi.settings.volume} ${title}`);
      const output = el("output");
      input.addEventListener("input", () => {
        const v = Number(input.value) / 100;
        output.value = percent(v);
        this.audio.update({ [volume]: v } as Partial<AudioSettings>);
      });
      label.append(el("span", "", vi.settings.volume), input, output);
      s.append(label);
      this.sliders.push({ key: volume, input, output });
    }
    return s;
  }

  private render(): void {
    const t = vi.settings;
    const s = this.audio.settings;
    const muted = this.audio.muted;
    if (muted) {
      this.desc.textContent = "";
      this.desc.append(el("span", "text-warning", t.muted));
    } else this.desc.textContent = t.desc;

    this.masterSoundToggle.setAttribute("aria-checked", String(!muted));
    this.masterSoundDesc.textContent = muted ? "Đang tắt toàn bộ âm thanh" : "Đang bật âm thanh";
    this.ambientToggle.setAttribute("aria-checked", String(s.ambientOn && !muted));
    this.sfxToggle.setAttribute("aria-checked", String(s.sfxOn && !muted));
    this.bgToggle.setAttribute("aria-checked", String(s.backgroundPlay));
    this.bgDesc.textContent = s.backgroundPlay ? t.backgroundOn : t.backgroundOff;
    for (const sl of this.sliders) {
      const v = s[sl.key];
      // Don't fight the thumb the user is dragging.
      if (document.activeElement !== sl.input) sl.input.value = String(Math.round(v * 100));
      sl.output.value = percent(v);
    }

    const c = this.chant.state;
    this.chantBtn.textContent = c.on ? t.stop : t.listen;
    this.chantBtn.setAttribute("aria-pressed", String(c.on));
    this.chantDesc.textContent = c.error ? t.chantError : c.ceremony ? t.chantCeremony : t.chantDesc;
    this.chantDesc.classList.toggle("text-danger", c.error);
    this.schedule.textContent = "";
    lines(this.schedule, [ceremonyScheduleText(this.now()), t.together]);
  }
}
