/**
 * @module core/validator/trace_types_test
 *
 * Unit tests for cross-file trace target validation. Focused on the
 * polymorphic `Caused-by` rule (Record vs Risk source) and the
 * subtype-inheritance behaviour that's harder to exercise via e2e
 * fixtures.
 */

import { assertEquals } from "@std/assert";
import { validateTraceTargetTypes } from "./trace_types.ts";
import type { Entry } from "../model/mod.ts";
import { makeDisplayId } from "../model/mod.ts";

const ULID_A = "01HGW2Q8MNP3RSTVWXYZABCDEF";
const ULID_B = "01HGW2Q8MNP3RSTVWXYZABCDEG";

function entry(opts: {
  displayId: string;
  type?: string;
  id?: string;
  rawAttributes?: Array<{ key: string; value: string }>;
}): Entry {
  const id = opts.id ?? ULID_A;
  return {
    displayId: makeDisplayId(opts.displayId),
    title: "Test",
    body: "Body.",
    rawAttributes: opts.rawAttributes ?? [{ key: "Id", value: id }],
    typedAttributes: new Map(),
    id,
    type: opts.type,
    shape: "Authored",
    location: { file: "test.md", line: 1, column: 1 },
    source: "markdown",
    bodyTokens: [],
  };
}

Deno.test("Caused-by on Record with Requirement target → OK", () => {
  const result = validateTraceTargetTypes([
    entry({
      displayId: "REC-001",
      type: "Record",
      rawAttributes: [
        { key: "Id", value: ULID_A },
        { key: "Type", value: "Record" },
        { key: "Caused-by", value: ULID_B },
      ],
    }),
    entry({
      displayId: "REQ-001",
      type: "Requirement",
      id: ULID_B,
      rawAttributes: [
        { key: "Id", value: ULID_B },
        { key: "Type", value: "Requirement" },
      ],
    }),
  ]);
  const r083 = result.filter((d) => d.code === "MSL-R083");
  assertEquals(r083.length, 0);
});

Deno.test("Caused-by on Record with Component target → MSL-R083 (Record-cause set)", () => {
  const result = validateTraceTargetTypes([
    entry({
      displayId: "REC-001",
      type: "Record",
      rawAttributes: [
        { key: "Id", value: ULID_A },
        { key: "Type", value: "Record" },
        { key: "Caused-by", value: ULID_B },
      ],
    }),
    entry({
      displayId: "comp-1",
      type: "Component",
      id: ULID_B,
      rawAttributes: [
        { key: "Id", value: ULID_B },
        { key: "Type", value: "Component" },
      ],
    }),
  ]);
  const r083 = result.filter((d) => d.code === "MSL-R083");
  assertEquals(r083.length, 1);
  // Message should name the Record-cause set, not the union with Risk-cause.
  const msg = r083[0].message;
  assertEquals(
    msg.includes("Record source"),
    true,
    `expected message to identify Record source role; got ${msg}`,
  );
});

Deno.test("Caused-by on Risk with Component target → OK", () => {
  const result = validateTraceTargetTypes([
    entry({
      displayId: "RSK-001",
      type: "Risk",
      rawAttributes: [
        { key: "Id", value: ULID_A },
        { key: "Type", value: "Risk" },
        { key: "Caused-by", value: ULID_B },
      ],
    }),
    entry({
      displayId: "comp-1",
      type: "Component",
      id: ULID_B,
      rawAttributes: [
        { key: "Id", value: ULID_B },
        { key: "Type", value: "Component" },
      ],
    }),
  ]);
  const r083 = result.filter((d) => d.code === "MSL-R083");
  assertEquals(r083.length, 0);
});

Deno.test("Caused-by on Requirement (neither Record nor Risk) → no MSL-R083 (skip)", () => {
  // A Requirement isn't a valid `Caused-by` source. Per spec §4.8 the
  // rule applies only to Record / Risk; if the source is neither (or
  // unresolved), the check is silent — a useful diagnostic would need
  // attribute-applicability rules, not type-target mismatch.
  const result = validateTraceTargetTypes([
    entry({
      displayId: "REQ-001",
      type: "Requirement",
      rawAttributes: [
        { key: "Id", value: ULID_A },
        { key: "Type", value: "Requirement" },
        { key: "Caused-by", value: ULID_B },
      ],
    }),
    entry({
      displayId: "REQ-002",
      type: "Requirement",
      id: ULID_B,
      rawAttributes: [
        { key: "Id", value: ULID_B },
        { key: "Type", value: "Requirement" },
      ],
    }),
  ]);
  const r083 = result.filter((d) => d.code === "MSL-R083");
  assertEquals(r083.length, 0);
});
