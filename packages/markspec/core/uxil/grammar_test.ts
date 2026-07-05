import { assertEquals, assertStringIncludes } from "@std/assert";
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
  const withScheme = parseUxRef("ux:media.home@ready/play:{id}!activate");
  const wire = parseUxRef("media.home@ready/play:{id}!activate");
  assertEquals(wire.diagnostics, []);
  assertEquals(withScheme.diagnostics, []);
  assertEquals(withScheme.ref?.hasScheme, true);
  assertEquals(wire.ref?.hasScheme, false);
  // Every other field is byte-identical — normalize hasScheme and deep-compare
  // the full node so a regression in surface/state/element/key/verb cannot pass
  // silently.
  assertEquals({ ...wire.ref, hasScheme: true }, withScheme.ref);
});

Deno.test("parseUxRef: reserved authority is UXIL-003", () => {
  const { diagnostics } = parseUxRef("ux://app/media.home");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-003"]);
});

Deno.test("parseUxRef: reserved query char is exactly one UXIL-002", () => {
  // #780 case 3: the lexer drops the reserved char and orphans the trailing
  // token — the orphan must not surface as a spurious UXIL-001.
  const { diagnostics } = parseUxRef("media.home?x");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-002"]);
});

Deno.test("parseRootDecl: reserved char is exactly one UXIL-002", () => {
  // #796 review: the reserved-char scan poisons the token stream (the lexer
  // drops the char), so downstream structure checks (here: missing kind)
  // must not fire on the mangled tokens.
  const { diagnostics } = parseRootDecl("media.home?x");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-002"]);
});

Deno.test("parseElementBullet: reserved char in the struct part is exactly one UXIL-002", () => {
  // #796 review: after the lexer drops '?', the orphaned 'x' must not turn
  // into a contradictory "expected ':' before the verb set" (a ':' IS there).
  const { diagnostics } = parseElementBullet("`/play?x : activate` — Press.");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-002"]);
});

