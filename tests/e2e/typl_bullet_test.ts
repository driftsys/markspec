/**
 * @module tests/e2e/typl_bullet_test
 *
 * E2E tests confirming that a bullet-glossary typl surface produces the same
 * `entry.types` JSON shape as the equivalent typl-fence surface through the
 * `markspec compile --format json` pipeline.
 */

import { assertEquals } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = "name: test-project\nversion: 0.1.0\n";

// ---------------------------------------------------------------------------
// Fixture: two entries in one file — fence vs bullet surface, same payload
// ---------------------------------------------------------------------------

const FENCE_AND_BULLET_MD =
  `- [STK_FENCE_0001] Brake when target stops (fence form)

  When the lead vehicle stops the system shall apply braking.

  \`\`\`typl
  $Speed     : signal float[0..300]
  $Brake     : command BrakeReq
  $Threshold : const 1.4

  type BrakeReq = { force_N: float[0..12000] }
  \`\`\`

      Id: 01HZZZ0000000000000000000A

- [STK_BULLET_0001] Brake when target stops (bullet form)

  When the lead vehicle stops the system shall apply braking.

  - $Speed     : signal float[0..300]
  - $Brake     : command BrakeReq
  - $Threshold : const 1.4
  - type BrakeReq = { force_N: float[0..12000] }

      Id: 01HZZZ0000000000000000000B
`;

// ---------------------------------------------------------------------------
// Fixture: entry with a mixed bullet list (typl + prose items)
// ---------------------------------------------------------------------------

const MIXED_BULLET_MD = `- [STK_MIXED_0001] Entry with mixed bullet list

  The system has the following interface signals:

  - This bullet describes context only.
  - $Vehicle  : signal float[0..200]
  - Another prose bullet — not a typl item.
  - $Driver   : signal bool

      Id: 01HZZZ0000000000000000000C
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
// Test 1: bullet glossary produces same entry.types as fence equivalent
// ---------------------------------------------------------------------------

Deno.test(
  "compile: bullet glossary produces same entry.types as fence equivalent",
  async () => {
    const { code, stdout } = await markspec(
      ["compile", "--format", "json", "req.md"],
      {
        files: { "project.yaml": PROJECT_YAML, "req.md": FENCE_AND_BULLET_MD },
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
    const bulletEntry = parsed.entries["STK_BULLET_0001"];
    if (!bulletEntry) {
      throw new Error("STK_BULLET_0001 not found in compile output");
    }

    if (!fenceEntry.types) {
      throw new Error(
        `fenceEntry.types is absent; full entry: ${
          JSON.stringify(fenceEntry, null, 2)
        }`,
      );
    }
    if (!bulletEntry.types) {
      throw new Error(
        `bulletEntry.types is absent; full entry: ${
          JSON.stringify(bulletEntry, null, 2)
        }`,
      );
    }

    const fenceBindings: Array<
      { name: string; kind: string; shape?: unknown; position: unknown }
    > = fenceEntry.types.bindings;
    const bulletBindings: Array<
      { name: string; kind: string; shape?: unknown; position: unknown }
    > = bulletEntry.types.bindings;
    const fenceTypedefs: Array<
      { name: string; shape: unknown; position: unknown }
    > = fenceEntry.types.typedefs;
    const bulletTypedefs: Array<
      { name: string; shape: unknown; position: unknown }
    > = bulletEntry.types.typedefs;

    // Both surfaces must yield the same number of bindings and typedefs.
    assertEquals(
      bulletBindings.length,
      fenceBindings.length,
      "binding count mismatch between bullet and fence surfaces",
    );
    assertEquals(
      bulletTypedefs.length,
      fenceTypedefs.length,
      "typedef count mismatch between bullet and fence surfaces",
    );

    // Compare each binding by name, kind, and shape — ignoring position.
    for (const fenceB of fenceBindings) {
      const bulletB = bulletBindings.find((b) => b.name === fenceB.name);
      if (!bulletB) {
        throw new Error(
          `binding '${fenceB.name}' present in fence entry but missing from bullet entry`,
        );
      }
      assertEquals(
        stripPosition(bulletB),
        stripPosition(fenceB),
        `binding '${fenceB.name}' shape/kind mismatch between surfaces`,
      );
    }

    // Compare each typedef by name and shape — ignoring position.
    for (const fenceT of fenceTypedefs) {
      const bulletT = bulletTypedefs.find((t) => t.name === fenceT.name);
      if (!bulletT) {
        throw new Error(
          `typedef '${fenceT.name}' present in fence entry but missing from bullet entry`,
        );
      }
      assertEquals(
        stripPosition(bulletT),
        stripPosition(fenceT),
        `typedef '${fenceT.name}' shape mismatch between surfaces`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Test 2: mixed bullet list only extracts typl items into entry.types
// ---------------------------------------------------------------------------

Deno.test(
  "compile: mixed bullet list (typl + prose) only extracts typl items",
  async () => {
    const { code, stdout } = await markspec(
      ["compile", "--format", "json", "req.md"],
      {
        files: { "project.yaml": PROJECT_YAML, "req.md": MIXED_BULLET_MD },
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

    const entry = parsed.entries["STK_MIXED_0001"];
    if (!entry) throw new Error("STK_MIXED_0001 not found in compile output");

    if (!entry.types) {
      throw new Error(
        `entry.types is absent; full entry: ${JSON.stringify(entry, null, 2)}`,
      );
    }

    const { bindings } = entry.types;

    // Only the two $-prefixed bullets should appear — the two prose bullets
    // ("This bullet describes context only." and "Another prose bullet — not a
    // typl item.") must NOT surface in entry.types.bindings.
    assertEquals(
      bindings.length,
      2,
      `expected 2 typl bindings but got ${bindings.length}: ${
        JSON.stringify(bindings.map((b: { name: string }) => b.name))
      }`,
    );

    const names: string[] = bindings.map((b: { name: string }) => b.name);
    if (!names.includes("$Vehicle")) {
      throw new Error(
        `$Vehicle binding missing; got: ${JSON.stringify(names)}`,
      );
    }
    if (!names.includes("$Driver")) {
      throw new Error(`$Driver binding missing; got: ${JSON.stringify(names)}`);
    }

    // Verify kinds
    const vehicleB = bindings.find((b: { name: string }) =>
      b.name === "$Vehicle"
    );
    assertEquals(vehicleB.kind, "signal");
    const driverB = bindings.find((b: { name: string }) =>
      b.name === "$Driver"
    );
    assertEquals(driverB.kind, "signal");
  },
);
