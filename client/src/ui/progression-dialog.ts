import { type ConnectionStatus } from "@santinh/shared";
import { safeLocalStorage } from "../beads/counter.ts";
import {
  ALL_QUESTS_BONUS,
  SHOP_ITEMS,
  type BuyOrEquipResult,
  type Progression,
  type ShopCategory,
} from "../game/progression.ts";
import { vi } from "../i18n/vi.ts";
import { closeOnBackdrop } from "./dialog.ts";
import "./progression-dialog.css";

type TabId = "checkin" | "quests" | "shop";

const AVATAR_STORAGE_KEY = "santinh.avatar.v1";

export interface ProgressionDialogCallbacks {
  onClaimReward?: (meritAdded: number, label: string) => void;
  onShopAction?: (res: BuyOrEquipResult) => void;
  onOpenSettings?: () => void;
  onOpenOffering?: () => void;
  onOpenRooms?: () => void;
  onRename?: () => void;
}

const CATEGORY_LABEL: Record<ShopCategory, string> = {
  aura: "Hào Quang Chánh Niệm",
  artifact: "Pháp Khí Hộ Thân",
  title: "Danh Hiệu Tịnh Tu",
};

/** Default chibi novice monk portrait SVG (inside the circular frame). */
const MONK_PORTRAIT_SVG = `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <radialGradient id="avBg" cx="50%" cy="42%" r="52%">
      <stop offset="0%" stop-color="#a8c0ff"/>
      <stop offset="60%" stop-color="#5d78c9"/>
      <stop offset="100%" stop-color="#35488a"/>
    </radialGradient>
    <radialGradient id="skinGrad" cx="45%" cy="35%" r="60%">
      <stop offset="0%" stop-color="#ffe7d4"/>
      <stop offset="70%" stop-color="#f7c8a4"/>
      <stop offset="100%" stop-color="#e3a67c"/>
    </radialGradient>
  </defs>
  <circle cx="60" cy="60" r="58" fill="url(#avBg)"/>
  <circle cx="60" cy="52" r="36" fill="#ffe89e" fill-opacity="0.25"/>
  <!-- Robe body -->
  <path d="M24 112C26 84 41 73 60 73C79 73 94 84 96 112H24Z" fill="var(--monk-robe, #b8621b)" stroke="#5c2c06" stroke-width="2"/>
  <path d="M46 74L60 90L74 74" stroke="#f6b93b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <!-- Prayer beads around neck -->
  <g fill="#6e3512" stroke="#3d1b05" stroke-width="1">
    <circle cx="46" cy="77" r="3.2"/><circle cx="51" cy="81" r="3.2"/><circle cx="57" cy="83" r="3.2"/>
    <circle cx="63" cy="83" r="3.2"/><circle cx="69" cy="81" r="3.2"/><circle cx="74" cy="77" r="3.2"/>
  </g>
  <!-- Ears -->
  <ellipse cx="27" cy="54" rx="6" ry="8" fill="url(#skinGrad)" stroke="#8c5332" stroke-width="1.8"/>
  <ellipse cx="93" cy="54" rx="6" ry="8" fill="url(#skinGrad)" stroke="#8c5332" stroke-width="1.8"/>
  <!-- Head -->
  <circle cx="60" cy="49" r="31" fill="url(#skinGrad)" stroke="#8c5332" stroke-width="2"/>
  <!-- Forehead wisdom dot -->
  <circle cx="60" cy="36" r="2" fill="#d94528"/>
  <!-- Eyebrows -->
  <path d="M41 41C44 38 49 38 52 40" stroke="#5c3317" stroke-width="2.2" stroke-linecap="round"/>
  <path d="M68 40C71 38 76 38 79 41" stroke="#5c3317" stroke-width="2.2" stroke-linecap="round"/>
  <!-- Big cute eyes -->
  <ellipse cx="47" cy="50" rx="5.8" ry="6.8" fill="#2d1810"/>
  <ellipse cx="73" cy="50" rx="5.8" ry="6.8" fill="#2d1810"/>
  <circle cx="45" cy="47.5" r="2.2" fill="#ffffff"/>
  <circle cx="71" cy="47.5" r="2.2" fill="#ffffff"/>
  <circle cx="49" cy="52.5" r="1.1" fill="#ffffff"/>
  <circle cx="75" cy="52.5" r="1.1" fill="#ffffff"/>
  <!-- Rosy cheeks -->
  <ellipse cx="38" cy="57" rx="5.5" ry="3.2" fill="#f28b82" fill-opacity="0.55"/>
  <ellipse cx="82" cy="57" rx="5.5" ry="3.2" fill="#f28b82" fill-opacity="0.55"/>
  <!-- Sweet smile -->
  <path d="M55 59Q60 63.5 65 59" stroke="#7a3e22" stroke-width="2.2" stroke-linecap="round" fill="none"/>
  <!-- Clasped hands (Chắp tay) -->
  <path d="M53 96C53 85 57 78 60 76C63 78 67 85 67 96C67 99 64 101 60 101C56 101 53 99 53 96Z" fill="url(#skinGrad)" stroke="#8c5332" stroke-width="1.8"/>
  <path d="M60 77V99" stroke="#b57c56" stroke-width="1.4" stroke-linecap="round"/>
</svg>`;

