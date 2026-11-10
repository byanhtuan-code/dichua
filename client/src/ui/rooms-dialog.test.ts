import { describe, expect, it } from "vitest";
import { chatNoteText, emptiestRoom, roomFromSearch, roomKindText } from "./rooms-dialog.ts";

describe("room choice", () => {
  it("reads ?room= only for one of the 10 rooms", () => {
    expect(roomFromSearch("?room=san-05")).toBe("san-05");
    expect(roomFromSearch("?mock=full&room=san-10")).toBe("san-10");
    expect(roomFromSearch("?room=san-11")).toBeNull();
    expect(roomFromSearch("?room=abc")).toBeNull();
    expect(roomFromSearch("")).toBeNull();
  });

  it("picks the emptiest room with space, lowest number on ties", () => {
    const r = (n: number, count: number) => ({ id: `san-0${n}`, number: n, name: `R${n}`, count, capacity: 30 });
    expect(emptiestRoom([r(1, 30), r(2, 4), r(3, 0), r(4, 0)])).toBe("san-03");
    expect(emptiestRoom([r(1, 30), r(2, 30)])).toBeNull();
  });
});

describe("room kind (P4-D1)", () => {
  it("tags room 1 silent and room 4 chat", () => {
    expect(roomKindText("san-01")).toBe("Tĩnh lặng");
    expect(roomKindText("san-03")).toBe("Tĩnh lặng");
    expect(roomKindText("san-04")).toBe("Trò chuyện");
    expect(roomKindText("san-10")).toBe("Trò chuyện");
  });

  it("explains the split with numbers from the room table", () => {
    expect(chatNoteText()).toEqual({
      quiet: "Phòng 1–3: ngồi yên, không trò chuyện.",
      chat: "Phòng 4–10: trò chuyện được, cần tạo tài khoản.",
    });
  });
});
