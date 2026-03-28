/**
 * @module parser/captions_test
 *
 * Unit tests for table and figure caption detection.
 */

import { assertEquals } from "@std/assert";
import { detectCaptions } from "./captions.ts";

// ---------------------------------------------------------------------------
// Table captions
// ---------------------------------------------------------------------------

Deno.test("detectCaptions: table caption before pipe table", () => {
  const md = `# Sensor Config

_Table: Sensor thresholds_

| Sensor   | Min | Max |
| -------- | --- | --- |
| Pressure | 0   | 100 |
| Speed    | 0   | 300 |
`;
  const captions = detectCaptions(md, { file: "config.md" });
  assertEquals(captions.length, 1);
  assertEquals(captions[0].kind, "table");
  assertEquals(captions[0].slug, "tbl.sensor-thresholds");
  assertEquals(captions[0].text, "Sensor thresholds");
  assertEquals(captions[0].location.file, "config.md");
});

// ---------------------------------------------------------------------------
// Figure captions
// ---------------------------------------------------------------------------

Deno.test("detectCaptions: figure caption after image", () => {
  const md = `# Architecture

![](architecture.svg)

_Figure: Architecture overview_
`;
  const captions = detectCaptions(md, { file: "arch.md" });
  assertEquals(captions.length, 1);
  assertEquals(captions[0].kind, "figure");
  assertEquals(captions[0].slug, "fig.architecture-overview");
  assertEquals(captions[0].text, "Architecture overview");
  assertEquals(captions[0].location.file, "arch.md");
});

// ---------------------------------------------------------------------------
// Alt text fallback
// ---------------------------------------------------------------------------

Deno.test("detectCaptions: alt text fallback when no explicit caption", () => {
  const md = `# Diagrams

![System overview](img.svg)
`;
  const captions = detectCaptions(md, { file: "diag.md" });
  assertEquals(captions.length, 1);
  assertEquals(captions[0].kind, "figure");
  assertEquals(captions[0].slug, "fig.system-overview");
  assertEquals(captions[0].text, "System overview");
});

// ---------------------------------------------------------------------------
// Non-caption emphasis ignored
// ---------------------------------------------------------------------------

Deno.test("detectCaptions: emphasis not starting with Table: is ignored", () => {
  const md = `# Notes

_Important: read this carefully_

| Col A | Col B |
| ----- | ----- |
| 1     | 2     |
`;
  const captions = detectCaptions(md, { file: "notes.md" });
  assertEquals(captions.length, 0);
});

// ---------------------------------------------------------------------------
// Caption not immediately followed by table
// ---------------------------------------------------------------------------

Deno.test("detectCaptions: caption not immediately followed by table is ignored", () => {
  const md = `# Notes

_Table: Orphan caption_

Some intervening paragraph.

| Col A | Col B |
| ----- | ----- |
| 1     | 2     |
`;
  const captions = detectCaptions(md, { file: "notes.md" });
  assertEquals(captions.length, 0);
});
