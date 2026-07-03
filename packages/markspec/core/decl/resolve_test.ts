/**
 * @module core/decl/resolve_test
 *
 * Unit tests for the DSL-agnostic base-resolution engine — one test per
 * normative rule from #722. Fixtures use a toy DSL: an absolute ref starts
 * with `abs:`, and `join` combines base + `/` + ref. Neither typl nor uxil
 * vocabulary appears, proving the engine carries no DSL knowledge.
 */

import { assertEquals } from "@std/assert";
import {
  type BaseScope,
  checkSingleRoot,
  type RefOps,
  resolveRef,
} from "./resolve.ts";

const OPS: RefOps = {
  isAbsolute: (ref) => ref.startsWith("abs:"),
  join: (base, ref) => `${base}/${ref}`,
};

// --- resolveRef ------------------------------------------------------------

Deno.test("resolveRef: absolute ref passes through unchanged (no base needed)", () => {
  // Absolute even when no scope carries a base.
  assertEquals(resolveRef("abs:home", undefined, OPS), {
    ok: true,
    ref: "abs:home",
  });
  // Absolute even when a base IS in scope — it is not applied.
  const scope: BaseScope = { base: "root" };
  assertEquals(resolveRef("abs:home", scope, OPS), {
    ok: true,
    ref: "abs:home",
  });
});

Deno.test("resolveRef: relative ref joins the innermost base", () => {
  const scope: BaseScope = { base: "root" };
  assertEquals(resolveRef("leaf", scope, OPS), { ok: true, ref: "root/leaf" });
});

Deno.test("resolveRef: innermost base wins over an outer base (single join, not cumulative)", () => {
  const scope: BaseScope = { base: "inner", parent: { base: "outer" } };
  // Only the innermost base is applied, exactly once — not "outer/inner/x".
  assertEquals(resolveRef("x", scope, OPS), { ok: true, ref: "inner/x" });
});

Deno.test("resolveRef: skips base-less scopes, uses the nearest ancestor that has one", () => {
  const scope: BaseScope = {
    // innermost: a structural container with no base of its own
    parent: { parent: { base: "grandparent" } },
  };
  assertEquals(resolveRef("x", scope, OPS), {
    ok: true,
    ref: "grandparent/x",
  });
});

Deno.test("resolveRef: relative ref with no base in scope → error", () => {
  // A chain of base-less scopes, and the undefined-scope case.
  const scope: BaseScope = { parent: {} };
  assertEquals(resolveRef("x", scope, OPS), {
    ok: false,
    reason: "no-base-in-scope",
  });
  assertEquals(resolveRef("x", undefined, OPS), {
    ok: false,
    reason: "no-base-in-scope",
  });
});

Deno.test("resolveRef: structural not sequential — siblings do not share bases, order is irrelevant", () => {
  // Two sibling scopes under a base-less root. Sibling A declares a base;
  // sibling B declares none. Resolving in B must NOT see A's base — the
  // engine only follows `parent`, never siblings (rule 4).
  const root: BaseScope = {};
  const siblingA: BaseScope = { base: "a", parent: root };
  const siblingB: BaseScope = { parent: root };

  assertEquals(resolveRef("x", siblingA, OPS), { ok: true, ref: "a/x" });
  assertEquals(resolveRef("x", siblingB, OPS), {
    ok: false,
    reason: "no-base-in-scope",
  });
  // Declaring a second sibling C after B — and in any order — cannot change
  // B's resolution, because the engine never reaches a sibling.
  const _siblingC: BaseScope = { base: "c", parent: root };
  assertEquals(resolveRef("x", siblingB, OPS), {
    ok: false,
    reason: "no-base-in-scope",
  });
});

// --- checkSingleRoot -------------------------------------------------------

Deno.test("checkSingleRoot: exactly one root → ok with that root", () => {
  assertEquals(checkSingleRoot(["only"]), { ok: true, root: "only" });
});

Deno.test("checkSingleRoot: zero roots → no-root", () => {
  assertEquals(checkSingleRoot([]), {
    ok: false,
    reason: "no-root",
    roots: [],
  });
});

Deno.test("checkSingleRoot: multiple roots → multiple-roots with the offending set", () => {
  assertEquals(checkSingleRoot(["a", "b"]), {
    ok: false,
    reason: "multiple-roots",
    roots: ["a", "b"],
  });
});
