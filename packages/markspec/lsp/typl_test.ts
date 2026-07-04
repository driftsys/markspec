import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildDollarNameCompletions,
  dollarNameAtPosition,
  formatShape,
  formatTyplHoverContent,
  isDollarNameTrigger,
  isRelativeDollarTrigger,
} from "./typl.ts";
import { buildTypeRegistry } from "../core/typl/mod.ts";
import type { Binding } from "../core/typl/mod.ts";
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

/** A resolved leaf binding as it appears in `entry.types.bindings` — the
 * name is already fully-qualified (absolute) by the assembler. */
function binding(
  name: string,
  kind: Binding["kind"],
  shape?: Binding["shape"],
): Binding {
  return {
    statementKind: "binding",
    name,
    kind,
    ...(shape ? { shape } : {}),
    position: { line: 1, column: 1 },
  } as Binding;
}

// ---------------------------------------------------------------------------
// dollarNameAtPosition
// ---------------------------------------------------------------------------

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

Deno.test("dollarNameAtPosition: spans a dotted published name", () => {
  const l = "cite `$powertrain.brake.pedal_position` here";
  const want = "$powertrain.brake.pedal_position";
  assertEquals(dollarNameAtPosition(l, l.indexOf("$")), want); // on $
  assertEquals(dollarNameAtPosition(l, l.indexOf("brake")), want); // mid segment
  assertEquals(dollarNameAtPosition(l, l.indexOf("pedal_position") + 3), want); // last segment
});

Deno.test("dollarNameAtPosition: spans the relative $.x form", () => {
  const l = "see $.pedal_position now";
  assertEquals(dollarNameAtPosition(l, l.indexOf("$")), "$.pedal_position");
  assertEquals(dollarNameAtPosition(l, l.indexOf("pedal")), "$.pedal_position");
});

Deno.test("dollarNameAtPosition: trims a trailing sentence period", () => {
  const l = "ends at $powertrain.brake.";
  assertEquals(
    dollarNameAtPosition(l, l.indexOf("brake")),
    "$powertrain.brake",
  );
});

Deno.test("dollarNameAtPosition: cursor on a dot separator returns undefined", () => {
  assertEquals(dollarNameAtPosition("$a.b", 2), undefined); // the '.'
});

Deno.test("dollarNameAtPosition: prose dotted path without $ is not a token", () => {
  assertEquals(dollarNameAtPosition("system.module.init", 8), undefined);
});

Deno.test("dollarNameAtPosition: $ breaks left-scan across prose dots", () => {
  const l = "path.to.$sig";
  assertEquals(dollarNameAtPosition(l, l.indexOf("sig")), "$sig");
});

Deno.test("dollarNameAtPosition: bare $. returns undefined", () => {
  assertEquals(dollarNameAtPosition("x $. y", 2), undefined); // on $
});

// ---------------------------------------------------------------------------
// formatTyplHoverContent
// ---------------------------------------------------------------------------

Deno.test("formatTyplHoverContent: returns undefined for unknown name", () => {
  const r = buildTypeRegistry([]);
  assertEquals(formatTyplHoverContent("$Unknown", r), undefined);
});

Deno.test("formatTyplHoverContent: shows kind, shape, and declaration", () => {
  const e = entry("REQ_0001", "a.md", {
    bindings: [binding("$Speed", "signal", {
      kind: "range",
      type: "float",
      min: 0,
      max: 300,
    })],
    typedefs: [],
  });
  const r = buildTypeRegistry([e]);
  const content = formatTyplHoverContent("$Speed", r);
  assertEquals(content?.includes("$Speed"), true);
  assertEquals(content?.includes("signal"), true);
  assertEquals(content?.includes("float[0..300]"), true);
  assertEquals(content?.includes("REQ_0001"), true);
  assertEquals(content?.includes("a.md"), true);
  // Entry-local names are not "Published".
  assertEquals(content?.includes("Published"), false);
});

Deno.test("formatTyplHoverContent: published symbol shows dotted path + declaring file", () => {
  const e = entry("ICD_BRK_0010", "icd.md", {
    rootNamespace: "powertrain.brake",
    bindings: [binding("$powertrain.brake.pedal_position", "signal", {
      kind: "range",
      type: "float",
      min: 0,
      max: 100,
    })],
    typedefs: [],
  });
  const r = buildTypeRegistry([e]);
  // Hovered from a DIFFERENT entry — cites, does not declare.
  const content = formatTyplHoverContent(
    "$powertrain.brake.pedal_position",
    r,
    { entryDisplayId: "SWE_0001" },
  );
  assertStringIncludes(content!, "$powertrain.brake.pedal_position");
  assertStringIncludes(content!, "Published");
  assertStringIncludes(content!, "float[0..100]");
  assertStringIncludes(content!, "Declared in:");
  assertStringIncludes(content!, "ICD_BRK_0010");
  assertStringIncludes(content!, "icd.md");
});

Deno.test("formatTyplHoverContent: published symbol from declaring entry says 'this entry'", () => {
  const e = entry("ICD_BRK_0010", "icd.md", {
    rootNamespace: "powertrain.brake",
    bindings: [binding("$powertrain.brake.pedal_position", "signal", {
      kind: "primitive",
      type: "float",
    })],
    typedefs: [],
  });
  const r = buildTypeRegistry([e]);
  const content = formatTyplHoverContent(
    "$powertrain.brake.pedal_position",
    r,
    { entryDisplayId: "ICD_BRK_0010" },
  );
  assertStringIncludes(content!, "this entry");
});

