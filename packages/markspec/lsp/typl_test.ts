import { assertEquals } from "@std/assert";
import {
  buildDollarNameCompletions,
  dollarNameAtPosition,
  formatShape,
  formatTyplHoverContent,
  isDollarNameTrigger,
} from "./typl.ts";
import { buildTypeRegistry } from "../core/typl/mod.ts";
import type { Entry } from "../core/model/mod.ts";
import { makeDisplayId } from "../core/mod.ts";

function entry(
  displayId: string,
  file: string,
  types?: Entry["types"],
): Entry {
  return {
    displayId: makeDisplayId(displayId),
    title: "t",
    body: "",
    rawAttributes: [],
    typedAttributes: new Map(),
    id: "01HZZZ0000000000000000000A",
    type: undefined,
    shape: "Authored",
    location: { file, line: 1, column: 1 },
    source: { kind: "markdown" },
    properties: { file: { path: file, line: 1, column: 1 } },
    bodyTokens: [],
    types,
  } as unknown as Entry;
}

Deno.test("dollarNameAtPosition: detects $Name with cursor in middle", () => {
  assertEquals(dollarNameAtPosition("The $Speed value", 5), "$Speed");
  assertEquals(dollarNameAtPosition("The $Speed value", 8), "$Speed");
});

Deno.test("dollarNameAtPosition: returns undefined on whitespace", () => {
  assertEquals(dollarNameAtPosition("The $Speed value", 3), undefined); // space before $
});

Deno.test("dollarNameAtPosition: returns undefined on bare $", () => {
  assertEquals(dollarNameAtPosition("Just a $ alone", 7), undefined);
});

Deno.test("dollarNameAtPosition: detects when cursor on the $ itself", () => {
  assertEquals(dollarNameAtPosition("$Speed", 0), "$Speed");
});

Deno.test("formatTyplHoverContent: returns undefined for unknown name", () => {
  const r = buildTypeRegistry([]);
  assertEquals(formatTyplHoverContent("$Unknown", r), undefined);
});

Deno.test("formatTyplHoverContent: shows kind, shape, and declaration", () => {
  const e = entry("REQ_0001", "a.md", {
    bindings: [{
      statementKind: "binding",
      name: "$Speed",
      kind: "signal",
      shape: { kind: "range", type: "float", min: 0, max: 300 },
      position: { line: 5, column: 1 },
    }],
    typedefs: [],
  });
  const r = buildTypeRegistry([e]);
  const content = formatTyplHoverContent("$Speed", r);
  assertEquals(content?.includes("$Speed"), true);
  assertEquals(content?.includes("signal"), true);
  assertEquals(content?.includes("float[0..300]"), true);
  assertEquals(content?.includes("REQ_0001"), true);
  assertEquals(content?.includes("a.md"), true);
});

Deno.test("formatShape: range / primitive / record / enum / optional", () => {
  assertEquals(formatShape({ kind: "primitive", type: "int" }), "int");
  assertEquals(
    formatShape({ kind: "range", type: "float", min: 0, max: 1 }),
    "float[0..1]",
  );
  assertEquals(
    formatShape({ kind: "enum", values: ["a", "b"] }),
    `"a" | "b"`,
  );
  assertEquals(
    formatShape({
      kind: "optional",
      inner: { kind: "primitive", type: "bool" },
    }),
    "bool?",
  );
});

Deno.test("buildDollarNameCompletions: one item per registered name", () => {
  const e = entry("REQ_0001", "a.md", {
    bindings: [
      {
        statementKind: "binding",
        name: "$Speed",
        kind: "signal",
        shape: { kind: "primitive", type: "float" },
        position: { line: 1, column: 1 },
      },
      {
        statementKind: "binding",
        name: "$Brake",
        kind: "command",
        position: { line: 2, column: 1 },
      },
    ],
    typedefs: [],
  });
  const r = buildTypeRegistry([e]);
  const items = buildDollarNameCompletions(r);
  assertEquals(items.length, 2);
  const speed = items.find((i) => i.label === "$Speed");
  assertEquals(speed?.detail, "signal float");
});

Deno.test("isDollarNameTrigger: triggers on $ and partial name", () => {
  assertEquals(isDollarNameTrigger("The $Sp"), true);
  assertEquals(isDollarNameTrigger("value $"), true);
  assertEquals(isDollarNameTrigger("$Speed"), true);
});

Deno.test("isDollarNameTrigger: does not trigger on non-$ context", () => {
  assertEquals(isDollarNameTrigger("Speed"), false);
  assertEquals(isDollarNameTrigger("Satisfies: "), false);
});
