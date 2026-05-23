import { test } from "node:test";
import { strict as assert } from "node:assert";
import { classifyContext, type InlineContext } from "./inlineCompletions";

interface FakePosition {
  readonly line: number;
  readonly character: number;
}

interface FakeDocument {
  readonly lineCount: number;
  lineAt(line: number): { text: string };
}

function makeDoc(lines: readonly string[]): FakeDocument {
  return {
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? "" }),
  };
}

function pos(line: number, character: number): FakePosition {
  return { line, character };
}

test("classifyContext: skip when cursor is on Id: line", () => {
  const doc = makeDoc([
    "- [STK_AEB_0001] Title",
    "",
    "  Body.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
  ]);
  const ctx = classifyContext(doc as never, pos(4, 41) as never);
  assert.equal(ctx.kind, "skip");
});

test("classifyContext: title-after-bracket when cursor just after `- [STK_..._NNNN] `", () => {
  const doc = makeDoc([
    "- [STK_AEB_0042] ",
  ]);
  const ctx = classifyContext(doc as never, pos(0, 17) as never);
  assert.equal(ctx.kind, "title-after-bracket");
  if (ctx.kind === "title-after-bracket") {
    assert.equal(ctx.displayId, "STK_AEB_0042");
  }
});

test("classifyContext: entry-body when cursor on indented blank line inside an entry's body", () => {
  const doc = makeDoc([
    "- [STK_AEB_0001] Title",
    "",
    "  ",
  ]);
  const ctx = classifyContext(doc as never, pos(2, 2) as never);
  assert.equal(ctx.kind, "entry-body");
  if (ctx.kind === "entry-body") {
    assert.equal(ctx.entryLine, 0);
    assert.equal(ctx.entryTitle, "Title");
  }
});

test("classifyContext: trace-attribute after `Satisfies: `", () => {
  const doc = makeDoc([
    "- [STK_AEB_0001] Title",
    "",
    "  Body.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
    "      Satisfies: ",
  ]);
  const ctx = classifyContext(doc as never, pos(5, 17) as never);
  assert.equal(ctx.kind, "trace-attribute");
  if (ctx.kind === "trace-attribute") {
    assert.equal(ctx.attribute, "Satisfies");
    assert.equal(ctx.entryTitle, "Title");
  }
});

test("classifyContext: doc-prose when cursor is on plain markdown outside any entry", () => {
  const doc = makeDoc([
    "# Some heading",
    "",
    "Just some paragraph text.",
  ]);
  const ctx = classifyContext(doc as never, pos(2, 24) as never);
  assert.equal(ctx.kind, "doc-prose");
});

test("classifyContext: doc-prose when cursor is at start of empty document", () => {
  const doc = makeDoc([""]);
  const ctx = classifyContext(doc as never, pos(0, 0) as never);
  assert.equal(ctx.kind, "doc-prose");
});

test("classifyContext: doc-prose when cursor mid-title on an existing title line", () => {
  // Regression for the `TITLE_SLOT_RE`-against-`beforeCursor` false positive.
  // Cursor at column 13 of `- [STK_001] Existing Title` — there is real
  // title text after the cursor, so this is NOT a title-slot completion.
  const doc = makeDoc([
    "- [STK_001] Existing Title",
  ]);
  const ctx = classifyContext(doc as never, pos(0, 13) as never);
  assert.notEqual(ctx.kind, "title-after-bracket");
});

test("classifyContext: skip when cursor is on a Labels: trailer value line", () => {
  // Regression: trailer attribute keys that are not trace-link keys must
  // skip, not fall through to doc-prose.
  const doc = makeDoc([
    "- [STK_AEB_0001] Title",
    "",
    "  Body.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
    "      Labels: ASIL-",
  ]);
  const ctx = classifyContext(doc as never, pos(5, 19) as never);
  assert.equal(ctx.kind, "skip");
});

test("classifyContext: skip when cursor is on a Type: trailer value line", () => {
  const doc = makeDoc([
    "- [STK_AEB_0001] Title",
    "",
    "  Body.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
    "      Type: stakeholder-requ",
  ]);
  const ctx = classifyContext(doc as never, pos(5, 27) as never);
  assert.equal(ctx.kind, "skip");
});

// Suppress unused-variable warning for the type-only import.
const _typeProbe: InlineContext = { kind: "skip" };
void _typeProbe;
