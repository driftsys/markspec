/**
 * @module lsp/inlay_hint_test
 *
 * Unit tests for {@linkcode buildInlayHints} — pure helper that emits
 * inline hints (`: <type>` and `(N dependents)`) for `textDocument/inlayHint`.
 */

import { assertEquals } from "@std/assert";
import { buildInlayHints } from "./inlay_hint.ts";
import type { Attribute, DisplayId, Entry, Ulid } from "../core/mod.ts";

function fakeEntry(opts: {
  displayId: string;
  title?: string;
  line?: number;
  file?: string;
  type?: string;
  attrs?: Array<{ key: string; value: string }>;
}): Entry {
  const attrs: Attribute[] = (opts.attrs ?? []).map((a) => ({
    key: a.key,
    value: a.value,
  }));
  return {
    shape: "Authored",
    displayId: opts.displayId as DisplayId,
    title: opts.title ?? "T",
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF" as Ulid,
    body: "",
    rawAttributes: attrs,
    typedAttributes: new Map(),
    type: opts.type,
    location: {
      file: opts.file ?? "/proj/r.md",
      line: opts.line ?? 1,
      column: 1,
    },
    labels: [],
    // deno-lint-ignore no-explicit-any
  } as any;
}

/** Stub lineLength: every line is 80 chars wide. */
const stubLineLength = (_line: number): number => 80;

Deno.test("buildInlayHints: empty input returns empty array", () => {
  assertEquals(buildInlayHints([], [], stubLineLength), []);
});

Deno.test("buildInlayHints: entry with no type and no dependents yields no hints", () => {
  const entry = fakeEntry({ displayId: "STK_001" });
  assertEquals(buildInlayHints([entry], [entry], stubLineLength), []);
});

Deno.test("buildInlayHints: prefix-inferred type yields ': <type>' hint", () => {
  const entry = fakeEntry({
    displayId: "STK_001",
    type: "stakeholder-requirement",
  });
  const hints = buildInlayHints([entry], [entry], stubLineLength);
  const typeHint = hints.find((h) => h.label.startsWith(":"));
  assertEquals(typeHint?.label, ": stakeholder-requirement");
  assertEquals(typeHint?.position, { line: 0, character: 80 });
  assertEquals(typeHint?.kind, 1);
  assertEquals(typeHint?.paddingLeft, true);
});

Deno.test("buildInlayHints: explicit Type: attribute suppresses ': <type>' hint", () => {
  const entry = fakeEntry({
    displayId: "STK_001",
    type: "stakeholder-requirement",
    attrs: [{ key: "Type", value: "stakeholder-requirement" }],
  });
  const hints = buildInlayHints([entry], [entry], stubLineLength);
  const typeHint = hints.find((h) => h.label.startsWith(":"));
  assertEquals(typeHint, undefined);
});

Deno.test("buildInlayHints: entry with dependents yields '(N dependents)' hint", () => {
  const target = fakeEntry({ displayId: "STK_001" });
  const child1 = fakeEntry({
    displayId: "SAD_A",
    attrs: [{ key: "Satisfies", value: "STK_001" }],
  });
  const child2 = fakeEntry({
    displayId: "SAD_B",
    attrs: [{ key: "Satisfies", value: "STK_001" }],
  });
  const hints = buildInlayHints(
    [target],
    [target, child1, child2],
    stubLineLength,
  );
  const depHint = hints.find((h) => h.label.startsWith("("));
  assertEquals(depHint?.label, "(2 dependents)");
  assertEquals(depHint?.position, { line: 0, character: 80 });
  assertEquals(depHint?.kind, 2);
});

Deno.test("buildInlayHints: singular dependent uses singular form", () => {
  const target = fakeEntry({ displayId: "STK_001" });
  const child = fakeEntry({
    displayId: "SAD_A",
    attrs: [{ key: "Satisfies", value: "STK_001" }],
  });
  const hints = buildInlayHints([target], [target, child], stubLineLength);
  const depHint = hints.find((h) => h.label.startsWith("("));
  assertEquals(depHint?.label, "(1 dependent)");
});

Deno.test("buildInlayHints: type + dependents both emitted on the same entry", () => {
  const target = fakeEntry({
    displayId: "STK_001",
    type: "stakeholder-requirement",
  });
  const child = fakeEntry({
    displayId: "SAD_A",
    attrs: [{ key: "Satisfies", value: "STK_001" }],
  });
  const hints = buildInlayHints([target], [target, child], stubLineLength);
  assertEquals(hints.length, 2);
  // Order: type hint first, then dependents.
  assertEquals(hints[0].label, ": stakeholder-requirement");
  assertEquals(hints[1].label, "(1 dependent)");
});
