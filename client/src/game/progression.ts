import { vnMidnight } from "@santinh/shared";
import { safeLocalStorage } from "../beads/counter.ts";

export const PROGRESSION_STORAGE_KEY = "santinh.progression.v1";
const DAY_MS = 86_400_000;
const EXP_PER_LEVEL = 100;
/** Default EXP starts at Level 3 (225 EXP = Level 3 with 25% EXP bar) so the status bar looks lively right away. */
const DEFAULT_EXP = 225;
const DEFAULT_HP = 18;

export type QuestKind = "bow" | "beads" | "woodblock" | "hello" | "offering";
export type ShopCategory = "aura" | "artifact" | "title";

export interface QuestDef {
  readonly id: QuestKind;
  readonly title: string;
  readonly desc: string;
  readonly target: number;
  readonly reward: number;
}

export interface QuestProgress {
  readonly def: QuestDef;
  readonly progress: number;
  readonly completed: boolean;
  readonly claimed: boolean;
}

export interface ShopItem {
  readonly id: string;
  readonly category: ShopCategory;
  readonly name: string;
  readonly desc: string;
  readonly price: number;
  /** Short badge text for titles, or visual key for auras / artifacts. */
  readonly badge?: string;
}

export const CHECKIN_REWARDS: readonly number[] = [20, 30, 40, 50, 60, 80, 150];
export const ALL_QUESTS_BONUS = 50;

export const QUEST_DEFS: readonly QuestDef[] = [
  {
    id: "bow",
    title: "Thành Tâm Lễ Phật",
    desc: "Thực hiện 3 lễ quỳ lạy trước Phật đài trong Chánh điện.",
    target: 3,
    reward: 30,
  },
  {
    id: "beads",
    title: "Chánh Niệm Lần Chuỗi",
    desc: "Tịnh tâm lần đủ 36 hạt tràng hạt niệm Phật.",
    target: 36,
    reward: 35,
  },
  {
    id: "woodblock",
    title: "Tiếng Mõ Tỉnh Thức",
    desc: "Gõ mõ tụng niệm 20 nhịp giữ chánh niệm.",
    target: 20,
    reward: 25,
  },
  {
    id: "hello",
    title: "Kết Duyên Đạo Hữu",
    desc: "Chắp tay xá chào đạo hữu trong sân chùa 2 lần.",
    target: 2,
    reward: 20,
  },
  {
    id: "offering",
    title: "Tâm Thành Cúng Dường",
    desc: "Thắp hương, thả hoa đăng, treo ước nguyện hoặc rút thẻ Pháp ngữ 1 lần.",
    target: 1,
    reward: 30,
  },
];