Deno.test("formatTyplHoverContent: relative ref resolves against entry root namespace", () => {
  const e = entry("ICD_BRK_0010", "icd.md", {
    rootNamespace: "powertrain.brake",
    bindings: [binding("$powertrain.brake.pedal_position", "signal", {
      kind: "range",
      type: "float",
      min: 0,
      max: 100,
    })],
    typedefs: [],
  });
  const r = buildTypeRegistry([e]);
  const content = formatTyplHoverContent("$.pedal_position", r, {
    entryDisplayId: "ICD_BRK_0010",
    rootNamespace: "powertrain.brake",
  });
  assertStringIncludes(content!, "$powertrain.brake.pedal_position");
  assertStringIncludes(content!, "float[0..100]");
  assertStringIncludes(content!, "Published");
});

Deno.test("formatTyplHoverContent: relative ref with no root namespace returns undefined", () => {
  const r = buildTypeRegistry([]);
  assertEquals(
    formatTyplHoverContent("$.pedal_position", r, { entryDisplayId: "X" }),
    undefined,
  );
});

Deno.test("formatTyplHoverContent: entry-local name in two entries has no collision framing", () => {
  const shape: Binding["shape"] = {
    kind: "range",
    type: "float",
    min: 0,
    max: 300,
  };
  const a = entry("REQ_0001", "a.md", {
    bindings: [binding("$Speed", "signal", shape)],
    typedefs: [],
  });
  const b = entry("REQ_0002", "b.md", {
    bindings: [binding("$Speed", "signal", shape)],
    typedefs: [],
  });
  const r = buildTypeRegistry([a, b]);
  const content = formatTyplHoverContent("$Speed", r);
  assertStringIncludes(content!, "independently");
  assertStringIncludes(content!, "REQ_0001");
  assertStringIncludes(content!, "REQ_0002");
  assertEquals(content!.includes("collision"), false);
  assertEquals(content!.includes("TYPL-003"), false);
});

// ---------------------------------------------------------------------------
// formatShape
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// buildDollarNameCompletions
// ---------------------------------------------------------------------------

Deno.test("buildDollarNameCompletions: one item per registered name", () => {
  const e = entry("REQ_0001", "a.md", {
    bindings: [
      binding("$Speed", "signal", { kind: "primitive", type: "float" }),
      binding("$Brake", "command"),
    ],
    typedefs: [],
  });
  const r = buildTypeRegistry([e]);
  const items = buildDollarNameCompletions(r);
  assertEquals(items.length, 2);
  const speed = items.find((i) => i.label === "$Speed");
  assertEquals(speed?.detail, "signal float");
});

Deno.test("buildDollarNameCompletions: relative mode offers $.tail scoped to root", () => {
  const e = entry("ICD_BRK_0010", "icd.md", {
    rootNamespace: "powertrain.brake",
    bindings: [
      binding("$powertrain.brake.pedal_position", "signal", {
        kind: "primitive",
        type: "float",
      }),
      binding("$powertrain.brake.line_pressure", "signal", {
        kind: "primitive",
        type: "float",
      }),
    ],
    typedefs: [],
  });
  const r = buildTypeRegistry([e]);
  const items = buildDollarNameCompletions(r, {
    rootNamespace: "powertrain.brake",
    relative: true,
  });
  assertEquals(
    items.map((i) => i.label).sort(),
    ["$.line_pressure", "$.pedal_position"],
  );
  const ped = items.find((i) => i.label === "$.pedal_position");
  assertStringIncludes(ped!.documentation, "$powertrain.brake.pedal_position");
});

Deno.test("buildDollarNameCompletions: relative mode with no root is empty", () => {
  const e = entry("ICD_BRK_0010", "icd.md", {
    bindings: [binding("$powertrain.brake.pedal_position", "signal")],
    typedefs: [],
  });
  const r = buildTypeRegistry([e]);
  assertEquals(buildDollarNameCompletions(r, { relative: true }).length, 0);
});

Deno.test("buildDollarNameCompletions: absolute mode adds relative shorthands", () => {
  const e = entry("ICD_BRK_0010", "icd.md", {
    rootNamespace: "powertrain.brake",
    bindings: [
      binding("$powertrain.brake.pedal_position", "signal", {
        kind: "primitive",
        type: "float",
      }),
    ],
    typedefs: [],
  });
  const r = buildTypeRegistry([e]);
  const labels = buildDollarNameCompletions(r, {
    rootNamespace: "powertrain.brake",
  }).map((i) => i.label);
  assertEquals(labels.includes("$powertrain.brake.pedal_position"), true); // absolute
  assertEquals(labels.includes("$.pedal_position"), true); // relative shorthand
});

// ---------------------------------------------------------------------------
// triggers
// ---------------------------------------------------------------------------

Deno.test("isDollarNameTrigger: triggers on $ and partial name", () => {
  assertEquals(isDollarNameTrigger("The $Sp"), true);
  assertEquals(isDollarNameTrigger("value $"), true);
  assertEquals(isDollarNameTrigger("$Speed"), true);
});

Deno.test("isDollarNameTrigger: fires on relative and dotted partials", () => {
  assertEquals(isDollarNameTrigger("see $."), true);
  assertEquals(isDollarNameTrigger("see $.ped"), true);
  assertEquals(isDollarNameTrigger("see $a.b"), true);
});

Deno.test("isDollarNameTrigger: does not trigger on non-$ context", () => {
  assertEquals(isDollarNameTrigger("Speed"), false);
  assertEquals(isDollarNameTrigger("Satisfies: "), false);
});

Deno.test("isRelativeDollarTrigger: only for $.-led partials", () => {
  assertEquals(isRelativeDollarTrigger("see $."), true);
  assertEquals(isRelativeDollarTrigger("see $.ped"), true);
  assertEquals(isRelativeDollarTrigger("see $Sp"), false);
  assertEquals(isRelativeDollarTrigger("value $"), false);
});
