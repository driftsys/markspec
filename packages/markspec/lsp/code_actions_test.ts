/**
 * @module lsp/code_actions_test
 *
 * Unit tests for {@linkcode buildCodeActions} — produces LSP code
 * actions (quick fixes) for the diagnostics MarkSpec knows how to
 * mechanically repair.
 */

import { assertEquals } from "@std/assert";
import { buildCodeActions, type LspDiagnosticLike } from "./code_actions.ts";

function diag(opts: {
  code: string;
  message: string;
  line: number;
  character: number;
}): LspDiagnosticLike {
  return {
    code: opts.code,
    severity: 2,
    message: opts.message,
    range: {
      start: { line: opts.line, character: opts.character },
      end: { line: opts.line, character: Number.MAX_SAFE_INTEGER },
    },
  };
}

Deno.test("buildCodeActions: MSL-M060 → lowercase keyword quick fix", () => {
  const actions = buildCodeActions("file:///x.md", [
    diag({
      code: "MSL-M060",
      message: "REQ-001: modal keyword 'SHALL' in body prose is uppercase",
      line: 4,
      character: 14,
    }),
  ]);
  assertEquals(actions.length, 1);
  const a = actions[0];
  assertEquals(a.title, "Lowercase 'shall'");
  assertEquals(a.kind, "quickfix");
  assertEquals(a.isPreferred, true);
  const edit = a.edit!.changes!["file:///x.md"][0];
  assertEquals(edit.newText, "shall");
  assertEquals(edit.range.start.line, 4);
  assertEquals(edit.range.start.character, 14);
  assertEquals(edit.range.end.line, 4);
  // 'SHALL' is 5 chars.
  assertEquals(edit.range.end.character, 19);
});

Deno.test("buildCodeActions: MSL-M060 with NOT suffix → lowercases both tokens", () => {
  const actions = buildCodeActions("file:///x.md", [
    diag({
      code: "MSL-M060",
      message: "REQ-001: modal keyword 'MUST NOT' in body prose is uppercase",
      line: 0,
      character: 10,
    }),
  ]);
  assertEquals(actions.length, 1);
  const edit = actions[0].edit!.changes!["file:///x.md"][0];
  assertEquals(edit.newText, "must not");
  assertEquals(edit.range.end.character, 18);
});

Deno.test("buildCodeActions: unrelated diagnostic code yields no action", () => {
  const actions = buildCodeActions("file:///x.md", [
    diag({
      code: "MSL-T020",
      message: "REQ-001: Type: 'NotARealType' is not a core type",
      line: 5,
      character: 0,
    }),
  ]);
  assertEquals(actions, []);
});

Deno.test("buildCodeActions: empty diagnostics list yields empty actions", () => {
  assertEquals(buildCodeActions("file:///x.md", []), []);
});

Deno.test("buildCodeActions: MSL-M060 with malformed message yields no action", () => {
  // Missing the 'KEYWORD' single-quoted token in the message.
  const actions = buildCodeActions("file:///x.md", [
    diag({
      code: "MSL-M060",
      message: "REQ-001: something went wrong",
      line: 0,
      character: 0,
    }),
  ]);
  assertEquals(actions, []);
});
