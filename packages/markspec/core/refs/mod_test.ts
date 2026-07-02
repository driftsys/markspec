import { assertEquals } from "@std/assert";
import { makeDisplayId } from "../model/mod.ts";
import type { Entry } from "../model/mod.ts";
import type { LockEdge } from "../lock/mod.ts";
import {
  buildRefIndex,
  canonicalizeRefs,
  TRACE_ATTRIBUTE_KEYS,
} from "./mod.ts";

// ---------------------------------------------------------------------------
// Test fixture constants
// ---------------------------------------------------------------------------

const SRC = "01J0000000000000000000SRC1";
const TGT = "01J0000000000000000000TGT1";

/**
 * Build a minimal Entry for refs tests. Mirrors the `makeEntry` baseline from
 * `core/lock/resolve_test.ts` exactly — same field set, same defaults.
 */
function entry(
  partial: {
    displayId: string;
    id: string | undefined;
    rawAttributes: Array<{ key: string; value: string }>;
    location?: { file: string; line: number; column: number };
  },
): Entry {
  return {
    displayId: makeDisplayId(partial.displayId),
    title: partial.displayId,
    body: "",
    rawAttributes: partial.rawAttributes,
    typedAttributes: new Map() as never,
    id: partial.id,
    shape: "Authored",
    location: partial.location ?? { file: "x.md", line: 1, column: 1 },
    source: { kind: "markdown" },
    bodyTokens: [],
  };
}

// ---------------------------------------------------------------------------
// TRACE_ATTRIBUTE_KEYS membership
// ---------------------------------------------------------------------------

Deno.test("TRACE_ATTRIBUTE_KEYS: includes core trace relations", () => {
  assertEquals(TRACE_ATTRIBUTE_KEYS.has("Satisfies"), true);
  assertEquals(TRACE_ATTRIBUTE_KEYS.has("Derived-from"), true);
  assertEquals(TRACE_ATTRIBUTE_KEYS.has("Verified-by"), true);
  assertEquals(TRACE_ATTRIBUTE_KEYS.has("References"), true);
  assertEquals(TRACE_ATTRIBUTE_KEYS.has("Tests"), true);
  assertEquals(TRACE_ATTRIBUTE_KEYS.has("Depends-on"), true);
  assertEquals(TRACE_ATTRIBUTE_KEYS.has("Part-of"), true);
  assertEquals(TRACE_ATTRIBUTE_KEYS.has("Allocated-to"), true);
  assertEquals(TRACE_ATTRIBUTE_KEYS.has("Realizes"), true);
  assertEquals(TRACE_ATTRIBUTE_KEYS.has("Provides"), true);
  assertEquals(TRACE_ATTRIBUTE_KEYS.has("Requires"), true);
});

Deno.test("TRACE_ATTRIBUTE_KEYS: does not include non-trace keys", () => {
  assertEquals(TRACE_ATTRIBUTE_KEYS.has("Labels"), false);
  assertEquals(TRACE_ATTRIBUTE_KEYS.has("Id"), false);
  assertEquals(TRACE_ATTRIBUTE_KEYS.has("Type"), false);
});

// ---------------------------------------------------------------------------
// buildRefIndex
// ---------------------------------------------------------------------------

Deno.test("buildRefIndex: builds both directions", () => {
  const src = entry({
    displayId: "SWE_0001",
    id: SRC,
    rawAttributes: [],
  });
  const tgt = entry({
    displayId: "SYS_0001",
    id: TGT,
    rawAttributes: [],
  });
  const idx = buildRefIndex([src, tgt]);
  assertEquals(idx.displayIdToUlid.get("SWE_0001"), SRC);
  assertEquals(idx.displayIdToUlid.get("SYS_0001"), TGT);
  assertEquals(idx.ulidToDisplayId.get(SRC), "SWE_0001");
  assertEquals(idx.ulidToDisplayId.get(TGT), "SYS_0001");
});

Deno.test("buildRefIndex: first-entry-wins on duplicate display ID", () => {
  const a = entry({ displayId: "REQ_0001", id: SRC, rawAttributes: [] });
  const b = entry({
    displayId: "REQ_0001",
    id: "01J0000000000000000000TGT2",
    rawAttributes: [],
  });
  const idx = buildRefIndex([a, b]);
  assertEquals(idx.displayIdToUlid.get("REQ_0001"), SRC);
});

