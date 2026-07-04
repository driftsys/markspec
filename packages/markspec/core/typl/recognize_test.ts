import { assertEquals } from "@std/assert";
import { isTyplDeclarationText } from "./recognize.ts";

Deno.test("recognize: dotted and relative bindings", () => {
  assertEquals(isTyplDeclarationText("$powertrain.brake : namespace"), true);
  assertEquals(
    isTyplDeclarationText("$.pedal_position : signal float[0..100]"),
    true,
  );
  assertEquals(isTyplDeclarationText("$Speed : signal"), true); // unchanged
  assertEquals(isTyplDeclarationText("$powertrain.brake"), false); // citation, not decl
  assertEquals(isTyplDeclarationText("prose text"), false);
});
