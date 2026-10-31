import { describe, expect, it } from "vitest";
import { stripOneFence } from "./reply";

describe("stripOneFence", () => {
  it("removes one fence around the whole reply", () => {
    expect(stripOneFence("```markdown\nA.\n\nB.\n```")).toBe("A.\n\nB.");
    expect(stripOneFence("~~~\nA.\n~~~\n")).toBe("A.");
  });

  it("keeps a reply that is not wholly fenced", () => {
    expect(stripOneFence("Text\n```\ncode\n```")).toBe("Text\n```\ncode\n```");
    expect(stripOneFence("```\nA\n```\n\n```\nB\n```")).toBe(
      "```\nA\n```\n\n```\nB\n```",
    );
  });

  it("trims a reply without a fence", () => {
    expect(stripOneFence("  The system shall stop.\n\n")).toBe(
      "The system shall stop.",
    );
  });

  it("keeps a reply whose closer does not match the opener", () => {
    expect(stripOneFence("```\nA\n~~~")).toBe("```\nA\n~~~");
    expect(stripOneFence("````\nA\n```")).toBe("````\nA\n```");
  });

  it("accepts a longer closer of the same character", () => {
    expect(stripOneFence("```\nA\n````")).toBe("A");
  });

  it("removes a fence around an empty block", () => {
    expect(stripOneFence("```\n```")).toBe("");
  });
});
