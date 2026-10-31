import { describe, expect, it } from "vitest";
import { type DiffPart, diffWords } from "./wordDiff";

function side(parts: DiffPart[], drop: DiffPart["kind"]): string {
  return parts
    .filter((part) => part.kind !== drop)
    .map((part) => part.text)
    .join("");
}

describe("diffWords", () => {
  it("diffs by word and keeps whitespace", () => {
    expect(diffWords("within 200 ms", "within 150 ms")).toEqual([
      { kind: "same", text: "within " },
      { kind: "removed", text: "200" },
      { kind: "added", text: "150" },
      { kind: "same", text: " ms" },
    ]);
  });

  it("joins the parts back into each side", () => {
    const before =
      "The brake controller shall apply\nfull pressure within 200 ms.\n\nIt shall log the event.";
    const after =
      "The brake controller shall apply\nfull brake pressure within 150 ms\nof a stop request.";
    const parts = diffWords(before, after);
    expect(side(parts, "added")).toBe(before);
    expect(side(parts, "removed")).toBe(after);
  });

  it("merges adjacent parts of the same kind", () => {
    const parts = diffWords("a b c", "x y z");
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i].kind).not.toBe(parts[i - 1].kind);
    }
  });

  it("returns one same part for equal text", () => {
    expect(diffWords("a b", "a b")).toEqual([{ kind: "same", text: "a b" }]);
  });

  it("handles an empty side", () => {
    expect(diffWords("", "new text")).toEqual([
      { kind: "added", text: "new text" },
    ]);
    expect(diffWords("old text", "")).toEqual([
      { kind: "removed", text: "old text" },
    ]);
    expect(diffWords("", "")).toEqual([]);
  });

  it("falls back to replace-all above the size cap", () => {
    const before = Array.from({ length: 1100 }, (_, i) => `b${i}`).join(" ");
    const after = Array.from({ length: 1100 }, (_, i) => `a${i}`).join(" ");
    expect(diffWords(before, after)).toEqual([
      { kind: "removed", text: before },
      { kind: "added", text: after },
    ]);
  });
});