/** Golden lotus petals overlay cradling the bottom of the avatar frame (stays above custom photos). */
const AVATAR_LOTUS_OVERLAY_SVG = `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="goldPetal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fff099"/>
      <stop offset="55%" stop-color="#f5b82e"/>
      <stop offset="100%" stop-color="#b87308"/>
    </linearGradient>
  </defs>
  <path d="M18 98C26 90 40 94 46 106C34 108 22 104 18 98Z" fill="url(#goldPetal)" stroke="#7a4602" stroke-width="1.6"/>
  <path d="M102 98C94 90 80 94 74 106C86 108 98 104 102 98Z" fill="url(#goldPetal)" stroke="#7a4602" stroke-width="1.6"/>
  <path d="M33 105C40 93 51 93 58 108C47 111 38 109 33 105Z" fill="url(#goldPetal)" stroke="#7a4602" stroke-width="1.6"/>
  <path d="M87 105C80 93 69 93 62 108C73 111 82 109 87 105Z" fill="url(#goldPetal)" stroke="#7a4602" stroke-width="1.6"/>
  <path d="M60 90C66 98 66 107 60 114C54 107 54 98 60 90Z" fill="url(#goldPetal)" stroke="#7a4602" stroke-width="1.6"/>
</svg>`;

const GOLD_LOTUS_ICON = `<svg viewBox="0 0 32 26" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M16 2C19.5 7.5 21 13 16 21C11 13 12.5 7.5 16 2Z" fill="#ffd859" stroke="#8a4f05" stroke-width="1.4"/>
  <path d="M16 21C21 13 26.5 11 29 15.5C26.5 20.5 21 22 16 21Z" fill="#f7b731" stroke="#8a4f05" stroke-width="1.4"/>
  <path d="M16 21C11 13 5.5 11 3 15.5C5.5 20.5 11 22 16 21Z" fill="#f7b731" stroke="#8a4f05" stroke-width="1.4"/>
</svg>`;

const TEMPLE_MINI_ICON = `<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M2 9L10 3L18 9H2Z" fill="#ffd859" stroke="#7a4204" stroke-width="1.3" stroke-linejoin="round"/>
  <rect x="4.5" y="9" width="11" height="7.5" rx="1" fill="#e09919" stroke="#7a4204" stroke-width="1.2"/>
  <rect x="8.2" y="11.5" width="3.6" height="5" rx="0.8" fill="#5c2808"/>
</svg>`;

const STAR_ICON = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M12 2.5l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.3l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L12 2.5Z" fill="#c850ff" stroke="#4a0e6e" stroke-width="1.6" stroke-linejoin="round"/>
  <circle cx="10" cy="9" r="1.5" fill="#f3ccff"/>
</svg>`;

const COIN_ICON = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <circle cx="16" cy="16" r="14" fill="#ffcf33" stroke="#8f5200" stroke-width="2"/>
  <circle cx="16" cy="16" r="10.5" fill="#f5a618" stroke="#ffd86b" stroke-width="1.2"/>
  <path d="M16 8.5l2.2 4.5 5 .7-3.6 3.5.9 4.9-4.5-2.4-4.5 2.4.9-4.9-3.6-3.5 5-.7L16 8.5Z" fill="#fff099" stroke="#9e5b00" stroke-width="1" stroke-linejoin="round"/>
</svg>`;

const GEM_ICON = `<svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <polygon points="9,5 23,5 29,13 16,28 3,13" fill="#2bcbff" stroke="#084c7d" stroke-width="2" stroke-linejoin="round"/>
  <polygon points="9,5 23,5 20,13 12,13" fill="#9beaff"/>
  <polygon points="3,13 12,13 16,28" fill="#1499e0"/>
  <polygon points="20,13 29,13 16,28" fill="#0d7bc2"/>
  <polygon points="12,13 20,13 16,28" fill="#5cd8ff"/>
</svg>`;

const PINK_LOTUS_ICON = `<svg viewBox="0 0 36 30" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M6 22C10 26 26 26 30 22C26 20 10 20 6 22Z" fill="#58b847" stroke="#1f5c16" stroke-width="1.4"/>
  <path d="M18 19C12 12 4 12 3 18C6 23 13 23 18 19Z" fill="#ff85b3" stroke="#8f244e" stroke-width="1.4"/>
  <path d="M18 19C24 12 32 12 33 18C30 23 23 23 18 19Z" fill="#ff85b3" stroke="#8f244e" stroke-width="1.4"/>
  <path d="M18 19C13 9 7 7 8 15C10 20 14 21 18 19Z" fill="#ffa6c9" stroke="#8f244e" stroke-width="1.4"/>
  <path d="M18 19C23 9 29 7 28 15C26 20 22 21 18 19Z" fill="#ffa6c9" stroke="#8f244e" stroke-width="1.4"/>
  <path d="M18 3C22 9 22 15 18 21C14 15 14 9 18 3Z" fill="#ffd1e3" stroke="#8f244e" stroke-width="1.4"/>
</svg>`;