Deno.test("buildRefIndex: entries without id are skipped", () => {
  const e = entry({ displayId: "UNS_0001", id: undefined, rawAttributes: [] });
  const idx = buildRefIndex([e]);
  assertEquals(idx.displayIdToUlid.has("UNS_0001"), false);
});

// ---------------------------------------------------------------------------
// canonicalizeRefs — rule 1: ULID → current display ID
// ---------------------------------------------------------------------------

Deno.test("canonicalizeRefs: ULID token in trace attr replaced with current display ID", () => {
  // Content has the source entry's title at line 1, Satisfies at line 6
  const content = [
    `- [SWE_0001] Title`,
    ``,
    `  Body.`,
    ``,
    `      Id: ${SRC}`,
    `      Satisfies: ${TGT}`,
  ].join("\n");

  const src = entry({
    displayId: "SWE_0001",
    id: SRC,
    rawAttributes: [
      { key: "Id", value: SRC },
      { key: "Satisfies", value: TGT },
    ],
    location: { file: "x.md", line: 1, column: 1 },
  });
  const tgt = entry({
    displayId: "SYS_0001",
    id: TGT,
    rawAttributes: [{ key: "Id", value: TGT }],
    location: { file: "x.md", line: 8, column: 1 },
  });

  const idx = buildRefIndex([src, tgt]);
  const { output, changed } = canonicalizeRefs(content, [src, tgt], idx, []);

  assertEquals(changed, true);
  assertEquals(
    output.split("\n").find((l: string) => l.includes("Satisfies"))!,
    "      Satisfies: SYS_0001",
  );
});

// ---------------------------------------------------------------------------
// canonicalizeRefs — fenced-code regions are verbatim (#668)
// ---------------------------------------------------------------------------

Deno.test("canonicalizeRefs: trace values inside a fenced block are left verbatim", () => {
  // A real trailer (line 6) is healed; an identical illustrative trailer
  // inside a ```markdown example (line 9) must stay byte-for-byte.
  const content = [
    `- [SWE_0001] Title`,
    ``,
    `  Body.`,
    ``,
    `      Id: ${SRC}`,
    `      Satisfies: ${TGT}`,
    ``,
    "```markdown",
    `      Satisfies: ${TGT}`,
    "```",
  ].join("\n");

  const src = entry({
    displayId: "SWE_0001",
    id: SRC,
    rawAttributes: [
      { key: "Id", value: SRC },
      { key: "Satisfies", value: TGT },
    ],
    location: { file: "x.md", line: 1, column: 1 },
  });
  const tgt = entry({
    displayId: "SYS_0001",
    id: TGT,
    rawAttributes: [{ key: "Id", value: TGT }],
    location: { file: "x.md", line: 20, column: 1 },
  });

  const idx = buildRefIndex([src, tgt]);
  const { output, changed } = canonicalizeRefs(content, [src, tgt], idx, []);
  const outLines = output.split("\n");

  assertEquals(changed, true);
  // Real trailer healed ULID → current display ID.
  assertEquals(outLines[5], "      Satisfies: SYS_0001");
  // Fenced example untouched — still the raw ULID.
  assertEquals(outLines[8], `      Satisfies: ${TGT}`);
});

Deno.test("canonicalizeRefs: a document that is only a fenced example is a no-op", () => {
  // Mirrors the #668 repo-churn scenario: an illustrative trailer inside a
  // fence, with no real entry claiming that ULID — must not be rewritten.
  const content = [
    "```markdown",
    `      Realizes: ${TGT}`,
    "```",
  ].join("\n");

  const tgt = entry({
    displayId: "SYS_0001",
    id: TGT,
    rawAttributes: [{ key: "Id", value: TGT }],
    location: { file: "x.md", line: 100, column: 1 },
  });

  const idx = buildRefIndex([tgt]);
  const { output, changed } = canonicalizeRefs(content, [tgt], idx, []);

  assertEquals(changed, false);
  assertEquals(output, content);
});

// ---------------------------------------------------------------------------
// canonicalizeRefs — rule 2: current display ID → no-op
// ---------------------------------------------------------------------------

