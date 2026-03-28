/**
 * @module parser/references_test
 *
 * Unit tests for inline reference detection.
 */

import { assertEquals } from "@std/assert";
import { detectInlineRefs } from "./references.ts";

// ---------------------------------------------------------------------------
// Basic detection
// ---------------------------------------------------------------------------

Deno.test("detectInlineRefs: detects typed requirement ref", () => {
  const md = `This satisfies {{req.SRS_BRK_0107}}.`;
  const refs = detectInlineRefs(md, { file: "test.md" });
  assertEquals(refs.length, 1);
  assertEquals(refs[0].namespace, "req");
  assertEquals(refs[0].refId, "SRS_BRK_0107");
});

Deno.test("detectInlineRefs: detects figure ref", () => {
  const md = `See {{fig.sensor-thresholds}} for details.`;
  const refs = detectInlineRefs(md, { file: "test.md" });
  assertEquals(refs.length, 1);
  assertEquals(refs[0].namespace, "fig");
  assertEquals(refs[0].refId, "sensor-thresholds");
});

// ---------------------------------------------------------------------------
// Code exclusion
// ---------------------------------------------------------------------------

Deno.test("detectInlineRefs: skips inline code spans", () => {
  const md = "Use `{{req.SRS_BRK_0107}}` in your document.";
  const refs = detectInlineRefs(md, { file: "test.md" });
  assertEquals(refs.length, 0);
});

Deno.test("detectInlineRefs: skips fenced code blocks", () => {
  const md = `# Example

\`\`\`markdown
{{req.SRS_BRK_0107}}
\`\`\`

Some text.
`;
  const refs = detectInlineRefs(md, { file: "test.md" });
  assertEquals(refs.length, 0);
});

// ---------------------------------------------------------------------------
// Multiple refs
// ---------------------------------------------------------------------------

Deno.test("detectInlineRefs: detects multiple refs in one paragraph", () => {
  const md =
    `This links {{req.SRS_BRK_0001}} and {{arch.SAD_MOD_0042}} together.`;
  const refs = detectInlineRefs(md, { file: "test.md" });
  assertEquals(refs.length, 2);
  assertEquals(refs[0].namespace, "req");
  assertEquals(refs[0].refId, "SRS_BRK_0001");
  assertEquals(refs[1].namespace, "arch");
  assertEquals(refs[1].refId, "SAD_MOD_0042");
});

// ---------------------------------------------------------------------------
// Source location
// ---------------------------------------------------------------------------

Deno.test("detectInlineRefs: preserves source location", () => {
  const md = `# Heading

See {{req.SRS_BRK_0001}} here.
`;
  const refs = detectInlineRefs(md, { file: "spec.md" });
  assertEquals(refs.length, 1);
  assertEquals(refs[0].location.file, "spec.md");
  assertEquals(refs[0].location.line, 3);
  // "See " is 4 chars, so {{req...}} starts at column 5
  assertEquals(refs[0].location.column, 5);
});

// ---------------------------------------------------------------------------
// Default file path
// ---------------------------------------------------------------------------

Deno.test("detectInlineRefs: uses '<unknown>' when no file specified", () => {
  const md = `{{req.SRS_BRK_0001}}`;
  const refs = detectInlineRefs(md);
  assertEquals(refs[0].location.file, "<unknown>");
});
