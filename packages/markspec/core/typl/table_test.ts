/**
 * @module typl/table_test
 *
 * Unit tests for the typl table surface adapter (#724 / S6): the row
 * recognizer that reduces a `$name | kind shape | description` data row to a
 * typl declaration source, and the caption-base parser that reads a base out
 * of a `Table:` caption.
 */

import { assertEquals } from "@std/assert";
import { typlTableCaptionBase, typlTableRowRecognizer } from "./table.ts";

// --- row recognizer --------------------------------------------------------

Deno.test("typlTableRowRecognizer: reconstructs `$name : kind shape` from cells", () => {
  assertEquals(
    typlTableRowRecognizer(["$speed", "signal float[0..300]", "vehicle speed"]),
    "$speed : signal float[0..300]",
  );
});

Deno.test("typlTableRowRecognizer: trims surrounding whitespace in name and shape", () => {
  assertEquals(
    typlTableRowRecognizer(["  $speed ", "  signal  ", "desc"]),
    "$speed : signal",
  );
});

Deno.test("typlTableRowRecognizer: accepts a relative name for caption-base resolution", () => {
  assertEquals(
    typlTableRowRecognizer(["$.pedal", "signal float[0..100]", "pedal"]),
    "$.pedal : signal float[0..100]",
  );
});

Deno.test("typlTableRowRecognizer: skips a row whose first cell is not a typl name", () => {
  assertEquals(
    typlTableRowRecognizer(["note", "see appendix A", "not a declaration"]),
    undefined,
  );
});

Deno.test("typlTableRowRecognizer: skips a row with an empty shape cell (malformed)", () => {
  assertEquals(typlTableRowRecognizer(["$speed", "", "desc"]), undefined);
});

Deno.test("typlTableRowRecognizer: skips a single-cell row (no shape column)", () => {
  assertEquals(typlTableRowRecognizer(["$speed"]), undefined);
});

// --- caption-base parser ---------------------------------------------------

Deno.test("typlTableCaptionBase: an absolute dotted name yields its path", () => {
  assertEquals(typlTableCaptionBase("$powertrain.brake"), "powertrain.brake");
});

Deno.test("typlTableCaptionBase: a single-segment absolute name yields its path", () => {
  assertEquals(typlTableCaptionBase("$vehicle"), "vehicle");
});

Deno.test("typlTableCaptionBase: ignores a trailing description after the base", () => {
  assertEquals(
    typlTableCaptionBase("$powertrain.brake — brake signals"),
    "powertrain.brake",
  );
});

Deno.test("typlTableCaptionBase: a non-typl caption yields no base", () => {
  assertEquals(typlTableCaptionBase("Sensor thresholds"), undefined);
});

Deno.test("typlTableCaptionBase: a relative name is not a base (needs a base itself)", () => {
  assertEquals(typlTableCaptionBase("$.pedal"), undefined);
});