Deno.test("canonicalizeRefs: current display ID token is left unchanged", () => {
  const content = [
    `- [SWE_0001] Title`,
    ``,
    `  Body.`,
    ``,
    `      Id: ${SRC}`,
    `      Satisfies: SYS_0001`,
  ].join("\n");

  const src = entry({
    displayId: "SWE_0001",
    id: SRC,
    rawAttributes: [
      { key: "Id", value: SRC },
      { key: "Satisfies", value: "SYS_0001" },
    ],
    location: { file: "x.md", line: 1, column: 1 },
  });
  const tgt = entry({
    displayId: "SYS_0001",
    id: TGT,
    rawAttributes: [{ key: "Id", value: TGT }],
    location: { file: "x.md", line: 8, column: 1 },
  });

  const idx = buildRefIndex([src, tgt]);
  const { output, changed } = canonicalizeRefs(content, [src, tgt], idx, []);

  assertEquals(changed, false);
  assertEquals(output, content);
});

// ---------------------------------------------------------------------------
// canonicalizeRefs — rule 3: stale display ID → heal via ledger
// ---------------------------------------------------------------------------

Deno.test("canonicalizeRefs: stale display ID healed via ledger", () => {
  // Target was renamed from OLD_SYS_001 to SYS_0001; ledger records the edge.
  const content = [
    `- [SWE_0001] Title`,
    ``,
    `  Body.`,
    ``,
    `      Id: ${SRC}`,
    `      Satisfies: OLD_SYS_001`,
  ].join("\n");

  const src = entry({
    displayId: "SWE_0001",
    id: SRC,
    rawAttributes: [
      { key: "Id", value: SRC },
      { key: "Satisfies", value: "OLD_SYS_001" },
    ],
    location: { file: "x.md", line: 1, column: 1 },
  });
  const tgt = entry({
    displayId: "SYS_0001",
    id: TGT,
    rawAttributes: [{ key: "Id", value: TGT }],
    location: { file: "x.md", line: 8, column: 1 },
  });

  const idx = buildRefIndex([src, tgt]);
  const ledger: LockEdge[] = [
    {
      sourceUlid: SRC,
      relation: "Satisfies",
      targetUlid: TGT,
      authoredTarget: "OLD_SYS_001",
    },
  ];
  const { output, changed } = canonicalizeRefs(
    content,
    [src, tgt],
    idx,
    ledger,
  );

  assertEquals(changed, true);
  assertEquals(
    output.split("\n").find((l: string) => l.includes("Satisfies"))!,
    "      Satisfies: SYS_0001",
  );
});

// ---------------------------------------------------------------------------
// canonicalizeRefs — rule 4: orphan → left untouched
// ---------------------------------------------------------------------------

Deno.test("canonicalizeRefs: orphan display ID left untouched", () => {
  const content = [
    `- [SWE_0001] Title`,
    ``,
    `  Body.`,
    ``,
    `      Id: ${SRC}`,
    `      Satisfies: GONE_0001`,
  ].join("\n");

  const src = entry({
    displayId: "SWE_0001",
    id: SRC,
    rawAttributes: [
      { key: "Id", value: SRC },
      { key: "Satisfies", value: "GONE_0001" },
    ],
    location: { file: "x.md", line: 1, column: 1 },
  });

  const idx = buildRefIndex([src]);
  const { output, changed } = canonicalizeRefs(content, [src], idx, []);

  assertEquals(changed, false);
  assertEquals(output, content);
});

// ---------------------------------------------------------------------------
// canonicalizeRefs — CSV multi-token rewrite
// ---------------------------------------------------------------------------

Deno.test("canonicalizeRefs: CSV line with ULID and display ID — only ULID replaced", () => {
  const content = [
    `- [SWE_0001] Title`,
    ``,
    `  Body.`,
    ``,
    `      Id: ${SRC}`,
    `      Satisfies: ${TGT}, SYS_0002`,
  ].join("\n");

  const src = entry({
    displayId: "SWE_0001",
    id: SRC,
    rawAttributes: [
      { key: "Id", value: SRC },
      { key: "Satisfies", value: `${TGT}, SYS_0002` },
    ],
    location: { file: "x.md", line: 1, column: 1 },
  });
  const tgt1 = entry({
    displayId: "SYS_0001",
    id: TGT,
    rawAttributes: [{ key: "Id", value: TGT }],
    location: { file: "x.md", line: 8, column: 1 },
  });
  const tgt2 = entry({
    displayId: "SYS_0002",
    id: "01J0000000000000000000TGT2",
    rawAttributes: [{ key: "Id", value: "01J0000000000000000000TGT2" }],
    location: { file: "x.md", line: 14, column: 1 },
  });

  const idx = buildRefIndex([src, tgt1, tgt2]);
  const { output, changed } = canonicalizeRefs(
    content,
    [src, tgt1, tgt2],
    idx,
    [],
  );

  assertEquals(changed, true);
  assertEquals(
    output.split("\n").find((l: string) => l.includes("Satisfies"))!,
    "      Satisfies: SYS_0001, SYS_0002",
  );
});

