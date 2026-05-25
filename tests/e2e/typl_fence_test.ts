/**
 * @module tests/e2e/typl_fence_test
 *
 * E2E tests confirming that `entry.types` (parsed typl declarations) flows
 * through the `markspec compile --format json` output when an entry body
 * contains a typl-info-string fence.
 */

import { assertEquals } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = "name: test-project\nversion: 0.1.0\n";

// ---------------------------------------------------------------------------
// Positive case — entry with a typl fence
// ---------------------------------------------------------------------------

const WITH_TYPL_MD = `- [STK_BRK_0001] Brake when target stops

  When the lead vehicle stops the system shall apply braking.

  \`\`\`typl
  $Speed     : signal float[0..300]
  $Brake     : command BrakeReq
  $Threshold : const 1.4

  type BrakeReq = { force_N: float[0..12000] }
  \`\`\`

      Id: 01HZZZ0000000000000000000A
`;

// ---------------------------------------------------------------------------
// Negative case — entry without a typl fence
// ---------------------------------------------------------------------------

const WITHOUT_TYPL_MD = `- [STK_BRK_0002] Driver override

  The driver shall be able to override the braking system.

      Id: 01HZZZ0000000000000000000B
`;

Deno.test(
  "compile: entry.types populated for entry with typl fence",
  async () => {
    const { code, stdout } = await markspec(
      ["compile", "--format", "json", "req.md"],
      {
        files: { "project.yaml": PROJECT_YAML, "req.md": WITH_TYPL_MD },
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

    const entry = parsed.entries["STK_BRK_0001"];
    if (!entry) throw new Error("STK_BRK_0001 not found in compile output");

    // entry.types must be present
    if (!entry.types) {
      throw new Error(
        `entry.types is absent for an entry with a typl fence; full entry: ${
          JSON.stringify(entry, null, 2)
        }`,
      );
    }

    // --- bindings ---
    const { bindings, typedefs } = entry.types;
    assertEquals(bindings.length, 3, "expected 3 bindings");

    // $Speed : signal float[0..300]
    const speedBinding = bindings.find((b: { name: string }) =>
      b.name === "$Speed"
    );
    if (!speedBinding) throw new Error("$Speed binding not found");
    assertEquals(speedBinding.kind, "signal");
    assertEquals(speedBinding.shape.kind, "range");
    assertEquals(speedBinding.shape.type, "float");
    assertEquals(speedBinding.shape.min, 0);
    assertEquals(speedBinding.shape.max, 300);

    // $Brake : command BrakeReq
    const brakeBinding = bindings.find((b: { name: string }) =>
      b.name === "$Brake"
    );
    if (!brakeBinding) throw new Error("$Brake binding not found");
    assertEquals(brakeBinding.kind, "command");
    assertEquals(brakeBinding.shape.kind, "ref");
    assertEquals(brakeBinding.shape.name, "BrakeReq");

    // $Threshold : const 1.4
    const thresholdBinding = bindings.find((b: { name: string }) =>
      b.name === "$Threshold"
    );
    if (!thresholdBinding) throw new Error("$Threshold binding not found");
    assertEquals(thresholdBinding.kind, "const");

    // --- typedefs ---
    assertEquals(typedefs.length, 1, "expected 1 typedef");
    const brakeReqTypedef = typedefs[0];
    assertEquals(brakeReqTypedef.name, "BrakeReq");
    assertEquals(brakeReqTypedef.shape.kind, "record");
  },
);

Deno.test(
  "compile: entry.types absent for entry without typl fence",
  async () => {
    const { code, stdout } = await markspec(
      ["compile", "--format", "json", "req.md"],
      {
        files: { "project.yaml": PROJECT_YAML, "req.md": WITHOUT_TYPL_MD },
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

    const entry = parsed.entries["STK_BRK_0002"];
    if (!entry) throw new Error("STK_BRK_0002 not found in compile output");

    // entry.types must be absent when no typl fence is present
    assertEquals(
      entry.types,
      undefined,
      "entry.types should be absent for an entry without a typl fence",
    );
  },
);
