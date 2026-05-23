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

import { buildUserPrompt, type PromptContext, SYSTEM_PROMPT } from "./prompts";

test("SYSTEM_PROMPT: mentions entry block syntax and EARS pattern", () => {
  assert.match(SYSTEM_PROMPT, /entry block/i);
  assert.match(SYSTEM_PROMPT, /EARS/i);
  assert.match(SYSTEM_PROMPT, /\bId:/);
});

test("buildUserPrompt: title-after-bracket includes display ID and asks for a title", () => {
  const ctx: PromptContext = {
    cursorContext: {
      kind: "title-after-bracket",
      displayId: "STK_AEB_0042",
    },
    localWindow:
      "# Emergency braking\n\nAuthor stakeholder requirements here.\n",
    currentFileEntries: [],
    workspaceEntries: [],
  };
  const prompt = buildUserPrompt(ctx);
  assert.match(prompt, /STK_AEB_0042/);
  assert.match(prompt, /Emergency braking/);
  assert.match(prompt, /title/i);
});

test("buildUserPrompt: trace-attribute includes workspace entry list as candidates", () => {
  const ctx: PromptContext = {
    cursorContext: {
      kind: "trace-attribute",
      attribute: "Satisfies",
      entryTitle: "Sensor debouncing",
    },
    localWindow: "      Satisfies: ",
    currentFileEntries: [],
    workspaceEntries: [
      { displayId: "SYS_AEB_0010", title: "Object threat assessment" },
      { displayId: "SYS_AEB_0011", title: "Brake actuation" },
    ],
  };
  const prompt = buildUserPrompt(ctx);
  assert.match(prompt, /Sensor debouncing/);
  assert.match(prompt, /`Satisfies:`/);
  assert.match(prompt, /SYS_AEB_0010/);
  assert.match(prompt, /SYS_AEB_0011/);
});

test("buildUserPrompt: entry-body includes the current file entries but not the workspace", () => {
  const ctx: PromptContext = {
    cursorContext: {
      kind: "entry-body",
      entryLine: 0,
      entryTitle: "Sensor debouncing",
    },
    localWindow: "- [STK_AEB_0001] Sensor debouncing\n\n  |\n",
    currentFileEntries: [
      { displayId: "STK_AEB_0001", title: "Sensor debouncing" },
    ],
    workspaceEntries: [
      { displayId: "SYS_AEB_0010", title: "Should not appear" },
    ],
  };
  const prompt = buildUserPrompt(ctx);
  assert.match(prompt, /Sensor debouncing/);
  assert.match(prompt, /STK_AEB_0001/);
  assert.equal(prompt.includes("SYS_AEB_0010"), false);
});

test("buildUserPrompt: throws when called with skip context", () => {
  const ctx: PromptContext = {
    cursorContext: { kind: "skip" },
    localWindow: "",
    currentFileEntries: [],
    workspaceEntries: [],
  };
  assert.throws(() => buildUserPrompt(ctx), /skip/);
});

test("buildUserPrompt: doc-prose includes only the local window", () => {
  const ctx: PromptContext = {
    cursorContext: { kind: "doc-prose" },
    localWindow: "Some prose around the cursor.",
    currentFileEntries: [
      { displayId: "STK_AEB_0001", title: "Should not appear in prose prompt" },
    ],
    workspaceEntries: [],
  };
  const prompt = buildUserPrompt(ctx);
  assert.match(prompt, /Some prose around the cursor/);
  assert.equal(prompt.includes("STK_AEB_0001"), false);
});

import {
  MarkspecInlineCompletionProvider,
  type ModelInvoker,
} from "./inlineCompletions";

test("MarkspecInlineCompletionProvider: returns null for skip context", async () => {
  const invoker: ModelInvoker = async function* () {
    yield "should-not-appear";
  };
  const provider = new MarkspecInlineCompletionProvider({
    modelInvoker: invoker,
    listDocumentSymbols: async () => [],
    listWorkspaceSymbols: async () => [],
    maxWorkspaceEntries: 200,
  });
  const doc = makeDoc([
    "- [STK_AEB_0001] Title",
    "",
    "  Body.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
  ]);
  const fakeToken = { isCancellationRequested: false } as never;
  const items = await provider.provideInlineCompletionItems(
    doc as never,
    pos(4, 41) as never,
    {} as never,
    fakeToken,
  );
  assert.equal(items, null);
});

test("MarkspecInlineCompletionProvider: forwards model output as the completion item text", async () => {
  const invoker: ModelInvoker = async function* () {
    yield "Sensor ";
    yield "debouncing";
  };
  const provider = new MarkspecInlineCompletionProvider({
    modelInvoker: invoker,
    listDocumentSymbols: async () => [],
    listWorkspaceSymbols: async () => [],
    maxWorkspaceEntries: 200,
  });
  const doc = makeDoc([
    "- [STK_AEB_0042] ",
  ]);
  const fakeToken = { isCancellationRequested: false } as never;
  const items = await provider.provideInlineCompletionItems(
    doc as never,
    pos(0, 17) as never,
    {} as never,
    fakeToken,
  );
  assert.notEqual(items, null);
  if (items && Array.isArray(items)) {
    assert.equal(items.length, 1);
    assert.equal(
      (items[0] as { insertText: string }).insertText,
      "Sensor debouncing",
    );
  }
});

test("MarkspecInlineCompletionProvider: caps workspace symbols at maxWorkspaceEntries", async () => {
  const workspaceSymbols = Array.from(
    { length: 500 },
    (_, i) => ({
      displayId: `SYS_${i.toString().padStart(4, "0")}`,
      title: `Title ${i}`,
    }),
  );
  let promptSeen = "";
  const invoker: ModelInvoker = async function* (messages) {
    promptSeen = messages.join("\n");
    yield "ok";
  };
  const provider = new MarkspecInlineCompletionProvider({
    modelInvoker: invoker,
    listDocumentSymbols: async () => [],
    listWorkspaceSymbols: async () => workspaceSymbols,
    maxWorkspaceEntries: 200,
  });
  const doc = makeDoc([
    "- [STK_AEB_0001] Title",
    "",
    "  Body.",
    "",
    "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
    "      Satisfies: ",
  ]);
  const fakeToken = { isCancellationRequested: false } as never;
  await provider.provideInlineCompletionItems(
    doc as never,
    pos(5, 17) as never,
    {} as never,
    fakeToken,
  );
  assert.equal(promptSeen.includes("SYS_0000"), true);
  assert.equal(promptSeen.includes("SYS_0199"), true);
  assert.equal(promptSeen.includes("SYS_0200"), false);
});

test("MarkspecInlineCompletionProvider: aborts when the cancellation token fires mid-stream", async () => {
  const fakeToken = { isCancellationRequested: false } as {
    isCancellationRequested: boolean;
  };
  const invoker: ModelInvoker = async function* () {
    yield "first";
    fakeToken.isCancellationRequested = true;
    yield "should-not-appear";
  };
  const provider = new MarkspecInlineCompletionProvider({
    modelInvoker: invoker,
    listDocumentSymbols: async () => [],
    listWorkspaceSymbols: async () => [],
    maxWorkspaceEntries: 200,
  });
  const doc = makeDoc(["- [STK_AEB_0042] "]);
  const items = await provider.provideInlineCompletionItems(
    doc as never,
    pos(0, 17) as never,
    {} as never,
    fakeToken as never,
  );
  assert.equal(items, null);
});
