/**
 * @module tests/e2e/typl_inline_test
 *
 * E2E tests confirming that a typl inline-backtick surface produces the same
 * `entry.types` JSON shape as the equivalent typl-fence surface through the
 * `markspec compile --format json` pipeline.
 *
 * Two tests:
 *  1. Equivalence: one file contains a fence entry and an inline entry with
 *     identical bindings + typedef. Both must produce equivalent `entry.types`
 *     after stripping `position` (which differs between surfaces).
 *  2. Pure-inline: inline backtick declarations scattered through prose are
 *     extracted into `entry.types.bindings`. A sibling entry whose code spans
 *     are not typl syntax (`foo()`, `MAX_SPEED`) must leave `entry.types`
 *     absent.
 */

import { assertEquals } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = "name: test-project\nversion: 0.1.0\n";

// ---------------------------------------------------------------------------
// Fixture 1: two entries in one file — fence and inline surface,
// each expressing the same bindings + typedef.
// ---------------------------------------------------------------------------

const FENCE_AND_INLINE_MD = `- [STK_FENCE_0001] Brake when target stops (fence form)

  When the lead vehicle stops the system shall apply braking.

  \`\`\`typl
  $Speed     : signal float[0..300]
  $Brake     : command BrakeReq
  $Threshold : const 1.4

  type BrakeReq = { force_N: float[0..12000] }
  \`\`\`

      Id: 01HZZZ0000000000000000000A

- [STK_INLINE_0001] Brake when target stops (inline form)

  When the lead vehicle stops the system shall apply braking such that
  \`$Speed : signal float[0..300]\` drops below \`$Threshold : const 1.4\`
  before \`$Brake : command BrakeReq\` is issued. The payload shape is
  \`type BrakeReq = { force_N: float[0..12000] }\` defined above.

      Id: 01HZZZ0000000000000000000B
`;

// ---------------------------------------------------------------------------
// Fixture 2: pure-inline entry (all declarations in prose code spans) plus
// a sibling entry whose code spans carry non-typl content.
// ---------------------------------------------------------------------------

const PURE_INLINE_MD = `- [STK_INLINE_0002] Speed limit enforcement (pure inline)

  The system shall enforce the speed limit by reading \`$Speed : signal float[0..300]\`
  and comparing it against \`$Limit : const 130.0\` at each evaluation cycle.

      Id: 01HZZZ0000000000000000000C

- [STK_NOTYPL_0001] Driver override (no typl code spans)

  The driver shall be able to override the system using \`foo()\` or the
  \`MAX_SPEED\` constant defined in the firmware header.

      Id: 01HZZZ0000000000000000000D
`;

// ---------------------------------------------------------------------------
// Helper: strip `position` from a binding or typedef before comparing
// ---------------------------------------------------------------------------

type PositionStripped<T> = Omit<T, "position">;

function stripPosition<T extends { position: unknown }>(
  item: T,
): PositionStripped<T> {
  const { position: _pos, ...rest } = item;
  return rest as PositionStripped<T>;
}

// ---------------------------------------------------------------------------
// Test 1: inline surface produces same entry.types as fence equivalent
// ---------------------------------------------------------------------------

