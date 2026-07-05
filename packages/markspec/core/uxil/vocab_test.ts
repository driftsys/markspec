import { assert, assertEquals, assertFalse } from "@std/assert";
import { isKnownKind, isKnownVerb, UX_KINDS, UX_VERBS } from "./vocab.ts";

Deno.test("UX_KINDS: three closed kinds with flags", () => {
  assertEquals([...UX_KINDS.keys()].sort(), ["agent", "panel", "screen"]);
  assertEquals(UX_KINDS.get("screen"), {
    navigable: true,
    stateful: true,
    visual: true,
  });
  assertEquals(UX_KINDS.get("panel"), {
    navigable: false,
    stateful: false,
    visual: true,
  });
  assertEquals(UX_KINDS.get("agent"), {
    navigable: false,
    stateful: true,
    visual: false,
  });
});

Deno.test("UX_VERBS: eleven closed verbs; navigate requires a target", () => {
  assertEquals(UX_VERBS.size, 11);
  assert(UX_VERBS.get("navigate")?.requiresNavTarget);
  assertFalse(UX_VERBS.get("activate")?.requiresNavTarget);
  assert(UX_VERBS.get("observe")?.exclusive);
  assertFalse(UX_VERBS.get("toggle")?.exclusive);
});

Deno.test("isKnownKind / isKnownVerb", () => {
  assert(isKnownKind("agent"));
  assertFalse(isKnownKind("dialog"));
  assert(isKnownVerb("ask"));
  assertFalse(isKnownVerb("longpress"));
});
