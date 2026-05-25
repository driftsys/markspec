import { assertEquals } from "@std/assert";
import type { Shape } from "./ast.ts";

Deno.test("Shape: exhaustive discriminated-union switch", () => {
  function describe(s: Shape): string {
    switch (s.kind) {
      case "primitive":
        return s.type;
      case "range":
        return `${s.type} range`;
      case "length":
        return `${s.type} length`;
      case "pattern":
        return `pattern /${s.regex}/${s.flags ?? ""}`;
      case "array":
        return "array";
      case "enum":
        return `enum(${s.values.length})`;
      case "record":
        return `record(${Object.keys(s.fields).length})`;
      case "literal":
        return `literal ${String(s.value)}`;
      case "ref":
        return `ref ${s.name}`;
      case "optional":
        return "optional";
    }
  }
  const sample: Shape = { kind: "primitive", type: "int" };
  assertEquals(describe(sample), "int");
});