const GEAR_ICON = `<svg viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <path d="M11.8 3h4.4l.7 2.8a8.2 8.2 0 0 1 2.2 1.3l2.7-.9 2.2 3.8-2 2a8.4 8.4 0 0 1 0 2.6l2 2-2.2 3.8-2.7-.9a8.2 8.2 0 0 1-2.2 1.3L16.2 25h-4.4l-.7-2.8a8.2 8.2 0 0 1-2.2-1.3l-2.7.9-2.2-3.8 2-2a8.4 8.4 0 0 1 0-2.6l-2-2 2.2-3.8 2.7.9a8.2 8.2 0 0 1 2.2-1.3L11.8 3Z" fill="#ffd452" stroke="#6e3b00" stroke-width="1.8" stroke-linejoin="round"/>
  <circle cx="14" cy="14" r="4.2" fill="#5e3108" stroke="#ffe885" stroke-width="1.6"/>
</svg>`;

const QUEST_SCROLL_ICON = `<svg viewBox="0 0 56 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <ellipse cx="28" cy="42" rx="22" ry="7" fill="#5c2808" stroke="#f5b82e" stroke-width="2.2"/>
  <path d="M16 11H42L38 39H12L16 11Z" fill="#fff0c7" stroke="#7d4408" stroke-width="2" stroke-linejoin="round"/>
  <rect x="13" y="8" width="32" height="5" rx="2.5" fill="#d9821b" stroke="#612c02" stroke-width="1.8"/>
  <rect x="9" y="37" width="32" height="5" rx="2.5" fill="#d9821b" stroke="#612c02" stroke-width="1.8"/>
  <line x1="19" y1="18" x2="31" y2="18" stroke="#8c5828" stroke-width="2" stroke-linecap="round"/>
  <line x1="18" y1="24" x2="30" y2="24" stroke="#8c5828" stroke-width="2" stroke-linecap="round"/>
  <line x1="17" y1="30" x2="28" y2="30" stroke="#8c5828" stroke-width="2" stroke-linecap="round"/>
  <circle cx="34" cy="24" r="2.8" fill="#e62e25"/>
  <circle cx="33" cy="31" r="2.8" fill="#f59e0b"/>
</svg>`;

function loadSavedAvatar(): string | null {
  try {
    const val = safeLocalStorage()?.getItem(AVATAR_STORAGE_KEY);
    return val && val.startsWith("data:image/") ? val : null;
  } catch {
    return null;
  }
}

function saveAvatarDataUrl(dataUrl: string): void {
  try {
    safeLocalStorage()?.setItem(AVATAR_STORAGE_KEY, dataUrl);
  } catch {
    // Storage quota or private mode: still shown for current session.
  }
}

/** Center-crops an uploaded image file into a 160×160 square JPEG data URL. */
function cropImageToSquareDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const size = 160;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas 2D unavailable"));
        return;
      }
      const side = Math.min(img.width, img.height);
      const sx = Math.max(0, Math.floor((img.width - side) / 2));
      const sy = Math.max(0, Math.floor((img.height - side) / 2));
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      resolve(canvas.toDataURL("image/jpeg", 0.86));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Invalid image"));
    };
    img.src = url;
  });
}

/**
 * Renders the compact top-left Player Status Frame (Avatar with custom photo upload,
 * Name, Level, EXP bar, and Room selector placed below the Avatar),
 * the compact top-right 3-Currency Bar + Settings Gear + single `Nhiệm Vụ` button,
 * and the 3-tab modal dialog (Daily Check-in, Daily Quests, Spiritual Shop).
 */
export class ProgressionDialog {
  private readonly playerWrap: HTMLDivElement;
  private readonly avatarBtn: HTMLButtonElement;
  private readonly avatarDefaultEl: HTMLSpanElement;
  private readonly avatarImgEl: HTMLImageElement;
  private readonly avatarInput: HTMLInputElement;
  private readonly playerNameEl: HTMLSpanElement;
  private readonly levelBadgeEl: HTMLButtonElement;
  private readonly expFillEl: HTMLDivElement;
  private readonly expTextEl: HTMLSpanElement;
  private readonly roomBtn: HTMLButtonElement;
  private readonly roomDotEl: HTMLSpanElement;
  private readonly roomTextEl: HTMLSpanElement;

