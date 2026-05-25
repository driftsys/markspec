/**
 * @module core/lint/segmenter_test
 *
 * Unit tests for the rule-based sentence segmenter.
 */

import { assertEquals } from "@std/assert";
import { assertSnapshot } from "@std/testing/snapshot";
import { segmentSentences } from "./segmenter.ts";
import { loadLexicon } from "../lexicons/mod.ts";

const ABBREVS = loadLexicon("sentence-abbrev");

Deno.test("segmenter: empty input", () => {
  assertEquals(segmentSentences("", ABBREVS), []);
});

Deno.test("segmenter: single sentence no terminal punctuation", () => {
  const s = segmentSentences("The system shall apply pressure", ABBREVS);
  assertEquals(s.length, 1);
  assertEquals(s[0].text, "The system shall apply pressure");
  assertEquals(s[0].offset, 0);
});

Deno.test("segmenter: two sentences split on period + space + uppercase", () => {
  const s = segmentSentences(
    "The brake shall apply. The pedal shall release.",
    ABBREVS,
  );
  assertEquals(s.length, 2);
  assertEquals(s[0].text, "The brake shall apply.");
  assertEquals(s[0].offset, 0);
  assertEquals(s[1].text, "The pedal shall release.");
  assertEquals(s[1].offset, 23);
});

Deno.test("segmenter: does not split on abbreviation 'e.g.'", () => {
  const s = segmentSentences(
    "Sensors e.g. radar shall debounce. The system shall log.",
    ABBREVS,
  );
  assertEquals(s.length, 2);
  assertEquals(s[0].text, "Sensors e.g. radar shall debounce.");
});

Deno.test("segmenter: ? and ! terminate sentences", () => {
  const s = segmentSentences("Is it raining? The system shall halt!", ABBREVS);
  assertEquals(s.length, 2);
});

Deno.test("segmenter: lowercase after period is not a split", () => {
  const s = segmentSentences("v1.0 is current.", ABBREVS);
  assertEquals(s.length, 1);
});

Deno.test("segmenter: deterministic on repeated calls", () => {
  const text = "First. Second. Third.";
  const a = segmentSentences(text, ABBREVS);
  const b = segmentSentences(text, ABBREVS);
  assertEquals(a, b);
});

// Snapshot test for corpus stability.
const CORPUS = `
The brake controller shall debounce sensor inputs. When the pedal is
pressed, the system shall apply pressure within 200 ms. The pressure
shall be released, e.g. when the parking brake is engaged, by the
release subsystem. Fig. 3 shows the data flow. See vol. II for details.
If a sensor reading is invalid, then the brake controller shall ignore
it.
`.trim();

Deno.test("segmenter: corpus snapshot", async (t) => {
  const sentences = segmentSentences(CORPUS, ABBREVS);
  await assertSnapshot(t, sentences);
});
