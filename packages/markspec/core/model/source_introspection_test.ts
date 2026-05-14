/**
 * @module core/model/source_introspection_test
 *
 * Unit tests for {@linkcode inferTypeFromSource} — the spec §1.3.1
 * step 3 `Source:` introspection pattern matcher.
 */

import { assertEquals } from "@std/assert";
import { inferTypeFromSource } from "./source_introspection.ts";

// SoftwareComponent — build manifests
Deno.test("inferTypeFromSource: Cargo.toml → SoftwareComponent", () => {
  assertEquals(
    inferTypeFromSource("crates/foo/Cargo.toml"),
    "SoftwareComponent",
  );
});

Deno.test("inferTypeFromSource: package.json → SoftwareComponent", () => {
  assertEquals(inferTypeFromSource("ui/package.json"), "SoftwareComponent");
});

Deno.test("inferTypeFromSource: deno.json → SoftwareComponent", () => {
  assertEquals(inferTypeFromSource("deno.json"), "SoftwareComponent");
});

Deno.test("inferTypeFromSource: .csproj → SoftwareComponent", () => {
  assertEquals(
    inferTypeFromSource("src/MyService/MyService.csproj"),
    "SoftwareComponent",
  );
});

// SoftwareUnit — source-code files
Deno.test("inferTypeFromSource: .rs → SoftwareUnit", () => {
  assertEquals(
    inferTypeFromSource("src/braking/controller.rs"),
    "SoftwareUnit",
  );
});

Deno.test("inferTypeFromSource: .kt → SoftwareUnit", () => {
  assertEquals(
    inferTypeFromSource("app/src/main/kotlin/Foo.kt"),
    "SoftwareUnit",
  );
});

Deno.test("inferTypeFromSource: .py → SoftwareUnit", () => {
  assertEquals(inferTypeFromSource("foo/bar.py"), "SoftwareUnit");
});

// SoftwareInterface — interface description files
Deno.test("inferTypeFromSource: .proto → SoftwareInterface", () => {
  assertEquals(
    inferTypeFromSource("schemas/braking.proto"),
    "SoftwareInterface",
  );
});

Deno.test("inferTypeFromSource: .openapi.yaml → SoftwareInterface", () => {
  assertEquals(
    inferTypeFromSource("api/braking.openapi.yaml"),
    "SoftwareInterface",
  );
});

Deno.test("inferTypeFromSource: .arxml → SoftwareInterface", () => {
  assertEquals(
    inferTypeFromSource("vendor/BrakingPort.arxml"),
    "SoftwareInterface",
  );
});

// HardwareInterface — bus description files
Deno.test("inferTypeFromSource: .dbc → HardwareInterface", () => {
  assertEquals(
    inferTypeFromSource("vehicle/powertrain.dbc"),
    "HardwareInterface",
  );
});

Deno.test("inferTypeFromSource: .ldf → HardwareInterface", () => {
  assertEquals(inferTypeFromSource("body/cabin.ldf"), "HardwareInterface");
});

// Edge cases
Deno.test("inferTypeFromSource: leading/trailing whitespace ignored", () => {
  assertEquals(
    inferTypeFromSource("   src/foo.rs\n"),
    "SoftwareUnit",
  );
});

Deno.test("inferTypeFromSource: extensionless path → undefined", () => {
  assertEquals(inferTypeFromSource("src/braking/controller"), undefined);
});

Deno.test("inferTypeFromSource: unknown extension → undefined", () => {
  assertEquals(inferTypeFromSource("docs/notes.txt"), undefined);
});

Deno.test("inferTypeFromSource: empty string → undefined", () => {
  assertEquals(inferTypeFromSource(""), undefined);
});

Deno.test("inferTypeFromSource: openapi.yaml beats .yaml (interface beats source-code)", () => {
  // Confirms the rule ordering: a `.openapi.yaml` file is treated as
  // an interface description, not an arbitrary YAML source file
  // (which wouldn't match any rule anyway, but the test pins the
  // intended precedence).
  assertEquals(
    inferTypeFromSource("api/svc.openapi.yaml"),
    "SoftwareInterface",
  );
});