export const SHOP_ITEMS: readonly ShopItem[] = [
  {
    id: "aura_lotus",
    category: "aura",
    name: "Liên Hoa Tịnh Quang",
    desc: "Vòng hào quang hoa sen vàng dịu lan tỏa dưới bước chân và khi tọa thiền.",
    price: 150,
  },
  {
    id: "aura_jade",
    category: "aura",
    name: "Bích Ngọc Tâm Đăng",
    desc: "Hào quang ngọc bích thanh lương xoay nhẹ dưới chân người tu tập.",
    price: 250,
  },
  {
    id: "aura_wheel",
    category: "aura",
    name: "Kim Cang Pháp Luân",
    desc: "Pháp luân tám nan vàng rực rỡ xoay chuyển đồng tâm dưới đài sen.",
    price: 400,
  },
  {
    id: "woodblock_crimson",
    category: "artifact",
    name: "Mõ Sơn Son Thếp Vàng",
    desc: "Mõ phủ sơn son thếp vàng; mỗi nhịp gõ lan tỏa sóng âm hoa sen vàng dưới chân.",
    price: 180,
  },
  {
    id: "woodblock_jade",
    category: "artifact",
    name: "Mõ Ngọc Bích Cổ",
    desc: "Mõ ngọc bích cổ truyền; mỗi nhịp gõ lan tỏa sóng âm ngọc lục bảo thanh tịnh.",
    price: 280,
  },
  {
    id: "title_tinhtam",
    category: "title",
    name: "Danh Hiệu · Tịnh Tâm",
    desc: "Hiển thị huy hiệu [Tịnh Tâm] vàng ấm phía trước tên nhân vật.",
    price: 120,
    badge: "Tịnh Tâm",
  },
  {
    id: "title_annhien",
    category: "title",
    name: "Danh Hiệu · An Nhiên",
    desc: "Hiển thị huy hiệu [An Nhiên] thanh thoát phía trước tên nhân vật.",
    price: 180,
    badge: "An Nhiên",
  },
  {
    id: "title_cusi",
    category: "title",
    name: "Danh Hiệu · Cư Sĩ",
    desc: "Hiển thị huy hiệu [Cư Sĩ] trang nghiêm phía trước tên nhân vật.",
    price: 240,
    badge: "Cư Sĩ",
  },
  {
    id: "title_phuochue",
    category: "title",
    name: "Danh Hiệu · Phước Huệ",
    desc: "Hiển thị huy hiệu [Phước Huệ] song tu phía trước tên nhân vật.",
    price: 320,
    badge: "Phước Huệ",
  },
];

interface StoredData {
  merit: number;
  gems: number;
  lotus: number;
  exp: number;
  hp: number;
  lastCheckInDay: number;
  streak: number;
  questDay: number;
  questCounts: Partial<Record<QuestKind, number>>;
  questClaimed: Partial<Record<QuestKind, boolean>>;
  allBonusClaimed: boolean;
  owned: string[];
  equippedAura: string | null;
  equippedArtifact: string | null;
  equippedTitle: string | null;
}

export type BuyOrEquipResult =
  | { action: "bought"; item: ShopItem }
  | { action: "equipped"; item: ShopItem }
  | { action: "unequipped"; item: ShopItem }
  | { action: "insufficient"; item: ShopItem; missing: number }
  | { action: "invalid" };

export interface AdminResourcePatch {
  merit?: number;
  gems?: number;
  lotus?: number;
  level?: number;
}

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

/**
 * Manages daily check-in, daily quests, Merit currency ("Công Đức"), Gems ("Bảo Ngọc"),
 * Lotus ("Liên Hoa"), player Level / EXP / HP, and spiritual shop items.
 */
export class Progression {
  private data: StoredData;
  private readonly store: KeyValueStore | null;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();
  private readonly questCompleteListeners = new Set<(def: QuestDef) => void>();

