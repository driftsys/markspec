import { assertEquals } from "@std/assert";
import {
  classifyUxilForm,
  parseChildSurfaceDecl,
  parseElementBullet,
  parseRootDecl,
  parseUxRef,
} from "./mod.ts";

// Acceptance 1: grammar parses/round-trips all four forms + refs.
Deno.test("acceptance: all four forms parse through the public surface", () => {
  const root = parseRootDecl("ux:media.home : screen @ loading, error, ready");
  assertEquals(root.diagnostics, []);
  assertEquals(root.decl?.form, "root");

  const element = parseElementBullet("`/play : activate` — Resumes playback.");
  assertEquals(element.diagnostics, []);
  assertEquals(element.decl?.form, "element");

  const child = parseChildSurfaceDecl(".confirm_dialog @ default");
  assertEquals(child.diagnostics, []);
  assertEquals(child.decl?.form, "child");

  const ref = parseUxRef("ux:media.home/play:{id}!activate");
  assertEquals(ref.diagnostics, []);
  assertEquals(ref.ref?.element, "play");

  assertEquals(classifyUxilForm("/play : activate"), "element");
});

// Acceptance 2: scheme-less relative form parses identically (wire-compat).
Deno.test("acceptance: scheme-less wire form is byte-compatible", () => {
  const scheme = parseUxRef("ux:media.home/play");
  const wire = parseUxRef("media.home/play");
  assertEquals(scheme.diagnostics, []);
  assertEquals(wire.diagnostics, []);
  assertEquals(scheme.ref?.surface, wire.ref?.surface);
  assertEquals(scheme.ref?.element, wire.ref?.element);
  assertEquals(scheme.ref?.hasScheme, true);
  assertEquals(wire.ref?.hasScheme, false);
});

// Acceptance 3: parse errors are structured (feed S9).
Deno.test("acceptance: parse errors carry code + position", () => {
  const { diagnostics } = parseElementBullet("`/play : activate`");
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "UXIL-006");
  assertEquals(typeof diagnostics[0].position.line, "number");
  assertEquals(typeof diagnostics[0].position.column, "number");
});
