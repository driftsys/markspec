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
import type { Diagnostic, Entry } from "../model/mod.ts";
import { emittableEntries, makeDisplayId } from "../model/mod.ts";

/** Compose the #771 emit partition the way `runPipeline` Stage 1.6 does —
 * tests exercise the same caller contract the production pipeline uses. */
function run(entries: readonly Entry[]): readonly Diagnostic[] {
  return validateTraceTargetTypes(emittableEntries(entries), entries);
}

const ULID_A = "01HGW2Q8MNP3RSTVWXYZABCDEF";
const ULID_B = "01HGW2Q8MNP3RSTVWXYZABCDEG";

function entry(opts: {
  displayId: string;
  type?: string;
  id?: string;
  rawAttributes?: Array<{ key: string; value: string }>;
  origin?: Entry["origin"];
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
    source: { kind: "markdown" },
    bodyTokens: [],
    origin: opts.origin,
  };
}

Deno.test("Caused-by on Record with Requirement target → OK", () => {
  const result = run([
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
  const result = run([
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

Deno.test("Caused-by on upstream Record with Component target → no MSL-R083 (upstream source is validation-exempt)", () => {
  // Same fixture shape as "Caused-by on Record with Component target →
  // MSL-R083 (Record-cause set)" above, but the source entry carries a
  // `kind:"upstream"` origin. Upstream entries are validation-exempt
  // graph citizens (design §4.7) — Stage 1.6 must skip emitting from
  // them entirely, even though the target-type mismatch would otherwise
  // fire MSL-R083.
  const result = run([
    entry({
      displayId: "REC-001",
      type: "Record",
      rawAttributes: [
        { key: "Id", value: ULID_A },
        { key: "Type", value: "Record" },
        { key: "Caused-by", value: ULID_B },
      ],
      origin: { kind: "upstream", upstreamId: "acme/reqs", version: "v1.0" },
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

Deno.test("Caused-by on Record with UPSTREAM Component target → no MSL-R083 (target-side exemption, #771)", () => {
  // Mirror of "Caused-by on Record with Component target → MSL-R083"
  // above, but the TARGET carries a `kind:"upstream"` origin. An upstream
  // target's type comes from a foreign vocabulary — core-type
  // compatibility must never be judged against it (the target-side twin
  // of #765's MSL-L004 fix).
  const result = run([
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
      origin: { kind: "upstream", upstreamId: "acme/reqs", version: "v1.0" },
    }),
  ]);
  const r083 = result.filter((d) => d.code === "MSL-R083");
  assertEquals(r083.length, 0);
});

Deno.test("Caused-by on Risk with Component target → OK", () => {
  const result = run([
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
  const result = run([
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

// ---------------------------------------------------------------------------
// Interface-as-contract re-parent (Fix 1):
//   Provides/Requires now accept Contract (and subtypes).
//   Tests/Affects now also accept Contract (and subtypes).
// ---------------------------------------------------------------------------

const ULID_C = "01HGW2Q8MNP3RSTVWXYZABCDEH";

Deno.test("Provides: SoftwareInterface target → no MSL-R083 (Contract subtype)", () => {
  const result = run([
    entry({
      displayId: "SWC-001",
      type: "SoftwareComponent",
      rawAttributes: [
        { key: "Id", value: ULID_A },
        { key: "Type", value: "SoftwareComponent" },
        { key: "Provides", value: ULID_B },
      ],
    }),
    entry({
      displayId: "IFC-001",
      type: "SoftwareInterface",
      id: ULID_B,
      rawAttributes: [
        { key: "Id", value: ULID_B },
        { key: "Type", value: "SoftwareInterface" },
      ],
    }),
  ]);
  const r083 = result.filter((d) => d.code === "MSL-R083");
  assertEquals(r083.length, 0);
});

Deno.test("Provides: plain Contract target → no MSL-R083", () => {
  const result = run([
    entry({
      displayId: "SWC-001",
      type: "SoftwareComponent",
      rawAttributes: [
        { key: "Id", value: ULID_A },
        { key: "Type", value: "SoftwareComponent" },
        { key: "Provides", value: ULID_B },
      ],
    }),
    entry({
      displayId: "CTR-001",
      type: "Contract",
      id: ULID_B,
      rawAttributes: [
        { key: "Id", value: ULID_B },
        { key: "Type", value: "Contract" },
      ],
    }),
  ]);
  const r083 = result.filter((d) => d.code === "MSL-R083");
  assertEquals(r083.length, 0);
});

Deno.test("Tests: SoftwareInterface target → no MSL-R083 (Contract subtype)", () => {
  const result = run([
    entry({
      displayId: "TST-001",
      type: "Test",
      rawAttributes: [
        { key: "Id", value: ULID_A },
        { key: "Type", value: "Test" },
        { key: "Tests", value: ULID_B },
      ],
    }),
    entry({
      displayId: "IFC-001",
      type: "SoftwareInterface",
      id: ULID_B,
      rawAttributes: [
        { key: "Id", value: ULID_B },
        { key: "Type", value: "SoftwareInterface" },
      ],
    }),
  ]);
  const r083 = result.filter((d) => d.code === "MSL-R083");
  assertEquals(r083.length, 0);
});

Deno.test("Requires: HardwareInterface target → no MSL-R083 (Contract subtype)", () => {
  const result = run([
    entry({
      displayId: "HWC-001",
      type: "HardwareComponent",
      rawAttributes: [
        { key: "Id", value: ULID_A },
        { key: "Type", value: "HardwareComponent" },
        { key: "Requires", value: ULID_C },
      ],
    }),
    entry({
      displayId: "HIFC-001",
      type: "HardwareInterface",
      id: ULID_C,
      rawAttributes: [
        { key: "Id", value: ULID_C },
        { key: "Type", value: "HardwareInterface" },
      ],
    }),
  ]);
  const r083 = result.filter((d) => d.code === "MSL-R083");
  assertEquals(r083.length, 0);
});
