import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  parseCodeLensTarget,
  parseReferenceLocations,
} from "./codeLensCommands";

test("parseCodeLensTarget: well-formed [uri, position] → open", () => {
  const result = parseCodeLensTarget([
    "file:///foo/bar.md",
    { line: 12, character: 0 },
  ]);
  assert.deepEqual(result, {
    kind: "open",
    uri: "file:///foo/bar.md",
    line: 12,
    character: 0,
  });
});

test("parseCodeLensTarget: empty args → missing (unresolved Satisfies case)", () => {
  // The LSP emits `arguments: []` for `↓ Satisfies: <ID>` lenses whose
  // target isn't in the indexed workspace — see
  // `packages/markspec/lsp/code_lens.ts:114`.
  assert.deepEqual(parseCodeLensTarget([]), { kind: "missing" });
});

test("parseCodeLensTarget: missing position → missing", () => {
  assert.deepEqual(
    parseCodeLensTarget(["file:///foo/bar.md"]),
    { kind: "missing" },
  );
});

test("parseCodeLensTarget: non-string uri → missing", () => {
  assert.deepEqual(
    parseCodeLensTarget([42, { line: 0, character: 0 }]),
    { kind: "missing" },
  );
});

test("parseCodeLensTarget: empty-string uri → missing", () => {
  assert.deepEqual(
    parseCodeLensTarget(["", { line: 0, character: 0 }]),
    { kind: "missing" },
  );
});

test("parseCodeLensTarget: null position → missing", () => {
  assert.deepEqual(
    parseCodeLensTarget(["file:///foo/bar.md", null]),
    { kind: "missing" },
  );
});

test("parseCodeLensTarget: missing line field → missing", () => {
  assert.deepEqual(
    parseCodeLensTarget(["file:///foo/bar.md", { character: 0 }]),
    { kind: "missing" },
  );
});

test("parseCodeLensTarget: negative line → missing", () => {
  assert.deepEqual(
    parseCodeLensTarget(["file:///foo/bar.md", { line: -1, character: 0 }]),
    { kind: "missing" },
  );
});

test("parseCodeLensTarget: NaN character → missing", () => {
  assert.deepEqual(
    parseCodeLensTarget([
      "file:///foo/bar.md",
      { line: 0, character: Number.NaN },
    ]),
    { kind: "missing" },
  );
});

test("parseCodeLensTarget: extra trailing args are tolerated", () => {
  // VS Code may dispatch with additional positional arguments in
  // future protocol revisions; the parser only cares about [0] + [1].
  const result = parseCodeLensTarget([
    "file:///foo/bar.md",
    { line: 5, character: 2 },
    "ignored",
  ]);
  assert.deepEqual(result, {
    kind: "open",
    uri: "file:///foo/bar.md",
    line: 5,
    character: 2,
  });
});

test("parseReferenceLocations: well-formed locations array", () => {
  const result = parseReferenceLocations([
    "file:///foo/bar.md",
    { line: 0, character: 0 },
    [
      { uri: "file:///foo/a.md", line: 3, character: 0 },
      { uri: "file:///foo/b.md", line: 7, character: 0 },
    ],
  ]);
  assert.deepEqual(result, [
    { uri: "file:///foo/a.md", line: 3, character: 0 },
    { uri: "file:///foo/b.md", line: 7, character: 0 },
  ]);
});

test("parseReferenceLocations: missing third argument → empty list", () => {
  assert.deepEqual(
    parseReferenceLocations(["file:///foo/bar.md", { line: 0, character: 0 }]),
    [],
  );
});

test("parseReferenceLocations: non-array third argument → empty list", () => {
  assert.deepEqual(
    parseReferenceLocations([
      "file:///foo/bar.md",
      { line: 0, character: 0 },
      "not-an-array",
    ]),
    [],
  );
});

test("parseReferenceLocations: malformed entries are dropped individually", () => {
  const result = parseReferenceLocations([
    "file:///foo/bar.md",
    { line: 0, character: 0 },
    [
      { uri: "file:///foo/a.md", line: 3, character: 0 },
      { uri: 42, line: 3, character: 0 },
      { uri: "file:///foo/b.md", line: -1, character: 0 },
      { uri: "file:///foo/c.md", line: 5, character: Number.NaN },
      null,
      "garbage",
    ],
  ]);
  assert.deepEqual(result, [
    { uri: "file:///foo/a.md", line: 3, character: 0 },
  ]);
});