  private readonly topRightWrap: HTMLDivElement;
  private readonly meritValueEl: HTMLSpanElement;
  private readonly gemsValueEl: HTMLSpanElement;
  private readonly lotusValueEl: HTMLSpanElement;
  private readonly questBangEl: HTMLSpanElement;

  private readonly dialog: HTMLDialogElement;
  private readonly balanceEl: HTMLSpanElement;
  private readonly bodyEl: HTMLDivElement;
  private readonly tabButtons = new Map<TabId, HTMLButtonElement>();
  private activeTab: TabId = "checkin";
  private readonly offChange: () => void;
  private readonly offBackdrop: () => void;

  constructor(
    private readonly prog: Progression,
    private readonly cb: ProgressionDialogCallbacks = {},
    parent: HTMLElement = document.body,
  ) {
    // 1. TOP-LEFT WRAP: Player Status Card on top + Room Selector Button below the Avatar
    this.playerWrap = document.createElement("div");
    this.playerWrap.className = "lotus-player-wrap";

    const playerCard = document.createElement("div");
    playerCard.className = "lotus-player-card";

    // Hidden file input for custom avatar photo upload
    this.avatarInput = document.createElement("input");
    this.avatarInput.type = "file";
    this.avatarInput.accept = "image/*";
    this.avatarInput.hidden = true;
    this.avatarInput.addEventListener("change", () => {
      const file = this.avatarInput.files?.[0];
      this.avatarInput.value = "";
      if (!file) return;
      void cropImageToSquareDataUrl(file).then(
        (dataUrl) => {
          saveAvatarDataUrl(dataUrl);
          this.applyCustomAvatar(dataUrl);
        },
        () => {
          // Ignore invalid image files silently.
        },
      );
    });

    this.avatarBtn = document.createElement("button");
    this.avatarBtn.type = "button";
    this.avatarBtn.className = "lotus-avatar-frame";
    this.avatarBtn.title = "Bấm để tải ảnh đại diện lên";
    this.avatarBtn.setAttribute("aria-label", "Tải ảnh đại diện lên");

    this.avatarDefaultEl = document.createElement("span");
    this.avatarDefaultEl.className = "lotus-avatar-art";
    this.avatarDefaultEl.innerHTML = MONK_PORTRAIT_SVG;

    this.avatarImgEl = document.createElement("img");
    this.avatarImgEl.className = "lotus-avatar-img";
    this.avatarImgEl.alt = "Ảnh đại diện";
    this.avatarImgEl.hidden = true;

    const lotusOverlay = document.createElement("span");
    lotusOverlay.className = "lotus-avatar-lotus";
    lotusOverlay.innerHTML = AVATAR_LOTUS_OVERLAY_SVG;

    const camHint = document.createElement("span");
    camHint.className = "lotus-avatar-cam";
    camHint.textContent = "📷";

    this.avatarBtn.append(this.avatarDefaultEl, this.avatarImgEl, lotusOverlay, camHint);
    this.avatarBtn.addEventListener("click", () => this.avatarInput.click());

    const savedAvatar = loadSavedAvatar();
    if (savedAvatar) {
      this.applyCustomAvatar(savedAvatar);
    }

    const infoPanel = document.createElement("div");
    infoPanel.className = "lotus-player-panel";

    const topRow = document.createElement("div");
    topRow.className = "lotus-player-top";

    const namePill = document.createElement("button");
    namePill.type = "button";
    namePill.className = "lotus-name-pill";
    namePill.title = "Đổi tên nhân vật";
    const lotusMark = document.createElement("span");
    lotusMark.className = "lotus-name-icon";
    lotusMark.innerHTML = GOLD_LOTUS_ICON;
    this.playerNameEl = document.createElement("span");
    this.playerNameEl.className = "lotus-name-text";
    this.playerNameEl.textContent = "Đạo Hữu";
    namePill.append(lotusMark, this.playerNameEl);
    namePill.addEventListener("click", () => {
      if (this.cb.onRename) this.cb.onRename();
      else this.open("shop");
    });

    this.levelBadgeEl = document.createElement("button");
    this.levelBadgeEl.type = "button";
    this.levelBadgeEl.className = "lotus-level-badge";
    this.levelBadgeEl.title = "Mở Sổ Tu Tập & Pháp Bảo Các";
    this.levelBadgeEl.addEventListener("click", () => this.open("shop"));

    topRow.append(namePill, this.levelBadgeEl);

    const barsBox = document.createElement("div");
    barsBox.className = "lotus-bars-box";

    // Single EXP Row
    const expRow = document.createElement("div");
    expRow.className = "lotus-stat-row";
    const expIcon = document.createElement("span");
    expIcon.className = "lotus-stat-icon";
    expIcon.innerHTML = STAR_ICON;
    const expLabel = document.createElement("span");
    expLabel.className = "lotus-stat-label lotus-stat-label--exp";
    expLabel.textContent = "EXP";
    const expTrack = document.createElement("div");
    expTrack.className = "lotus-bar-track";
    this.expFillEl = document.createElement("div");
    this.expFillEl.className = "lotus-bar-fill lotus-bar-fill--exp";
    this.expTextEl = document.createElement("span");
    this.expTextEl.className = "lotus-bar-text";
    expTrack.append(this.expFillEl, this.expTextEl);
    expRow.append(expIcon, expLabel, expTrack);

    const cornerLotus = document.createElement("span");
    cornerLotus.className = "lotus-panel-flower";
    cornerLotus.innerHTML = PINK_LOTUS_ICON;

    barsBox.append(expRow, cornerLotus);
    infoPanel.append(topRow, barsBox);
    playerCard.append(this.avatarBtn, infoPanel);

    // Room / Server selector pill placed on its own row directly below the Avatar
    this.roomBtn = document.createElement("button");
    this.roomBtn.type = "button";
    this.roomBtn.className = "lotus-room-btn";
    this.roomBtn.title = "Đổi phòng / Chọn sân chùa";
    this.roomBtn.setAttribute("aria-label", vi.hud.roomPill.replace("{n}", "1").replace("{room}", "Tĩnh Tâm"));
    this.roomDotEl = document.createElement("span");
    this.roomDotEl.className = "status-dot status-dot--connecting";
    const roomTempleIcon = document.createElement("span");
    roomTempleIcon.className = "lotus-room-icon";
    roomTempleIcon.innerHTML = TEMPLE_MINI_ICON;
    this.roomTextEl = document.createElement("span");
    this.roomTextEl.className = "lotus-room-text";
    this.roomTextEl.textContent = "Phòng 1 · Tĩnh Tâm";
    const roomChevron = document.createElement("span");
    roomChevron.className = "lotus-room-chevron";
    roomChevron.textContent = "▾";
    this.roomBtn.append(this.roomDotEl, roomTempleIcon, this.roomTextEl, roomChevron);
    this.roomBtn.addEventListener("click", () => this.cb.onOpenRooms?.());

    this.playerWrap.append(playerCard, this.roomBtn, this.avatarInput);
    parent.append(this.playerWrap);

    // 2. COMPACT TOP-RIGHT CURRENCY BAR + SETTINGS GEAR + SINGLE `Nhiệm Vụ` BUTTON
    this.topRightWrap = document.createElement("div");
    this.topRightWrap.className = "lotus-top-right";

    const currencyBar = document.createElement("div");
    currencyBar.className = "lotus-currency-bar";

    const leftFlower = document.createElement("span");
    leftFlower.className = "lotus-bar-wing lotus-bar-wing--left";
    leftFlower.innerHTML = PINK_LOTUS_ICON;

    const rightFlower = document.createElement("span");
    rightFlower.className = "lotus-bar-wing lotus-bar-wing--right";
    rightFlower.innerHTML = PINK_LOTUS_ICON;

    // Slot 1: Merit (Xu Công Đức)
    this.meritValueEl = document.createElement("span");
    this.meritValueEl.className = "lotus-curr-val";
    const meritSlot = this.makeCurrencySlot(
      COIN_ICON,
      this.meritValueEl,
      "Công đức (Bấm để mở Pháp Bảo Các)",
      () => this.open("shop"),
    );

    // Slot 2: Gems (Bảo Ngọc Kim Cương)
    this.gemsValueEl = document.createElement("span");
    this.gemsValueEl.className = "lotus-curr-val";
    const gemsSlot = this.makeCurrencySlot(
      GEM_ICON,
      this.gemsValueEl,
      "Bảo ngọc (Điểm danh nhận thưởng)",
      () => this.open("checkin"),
    );

    // Slot 3: Lotus (Liên Hoa Cúng Dường)
    this.lotusValueEl = document.createElement("span");
    this.lotusValueEl.className = "lotus-curr-val";
    const lotusSlot = this.makeCurrencySlot(
      PINK_LOTUS_ICON,
      this.lotusValueEl,
      "Liên hoa (Cúng dường & Tâm nguyện)",
      () => {
        if (this.cb.onOpenOffering) this.cb.onOpenOffering();
        else this.open("checkin");
      },
    );

    // Rightmost button: Settings Gear ("Cài đặt")
    const settingsBtn = document.createElement("button");
    settingsBtn.type = "button";
    settingsBtn.className = "lotus-settings-btn";
    settingsBtn.innerHTML = GEAR_ICON;
    settingsBtn.title = vi.hud.settings;
    settingsBtn.setAttribute("aria-label", vi.hud.settings);
    settingsBtn.addEventListener("click", () => this.cb.onOpenSettings?.());

    currencyBar.append(leftFlower, meritSlot, gemsSlot, lotusSlot, settingsBtn, rightFlower);

    // Single Quick Button below Currency Bar: `Nhiệm Vụ`
    const quickRow = document.createElement("div");
    quickRow.className = "lotus-quick-row";

    const questBtn = document.createElement("button");
    questBtn.type = "button";
    questBtn.className = "lotus-quick-btn";
    questBtn.title = "Điểm danh & Nhiệm vụ Nhật Tu (Phím 6 / J)";
    const questArt = document.createElement("span");
    questArt.className = "lotus-quick-art";
    questArt.innerHTML = QUEST_SCROLL_ICON;
    const questLabel = document.createElement("span");
    questLabel.className = "lotus-quick-label";
    questLabel.textContent = "Nhiệm Vụ";
    this.questBangEl = document.createElement("span");
    this.questBangEl.className = "lotus-red-bang";
    this.questBangEl.textContent = "!";
    this.questBangEl.hidden = true;
    questBtn.append(questArt, questLabel, this.questBangEl);
    questBtn.addEventListener("click", () => {
      this.open(this.prog.canCheckIn() ? "checkin" : "quests");
    });

    quickRow.append(questBtn);
    this.topRightWrap.append(currencyBar, quickRow);
    parent.append(this.topRightWrap);

    // 3. MODAL DIALOG (Sổ Tu Tập & Pháp Bảo Các)
    this.dialog = document.createElement("dialog");
    this.dialog.className = "progression-dialog";
    this.offBackdrop = closeOnBackdrop(this.dialog);

    const shell = document.createElement("div");
    shell.className = "prog-shell";

    const header = document.createElement("div");
    header.className = "prog-header";

    const titleWrap = document.createElement("div");
    titleWrap.className = "prog-title-wrap";
    const h2 = document.createElement("h2");
    h2.textContent = "Sổ Tu Tập & Pháp Bảo Các";
    const sub = document.createElement("p");
    sub.textContent = "Tích lũy công đức mỗi ngày qua lễ Phật, lần chuỗi và gõ mõ";
    titleWrap.append(h2, sub);

    const headerRight = document.createElement("div");
    headerRight.className = "prog-header-right";
    this.balanceEl = document.createElement("span");
    this.balanceEl.className = "prog-balance";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "prog-close";
    closeBtn.setAttribute("aria-label", "Đóng");
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", () => this.close());

    headerRight.append(this.balanceEl, closeBtn);
    header.append(titleWrap, headerRight);

    const tabs = document.createElement("div");
    tabs.className = "prog-tabs";
    tabs.setAttribute("role", "tablist");
    const tabDefs: { id: TabId; label: string }[] = [
      { id: "checkin", label: "Điểm Danh" },
      { id: "quests", label: "Nhật Tu" },
      { id: "shop", label: "Pháp Bảo Các" },
    ];
    for (const t of tabDefs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "prog-tab";
      btn.setAttribute("role", "tab");
      btn.textContent = t.label;
      btn.addEventListener("click", () => {
        this.activeTab = t.id;
        this.render();
      });
      this.tabButtons.set(t.id, btn);
      tabs.append(btn);
    }

    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "prog-body";

    shell.append(header, tabs, this.bodyEl);
    this.dialog.append(shell);
    parent.append(this.dialog);

    this.offChange = this.prog.onChange(() => this.render());
    this.render();
  }

