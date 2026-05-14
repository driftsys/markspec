/**
 * @module core/validator/types_unit_test
 *
 * Unit tests for type-resolution helpers in validator/types.ts. These
 * cover paths that are hard or noisy to exercise via the e2e validate
 * suite (e.g., entries with profile-classified `entry.type` set
 * directly).
 */

import { assertEquals } from "@std/assert";
import { inferTypeFromDisplayIdShape } from "./types.ts";
import type { Entry } from "../model/mod.ts";

const ULID = "01HGW2Q8MNP3RSTVWXYZABCDEF";

function authoredEntry(opts: {
  displayId: string;
  type?: string;
  rawAttributes?: Array<{ key: string; value: string }>;
}): Entry {
  return {
    displayId: opts.displayId,
    title: "Test entry",
    body: "Body.",
    rawAttributes: opts.rawAttributes ?? [{ key: "Id", value: ULID }],
    typedAttributes: new Map(),
    id: ULID,
    type: opts.type,
    shape: "identified",
    location: { file: "test.md", line: 1, column: 1 },
    source: "markdown",
  };
}

// Regression — B1: when entry.type is already resolved (e.g., by profile
// classification), the display-ID-shape inference must NOT fire MSL-T021.
// The "infer Unit" warning only makes sense when no type signal at all
// has resolved the entry.
Deno.test("inferTypeFromDisplayIdShape: skipped when entry.type set even if display ID contains ::", () => {
  const entry = authoredEntry({
    displayId: "braking::controller::debounce",
    type: "SoftwareUnit",
  });
  const diags = inferTypeFromDisplayIdShape(entry);
  assertEquals(
    diags.length,
    0,
    `expected no diagnostics when entry.type is set; got ${
      JSON.stringify(diags)
    }`,
  );
});

Deno.test("inferTypeFromDisplayIdShape: skipped when explicit Type: set", () => {
  const entry = authoredEntry({
    displayId: "braking::controller::debounce",
    rawAttributes: [
      { key: "Id", value: ULID },
      { key: "Type", value: "SoftwareUnit" },
    ],
  });
  const diags = inferTypeFromDisplayIdShape(entry);
  assertEquals(diags.length, 0);
});

Deno.test("inferTypeFromDisplayIdShape: fires MSL-T021 when no type signal resolves", () => {
  const entry = authoredEntry({
    displayId: "braking::controller::debounce",
  });
  const diags = inferTypeFromDisplayIdShape(entry);
  assertEquals(diags.length, 1);
  assertEquals(diags[0].code, "MSL-T021");
  assertEquals(diags[0].severity, "warning");
});
