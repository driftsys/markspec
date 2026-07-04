import { assertEquals } from "@std/assert";
import type { BodyToken } from "../model/mod.ts";
import { extractTyplCitations, isTyplCitationText } from "./citations.ts";

function inlineCode(text: string, line = 1, column = 1): BodyToken {
  return {
    kind: "inline-code",
    text,
    location: { file: "a.md", line, column },
  };
}

Deno.test("citations: text predicate", () => {
  assertEquals(isTyplCitationText("$powertrain.brake.pedal_position"), true);
  assertEquals(isTyplCitationText("$.pedal_position"), true);
  assertEquals(isTyplCitationText(" $a.b "), true); // trimmed
  assertEquals(isTyplCitationText("$speed"), false); // entry-local, not checked
  assertEquals(isTyplCitationText("$a.b : signal"), false); // declaration
  assertEquals(isTyplCitationText("ux:media.home/play"), false); // uxil
});

Deno.test("citations: extracted from inline-code body tokens", () => {
  const loc = { file: "a.md", line: 5, column: 10 };
  const tokens: BodyToken[] = [
    inlineCode("`$powertrain.brake.pedal_position`", 5, 10),
    inlineCode("`$speed`", 5, 10),
    inlineCode("`$a.b : signal`", 5, 10),
  ];
  const out = extractTyplCitations(tokens);
  assertEquals(out.length, 1);
  assertEquals(out[0].name, "$powertrain.brake.pedal_position");
  assertEquals(out[0].location, loc);
});
