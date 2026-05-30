/**
 * @module compiler/constants
 *
 * Shared constants for the compiler pipeline.
 */

import { CORE_RELATIONS } from "../model/mod.ts";
import type { LinkKind } from "../model/mod.ts";

/**
 * Attribute keys that produce traceability links per ADR-002.
 *
 * Spec attributes: Satisfies, Derived-from, References, Allocated-to.
 * Test attributes: Verifies, Tests.
 * Element attributes: Realizes, Depends-on, Part-of, Generated-from, Provides, Requires.
 * Universal: Supersedes (same-family).
 */
export const ATTR_TO_LINK_KIND: Readonly<Record<string, LinkKind>> = Object
  .fromEntries(
    CORE_RELATIONS.filter((r) => r.linkKind).map((r) => [r.attr, r.linkKind!]),
  );
