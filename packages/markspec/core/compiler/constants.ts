/**
 * @module compiler/constants
 *
 * Shared constants for the compiler pipeline.
 */

import type { LinkKind } from "../model/mod.ts";

/**
 * Attribute keys that produce traceability links per ADR-002.
 *
 * Spec attributes: Satisfies, Derived-from, References, Allocated-to.
 * Test attributes: Verifies, Tests.
 * Element attributes: Realizes, Depends-on, Part-of, Generated-from.
 * Universal: Supersedes (same-family).
 */
export const ATTR_TO_LINK_KIND: Readonly<Record<string, LinkKind>> = {
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
};