Deno.test(
  "compile: inline backtick surface produces same entry.types as fence surface",
  async () => {
    const { code, stdout } = await markspec(
      ["compile", "--format", "json", "req.md"],
      {
        files: { "project.yaml": PROJECT_YAML, "req.md": FENCE_AND_INLINE_MD },
      },
    );
    assertEquals(code, 0);

    let parsed: ReturnType<typeof JSON.parse>;
    try {
      parsed = JSON.parse(stdout);
    } catch (err) {
      throw new Error(
        `Failed to parse compile JSON output: ${err}\nstdout: ${stdout}`,
      );
    }

    const fenceEntry = parsed.entries["STK_FENCE_0001"];
    if (!fenceEntry) {
      throw new Error("STK_FENCE_0001 not found in compile output");
    }
    const inlineEntry = parsed.entries["STK_INLINE_0001"];
    if (!inlineEntry) {
      throw new Error("STK_INLINE_0001 not found in compile output");
    }

    if (!fenceEntry.types) {
      throw new Error(
        `fenceEntry.types is absent; full entry: ${JSON.stringify(fenceEntry, null, 2)}`,
      );
    }
    if (!inlineEntry.types) {
      throw new Error(
        `inlineEntry.types is absent; full entry: ${JSON.stringify(inlineEntry, null, 2)}`,
      );
    }

    const fenceBindings: Array<{
      name: string;
      kind: string;
      shape?: unknown;
      position: unknown;
    }> = fenceEntry.types.bindings;
    const inlineBindings: Array<{
      name: string;
      kind: string;
      shape?: unknown;
      position: unknown;
    }> = inlineEntry.types.bindings;

    const fenceTypedefs: Array<{
      name: string;
      shape: unknown;
      position: unknown;
    }> = fenceEntry.types.typedefs;
    const inlineTypedefs: Array<{
      name: string;
      shape: unknown;
      position: unknown;
    }> = inlineEntry.types.typedefs;

    // Both surfaces must yield the same number of bindings and typedefs.
    assertEquals(
      inlineBindings.length,
      fenceBindings.length,
      "binding count mismatch between inline and fence surfaces",
    );
    assertEquals(
      inlineTypedefs.length,
      fenceTypedefs.length,
      "typedef count mismatch between inline and fence surfaces",
    );

    // Compare each binding by name, kind, and shape — ignoring position.
    // Use fence as the reference surface; look up by name so order differences
    // between surfaces do not cause false failures.
    for (const fenceB of fenceBindings) {
      const inlineB = inlineBindings.find((b) => b.name === fenceB.name);
      if (!inlineB) {
        throw new Error(
          `binding '${fenceB.name}' present in fence entry but missing from inline entry`,
        );
      }
      assertEquals(
        stripPosition(inlineB),
        stripPosition(fenceB),
        `binding '${fenceB.name}' shape/kind mismatch between inline and fence surfaces`,
      );
    }

    // Compare each typedef by name and shape — ignoring position.
    for (const fenceT of fenceTypedefs) {
      const inlineT = inlineTypedefs.find((t) => t.name === fenceT.name);
      if (!inlineT) {
        throw new Error(
          `typedef '${fenceT.name}' present in fence entry but missing from inline entry`,
        );
      }
      assertEquals(
        stripPosition(inlineT),
        stripPosition(fenceT),
        `typedef '${fenceT.name}' shape mismatch between inline and fence surfaces`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Test 2: pure-inline entry populates entry.types; non-typl sibling does not
// ---------------------------------------------------------------------------

Deno.test(
  "compile: pure-inline typl declarations populate entry.types; non-typl code spans leave entry.types absent",
  async () => {
    const { code, stdout } = await markspec(
      ["compile", "--format", "json", "req.md"],
      {
        files: { "project.yaml": PROJECT_YAML, "req.md": PURE_INLINE_MD },
      },
    );
    assertEquals(code, 0);

    let parsed: ReturnType<typeof JSON.parse>;
    try {
      parsed = JSON.parse(stdout);
    } catch (err) {
      throw new Error(
        `Failed to parse compile JSON output: ${err}\nstdout: ${stdout}`,
      );
    }

    // --- positive case: entry with inline typl declarations ---
    const inlineEntry = parsed.entries["STK_INLINE_0002"];
    if (!inlineEntry) {
      throw new Error("STK_INLINE_0002 not found in compile output");
    }

    if (!inlineEntry.types) {
      throw new Error(
        `inlineEntry.types is absent for an entry with inline typl code spans; full entry: ${
          JSON.stringify(inlineEntry, null, 2)
        }`,
      );
    }

    const { bindings } = inlineEntry.types;
    assertEquals(bindings.length, 2, "expected 2 bindings from inline spans");

    // $Speed : signal float[0..300]
    const speedBinding = bindings.find((b: { name: string }) =>
      b.name === "$Speed"
    );
    if (!speedBinding) {
      throw new Error(
        `$Speed binding not found; got: ${JSON.stringify(bindings.map((b: { name: string }) => b.name))}`,
      );
    }
    assertEquals(speedBinding.kind, "signal");
    assertEquals(speedBinding.shape.kind, "range");
    assertEquals(speedBinding.shape.type, "float");
    assertEquals(speedBinding.shape.min, 0);
    assertEquals(speedBinding.shape.max, 300);

    // $Limit : const 130.0
    const limitBinding = bindings.find((b: { name: string }) =>
      b.name === "$Limit"
    );
    if (!limitBinding) {
      throw new Error(
        `$Limit binding not found; got: ${JSON.stringify(bindings.map((b: { name: string }) => b.name))}`,
      );
    }
    assertEquals(limitBinding.kind, "const");

    // --- negative case: entry with non-typl code spans has no entry.types ---
    const noTyplEntry = parsed.entries["STK_NOTYPL_0001"];
    if (!noTyplEntry) {
      throw new Error("STK_NOTYPL_0001 not found in compile output");
    }

    // `foo()` and `MAX_SPEED` must NOT be parsed as typl declarations.
    assertEquals(
      noTyplEntry.types,
      undefined,
      "entry.types should be absent for an entry whose code spans are not typl syntax",
    );
  },
);
