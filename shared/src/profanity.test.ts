import { describe, expect, it } from "vitest";
import { maskProfanity } from "./profanity.ts";

describe("maskProfanity", () => {
  it("masks Vietnamese words with or without diacritics, any case", () => {
    expect(maskProfanity("đồ địt thật")).toBe("đồ *** thật");
    expect(maskProfanity("ĐỊT")).toBe("***");
    expect(maskProfanity("vcl luôn")).toBe("*** luôn");
    expect(maskProfanity("Đcm, dcm!")).toBe("***, ***!");
  });

  it("masks English words, any case, keeps punctuation", () => {
    expect(maskProfanity("oh FUCK, Shit.")).toBe("oh ***, ***.");
  });

  it("whole words only", () => {
    expect(maskProfanity("class assignment passes")).toBe("class assignment passes");
    expect(maskProfanity("ass")).toBe("***");
  });

  it("leaves everyday words that only collide once diacritics are gone", () => {
    expect(maskProfanity("buổi sáng lớn lon bia các bạn dẻo")).toBe("buổi sáng lớn lon bia các bạn dẻo");
  });
});