// ---------------------------------------------------------------------------
// canonicalizeRefs — ULID in body prose is NOT rewritten
// ---------------------------------------------------------------------------

Deno.test("canonicalizeRefs: ULID in body prose is not rewritten", () => {
  // The ULID appears in the body, not a trace trailer.
  const content = [
    `- [SWE_0001] Title`,
    ``,
    `  Prose mentioning ${TGT} for context.`,
    ``,
    `      Id: ${SRC}`,
  ].join("\n");

  const src = entry({
    displayId: "SWE_0001",
    id: SRC,
    rawAttributes: [{ key: "Id", value: SRC }],
    location: { file: "x.md", line: 1, column: 1 },
  });
  const tgt = entry({
    displayId: "SYS_0001",
    id: TGT,
    rawAttributes: [{ key: "Id", value: TGT }],
    location: { file: "x.md", line: 8, column: 1 },
  });

  const idx = buildRefIndex([src, tgt]);
  const { output, changed } = canonicalizeRefs(content, [src, tgt], idx, []);

  assertEquals(changed, false);
  assertEquals(output, content);
});

// ---------------------------------------------------------------------------
// canonicalizeRefs — trailing-backslash key line is canonicalised (#606)
// ---------------------------------------------------------------------------

Deno.test("canonicalizeRefs: trailing-backslash key line has its ULID canonicalised, continuation orphan untouched", () => {
  const line = `      Satisfies: ${TGT} \\`;
  const content = [
    `- [SWE_0001] Title`,
    ``,
    `  Body.`,
    ``,
    `      Id: ${SRC}`,
    line,
    `      SYS_0002`,
  ].join("\n");

  const src = entry({
    displayId: "SWE_0001",
    id: SRC,
    rawAttributes: [
      { key: "Id", value: SRC },
      { key: "Satisfies", value: `${TGT}` },
    ],
    location: { file: "x.md", line: 1, column: 1 },
  });
  const tgt = entry({
    displayId: "SYS_0001",
    id: TGT,
    rawAttributes: [{ key: "Id", value: TGT }],
    location: { file: "x.md", line: 8, column: 1 },
  });

  const idx = buildRefIndex([src, tgt]);
  const { output, changed } = canonicalizeRefs(content, [src, tgt], idx, []);

  assertEquals(changed, true);
  const lines = output.split("\n");
  // The key-line ULID is canonicalised; the trailing backslash is preserved.
  assertEquals(lines[5], "      Satisfies: SYS_0001 \\");
  // The continuation orphan (SYS_0002 not in the index) is left untouched.
  assertEquals(lines[6], "      SYS_0002");
});

// ---------------------------------------------------------------------------
// canonicalizeRefs — CRLF line endings (#610 regression)
// ---------------------------------------------------------------------------

Deno.test("canonicalizeRefs: CRLF file canonicalises a ULID and preserves the CR", () => {
  // Same content as the rule-1 test but with CRLF line endings. The trailer
  // regex must still match (the CR is stripped before matching) and the
  // rewritten line must retain its trailing CR so line endings are lossless.
  // The Satisfies line must NOT be the final line — only a non-final line
  // carries a trailing CR after `split("\n")`, which is what exposes the bug.
  const content = [
    `- [SWE_0001] Title`,
    ``,
    `  Body.`,
    ``,
    `      Id: ${SRC}`,
    `      Satisfies: ${TGT}`,
    ``,
  ].join("\r\n");

  const src = entry({
    displayId: "SWE_0001",
    id: SRC,
    rawAttributes: [
      { key: "Id", value: SRC },
      { key: "Satisfies", value: TGT },
    ],
    location: { file: "x.md", line: 1, column: 1 },
  });
  const tgt = entry({
    displayId: "SYS_0001",
    id: TGT,
    rawAttributes: [{ key: "Id", value: TGT }],
    location: { file: "x.md", line: 8, column: 1 },
  });

  const idx = buildRefIndex([src, tgt]);
  const { output, changed } = canonicalizeRefs(content, [src, tgt], idx, []);

  assertEquals(changed, true);
  // Output is byte-for-byte the input with only the ULID token canonicalised
  // and every CRLF preserved.
  const expected = [
    `- [SWE_0001] Title`,
    ``,
    `  Body.`,
    ``,
    `      Id: ${SRC}`,
    `      Satisfies: SYS_0001`,
    ``,
  ].join("\r\n");
  assertEquals(output, expected);
});