  private applyCustomAvatar(dataUrl: string): void {
    this.avatarImgEl.src = dataUrl;
    this.avatarImgEl.hidden = false;
    this.avatarDefaultEl.hidden = true;
  }

  private makeCurrencySlot(
    iconSvg: string,
    valueEl: HTMLSpanElement,
    title: string,
    onClick: () => void,
  ): HTMLDivElement {
    const slot = document.createElement("div");
    slot.className = "lotus-curr-slot";
    slot.title = title;

    const icon = document.createElement("span");
    icon.className = "lotus-curr-icon";
    icon.innerHTML = iconSvg;

    const plusBtn = document.createElement("button");
    plusBtn.type = "button";
    plusBtn.className = "lotus-curr-plus";
    plusBtn.textContent = "+";
    plusBtn.setAttribute("aria-label", title);
    plusBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });

    slot.append(icon, valueEl, plusBtn);
    slot.addEventListener("click", onClick);
    return slot;
  }

  /** Updates the player's display name on the top-left status card. */
  setPlayerName(name: string): void {
    const clean = name.trim();
    if (clean) {
      this.playerNameEl.textContent = clean;
      this.playerNameEl.title = clean;
    }
  }

  /** Tints the default chibi monk avatar's robe to match the player's chosen robe color. */
  setPlayerColor(color: string): void {
    this.avatarBtn.style.setProperty("--monk-robe", color);
  }

  /** Updates the room / server selector pill right below the Avatar. */
  setRoomInfo(roomNum: number, roomName: string, status?: ConnectionStatus): void {
    const label = `Phòng ${roomNum} · ${roomName}`;
    this.roomTextEl.textContent = label;
    this.roomBtn.title = `Đang ở ${label} (Bấm để đổi phòng)`;
    this.roomBtn.setAttribute("aria-label", vi.hud.roomPill.replace("{n}", String(roomNum)).replace("{room}", roomName));
    if (status) {
      this.roomDotEl.className =
        status === "connected"
          ? "status-dot"
          : status === "connecting"
            ? "status-dot status-dot--connecting"
            : "status-dot status-dot--off";
    }
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  open(tab?: TabId): void {
    if (tab) this.activeTab = tab;
    else if (this.prog.canCheckIn()) this.activeTab = "checkin";
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  toggle(): void {
    if (this.dialog.open) this.close();
    else this.open();
  }

  dispose(): void {
    this.offChange();
    this.offBackdrop();
    this.playerWrap.remove();
    this.topRightWrap.remove();
    this.dialog.remove();
  }

  private render(): void {
    // 1. Update Top-Left Player Status Frame (Level + EXP bar)
    this.levelBadgeEl.textContent = `Lv.${this.prog.level}`;
    this.expFillEl.style.width = `${this.prog.expPercent}%`;
    this.expTextEl.textContent = `${this.prog.expInLevel}/${this.prog.expNext}`;

    // 2. Update Top-Right Currency Bar & Notification Badge
    this.meritValueEl.textContent = String(this.prog.merit);
    this.gemsValueEl.textContent = String(this.prog.gems);
    this.lotusValueEl.textContent = String(this.prog.lotus);
    this.questBangEl.hidden = !this.prog.hasNotification();

    // 3. Update Modal Header & Tabs
    this.balanceEl.textContent = `🪙 ${this.prog.merit} · 💎 ${this.prog.gems} · 🪷 ${this.prog.lotus}`;

    for (const [id, btn] of this.tabButtons) {
      btn.setAttribute("aria-selected", id === this.activeTab ? "true" : "false");
    }

    if (!this.dialog.open && !this.bodyEl.hasChildNodes()) {
      this.renderActiveTab();
      return;
    }
    if (this.dialog.open) {
      this.renderActiveTab();
    }
  }

  private renderActiveTab(): void {
    this.bodyEl.replaceChildren();
    if (this.activeTab === "checkin") this.renderCheckIn();
    else if (this.activeTab === "quests") this.renderQuests();
    else this.renderShop();
  }

  private renderCheckIn(): void {
    const status = this.prog.checkInStatus();

    const banner = document.createElement("div");
    banner.className = "checkin-banner";

    const textWrap = document.createElement("div");
    textWrap.className = "checkin-banner-text";
    const strong = document.createElement("strong");
    strong.textContent = status.canClaim
      ? `Hôm nay là Ngày ${status.activeDay} trong chuỗi tinh tấn`
      : `Đã điểm danh Ngày ${status.activeDay} hôm nay`;
    const sub = document.createElement("span");
    sub.textContent = status.canClaim
      ? "Nhận lộc Công đức, Bảo ngọc và Liên hoa đầu ngày."
      : "Hãy quay lại vào ngày mai (sau 00:00 giờ Việt Nam) để nối tiếp chuỗi tu tập.";
    textWrap.append(strong, sub);

    const claimBtn = document.createElement("button");
    claimBtn.type = "button";
    claimBtn.className = "prog-btn";
    claimBtn.disabled = !status.canClaim;
    const todayReward = status.rewards[status.activeDay - 1] ?? 20;
    claimBtn.textContent = status.canClaim ? `Điểm danh (+${todayReward})` : "Đã nhận hôm nay";
    claimBtn.addEventListener("click", () => {
      const res = this.prog.claimCheckIn();
      if (res.ok) {
        this.cb.onClaimReward?.(res.reward, `Điểm danh Ngày ${res.day}: +${res.reward} Công đức`);
      }
    });

    banner.append(textWrap, claimBtn);

    const grid = document.createElement("div");
    grid.className = "checkin-grid";
    status.rewards.forEach((reward, idx) => {
      const dayNum = idx + 1;
      const card = document.createElement("div");
      card.className = "checkin-day";
      if (dayNum === 7) card.classList.add("checkin-day--wide");

      const isDone = status.canClaim ? dayNum < status.activeDay : dayNum <= status.activeDay;
      const isToday = dayNum === status.activeDay;
      if (isDone) card.classList.add("checkin-day--done");
      if (isToday && status.canClaim) card.classList.add("checkin-day--today");

      const lbl = document.createElement("span");
      lbl.className = "checkin-day-label";
      lbl.textContent = dayNum === 7 ? "Ngày 7 · Viên Mãn Tuần" : `Ngày ${dayNum}`;

      const val = document.createElement("span");
      val.className = "checkin-day-reward";
      val.textContent = `+${reward} Công đức`;

      const st = document.createElement("span");
      st.className = "checkin-day-status";
      st.textContent = isDone ? "✓ Đã nhận" : isToday ? "Hôm nay" : "Sắp tới";

      card.append(lbl, val, st);
      grid.append(card);
    });

    this.bodyEl.append(banner, grid);
  }

  private renderQuests(): void {
    const list = document.createElement("div");
    list.className = "quest-list";

    // Bonus banner for completing all 5 daily quests
    const bonusCard = document.createElement("div");
    bonusCard.className = "checkin-banner";
    const bonusText = document.createElement("div");
    bonusText.className = "checkin-banner-text";
    const bStrong = document.createElement("strong");
    bStrong.textContent = `Viên Mãn Nhật Tu (+${ALL_QUESTS_BONUS} Công đức · +5 💎 · +3 🪷)`;
    const bSub = document.createElement("span");
    bSub.textContent = "Hoàn thành cả 5 nhiệm vụ trong ngày để nhận thưởng viên mãn.";
    bonusText.append(bStrong, bSub);

    const bonusBtn = document.createElement("button");
    bonusBtn.type = "button";
    bonusBtn.className = "prog-btn";
    bonusBtn.disabled = !this.prog.canClaimAllBonus;
    bonusBtn.textContent = this.prog.allBonusClaimed
      ? "Đã nhận thưởng"
      : this.prog.canClaimAllBonus
        ? `Nhận +${ALL_QUESTS_BONUS}`
        : "Chưa đủ 5/5";
    bonusBtn.addEventListener("click", () => {
      const res = this.prog.claimAllBonus();
      if (res.ok) {
        this.cb.onClaimReward?.(res.reward, `Viên mãn Nhật Tu: +${res.reward} Công đức`);
      }
    });
    bonusCard.append(bonusText, bonusBtn);
    list.append(bonusCard);

    for (const q of this.prog.quests()) {
      const card = document.createElement("div");
      card.className = "quest-card";
      if (q.completed && !q.claimed) card.classList.add("quest-card--done");

      const info = document.createElement("div");
      info.className = "quest-info";

      const titleRow = document.createElement("div");
      titleRow.className = "quest-title-row";
      const title = document.createElement("span");
      title.className = "quest-title";
      title.textContent = q.def.title;
      const rewardTag = document.createElement("span");
      rewardTag.className = "quest-reward-tag";
      rewardTag.textContent = `+${q.def.reward} Công đức`;
      titleRow.append(title, rewardTag);

      const desc = document.createElement("p");
      desc.className = "quest-desc";
      desc.textContent = q.def.desc;

      const barWrap = document.createElement("div");
      barWrap.className = "quest-bar-wrap";
      const bar = document.createElement("div");
      bar.className = "quest-bar";
      const fill = document.createElement("div");
      fill.className = "quest-bar-fill";
      const pct = Math.min(100, Math.round((q.progress / q.def.target) * 100));
      fill.style.width = `${pct}%`;
      bar.append(fill);

      const count = document.createElement("span");
      count.className = "quest-count";
      count.textContent = `${q.progress}/${q.def.target}`;
      barWrap.append(bar, count);

      info.append(titleRow, desc, barWrap);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "prog-btn";
      btn.disabled = !q.completed || q.claimed;
      btn.textContent = q.claimed ? "Đã nhận" : q.completed ? "Nhận thưởng" : "Đang tu tập";
      btn.addEventListener("click", () => {
        const res = this.prog.claimQuest(q.def.id);
        if (res.ok) {
          this.cb.onClaimReward?.(res.reward, `${q.def.title}: +${res.reward} Công đức`);
        }
      });

      card.append(info, btn);
      list.append(card);
    }

    this.bodyEl.append(list);
  }

  private renderShop(): void {
    const list = document.createElement("div");
    list.className = "shop-list";

    for (const item of SHOP_ITEMS) {
      const owned = this.prog.isOwned(item.id);
      const equipped = this.prog.isEquipped(item.id);

      const card = document.createElement("div");
      card.className = "shop-card";
      if (equipped) card.classList.add("shop-card--equipped");

      const info = document.createElement("div");
      info.className = "shop-info";

      const cat = document.createElement("span");
      cat.className = "shop-cat";
      cat.textContent = CATEGORY_LABEL[item.category];

      const name = document.createElement("span");
      name.className = "shop-name";
      name.textContent = item.name;

      const desc = document.createElement("p");
      desc.className = "shop-desc";
      desc.textContent = item.desc;

      info.append(cat, name, desc);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "prog-btn";
      if (equipped) {
        btn.classList.add("prog-btn--equipped");
        btn.textContent = "Đang dùng (Gỡ)";
      } else if (owned) {
        btn.classList.add("prog-btn--equip");
        btn.textContent = "Trang bị";
      } else {
        btn.textContent = `Thỉnh · ${item.price}`;
      }

      btn.addEventListener("click", () => {
        const res = this.prog.buyOrEquip(item.id);
        this.cb.onShopAction?.(res);
      });

      card.append(info, btn);
      list.append(card);
    }

    this.bodyEl.append(list);
  }
}
