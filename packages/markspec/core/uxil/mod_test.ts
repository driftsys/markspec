import { assert, assertEquals } from "@std/assert";
import {
  buildUxRegistry,
  classifyUxilForm,
  parseChildSurfaceDecl,
  parseElementBullet,
  parseRootDecl,
  parseUxRef,
  projectUxRegistry,
  UX_VERBS,
  validateUxil,
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
  const scheme = parseUxRef("ux:media.home@ready/play:{id}!activate");
  const wire = parseUxRef("media.home@ready/play:{id}!activate");
  assertEquals(scheme.diagnostics, []);
  assertEquals(wire.diagnostics, []);
  assertEquals(scheme.ref?.hasScheme, true);
  assertEquals(wire.ref?.hasScheme, false);
  // Full structural equality modulo hasScheme (surface, state, element, key, verb).
  assertEquals(scheme.ref, { ...wire.ref, hasScheme: true });
});

// Acceptance 3: parse errors are structured (feed S9).
Deno.test("acceptance: parse errors carry code + position", () => {
  const { diagnostics } = parseElementBullet("`/play : activate`");
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "UXIL-006");
  assertEquals(typeof diagnostics[0].position.line, "number");
  assertEquals(typeof diagnostics[0].position.column, "number");
});

Deno.test("mod.ts re-exports the S8 compiler surface", () => {
  assert(typeof buildUxRegistry === "function");
  assert(typeof validateUxil === "function");
  assert(typeof projectUxRegistry === "function");
  assert(UX_VERBS.size === 11);
});
