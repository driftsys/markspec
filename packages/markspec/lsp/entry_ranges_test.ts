/**
 * @module lsp/entry_ranges_test
 *
 * Unit tests for {@linkcode buildEntryRanges} — produces per-entry
 * layout info (title range, trailer-dim ranges that exclude IDs,
 * label ranges + validity).
 */

import { assertEquals } from "@std/assert";
import type { Diagnostic, EffectiveProfile, Entry } from "../core/model/mod.ts";
import { makeDisplayId } from "../core/model/mod.ts";
import { buildEntryRanges } from "./entry_ranges.ts";

function makeEntry(): Entry {
  return {
    displayId: makeDisplayId("REQ-001"),
    title: "Brake response time",
    body: "",
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      { key: "Satisfies", value: "STK-001, STK-002" },
      { key: "Labels", value: "ASIL-B, custom-label" },
    ],
    typedAttributes: new Map(),
    shape: "Authored",
    location: { file: "t.md", line: 1, column: 1 },
    source: "markdown",
    bodyTokens: [],
  };
}

function makeProfile(allowedLabels: string[]): EffectiveProfile {
  return {
    chain: [],
    labels: new Map(
      allowedLabels.map((name) => [
        name,
        {
          value: { name, kind: "enum" as const, values: [] },
          origin: "test",
        },
      ]),
    ),
  } as unknown as EffectiveProfile;
}

Deno.test("buildEntryRanges: title range covers the title text", () => {
  const text = ["- [REQ-001] Brake response time"].join("\n");
  const result = buildEntryRanges(
    [makeEntry()],
    makeProfile([]),
    [],
    text.split("\n"),
  );
  assertEquals(result.entries.length, 1);
  const tr = result.entries[0].titleRange;
  assertEquals(tr.start.line, 0);
  assertEquals(tr.start.character, 12); // after `- [REQ-001] `
  assertEquals(tr.end.line, 0);
  assertEquals(tr.end.character, 31); // end of "Brake response time"
});

Deno.test("buildEntryRanges: trailerDimRanges exclude embedded display IDs", () => {
  const text = [
    "- [REQ-001] Brake response time",
    "",
    "      Satisfies: STK-001, STK-002",
  ].join("\n");
  const result = buildEntryRanges(
    [makeEntry()],
    makeProfile([]),
    [],
    text.split("\n"),
  );
  const dim = result.entries[0].trailerDimRanges;
  // For the Satisfies line, dim ranges should cover everything except
  // the two display IDs. Expected: indent + "Satisfies: ", then ", ",
  // then trailing nothing → 2 dim ranges on that line.
  const line2 = dim.filter((r) => r.start.line === 2);
  assertEquals(line2.length, 2);
  // First dim chunk covers from column 0 to before "STK-001".
  assertEquals(line2[0].start.character, 0);
  assertEquals(line2[0].end.character, 17);
  // Second dim chunk covers ", " between IDs.
  assertEquals(line2[1].start.character, 24); // end of STK-001
  assertEquals(line2[1].end.character, 26); // start of STK-002
});

Deno.test("buildEntryRanges: labelRanges carry the valid flag", () => {
  const text = [
    "- [REQ-001] Brake response time",
    "",
    "      Labels: ASIL-B, custom-label",
  ].join("\n");
  const result = buildEntryRanges(
    [makeEntry()],
    makeProfile(["ASIL-B"]),
    [],
    text.split("\n"),
  );
  const labels = result.entries[0].labelRanges;
  assertEquals(labels.length, 2);
  assertEquals(labels[0].valid, true);
  assertEquals(labels[1].valid, false);
});

Deno.test("buildEntryRanges: labelRanges include diagnostic when invalid label has matching diag", () => {
  const text = [
    "- [REQ-001] Brake response time",
    "",
    "      Labels: custom-label",
  ].join("\n");
  const diag: Diagnostic = {
    code: "MSL-L010",
    severity: "warning",
    message: "Unknown label 'custom-label'",
    location: { file: "t.md", line: 3, column: 21 },
  };
  const result = buildEntryRanges(
    [makeEntry()],
    makeProfile(["ASIL-B"]),
    [diag],
    text.split("\n"),
  );
  const labels = result.entries[0].labelRanges;
  assertEquals(labels[0].valid, false);
  assertEquals(labels[0].diagnostic, "Unknown label 'custom-label'");
});

Deno.test("buildEntryRanges: Id line dim range is contiguous", () => {
  // The ULID in `Id: 01HGW...` satisfies the display-ID grammar so it
  // gets reported as an idRange by scanEntryTrailer. The Id slot is
  // the entry's own identity, not a cross-reference — dim it whole.
  const text = [
    "- [REQ-001] Brake response time",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
  ].join("\n");
  const result = buildEntryRanges(
    [makeEntry()],
    makeProfile([]),
    [],
    text.split("\n"),
  );
  const idLineDim = result.entries[0].trailerDimRanges.filter(
    (r) => r.start.line === 2,
  );
  assertEquals(idLineDim.length, 1);
  assertEquals(idLineDim[0].start.character, 0);
  assertEquals(idLineDim[0].end.character, text.split("\n")[2].length);
});