  constructor(
    now: () => number = Date.now,
    store: KeyValueStore | null = safeLocalStorage(),
    initialMeritFallback = 0,
  ) {
    this.now = now;
    this.store = store;
    this.data = this.load(initialMeritFallback);
    this.ensureToday();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onQuestComplete(fn: (def: QuestDef) => void): () => void {
    this.questCompleteListeners.add(fn);
    return () => this.questCompleteListeners.delete(fn);
  }

  get merit(): number {
    return this.data.merit;
  }

  get gems(): number {
    return this.data.gems;
  }

  get lotus(): number {
    return this.data.lotus;
  }

  get level(): number {
    return Math.max(1, Math.floor(this.data.exp / EXP_PER_LEVEL) + 1);
  }

  get expInLevel(): number {
    return this.data.exp % EXP_PER_LEVEL;
  }

  get expNext(): number {
    return EXP_PER_LEVEL;
  }

  get expPercent(): number {
    return Math.min(100, Math.max(0, Math.round((this.expInLevel / this.expNext) * 100)));
  }

  /** At Level 3, maxHp = 122 + 3 * 20 = 182 (matches 18/182 on the design reference). */
  get maxHp(): number {
    return 122 + this.level * 20;
  }

  get hp(): number {
    return Math.min(this.maxHp, Math.max(1, this.data.hp));
  }

  get hpPercent(): number {
    return Math.min(100, Math.max(0, Math.round((this.hp / this.maxHp) * 100)));
  }

  get equippedAura(): string | null {
    return this.data.equippedAura;
  }

  get equippedArtifact(): string | null {
    return this.data.equippedArtifact;
  }

  get equippedTitle(): string | null {
    return this.data.equippedTitle;
  }

  /** Badge text of the currently equipped title (e.g. "Tịnh Tâm"), or null. */
  get equippedTitleBadge(): string | null {
    const id = this.data.equippedTitle;
    if (!id) return null;
    const item = SHOP_ITEMS.find((it) => it.id === id);
    return item?.badge ?? null;
  }

  isOwned(itemId: string): boolean {
    return this.data.owned.includes(itemId);
  }

  isEquipped(itemId: string): boolean {
    return (
      this.data.equippedAura === itemId ||
      this.data.equippedArtifact === itemId ||
      this.data.equippedTitle === itemId
    );
  }

  /** True when today's check-in has not been claimed yet. */
  canCheckIn(): boolean {
    this.ensureToday();
    const today = vnMidnight(this.now());
    return this.data.lastCheckInDay !== today;
  }

  /** Current 1..7 day index shown on the check-in calendar. */
  checkInStatus(): {
    canClaim: boolean;
    activeDay: number;
    streak: number;
    rewards: readonly number[];
  } {
    this.ensureToday();
    const today = vnMidnight(this.now());
    const last = this.data.lastCheckInDay;
    const canClaim = last !== today;
    let activeDay = this.data.streak;
    if (canClaim) {
      if (last === today - DAY_MS) {
        activeDay = (this.data.streak % 7) + 1;
      } else {
        activeDay = 1;
      }
    } else if (activeDay < 1 || activeDay > 7) {
      activeDay = 1;
    }
    return {
      canClaim,
      activeDay,
      streak: this.data.streak,
      rewards: CHECKIN_REWARDS,
    };
  }

  /** Claims today's check-in reward. */
  claimCheckIn(): { ok: boolean; day: number; reward: number } {
    this.ensureToday();
    const today = vnMidnight(this.now());
    if (this.data.lastCheckInDay === today) {
      return { ok: false, day: this.data.streak, reward: 0 };
    }
    const nextStreak = this.data.lastCheckInDay === today - DAY_MS ? (this.data.streak % 7) + 1 : 1;
    const reward = CHECKIN_REWARDS[nextStreak - 1] ?? 20;
    this.data.lastCheckInDay = today;
    this.data.streak = nextStreak;
    this.data.merit += reward;
    this.data.lotus += 1;
    if (nextStreak === 3 || nextStreak === 7) {
      this.data.gems += 5;
    } else {
      this.data.gems += 1;
    }
    this.gainExpAndHp(25, 16);
    this.save();
    this.emitChange();
    return { ok: true, day: nextStreak, reward };
  }

  /** Current list of daily quests and their progress for today. */
  quests(): QuestProgress[] {
    this.ensureToday();
    return QUEST_DEFS.map((def) => {
      const raw = this.data.questCounts[def.id] ?? 0;
      const progress = Math.min(def.target, Math.max(0, raw));
      const completed = progress >= def.target;
      const claimed = Boolean(this.data.questClaimed[def.id]);
      return { def, progress, completed, claimed };
    });
  }

  get allQuestsCompleted(): boolean {
    this.ensureToday();
    return QUEST_DEFS.every((def) => (this.data.questCounts[def.id] ?? 0) >= def.target);
  }

  get canClaimAllBonus(): boolean {
    return this.allQuestsCompleted && !this.data.allBonusClaimed;
  }

  get allBonusClaimed(): boolean {
    this.ensureToday();
    return this.data.allBonusClaimed;
  }

  /** True when the player has an unclaimed daily check-in or quest reward. */
  hasNotification(): boolean {
    this.ensureToday();
    if (this.canCheckIn()) return true;
    for (const def of QUEST_DEFS) {
      const done = (this.data.questCounts[def.id] ?? 0) >= def.target;
      if (done && !this.data.questClaimed[def.id]) return true;
    }
    return this.canClaimAllBonus;
  }

  /** Adds Merit directly (e.g. +1 from woodblock tap or bead milestone). */
  addMerit(amount: number): void {
    if (!(amount > 0) || !Number.isFinite(amount)) return;
    this.ensureToday();
    const n = Math.floor(amount);
    this.data.merit += n;
    this.gainExpAndHp(Math.max(1, n * 2), 1);
    this.save();
    this.emitChange();
  }

  addGems(amount: number): void {
    if (!(amount > 0) || !Number.isFinite(amount)) return;
    this.ensureToday();
    this.data.gems += Math.floor(amount);
    this.save();
    this.emitChange();
  }

  addLotus(amount: number): void {
    if (!(amount > 0) || !Number.isFinite(amount)) return;
    this.ensureToday();
    this.data.lotus += Math.floor(amount);
    this.save();
    this.emitChange();
  }

  /** Records progress towards one of today's quests. */
  recordAction(kind: QuestKind, amount = 1): void {
    if (!(amount > 0) || !Number.isFinite(amount)) return;
    this.ensureToday();
    const step = Math.floor(amount);
    if (kind === "offering") {
      this.data.lotus += step;
    }
    this.gainExpAndHp(4, 2);

    const def = QUEST_DEFS.find((q) => q.id === kind);
    if (!def) {
      this.save();
      this.emitChange();
      return;
    }
    const prev = this.data.questCounts[kind] ?? 0;
    if (prev >= def.target) {
      this.save();
      this.emitChange();
      return;
    }
    const next = Math.min(def.target, prev + step);
    this.data.questCounts[kind] = next;
    this.save();
    this.emitChange();
    if (prev < def.target && next >= def.target) {
      for (const fn of this.questCompleteListeners) fn(def);
    }
  }

  /** Claims the reward for a completed daily quest. */
  claimQuest(kind: QuestKind): { ok: boolean; reward: number } {
    this.ensureToday();
    const def = QUEST_DEFS.find((q) => q.id === kind);
    if (!def) return { ok: false, reward: 0 };
    const count = this.data.questCounts[kind] ?? 0;
    if (count < def.target || this.data.questClaimed[kind]) {
      return { ok: false, reward: 0 };
    }
    this.data.questClaimed[kind] = true;
    this.data.merit += def.reward;
    this.data.lotus += 1;
    this.gainExpAndHp(20, 12);
    this.save();
    this.emitChange();
    return { ok: true, reward: def.reward };
  }

  /** Claims the bonus reward when all 5 daily quests are completed. */
  claimAllBonus(): { ok: boolean; reward: number } {
    this.ensureToday();
    if (!this.canClaimAllBonus) return { ok: false, reward: 0 };
    this.data.allBonusClaimed = true;
    this.data.merit += ALL_QUESTS_BONUS;
    this.data.gems += 5;
    this.data.lotus += 3;
    this.gainExpAndHp(50, this.maxHp);
    this.save();
    this.emitChange();
    return { ok: true, reward: ALL_QUESTS_BONUS };
  }

  /** Buys an item if not owned, or toggles its equipped state if already owned. */
  buyOrEquip(itemId: string): BuyOrEquipResult {
    const item = SHOP_ITEMS.find((it) => it.id === itemId);
    if (!item) return { action: "invalid" };

    if (!this.isOwned(item.id)) {
      if (this.data.merit < item.price) {
        return { action: "insufficient", item, missing: item.price - this.data.merit };
      }
      this.data.merit -= item.price;
      this.data.owned.push(item.id);
      this.equipSlot(item.category, item.id);
      this.save();
      this.emitChange();
      return { action: "bought", item };
    }

    if (this.isEquipped(item.id)) {
      this.equipSlot(item.category, null);
      this.save();
      this.emitChange();
      return { action: "unequipped", item };
    }

    this.equipSlot(item.category, item.id);
    this.save();
    this.emitChange();
    return { action: "equipped", item };
  }

  // ============================================================================
  // ADMIN MANAGEMENT METHODS (IN-GAME MANAGEMENT PANEL)
  // ============================================================================

  /** Directly sets Merit, Gems, Lotus, or Level from the Admin Panel. */
  adminSetResources(patch: AdminResourcePatch): void {
    this.ensureToday();
    if (typeof patch.merit === "number" && Number.isFinite(patch.merit)) {
      this.data.merit = Math.max(0, Math.min(9_999_999, Math.floor(patch.merit)));
    }
    if (typeof patch.gems === "number" && Number.isFinite(patch.gems)) {
      this.data.gems = Math.max(0, Math.min(9_999_999, Math.floor(patch.gems)));
    }
    if (typeof patch.lotus === "number" && Number.isFinite(patch.lotus)) {
      this.data.lotus = Math.max(0, Math.min(9_999_999, Math.floor(patch.lotus)));
    }
    if (typeof patch.level === "number" && Number.isFinite(patch.level)) {
      const targetLv = Math.max(1, Math.min(999, Math.floor(patch.level)));
      this.data.exp = (targetLv - 1) * EXP_PER_LEVEL + this.expInLevel;
      this.data.hp = this.maxHp;
    }
    this.save();
    this.emitChange();
  }

  /** Unlocks all items in Pháp Bảo Các and equips the supreme set if nothing is equipped. */
  adminUnlockAllItems(): void {
    this.ensureToday();
    for (const item of SHOP_ITEMS) {
      if (!this.data.owned.includes(item.id)) {
        this.data.owned.push(item.id);
      }
    }
    this.data.equippedAura ??= "aura_jade";
    this.data.equippedArtifact ??= "woodblock_jade";
    this.data.equippedTitle ??= "title_phuochue";
    this.save();
    this.emitChange();
  }

  /** Clears all owned and equipped shop items. */
  adminLockAllItems(): void {
    this.ensureToday();
    this.data.owned = [];
    this.data.equippedAura = null;
    this.data.equippedArtifact = null;
    this.data.equippedTitle = null;
    this.save();
    this.emitChange();
  }

  /** Instantly marks all 5 daily quests as 100% completed so they can be claimed. */
  adminCompleteAllQuests(): void {
    this.ensureToday();
    for (const def of QUEST_DEFS) {
      this.data.questCounts[def.id] = def.target;
    }
    this.save();
    this.emitChange();
  }

  /** Resets today's check-in and daily quest claim state so they can be tested again. */
  adminResetToday(): void {
    this.ensureToday();
    this.data.lastCheckInDay = 0;
    this.data.questCounts = {};
    this.data.questClaimed = {};
    this.data.allBonusClaimed = false;
    this.save();
    this.emitChange();
  }

  /** Resets the entire player progression back to fresh defaults. */
  adminResetAll(): void {
    const today = vnMidnight(this.now());
    this.data = {
      merit: 0,
      gems: 0,
      lotus: 0,
      exp: DEFAULT_EXP,
      hp: DEFAULT_HP,
      lastCheckInDay: 0,
      streak: 0,
      questDay: today,
      questCounts: {},
      questClaimed: {},
      allBonusClaimed: false,
      owned: [],
      equippedAura: null,
      equippedArtifact: null,
      equippedTitle: null,
    };
    this.save();
    this.emitChange();
  }

  private gainExpAndHp(expDelta: number, hpDelta: number): void {
    this.data.exp = Math.max(0, this.data.exp + Math.floor(expDelta));
    const cap = 122 + Math.max(1, Math.floor(this.data.exp / EXP_PER_LEVEL) + 1) * 20;
    this.data.hp = Math.min(cap, Math.max(1, this.data.hp + Math.floor(hpDelta)));
  }

  private equipSlot(category: ShopCategory, id: string | null): void {
    if (category === "aura") this.data.equippedAura = id;
    else if (category === "artifact") this.data.equippedArtifact = id;
    else if (category === "title") this.data.equippedTitle = id;
  }

  private ensureToday(): void {
    const today = vnMidnight(this.now());
    if (this.data.questDay === today) return;
    this.data.questDay = today;
    this.data.questCounts = {};
    this.data.questClaimed = {};
    this.data.allBonusClaimed = false;
    this.save();
  }

  private load(initialMeritFallback: number): StoredData {
    const today = vnMidnight(this.now());
    const defaults: StoredData = {
      merit: Math.max(0, Math.floor(initialMeritFallback)),
      gems: 0,
      lotus: 0,
      exp: DEFAULT_EXP,
      hp: DEFAULT_HP,
      lastCheckInDay: 0,
      streak: 0,
      questDay: today,
      questCounts: {},
      questClaimed: {},
      allBonusClaimed: false,
      owned: [],
      equippedAura: null,
      equippedArtifact: null,
      equippedTitle: null,
    };
    try {
      const raw = this.store?.getItem(PROGRESSION_STORAGE_KEY);
      if (!raw) return defaults;
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return defaults;
      const p = parsed as Record<string, unknown>;
      const validIds = new Set(SHOP_ITEMS.map((i) => i.id));
      const owned = Array.isArray(p["owned"])
        ? (p["owned"] as unknown[]).filter((x): x is string => typeof x === "string" && validIds.has(x))
        : [];
      const validEquipped = (val: unknown, cat: ShopCategory): string | null => {
        if (typeof val !== "string" || !owned.includes(val)) return null;
        const item = SHOP_ITEMS.find((i) => i.id === val);
        return item?.category === cat ? val : null;
      };
      const nonNegInt = (v: unknown, fallback: number): number =>
        typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : fallback;

      return {
        merit: nonNegInt(p["merit"], defaults.merit),
        gems: nonNegInt(p["gems"], defaults.gems),
        lotus: nonNegInt(p["lotus"], defaults.lotus),
        exp: nonNegInt(p["exp"], defaults.exp),
        hp: Math.max(1, nonNegInt(p["hp"], defaults.hp)),
        lastCheckInDay:
          typeof p["lastCheckInDay"] === "number" && Number.isFinite(p["lastCheckInDay"])
            ? p["lastCheckInDay"]
            : 0,
        streak:
          typeof p["streak"] === "number" && Number.isInteger(p["streak"]) && p["streak"] >= 0 && p["streak"] <= 7
            ? p["streak"]
            : 0,
        questDay:
          typeof p["questDay"] === "number" && Number.isFinite(p["questDay"]) ? p["questDay"] : today,
        questCounts:
          p["questCounts"] && typeof p["questCounts"] === "object"
            ? (p["questCounts"] as Partial<Record<QuestKind, number>>)
            : {},
        questClaimed:
          p["questClaimed"] && typeof p["questClaimed"] === "object"
            ? (p["questClaimed"] as Partial<Record<QuestKind, boolean>>)
            : {},
        allBonusClaimed: p["allBonusClaimed"] === true,
        owned,
        equippedAura: validEquipped(p["equippedAura"], "aura"),
        equippedArtifact: validEquipped(p["equippedArtifact"], "artifact"),
        equippedTitle: validEquipped(p["equippedTitle"], "title"),
      };
    } catch {
      return defaults;
    }
  }

  private save(): void {
    try {
      this.store?.setItem(PROGRESSION_STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Storage full or blocked: in-memory state still works for the session.
    }
  }

  private emitChange(): void {
    for (const fn of this.listeners) fn();
  }
}
