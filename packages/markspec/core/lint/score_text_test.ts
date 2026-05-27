/**
 * @module core/lint/score_text_test
 *
 * Unit tests for the `scoreText` external-prose scoring primitive.
 */

import { assertEquals } from "@std/assert";
import { scoreText } from "./score_text.ts";

Deno.test("scoreText: empty text → only Q401 fires (short body)", async () => {
  // Q400 (title-length) does NOT fire because we set title to the
  // synthetic id (≥ 3 chars). Q401 (body-length) DOES fire because
  // body word count is 0 (< 5). No other rules can fire on empty
  // input. This is correct signal for an empty external requirement.
  const r = await scoreText("");
  assertEquals(r.diagnostics.length, 1);
  assertEquals(r.diagnostics[0].code, "MSL-Q401");
  assertEquals(r.score, 1);
  assertEquals(r.infoCount, 1);
  assertEquals(r.warningCount, 0);
});

Deno.test("scoreText: default id is EXT_0001", async () => {
  const r = await scoreText("");
  assertEquals(r.id, "EXT_0001");
});

Deno.test("scoreText: caller-supplied id is echoed", async () => {
  const r = await scoreText("", { id: "DOORS-9912" });
  assertEquals(r.id, "DOORS-9912");
});

Deno.test("scoreText: empty opts.id falls back to default", async () => {
  const r = await scoreText("", { id: "" });
  assertEquals(r.id, "EXT_0001");
});

Deno.test("scoreText: multi-modal sentence triggers Q200 warning", async () => {
  // Q200 (`modal-multiple`, warning, weight 3) fires when ≥ 2
  // normative modals appear in the same sentence — a compound
  // requirement. Two `shall` in one sentence is the simplest trigger.
  const r = await scoreText(
    "The system shall stop within 200 ms and shall log the event.",
  );
  assertEquals(r.warningCount >= 1, true, "expected ≥ 1 warning from Q200");
  assertEquals(r.score >= 3, true, "expected score ≥ 3 (warning weight)");
  // At least one Q200 diagnostic in the set.
  const codes = r.diagnostics.map((d) => d.code);
  assertEquals(
    codes.includes("MSL-Q200"),
    true,
    `expected MSL-Q200 in diagnostics; got: ${codes.join(", ")}`,
  );
});

Deno.test("scoreText: warningCount and infoCount partition diagnostics", async () => {
  const r = await scoreText(
    "The system shall handle errors appropriately and shall log them.",
  );
  assertEquals(
    r.warningCount + r.infoCount,
    r.diagnostics.length,
    "every diagnostic must be either warning or info",
  );
});
