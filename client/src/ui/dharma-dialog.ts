import { CHAT_LIMITS } from "@santinh/shared";
import { safeLocalStorage } from "../beads/counter.ts";
import { vi } from "../i18n/vi.ts";
import { closeOnBackdrop } from "./dialog.ts";
import "./base.css";

const DHARMA_STORAGE_KEY = "santinh.dharma.v1";
const CARD_W = 540;
const CARD_H = 760;

interface DharmaStoredState {
  count: number;
  lastIndex: number;
}

function loadStoredDharma(): DharmaStoredState {
  try {
    const raw = safeLocalStorage()?.getItem(DHARMA_STORAGE_KEY);
    if (!raw) return { count: 0, lastIndex: 0 };
    const parsed = JSON.parse(raw) as Partial<DharmaStoredState>;
    const count = typeof parsed.count === "number" && parsed.count >= 0 ? Math.floor(parsed.count) : 0;
    const lastIndex =
      typeof parsed.lastIndex === "number" && parsed.lastIndex >= 0 && parsed.lastIndex < vi.dharma.cards.length
        ? Math.floor(parsed.lastIndex)
        : 0;
    return { count, lastIndex };
  } catch {
    return { count: 0, lastIndex: 0 };
  }
}

function saveStoredDharma(state: DharmaStoredState): void {
  try {
    safeLocalStorage()?.setItem(DHARMA_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore private-browsing quota errors.
  }
}

/** Universal rounded-rectangle path helper compatible with all browsers and TypeScript DOM libs. */
function drawRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export interface DharmaDialogHandlers {
  onShakeTick?(): void;
  onDrawn?(title: string): void;
  onShare?(verseText: string): void;
}

/**
 * Modal dialog that draws and renders a traditional silk-and-gold Dharma Card ("Thẻ Pháp Ngữ")
 * onto a high-DPI HTML5 Canvas, supporting bamboo-tube shake rituals, PNG download, and room chat sharing.
 */
export class DharmaDialog {
  private readonly dialog: HTMLDialogElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly drawBtn: HTMLButtonElement;
  private readonly statsEl: HTMLParagraphElement;
  private readonly handlers: DharmaDialogHandlers;
  private readonly offBackdrop: () => void;
  private state: DharmaStoredState;
  private shaking = false;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor(handlers: DharmaDialogHandlers = {}, parent: HTMLElement = document.body) {
    this.handlers = handlers;
    this.state = loadStoredDharma();

    this.dialog = document.createElement("dialog");
    this.dialog.className = "dialog";
    this.dialog.setAttribute("aria-label", vi.dharma.title);

    const head = document.createElement("div");
    head.className = "dialog-head";
    const h2 = document.createElement("h2");
    h2.textContent = vi.dharma.title;
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "dialog-close";
    closeBtn.setAttribute("aria-label", vi.dharma.close);
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.close());
    head.append(h2, closeBtn);

    const desc = document.createElement("p");
    desc.className = "dialog-desc";
    desc.textContent = vi.dharma.desc;

    const body = document.createElement("div");
    body.className = "dialog-body";

    const wrap = document.createElement("div");
    wrap.className = "dharma-wrap";

    this.canvas = document.createElement("canvas");
    this.canvas.width = CARD_W;
    this.canvas.height = CARD_H;
    this.canvas.className = "dharma-canvas";

    const actions = document.createElement("div");
    actions.className = "dharma-actions";

    this.drawBtn = document.createElement("button");
    this.drawBtn.type = "button";
    this.drawBtn.className = "btn";
    this.drawBtn.textContent = vi.dharma.drawBtn;
    this.drawBtn.addEventListener("click", () => this.drawNewCard());

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "btn btn--ghost";
    saveBtn.textContent = vi.dharma.saveBtn;
    saveBtn.addEventListener("click", () => this.downloadCard());

    const shareBtn = document.createElement("button");
    shareBtn.type = "button";
    shareBtn.className = "btn btn--ghost";
    shareBtn.textContent = vi.dharma.shareBtn;
    shareBtn.addEventListener("click", () => this.shareCurrentCard());

    actions.append(this.drawBtn, saveBtn, shareBtn);

    this.statsEl = document.createElement("p");
    this.statsEl.className = "dharma-stats";

    wrap.append(this.canvas, actions, this.statsEl);
    body.append(wrap);
    this.dialog.append(head, desc, body);

    this.offBackdrop = closeOnBackdrop(this.dialog);

    parent.append(this.dialog);
    this.renderCard();
  }

  /** Opens the dialog; if the visitor has never drawn a card before, automatically performs the first draw. */
  open(drawImmediately = false): void {
    if (!this.dialog.open) {
      this.dialog.showModal();
    }
    if (drawImmediately || this.state.count === 0) {
      this.drawNewCard();
    } else {
      this.renderCard();
    }
  }

  close(): void {
    this.clearTimers();
    this.shaking = false;
    delete this.canvas.dataset.shaking;
    this.drawBtn.disabled = false;
    this.drawBtn.textContent = vi.dharma.drawBtn;
    if (this.dialog.open) this.dialog.close();
  }

  dispose(): void {
    this.close();
    this.offBackdrop();
    this.dialog.remove();
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private drawNewCard(): void {
    if (this.shaking) return;
    this.shaking = true;
    this.drawBtn.disabled = true;
    this.drawBtn.textContent = vi.dharma.drawingBtn;
    this.canvas.dataset.shaking = "true";

    // Play 3 rhythmic bamboo-tube clatter ticks before the card settles.
    this.handlers.onShakeTick?.();
    this.timers.push(setTimeout(() => this.handlers.onShakeTick?.(), 160));
    this.timers.push(setTimeout(() => this.handlers.onShakeTick?.(), 320));

    this.timers.push(
      setTimeout(() => {
        this.shaking = false;
        delete this.canvas.dataset.shaking;
        this.drawBtn.disabled = false;
        this.drawBtn.textContent = vi.dharma.drawBtn;

        const totalCards = vi.dharma.cards.length;
        let nextIndex = Math.floor(Math.random() * totalCards);
        if (totalCards > 1 && nextIndex === this.state.lastIndex) {
          nextIndex = (nextIndex + 1 + Math.floor(Math.random() * (totalCards - 1))) % totalCards;
        }
        this.state = {
          count: this.state.count + 1,
          lastIndex: nextIndex,
        };
        saveStoredDharma(this.state);
        this.renderCard();

        const card = vi.dharma.cards[this.state.lastIndex];
        if (card) this.handlers.onDrawn?.(card.title);
      }, 520),
    );
  }

  private downloadCard(): void {
    const num = String(this.state.lastIndex + 1).padStart(2, "0");
    const link = document.createElement("a");
    link.download = `the-phap-ngu-${num}-san-tinh.png`;
    link.href = this.canvas.toDataURL("image/png");
    link.click();
  }

  private shareCurrentCard(): void {
    const card = vi.dharma.cards[this.state.lastIndex] ?? vi.dharma.cards[0];
    if (!card) return;
    // Fit within CHAT_LIMITS.free.maxChars (80 code points) so free-tier room chat never rejects the verse.
    const max = CHAT_LIMITS.free.maxChars;
    const full = `【${card.title}】 ${card.lines[0]} ${card.lines[1]}`;
    const short = `${card.lines[0]} ${card.lines[1]}`;
    const verse = [...full].length <= max ? full : [...short].length <= max ? short : [...short].slice(0, max).join("");
    this.handlers.onShare?.(verse);
  }

  private renderCard(): void {
    this.statsEl.textContent = vi.dharma.stats.replace("{n}", String(this.state.count));
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;

    const cardIndex = this.state.lastIndex;
    const card = vi.dharma.cards[cardIndex] ?? vi.dharma.cards[0];
    if (!card) return;

    const w = CARD_W;
    const h = CARD_H;

    // 1. Deep temple moss-jade outer background.
    ctx.fillStyle = "#1b2820";
    ctx.fillRect(0, 0, w, h);

    // 2. Warm antique silk parchment interior.
    const paperGrad = ctx.createLinearGradient(0, 20, 0, h - 20);
    paperGrad.addColorStop(0, "#fbf3e0");
    paperGrad.addColorStop(0.5, "#f5e6c8");
    paperGrad.addColorStop(1, "#ebd4ab");
    ctx.fillStyle = paperGrad;
    drawRoundRect(ctx, 22, 22, w - 44, h - 44, 18);
    ctx.fill();

    // 3. Double ornamental gold-bronze border + corner lotus flourishes.
    ctx.strokeStyle = "#b58332";
    ctx.lineWidth = 3;
    drawRoundRect(ctx, 32, 32, w - 64, h - 64, 12);
    ctx.stroke();

    ctx.strokeStyle = "rgba(156, 104, 34, 0.55)";
    ctx.lineWidth = 1.5;
    drawRoundRect(ctx, 40, 40, w - 80, h - 80, 8);
    ctx.stroke();

    // Corner ornaments
    for (const [cx, cy] of [
      [48, 48],
      [w - 48, 48],
      [48, h - 48],
      [w - 48, h - 48],
    ] as const) {
      ctx.fillStyle = "#b58332";
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // 4. Top header & Lotus seal.
    ctx.textAlign = "center";
    ctx.fillStyle = "#7a5422";
    ctx.font = '600 15px "Be Vietnam Pro", system-ui, sans-serif';
    ctx.fillText(vi.dharma.cardHeader, w / 2, 74);

    // Decorative lotus seal
    ctx.save();
    ctx.translate(w / 2, 114);
    ctx.strokeStyle = "#a83824";
    ctx.fillStyle = "rgba(184, 55, 35, 0.12)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -14);
    ctx.quadraticCurveTo(9, -4, 0, 8);
    ctx.quadraticCurveTo(-9, -4, 0, -14);
    ctx.moveTo(0, 8);
    ctx.quadraticCurveTo(14, 0, 11, 10);
    ctx.quadraticCurveTo(4, 12, 0, 8);
    ctx.moveTo(0, 8);
    ctx.quadraticCurveTo(-14, 0, -11, 10);
    ctx.quadraticCurveTo(-4, 12, 0, 8);
    ctx.stroke();
    ctx.restore();

    // 5. Slip Number Badge ("Quẻ số 01").
    const numStr = vi.dharma.numberLabel.replace("{n}", String(cardIndex + 1).padStart(2, "0"));
    ctx.fillStyle = "#9e2b22";
    ctx.font = '700 16px "Be Vietnam Pro", system-ui, sans-serif';
    ctx.fillText(`${numStr} · ${vi.dharma.cardSubheader}`, w / 2, 162);

    // 6. Card Title.
    ctx.fillStyle = "#2b180a";
    ctx.font = '700 30px "Be Vietnam Pro", Georgia, serif';
    ctx.fillText(card.title, w / 2, 208);

    // Divider line with central diamond.
    ctx.strokeStyle = "rgba(156, 104, 34, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(96, 232);
    ctx.lineTo(w - 96, 232);
    ctx.stroke();
    ctx.fillStyle = "#b58332";
    ctx.beginPath();
    ctx.moveTo(w / 2, 226);
    ctx.lineTo(w / 2 + 6, 232);
    ctx.lineTo(w / 2, 238);
    ctx.lineTo(w / 2 - 6, 232);
    ctx.closePath();
    ctx.fill();

    // 7. 4-line Dharma Verse.
    ctx.fillStyle = "#362210";
    ctx.font = 'italic 600 22px Georgia, "Times New Roman", serif';
    let vy = 286;
    for (const line of card.lines) {
      ctx.fillText(line, w / 2, vy);
      vy += 46;
    }

    // 8. Bottom Mindfulness Guidance Box.
    const boxX = 56;
    const boxY = 488;
    const boxW = w - 112;
    const boxH = 204;
    ctx.fillStyle = "rgba(181, 131, 50, 0.11)";
    ctx.strokeStyle = "rgba(156, 104, 34, 0.4)";
    ctx.lineWidth = 1.5;
    drawRoundRect(ctx, boxX, boxY, boxW, boxH, 12);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#8a4b14";
    ctx.font = '700 16px "Be Vietnam Pro", system-ui, sans-serif';
    ctx.fillText(`✦ ${vi.dharma.guidanceTitle} ✦`, w / 2, boxY + 34);

    ctx.fillStyle = "#3d2914";
    ctx.font = '500 18px "Be Vietnam Pro", system-ui, sans-serif';
    const wrapped = wrapLines(ctx, card.guidance, boxW - 44);
    let gy = boxY + 74;
    for (const line of wrapped) {
      ctx.fillText(line, w / 2, gy);
      gy += 30;
    }
  }
}
