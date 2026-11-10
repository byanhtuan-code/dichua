import { describe, expect, it } from "vitest";
import { vi as copy } from "./vi.ts";

function leaves(node: unknown, path = "vi"): [string, unknown][] {
  if (typeof node !== "object" || node === null) return [[path, node]];
  return Object.entries(node).flatMap(([k, v]) => leaves(v, `${path}.${k}`));
}

describe("vi copy", () => {
  it("has only non-empty, trimmed strings", () => {
    for (const [path, value] of leaves(copy)) {
      expect(typeof value, path).toBe("string");
      expect(value, path).toBe(String(value).trim());
      expect(String(value).length, path).toBeGreaterThan(0);
    }
  });
});
