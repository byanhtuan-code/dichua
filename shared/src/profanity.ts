// P4-D7: masked, never refused. Whole words only, so "class" keeps its "ass".
// Lowercase data; extend here.

// Matched with their diacritics only: stripped, they collide with everyday words (lồn → lon "can", buồi → buổi "session").
const ACCENTED = ["địt", "đụ", "đéo", "lồn", "cặc", "buồi", "đĩ", "dái"];

// Matched after stripping diacritics (đ → d), so "Đcm" and "dcm" both hit.
const PLAIN = [
  "dit", "dcm", "dkm", "dmm", "dm", "vcl", "vkl", "vl", "clgt", "cmm", "loz", "cak",
  "fuck", "fucking", "fucker", "motherfucker", "shit", "bitch", "asshole", "ass", "dick", "cunt", "pussy", "bastard", "whore",
  "slut", "nigger", "faggot",
];

const ACCENTED_SET: ReadonlySet<string> = new Set(ACCENTED.map((w) => w.normalize("NFC")));
const PLAIN_SET: ReadonlySet<string> = new Set(PLAIN);

function stripMarks(word: string): string {
  return word.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d");
}

/** Each listed word (case- and diacritic-insensitive per list) → "***"; everything else unchanged. */
export function maskProfanity(text: string): string {
  return text.replace(/[\p{L}\p{M}\p{N}]+/gu, (word) => {
    const lower = word.normalize("NFC").toLowerCase();
    return ACCENTED_SET.has(lower) || PLAIN_SET.has(stripMarks(lower)) ? "***" : word;
  });
}