Deno.test("parseUxRef: doubled dot is exactly one UXIL-008", () => {
  // #780 case 3: the specific surface error must not be followed by a
  // spurious UXIL-001 for the tokens after the bad dot.
  const { diagnostics } = parseUxRef("media..home");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-008"]);
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

Deno.test("parseRootDecl: missing kind is UXIL-004 with a partial decl", () => {
  // #780 case 5: a surface is present, so per the parser contract a
  // best-effort decl (kind empty) is returned alongside the diagnostic.
  const { decl, diagnostics } = parseRootDecl("ux:media.home");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-004"]);
  assertEquals(decl?.surface, ["media", "home"]);
  assertEquals(decl?.kind, "");
});

Deno.test("parseRootDecl: dangling colon (no kind) is also UXIL-004 + partial decl", () => {
  // #780 case 5: this adjacent input previously reported UXIL-001 with a
  // different return shape than the no-colon form. Both missing-kind cases
  // must emit the same code and the same partial-decl shape.
  const { decl, diagnostics } = parseRootDecl("ux:media.home :");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-004"]);
  assertEquals(decl?.surface, ["media", "home"]);
  assertEquals(decl?.kind, "");
});

Deno.test("parseRootDecl: missing kind still captures the state set", () => {
  // Best-effort AST: mid-edit (kind deleted, states intact) the surface and
  // states survive so editor tooling degrades gracefully.
  const { decl, diagnostics } = parseRootDecl("ux:media.home : @ ready");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-004"]);
  assertEquals(decl?.kind, "");
  assertEquals(decl?.states, ["ready"]);
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

Deno.test("parseElementBullet: key-template clause, state set, nav target", () => {
  const { decl, diagnostics } = parseElementBullet(
    "`/track : activate, focus : {id} @enabled -> media.player` — Selects a track.",
  );
  assertEquals(diagnostics, []);
  assertEquals(decl?.keyTemplate, { kind: "template", name: "id" });
  assertEquals(decl?.verbs, ["activate", "focus"]);
  assertEquals(decl?.states, ["enabled"]);
  assertEquals(decl?.nav?.surface, ["media", "player"]);
  assertEquals(decl?.nav?.hasScheme, false);
});

Deno.test("parseElementBullet: key-template clause after the verb set (design-doc form)", () => {
  const { decl, diagnostics } = parseElementBullet(
    "`/favorite_toggle : toggle : {track_id}` — marks a track favourite.",
  );
  assertEquals(diagnostics, []);
  assertEquals(decl?.element, "favorite_toggle");
  assertEquals(decl?.verbs, ["toggle"]);
  assertEquals(decl?.keyTemplate, { kind: "template", name: "track_id" });
});

Deno.test("parseElementBullet: braces glued to the element name are rejected (#786)", () => {
  const { decl, diagnostics } = parseElementBullet(
    "`/track{id} : activate` — Selects a track.",
  );
  // One targeted UXIL-007 pointing at the moved key clause — not a
  // misleading empty-verb-set (UXIL-005) / unexpected-token cascade.
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-007"]);
  assertEquals(decl?.verbs, ["activate"]);
  assertEquals(decl?.keyTemplate, undefined);
});

Deno.test("parseElementBullet: concrete key in a declaration is UXIL-007", () => {
  const { decl, diagnostics } = parseElementBullet(
    "`/track : activate : trackid` — Selects a track.",
  );
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-007"]);
  assertEquals(decl?.keyTemplate, undefined);
});

Deno.test("parseElementBullet: key clause with no key is UXIL-001", () => {
  const { diagnostics } = parseElementBullet(
    "`/track : activate :` — Selects a track.",
  );
  assertEquals(diagnostics.some((d) => d.code === "UXIL-001"), true);
});

Deno.test("parseElementBullet: missing event dictionary is UXIL-006", () => {
  const { diagnostics } = parseElementBullet("`/play : activate`");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-006"]);
});

Deno.test("parseElementBullet: empty verb set is exactly one UXIL-005", () => {
  // #780 case 1: expectIdent previously added a redundant UXIL-001 for the
  // same empty verb set.
  const { diagnostics } = parseElementBullet("`/play :` — no verb.");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-005"]);
});

Deno.test("parseElementBullet: missing ':' with verb present is a single UXIL-001", () => {
  // #780 case 4: a verb IS present, so 'empty verb set' (UXIL-005) would be
  // contradictory — the real defect is the omitted ':'.
  const { decl, diagnostics } = parseElementBullet(
    "`/play activate` — Pressing play.",
  );
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-001"]);
  assertStringIncludes(
    diagnostics[0].message,
    "expected ':' before the verb set",
  );
  assertEquals(decl?.verbs, []);
});

Deno.test("parseElementBullet: reserved char in the nav target is reported once, span-relative", () => {
  // #780 case 2: the span-level scan and parseUxRef(navSource) both scanned
  // the nav tail, double-reporting a single reserved char. The surviving
  // diagnostic's column must stay span-relative (#796 review): the '?' sits
  // at span column 31, not at column 11 of the sliced nav source.
  const { diagnostics } = parseElementBullet(
    "`/play : activate -> media.home?x` — Goes home.",
  );
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-002"]);
  assertEquals(diagnostics[0].position.column, 31);
});

Deno.test("parseElementBullet: reserved char in the nav survives a malformed struct part", () => {
  // #796 review: the struct-part early return must still scan the peeled nav
  // tail — otherwise the '?' is reported by neither scan (the pre-#780 full-
  // span scan covered it). Struct error and nav reserved char are orthogonal
  // regions, so both report.
  const { diagnostics } = parseElementBullet(
    "`foo -> media.home?x` — Goes home.",
  );
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-001", "UXIL-002"]);
});

Deno.test("parseElementBullet: leftover token and missing dictionary co-report", () => {
  // Pins the load-bearing order in parseElementBullet (#796 review):
  // expectEof runs BEFORE the UXIL-006 event-dictionary check, so a real
  // leftover-token error is never suppressed by the (orthogonal) missing-
  // dictionary diagnostic.
  const { diagnostics } = parseElementBullet("`/play : activate junk`");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-001", "UXIL-006"]);
});

Deno.test("parseElementBullet: preserves a leading hyphen in the event dictionary", () => {
  const { decl, diagnostics } = parseElementBullet(
    "`/vol : set` -5 dB is the floor",
  );
  assertEquals(diagnostics, []);
  assertEquals(decl?.eventDictionary, "-5 dB is the floor");
});
