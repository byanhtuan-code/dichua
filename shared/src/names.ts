import { seeded } from "./random.ts";
import { spaceOf } from "./spaces/index.ts";
import { roomId, roomNumber } from "./world.ts";

const NOUNS = ["Gió", "Sóng", "Mây", "Trăng", "Suối", "Sương", "Mưa", "Nắng"] as const;
const ADJECTIVES = ["Lặng", "Ấm", "Hiền", "Nhẹ", "Trong", "Xanh", "Mát", "Êm"] as const;

/** Robe colours handed out to visitors. */
export const VISITOR_COLORS: readonly string[] = ["#b9c3c7", "#c9a46a", "#9fb59a", "#c79a8b", "#a7a9c4", "#d6c7a1"];

export interface Resident {
  id: string;
  name: string;
  color: string;
  cushion: number;
}

/** Dharma names the four resident NPCs draw from (made up, no real monk's name). */
export const RESIDENT_NAME_POOL: readonly string[] = [
  "Tâm An", "Minh Tịnh", "Thiện Lạc", "Diệu Hạnh", "Chơn Như", "Huệ Minh", "An Lạc", "Tịnh Tâm", "Viên Giác", "Tuệ Đăng",
  "Nhuận Hòa", "Hạnh Nguyên", "Pháp Nhẫn", "Từ Quang", "Bảo Châu", "Thường Lạc", "Chánh Niệm", "Như Ý", "Quang Hiền", "Định An",
];

/**
 * Four NPCs who always sit in the hall; they do not count towards room capacity.
 * Names are seeded by the room number, so every client and the server agree on them.
 */
export function residentsFor(id: string): Resident[] {
  const n = roomNumber(id);
  if (n === null) throw new RangeError(`room ${id}`);
  const space = spaceOf(id);
  const rng = seeded(n);
  const pool = [...RESIDENT_NAME_POOL];
  return space.residentCushions.map((cushion, i) => {
    const pick = i + Math.floor(rng() * (pool.length - i));
    const name = pool[pick] ?? "Tâm An";
    pool[pick] = pool[i] ?? name;
    pool[i] = name;
    return { id: `resident:${i + 1}`, name, color: VISITOR_COLORS[i % VISITOR_COLORS.length] ?? "#b9c3c7", cushion };
  });
}

/** Room 1's residents; code that only needs the head count (`.length`) reads this. */
export const RESIDENTS: readonly Resident[] = residentsFor(roomId(1));

const ALL_NAMES: readonly string[] = NOUNS.flatMap((n) => ADJECTIVES.map((a) => `${n} ${a}`)).filter(
  (name) => !RESIDENT_NAME_POOL.includes(name),
);

function pickFree(rng: () => number, all: readonly string[], taken: ReadonlySet<string>): string {
  const free = all.filter((n) => !taken.has(n));
  const pick = (list: readonly string[]): string => list[Math.min(list.length - 1, Math.floor(rng() * list.length))] ?? "Gió Lặng";
  if (free.length > 0) return pick(free);
  return uniqueName(pick(all), taken);
}

/**
 * Random "noun + adjective" name not in `taken` (and never a resident's name).
 * `rng` returns [0, 1) like Math.random. Falls back to a numbered name if all 64 are used.
 */
export function makeName(rng: () => number, taken: ReadonlySet<string>): string {
  return pickFree(rng, ALL_NAMES, taken);
}

// Lowercase, teen-style names for half the bots (D27): "who + quirk" combos plus some one-offs, so repeats are rare.
const FUNNY_WHO = ["mèo", "cún", "gấu", "vịt", "sóc", "heo", "thỏ", "cú", "bé", "nấm", "chuột", "cá vàng"] as const;
const FUNNY_QUIRK = [
  "lười", "ngủ gật", "đói bụng", "mê trà sữa", "hay quên", "tập thiền", "chill", "ngáo ngơ", "đi lạc", "mập ú",
  "hít thở sâu", "ăn chay", "cute xỉu", "u mê", "hết pin", "khó ngủ", "hiền khô", "ham ăn", "lạc trôi", "tu tại gia",
] as const;
const FUNNY_ONE_OFFS = [
  "tui là ai", "hông biết thở", "đi chùa nè", "an nhiên 2k7", "zen zen", "thở cái đã", "ngồi im nha", "trốn deadline",
  "deadline dí", "mất wifi", "đang sạc pin", "buồn ngủ ghê", "khum giận ai", "tâm tịnh tịnh", "ok luôn á", "chill phết",
  "hôm nay hông lười", "ăn xong ngồi thiền", "thiền thử coi", "bình tĩnh nha", "một chút an yên", "nghỉ xíu thôi",
  "j z trời", "đừng gọi tui", "tập làm người tốt", "ít nói thôi", "zui zẻ hông quạo", "mình chill thôi", "cục bông",
  "bánh bao nhân thịt", "trà đá vỉa hè", "mì tôm 2 gói", "người qua đường", "ngủ đông", "đang thở", "hông drama",
] as const;
export const FUNNY_NAME_POOL: readonly string[] = [...FUNNY_WHO.flatMap((w) => FUNNY_QUIRK.map((q) => `${w} ${q}`)), ...FUNNY_ONE_OFFS];

/** Bot name: a coin flip between makeName's serious names and the funny lowercase pool, never one in `taken`. */
export function makeBotName(rng: () => number, taken: ReadonlySet<string>): string {
  return rng() < 0.5 ? makeName(rng, taken) : pickFree(rng, FUNNY_NAME_POOL, taken);
}

/** Longest visitor name, in code points (an emoji counts 1). Server and the client's input share it. */
export const MAX_NAME_CHARS = 20;

// Bidi overrides / isolates / marks flip how the rest of a label renders; zero-width ones make a blank label.
// ZWJ (U+200D) stays: emoji sequences need it.
const HIDDEN = /[\u061C\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu;

function cut(text: string, max: number): string {
  return Array.from(text).slice(0, max).join("");
}

/**
 * Untrusted wanted name → display name (P3-D1): NFC, no control / bidi / zero-width / lone surrogate, whitespace runs → one space,
 * trimmed, at most MAX_NAME_CHARS code points. Nothing left (or not a string) → null = give a random name.
 */
export function normalizeVisitorName(raw: unknown): string | null {
  return normalizeLabel(raw, MAX_NAME_CHARS);
}

/** normalizeVisitorName's cleaning with another length cap (room names). */
export function normalizeLabel(raw: unknown, maxChars: number): string | null {
  if (typeof raw !== "string") return null;
  // Bounded before the regex work: a long query value must not cost more than a short one.
  const name = cut(
    raw
      .slice(0, maxChars * 16)
      .normalize("NFC")
      .replace(/\s+/gu, " ")
      .replace(/\p{Cc}|\p{Cs}/gu, "")
      .replace(HIDDEN, "")
      .replace(/ {2,}/g, " ")
      .trim(),
    maxChars,
  ).trimEnd();
  return name === "" ? null : name;
}

/** `want`, or "want 2", "want 3"… — the first one not in `taken`, kept within MAX_NAME_CHARS. */
export function uniqueName(want: string, taken: ReadonlySet<string>): string {
  if (!taken.has(want)) return want;
  for (let i = 2; ; i++) {
    const suffix = ` ${i}`;
    const name = cut(want, Math.max(1, MAX_NAME_CHARS - suffix.length)).trimEnd() + suffix;
    if (!taken.has(name)) return name;
  }
}
