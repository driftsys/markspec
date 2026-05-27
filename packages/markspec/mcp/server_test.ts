/**
 * @module mcp/server_test
 *
 * Structural assertions on SERVER_INSTRUCTIONS per ADR-023 §4. The text
 * itself is not testable for LLM-behavioural effect — these tests catch
 * accidental regressions to the trigger grammar (TRIGGER / PREFER / SKIP)
 * and the locked vocabulary anchors.
 */

import { assertStringIncludes } from "@std/assert";
import { SERVER_INSTRUCTIONS } from "./server.ts";

Deno.test("SERVER_INSTRUCTIONS: contains TRIGGER block", () => {
  assertStringIncludes(SERVER_INSTRUCTIONS, "TRIGGER when");
});

Deno.test("SERVER_INSTRUCTIONS: contains PREFER over block", () => {
  assertStringIncludes(SERVER_INSTRUCTIONS, "PREFER over");
});

Deno.test("SERVER_INSTRUCTIONS: contains SKIP when block", () => {
  assertStringIncludes(SERVER_INSTRUCTIONS, "SKIP when");
});

Deno.test("SERVER_INSTRUCTIONS: lists the display-ID regex anchor", () => {
  assertStringIncludes(SERVER_INSTRUCTIONS, "[A-Z]{2,}_[A-Z0-9_]+");
});

Deno.test("SERVER_INSTRUCTIONS: names grep/Read/Glob in PREFER over", () => {
  assertStringIncludes(SERVER_INSTRUCTIONS, "grep");
  assertStringIncludes(SERVER_INSTRUCTIONS, "Read");
  assertStringIncludes(SERVER_INSTRUCTIONS, "Glob");
});

Deno.test("SERVER_INSTRUCTIONS: references the soft-gate phrase verbatim", () => {
  // SKIP rule keys on this exact phrase — see ADR-023 §6.3.
  assertStringIncludes(SERVER_INSTRUCTIONS, "No MarkSpec project found");
});

Deno.test("SERVER_INSTRUCTIONS: lists locked vocabulary nouns", () => {
  // Spot-check that the noun list survives — the full vocabulary is
  // documented in ADR-023 §3.
  for (
    const noun of [
      "requirements",
      "specifications",
      "ICD",
      "architecture",
      "verification",
      "validation",
      "ASIL",
      "EARS",
      "traceability",
    ]
  ) {
    assertStringIncludes(SERVER_INSTRUCTIONS, noun);
  }
});