// ---------------------------------------------------------------------------
// Spec-invariant hardening (review follow-up)
// ---------------------------------------------------------------------------

Deno.test("canonicalizeRefs: Verified-by file-path value is left as-is", () => {
  // A path like `tests/val_foo.rs` matches DISPLAY_ID_RE (the class includes
  // `.` and `/`), but resolves to no entry and has no ledger edge, so Rule 4
  // leaves it untouched. Pins the path-or-id invariant for Verified-by.
  const content = [
    "- [SWE_0001] S",
    "",
    `      Id: ${SRC}`,
    "      Verified-by: tests/val_foo.rs",
    "",
  ].join("\n");
  const src = entry({
    displayId: "SWE_0001",
    id: SRC,
    rawAttributes: [{ key: "Id", value: SRC }, {
      key: "Verified-by",
      value: "tests/val_foo.rs",
    }],
  });
  const idx = buildRefIndex([src]);
  const { output, changed } = canonicalizeRefs(content, [src], idx, []);
  assertEquals(changed, false);
  assertEquals(output, content);
});

Deno.test("canonicalizeRefs: a non-resolving ULID trace value is left as-is", () => {
  // A ULID that resolves to no entry must NOT be rewritten (guards the
  // `?? token` fallback in Rule 1).
  const unknown = "01J0000000000000000000XXXX";
  const content = [
    "- [SWE_0001] S",
    "",
    `      Id: ${SRC}`,
    `      Satisfies: ${unknown}`,
    "",
  ].join("\n");
  const src = entry({
    displayId: "SWE_0001",
    id: SRC,
    rawAttributes: [{ key: "Id", value: SRC }, {
      key: "Satisfies",
      value: unknown,
    }],
  });
  const idx = buildRefIndex([src]);
  const { output, changed } = canonicalizeRefs(content, [src], idx, []);
  assertEquals(changed, false);
  assertEquals(output, content);
});

// ---------------------------------------------------------------------------
// canonicalizeRefs — multi-line (\-continued) trace values (#606)
// ---------------------------------------------------------------------------

const TGT2 = "01J0000000000000000000TGT2";

Deno.test("canonicalizeRefs: multi-line value canonicalises ULIDs on every line", () => {
  const content = [
    `- [SWE_0001] Title`,
    ``,
    `  Body.`,
    ``,
    `      Id: ${SRC}`,
    `      Satisfies: ${TGT}, \\`,
    `        ${TGT2}`,
  ].join("\n");

  const src = entry({
    displayId: "SWE_0001",
    id: SRC,
    rawAttributes: [{ key: "Id", value: SRC }],
    location: { file: "x.md", line: 1, column: 1 },
  });
  const tgt = entry({
    displayId: "SYS_0001",
    id: TGT,
    rawAttributes: [{ key: "Id", value: TGT }],
    location: { file: "x.md", line: 9, column: 1 },
  });
  const tgt2 = entry({
    displayId: "SYS_0002",
    id: TGT2,
    rawAttributes: [{ key: "Id", value: TGT2 }],
    location: { file: "x.md", line: 12, column: 1 },
  });

  const idx = buildRefIndex([src, tgt, tgt2]);
  const { output, changed } = canonicalizeRefs(
    content,
    [src, tgt, tgt2],
    idx,
    [],
  );

  assertEquals(changed, true);
  const lines = output.split("\n");
  // Both ULIDs canonicalised; indentation + trailing backslash preserved.
  assertEquals(lines[5], "      Satisfies: SYS_0001, \\");
  assertEquals(lines[6], "        SYS_0002");
});

