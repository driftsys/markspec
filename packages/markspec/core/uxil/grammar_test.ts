import { assertEquals } from "@std/assert";
import {
  parseChildSurfaceDecl,
  parseElementBullet,
  parseRootDecl,
  parseUxRef,
} from "./grammar.ts";

Deno.test("parseUxRef: full ref with scheme, state, element, key, verb", () => {
  const { ref, diagnostics } = parseUxRef(
    "ux:media.home@ready/play:{id}!activate",
  );
  assertEquals(diagnostics, []);
  assertEquals(ref?.hasScheme, true);
  assertEquals(ref?.surface, ["media", "home"]);
  assertEquals(ref?.state, "ready");
  assertEquals(ref?.element, "play");
  assertEquals(ref?.key, { kind: "template", name: "id" });
  assertEquals(ref?.verb, "activate");
});

Deno.test("parseUxRef: scheme-less wire form parses identically (wire-compat)", () => {
  const withScheme = parseUxRef("ux:media.home/play");
  const wire = parseUxRef("media.home/play");
  assertEquals(wire.diagnostics, []);
  assertEquals(withScheme.diagnostics, []);
  // Identical modulo hasScheme.
  assertEquals(wire.ref?.surface, withScheme.ref?.surface);
  assertEquals(wire.ref?.element, withScheme.ref?.element);
  assertEquals(withScheme.ref?.hasScheme, true);
  assertEquals(wire.ref?.hasScheme, false);
});

Deno.test("parseUxRef: reserved authority is UXIL-003", () => {
  const { diagnostics } = parseUxRef("ux://app/media.home");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-003"]);
});

Deno.test("parseUxRef: reserved query char is UXIL-002", () => {
  const { diagnostics } = parseUxRef("media.home?x");
  assertEquals(diagnostics.some((d) => d.code === "UXIL-002"), true);
});

Deno.test("parseRootDecl: surface, kind, state set", () => {
  const { decl, diagnostics } = parseRootDecl(
    "ux:media.home : screen @ loading, error, ready",
  );
  assertEquals(diagnostics, []);
  assertEquals(decl?.form, "root");
  assertEquals(decl?.surface, ["media", "home"]);
  assertEquals(decl?.kind, "screen");
  assertEquals(decl?.states, ["loading", "error", "ready"]);
});

Deno.test("parseRootDecl: missing kind is UXIL-004", () => {
  const { diagnostics } = parseRootDecl("ux:media.home");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-004"]);
});

Deno.test("parseChildSurfaceDecl: dotted leading path + state", () => {
  const { decl, diagnostics } = parseChildSurfaceDecl(
    ".confirm_dialog @ default",
  );
  assertEquals(diagnostics, []);
  assertEquals(decl?.form, "child");
  assertEquals(decl?.path, ["confirm_dialog"]);
  assertEquals(decl?.states, ["default"]);
});

Deno.test("parseChildSurfaceDecl: without a leading dot is UXIL-008", () => {
  const { diagnostics } = parseChildSurfaceDecl("confirm_dialog");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-008"]);
});

Deno.test("parseElementBullet: verb + event dictionary", () => {
  const { decl, diagnostics } = parseElementBullet(
    "`/play : activate` — Pressing play resumes playback.",
  );
  assertEquals(diagnostics, []);
  assertEquals(decl?.form, "element");
  assertEquals(decl?.element, "play");
  assertEquals(decl?.verbs, ["activate"]);
  assertEquals(decl?.eventDictionary, "Pressing play resumes playback.");
});

Deno.test("parseElementBullet: key template, state set, nav target", () => {
  const { decl, diagnostics } = parseElementBullet(
    "`/track{id} : activate, focus @enabled -> media.player` — Selects a track.",
  );
  assertEquals(diagnostics, []);
  assertEquals(decl?.keyTemplate, { kind: "template", name: "id" });
  assertEquals(decl?.verbs, ["activate", "focus"]);
  assertEquals(decl?.states, ["enabled"]);
  assertEquals(decl?.nav?.surface, ["media", "player"]);
  assertEquals(decl?.nav?.hasScheme, false);
});

Deno.test("parseElementBullet: missing event dictionary is UXIL-006", () => {
  const { diagnostics } = parseElementBullet("`/play : activate`");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-006"]);
});

Deno.test("parseElementBullet: empty verb set is UXIL-005", () => {
  const { diagnostics } = parseElementBullet("`/play :` — no verb.");
  assertEquals(diagnostics.some((d) => d.code === "UXIL-005"), true);
});
