/**
 * @module core/validator/type_resolution_test
 *
 * Unit tests for {@linkcode explicitType} and {@linkcode resolvedCoreType}.
 * These focus on edge cases (empty values, whitespace) that are hard to
 * exercise via the e2e validator suite because the parser drops
 * malformed trailer lines upstream.
 */

import { assertEquals } from "@std/assert";
import { explicitType, resolvedCoreType } from "./type_resolution.ts";
import type { Entry } from "../model/mod.ts";

const ULID = "01HGW2Q8MNP3RSTVWXYZABCDEF";

function makeEntry(opts: {
  attrs: Array<{ key: string; value: string }>;
  type?: string;
  shape?: "identified" | "referenced";
  id?: string;
}): Entry {
  return {
    displayId: "TEST-001",
    title: "Test entry",
    body: "Body.",
    rawAttributes: opts.attrs,
    typedAttributes: new Map(),
    id: opts.id ?? ULID,
    type: opts.type,
    shape: opts.shape ?? "identified",
    location: { file: "test.md", line: 1, column: 1 },
    source: "markdown",
  };
}

Deno.test("explicitType: returns the trimmed value for a non-empty Type:", () => {
  const entry = makeEntry({
    attrs: [
      { key: "Id", value: ULID },
      { key: "Type", value: "  Requirement  " },
    ],
  });
  assertEquals(explicitType(entry), "Requirement");
});

Deno.test("explicitType: returns undefined when Type: attribute is absent", () => {
  const entry = makeEntry({ attrs: [{ key: "Id", value: ULID }] });
  assertEquals(explicitType(entry), undefined);
});

Deno.test("explicitType: returns undefined for an empty Type: value", () => {
  const entry = makeEntry({
    attrs: [
      { key: "Id", value: ULID },
      { key: "Type", value: "" },
    ],
  });
  assertEquals(explicitType(entry), undefined);
});

Deno.test("explicitType: returns undefined for a whitespace-only Type: value", () => {
  const entry = makeEntry({
    attrs: [
      { key: "Id", value: ULID },
      { key: "Type", value: "   " },
    ],
  });
  assertEquals(explicitType(entry), undefined);
});

Deno.test("resolvedCoreType: prefers explicit Type: when valid", () => {
  const entry = makeEntry({
    attrs: [
      { key: "Id", value: ULID },
      { key: "Type", value: "Requirement" },
    ],
    type: "SoftwareUnit",
  });
  assertEquals(resolvedCoreType(entry), "Requirement");
});

Deno.test("resolvedCoreType: falls back to entry.type when explicit Type absent", () => {
  const entry = makeEntry({
    attrs: [{ key: "Id", value: ULID }],
    type: "SoftwareUnit",
  });
  assertEquals(resolvedCoreType(entry), "SoftwareUnit");
});

Deno.test("resolvedCoreType: infers from URI scheme for Reference shape with no explicit Type", () => {
  const entry = makeEntry({
    attrs: [{ key: "Id", value: "pkg:cargo/serde@1.0.0" }],
    shape: "referenced",
    id: "pkg:cargo/serde@1.0.0",
  });
  assertEquals(resolvedCoreType(entry), "SoftwareComponent");
});

Deno.test("resolvedCoreType: returns undefined when no source resolves to a core type", () => {
  const entry = makeEntry({
    attrs: [{ key: "Id", value: ULID }],
  });
  assertEquals(resolvedCoreType(entry), undefined);
});