Deno.test("canonicalizeRefs: multi-line value heals a stale display ID on a continuation line", () => {
  const content = [
    `- [SWE_0001] Title`,
    ``,
    `  Body.`,
    ``,
    `      Id: ${SRC}`,
    `      Satisfies: SYS_0001, \\`,
    `        OLD_SYS_002`,
  ].join("\n");

  const src = entry({
    displayId: "SWE_0001",
    id: SRC,
    rawAttributes: [{ key: "Id", value: SRC }],
    location: { file: "x.md", line: 1, column: 1 },
  });
  const tgt = entry({
    displayId: "SYS_0001",
    id: TGT,
    rawAttributes: [{ key: "Id", value: TGT }],
    location: { file: "x.md", line: 9, column: 1 },
  });
  const tgt2 = entry({
    displayId: "SYS_0002",
    id: TGT2,
    rawAttributes: [{ key: "Id", value: TGT2 }],
    location: { file: "x.md", line: 12, column: 1 },
  });

  const idx = buildRefIndex([src, tgt, tgt2]);
  const ledger: LockEdge[] = [
    {
      sourceUlid: SRC,
      relation: "Satisfies",
      targetUlid: TGT2,
      authoredTarget: "OLD_SYS_002",
    },
  ];
  const { output, changed } = canonicalizeRefs(
    content,
    [src, tgt, tgt2],
    idx,
    ledger,
  );

  assertEquals(changed, true);
  const lines = output.split("\n");
  assertEquals(lines[5], "      Satisfies: SYS_0001, \\");
  assertEquals(lines[6], "        SYS_0002");
});

Deno.test("canonicalizeRefs: fully-canonical multi-line value is a lossless no-op", () => {
  const content = [
    `- [SWE_0001] Title`,
    ``,
    `  Body.`,
    ``,
    `      Id: ${SRC}`,
    `      Satisfies: SYS_0001, \\`,
    `        SYS_0002`,
    ``,
  ].join("\n");

  const src = entry({
    displayId: "SWE_0001",
    id: SRC,
    rawAttributes: [{ key: "Id", value: SRC }],
    location: { file: "x.md", line: 1, column: 1 },
  });
  const tgt = entry({
    displayId: "SYS_0001",
    id: TGT,
    rawAttributes: [{ key: "Id", value: TGT }],
    location: { file: "x.md", line: 9, column: 1 },
  });
  const tgt2 = entry({
    displayId: "SYS_0002",
    id: TGT2,
    rawAttributes: [{ key: "Id", value: TGT2 }],
    location: { file: "x.md", line: 12, column: 1 },
  });

  const idx = buildRefIndex([src, tgt, tgt2]);
  const { output, changed } = canonicalizeRefs(
    content,
    [src, tgt, tgt2],
    idx,
    [],
  );

  assertEquals(changed, false);
  assertEquals(output, content);
});

Deno.test("canonicalizeRefs: continuation-only change does not skip the following trace line", () => {
  // The key line is already canonical; only the continuation carries a ULID.
  // A following `Verified-by:` line must still be reached by the outer loop.
  const content = [
    `- [SWE_0001] Title`,
    ``,
    `  Body.`,
    ``,
    `      Id: ${SRC}`,
    `      Satisfies: SYS_0001, \\`,
    `        ${TGT2}`,
    `      Verified-by: ${SRC}`,
  ].join("\n");

  const src = entry({
    displayId: "SWE_0001",
    id: SRC,
    rawAttributes: [{ key: "Id", value: SRC }],
    location: { file: "x.md", line: 1, column: 1 },
  });
  const tgt = entry({
    displayId: "SYS_0001",
    id: TGT,
    rawAttributes: [{ key: "Id", value: TGT }],
    location: { file: "x.md", line: 10, column: 1 },
  });
  const tgt2 = entry({
    displayId: "SYS_0002",
    id: TGT2,
    rawAttributes: [{ key: "Id", value: TGT2 }],
    location: { file: "x.md", line: 13, column: 1 },
  });

  const idx = buildRefIndex([src, tgt, tgt2]);
  const { output, changed } = canonicalizeRefs(
    content,
    [src, tgt, tgt2],
    idx,
    [],
  );

  assertEquals(changed, true);
  const lines = output.split("\n");
  assertEquals(lines[6], "        SYS_0002");
  // The Verified-by line after the continuation is still canonicalised.
  assertEquals(lines[7], "      Verified-by: SWE_0001");
});
