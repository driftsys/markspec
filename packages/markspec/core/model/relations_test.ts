import { assertEquals } from "@std/assert";
import { CORE_RELATIONS, LOCK_EXTRA_INVERSE_KEYS } from "./relations.ts";

const EXPECTED_ATTR_TO_LINK_KIND: Record<string, string> = {
  "Satisfies": "satisfies",
  "Derived-from": "derived-from",
  "References": "references",
  "Allocated-to": "allocated-to",
  "Realizes": "realizes",
  "Verifies": "verifies",
  "Tests": "tests",
  "Depends-on": "depends-on",
  "Part-of": "part-of",
  "Generated-from": "generated-from",
  "Supersedes": "supersedes",
  "Provides": "provides",
  "Requires": "requires",
};

const EXPECTED_KNOWN_LINK_KINDS = new Set([
  "satisfies",
  "derived-from",
  "references",
  "allocated-to",
  "realizes",
  "verifies",
  "tests",
  "depends-on",
  "part-of",
  "generated-from",
  "supersedes",
  "provides",
  "requires",
]);

const EXPECTED_TRACE_RULES: Record<string, string[]> = {
  "Satisfies": ["Specification"],
  "Derived-from": ["Specification"],
  "Allocated-to": ["Component"],
  "Verifies": ["Contract", "Requirement"],
  "Tests": ["Component", "Contract", "Unit"],
  "Realizes": ["Specification"],
  "Provides": ["Contract"],
  "Requires": ["Contract"],
  "Depends-on": ["Component", "Unit"],
  "Part-of": ["Component"],
  "Mitigated-by": ["Specification"],
  "Affects": ["Component", "Contract", "Unit"],
};

const EXPECTED_LOCK_TRACE_KEYS = new Set([
  "Satisfies",
  "Derived-from",
  "Verified-by",
  "References",
  "Tests",
  "Depends-on",
  "Part-of",
  "Allocated-to",
  "Realizes",
  "Provides",
  "Requires",
  "Generated-from",
  "Supersedes",
]);

Deno.test("registry projects ATTR_TO_LINK_KIND identically", () => {
  const derived: Record<string, string> = {};
  for (const r of CORE_RELATIONS) {
    if (r.linkKind) derived[r.attr] = r.linkKind;
  }
  assertEquals(derived, EXPECTED_ATTR_TO_LINK_KIND);
});

Deno.test("registry projects KNOWN_LINK_KINDS identically", () => {
  const derived = new Set(
    CORE_RELATIONS.filter((r) => r.linkKind).map((r) => r.linkKind!),
  );
  assertEquals(derived, EXPECTED_KNOWN_LINK_KINDS);
});

Deno.test("registry projects TRACE_RULES identically", () => {
  const derived: Record<string, string[]> = {};
  for (const r of CORE_RELATIONS) {
    if (r.targetTypes) derived[r.attr] = [...r.targetTypes].sort();
  }
  assertEquals(derived, EXPECTED_TRACE_RULES);
});

Deno.test("registry projects lock TRACE_KEYS identically", () => {
  const derived = new Set([
    ...CORE_RELATIONS.filter((r) => r.lockEdge).map((r) => r.attr),
    ...LOCK_EXTRA_INVERSE_KEYS,
  ]);
  assertEquals(derived, EXPECTED_LOCK_TRACE_KEYS);
});