Deno.test("buildEntryRanges: Labels line dims only the key prefix", () => {
  // Pill decorations draw on top of label values — those must NOT be
  // covered by the dim layer or the pill text becomes unreadable.
  // Dim only up to the value start (indent + "Labels: ").
  const text = [
    "- [REQ-001] Brake response time",
    "",
    "      Labels: ASIL-B, custom-label",
  ].join("\n");
  const result = buildEntryRanges(
    [makeEntry()],
    makeProfile(["ASIL-B", "custom-label"]),
    [],
    text.split("\n"),
  );
  const labelsLineDim = result.entries[0].trailerDimRanges.filter(
    (r) => r.start.line === 2,
  );
  assertEquals(labelsLineDim.length, 1);
  assertEquals(labelsLineDim[0].start.character, 0);
  // Value starts at column 14 (6 indent + "Labels:" + 1 space).
  assertEquals(labelsLineDim[0].end.character, 14);
});

Deno.test("buildEntryRanges: referenced entry (@-prefix) gets title range", () => {
  const text = ["- [@ISO-26262-6] ISO 26262 Part 6"].join("\n");
  const e: Entry = {
    ...makeEntry(),
    displayId: makeDisplayId("ISO-26262-6"),
    title: "ISO 26262 Part 6",
  };
  const result = buildEntryRanges([e], makeProfile([]), [], text.split("\n"));
  assertEquals(result.entries.length, 1);
  // Title starts after "- [@ISO-26262-6] " — that's 17 characters.
  assertEquals(result.entries[0].titleRange.start.character, 17);
});

Deno.test("buildEntryRanges: title with lowercase / dotted display ID still ranges", () => {
  const text = ["- [my.entry] Dotted title"].join("\n");
  const e: Entry = {
    ...makeEntry(),
    displayId: makeDisplayId("my.entry"),
    title: "Dotted title",
  };
  const result = buildEntryRanges([e], makeProfile([]), [], text.split("\n"));
  assertEquals(result.entries.length, 1);
  assertEquals(result.entries[0].titleRange.start.character, 13); // after `- [my.entry] `
});

Deno.test("buildEntryRanges: classifies admonition blockquotes by [!KIND] marker", () => {
  const text = [
    "- [REQ-001] Title",
    "",
    "  > [!NOTE]",
    "  > A note about something.",
    "",
    "  > [!WARNING]",
    "  > Heads up.",
    "",
    "  > Plain quote with no marker.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
  ].join("\n");
  const result = buildEntryRanges(
    [makeEntry()],
    makeProfile([]),
    [],
    text.split("\n"),
  );
  const bqs = result.entries[0].blockquoteRanges;
  assertEquals(bqs.length, 3);
  assertEquals(bqs[0].kind, "note");
  assertEquals(bqs[0].range.start.line, 2);
  assertEquals(bqs[0].range.end.line, 3);
  assertEquals(bqs[1].kind, "warning");
  assertEquals(bqs[1].range.start.line, 5);
  assertEquals(bqs[1].range.end.line, 6);
  assertEquals(bqs[2].kind, "plain");
  assertEquals(bqs[2].range.start.line, 8);
  assertEquals(bqs[2].range.end.line, 8);
});

Deno.test("buildEntryRanges: blockquote scan stops at trailer (does not include attribute lines)", () => {
  const text = [
    "- [REQ-001] Title",
    "",
    "  > [!NOTE]",
    "  > In the body.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
    "      Labels: ASIL-B",
  ].join("\n");
  const result = buildEntryRanges(
    [makeEntry()],
    makeProfile([]),
    [],
    text.split("\n"),
  );
  const bqs = result.entries[0].blockquoteRanges;
  assertEquals(bqs.length, 1);
  assertEquals(bqs[0].kind, "note");
  // Blockquote ends at line 3 — never spans into trailer (line 5+).
  assertEquals(bqs[0].range.end.line, 3);
});

Deno.test("buildEntryRanges: admonition marker is case-insensitive", () => {
  const text = [
    "- [REQ-001] Title",
    "",
    "  > [!note]",
    "  > lowercase marker.",
    "",
    "  > [!Important]",
    "  > Title-case marker.",
  ].join("\n");
  const result = buildEntryRanges(
    [makeEntry()],
    makeProfile([]),
    [],
    text.split("\n"),
  );
  const bqs = result.entries[0].blockquoteRanges;
  assertEquals(bqs.length, 2);
  assertEquals(bqs[0].kind, "note");
  assertEquals(bqs[1].kind, "important");
});
