import { assertEquals } from "@std/assert";
import type { BodyToken } from "../model/mod.ts";
import { extractUxCitations, isUxCitationText } from "./citations.ts";

function inlineCode(text: string, line = 1, column = 1): BodyToken {
  return {
    kind: "inline-code",
    text,
    location: { file: "a.md", line, column },
  };
}

Deno.test("isUxCitationText: citation vs declaration vs non-uxil", () => {
  assertEquals(isUxCitationText("ux:media.home/play!activate"), true);
  assertEquals(isUxCitationText(" ux:media.home "), true); // trimmed
  assertEquals(isUxCitationText("ux:media.home : screen"), false); // root decl
  assertEquals(isUxCitationText("/play : activate"), false); // element decl (no scheme)
  assertEquals(isUxCitationText("$speed"), false); // typl, not uxil
});

Deno.test("extractUxCitations: ux: refs in prose, not declarations", () => {
  const tokens: BodyToken[] = [
    inlineCode("`ux:media.home/play!activate`", 5, 10),
    inlineCode("`ux:media.home : screen`", 6, 3), // root decl, not a citation
    inlineCode("`/play : activate`", 7, 3), // element decl, not a citation
  ];
  const out = extractUxCitations(tokens);
  assertEquals(out.length, 1);
  assertEquals(out[0].ref.surface, ["media", "home"]);
  assertEquals(out[0].ref.element, "play");
  assertEquals(out[0].ref.verb, "activate");
  assertEquals(out[0].location, { file: "a.md", line: 5, column: 10 });
});

Deno.test("extractUxCitations: a malformed citation is dropped, not surfaced as a citation", () => {
  const tokens: BodyToken[] = [
    inlineCode("`ux:media.home/play#bad`", 5, 10), // reserved char
  ];
  assertEquals(extractUxCitations(tokens), []);
});
