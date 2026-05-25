/**
 * @module tests/e2e/typl_validation_test
 *
 * Blackbox E2E tests confirming that `markspec validate` emits TYPL-002,
 * TYPL-003, and TYPL-005 diagnostics for cross-entry and intra-entry typl
 * violations, and that `markspec compile --format json` outputs a populated
 * `typeRegistry` field.
 *
 * Six scenarios:
 *  1. Cross-entry TYPL-002 — same $Name, different kind
 *  2. Cross-entry TYPL-003 — same $Name, same kind, different shape
 *  3. Intra-entry TYPL-005 — binding references an undefined typedef
 *  4. TYPL-005 fires when typedef is defined in a sibling entry (entry-local scope)
 *  5. typeRegistry appears in compile JSON with populated bindings/typedefs
 *  6. Identical $Name declarations across entries do NOT trigger TYPL-002/003
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = "name: test-project\nversion: 0.1.0\n";

// ---------------------------------------------------------------------------
// Test 1: Cross-entry TYPL-002 — same $Speed name, different kinds
// ---------------------------------------------------------------------------

const DIFF_KIND_MD = `- [STK_TYPL_0001] Speed signal from radar

  The radar sensor shall emit vehicle speed.

  \`\`\`typl
  $Speed : signal float[0..300]
  \`\`\`

      Id: 01HZZZ0000000000000000001A

- [STK_TYPL_0002] Speed event from CAN bus

  The CAN bus shall publish a speed event.

  \`\`\`typl
  $Speed : event float[0..300]
  \`\`\`

      Id: 01HZZZ0000000000000000001B
`;

Deno.test(
  "validate: cross-entry kind mismatch emits TYPL-002",
  async () => {
    const { code, stderr } = await markspec(
      ["validate", "req.md"],
      {
        files: { "project.yaml": PROJECT_YAML, "req.md": DIFF_KIND_MD },
      },
    );
    if (code === 0) {
      throw new Error(
        `Expected non-zero exit code for TYPL-002 violation; stderr: ${stderr}`,
      );
    }
    assertStringIncludes(stderr, "TYPL-002", "TYPL-002 code must appear in stderr");
    assertStringIncludes(stderr, "$Speed", "$Speed name must appear in the diagnostic");
  },
);

// ---------------------------------------------------------------------------
// Test 2: Cross-entry TYPL-003 — same $Speed name + kind, different shape
// ---------------------------------------------------------------------------

const DIFF_SHAPE_MD = `- [STK_TYPL_0003] Speed signal first entry

  The first entry declares $Speed with range [0..300].

  \`\`\`typl
  $Speed : signal float[0..300]
  \`\`\`

      Id: 01HZZZ0000000000000000002A

- [STK_TYPL_0004] Speed signal second entry

  The second entry declares $Speed with a wider range [0..500].

  \`\`\`typl
  $Speed : signal float[0..500]
  \`\`\`

      Id: 01HZZZ0000000000000000002B
`;

Deno.test(
  "validate: cross-entry shape mismatch emits TYPL-003",
  async () => {
    const { code, stderr } = await markspec(
      ["validate", "req.md"],
      {
        files: { "project.yaml": PROJECT_YAML, "req.md": DIFF_SHAPE_MD },
      },
    );
    if (code === 0) {
      throw new Error(
        `Expected non-zero exit code for TYPL-003 violation; stderr: ${stderr}`,
      );
    }
    assertStringIncludes(stderr, "TYPL-003", "TYPL-003 code must appear in stderr");
  },
);

// ---------------------------------------------------------------------------
// Test 3: Intra-entry TYPL-005 — binding references an undefined typedef
// ---------------------------------------------------------------------------

const UNDEF_REF_MD = `- [STK_TYPL_0005] Brake command with undefined type

  The system shall issue a brake command of the payload type.

  \`\`\`typl
  $Brake : command BrakePayload
  \`\`\`

      Id: 01HZZZ0000000000000000003A
`;

Deno.test(
  "validate: binding referencing an undefined typedef emits TYPL-005",
  async () => {
    const { code, stderr } = await markspec(
      ["validate", "req.md"],
      {
        files: { "project.yaml": PROJECT_YAML, "req.md": UNDEF_REF_MD },
      },
    );
    if (code === 0) {
      throw new Error(
        `Expected non-zero exit code for TYPL-005 violation; stderr: ${stderr}`,
      );
    }
    assertStringIncludes(stderr, "TYPL-005", "TYPL-005 code must appear in stderr");
  },
);

// ---------------------------------------------------------------------------
// Test 4: TYPL-005 fires when typedef is local only to a sibling entry
//
// Entry A defines `type Frame = { id: int[0..255] }`. Entry B references
// `Frame` from a binding with no local typedef — v1 scope is entry-local,
// so this is a TYPL-005 error.
// ---------------------------------------------------------------------------

const CROSS_ENTRY_TYPEDEF_MD = `- [STK_TYPL_0006] Frame type definition

  Entry A defines the Frame typedef locally.

  \`\`\`typl
  type Frame = { id: int[0..255] }
  \`\`\`

      Id: 01HZZZ0000000000000000004A

- [STK_TYPL_0007] Frame command without local typedef

  Entry B references Frame in a binding but has no local typedef.

  \`\`\`typl
  $Msg : command Frame
  \`\`\`

      Id: 01HZZZ0000000000000000004B
`;

Deno.test(
  "validate: typedef defined in sibling entry is invisible — TYPL-005 fires",
  async () => {
    const { code, stderr } = await markspec(
      ["validate", "req.md"],
      {
        files: { "project.yaml": PROJECT_YAML, "req.md": CROSS_ENTRY_TYPEDEF_MD },
      },
    );
    if (code === 0) {
      throw new Error(
        `Expected non-zero exit code (typedef from sibling entry must not satisfy TYPL-005); stderr: ${stderr}`,
      );
    }
    assertStringIncludes(
      stderr,
      "TYPL-005",
      "TYPL-005 must fire when typedef is declared in a sibling entry only",
    );
  },
);

// ---------------------------------------------------------------------------
// Test 5: typeRegistry appears in compile JSON with populated bindings/typedefs
// ---------------------------------------------------------------------------

const TWO_ENTRY_TYPL_MD = `- [STK_TYPL_0008] Throttle signal declaration

  The throttle actuator shall accept a throttle signal.

  \`\`\`typl
  $Throttle : signal float[0..100]
  type ThrottleCmd = { pct: float[0..100] }
  \`\`\`

      Id: 01HZZZ0000000000000000005A

- [STK_TYPL_0009] Brake signal declaration

  The brake actuator shall accept a brake signal.

  \`\`\`typl
  $Brake : signal float[0..12000]
  type BrakeCmd = { force_N: float[0..12000] }
  \`\`\`

      Id: 01HZZZ0000000000000000005B
`;

Deno.test(
  "compile: typeRegistry field is present and populated",
  async () => {
    const { code, stdout } = await markspec(
      ["compile", "--format", "json", "req.md"],
      {
        files: { "project.yaml": PROJECT_YAML, "req.md": TWO_ENTRY_TYPL_MD },
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

    // typeRegistry must be present as an object (not undefined or null)
    if (!parsed.typeRegistry || typeof parsed.typeRegistry !== "object") {
      throw new Error(
        `typeRegistry field absent or not an object; full output: ${
          JSON.stringify(parsed, null, 2)
        }`,
      );
    }

    // bindings must be an object keyed by $Name
    const { bindings, typedefs } = parsed.typeRegistry;
    if (!bindings || typeof bindings !== "object") {
      throw new Error(
        `typeRegistry.bindings absent or not an object; typeRegistry: ${
          JSON.stringify(parsed.typeRegistry, null, 2)
        }`,
      );
    }
    if (!typedefs || typeof typedefs !== "object") {
      throw new Error(
        `typeRegistry.typedefs absent or not an object; typeRegistry: ${
          JSON.stringify(parsed.typeRegistry, null, 2)
        }`,
      );
    }

    // $Throttle and $Brake must be present in bindings
    if (!bindings["$Throttle"]) {
      throw new Error(
        `$Throttle missing from typeRegistry.bindings; keys: ${
          JSON.stringify(Object.keys(bindings))
        }`,
      );
    }
    if (!bindings["$Brake"]) {
      throw new Error(
        `$Brake missing from typeRegistry.bindings; keys: ${
          JSON.stringify(Object.keys(bindings))
        }`,
      );
    }

    // Each value must be an array of declaration records
    const throttleDecls = bindings["$Throttle"];
    if (!Array.isArray(throttleDecls) || throttleDecls.length === 0) {
      throw new Error(
        `typeRegistry.bindings["$Throttle"] must be a non-empty array; got: ${
          JSON.stringify(throttleDecls)
        }`,
      );
    }

    // ThrottleCmd and BrakeCmd must be present in typedefs
    if (!typedefs["ThrottleCmd"]) {
      throw new Error(
        `ThrottleCmd missing from typeRegistry.typedefs; keys: ${
          JSON.stringify(Object.keys(typedefs))
        }`,
      );
    }
    if (!typedefs["BrakeCmd"]) {
      throw new Error(
        `BrakeCmd missing from typeRegistry.typedefs; keys: ${
          JSON.stringify(Object.keys(typedefs))
        }`,
      );
    }

    // Typedef values must be arrays too
    const throttleCmdDecls = typedefs["ThrottleCmd"];
    if (!Array.isArray(throttleCmdDecls) || throttleCmdDecls.length === 0) {
      throw new Error(
        `typeRegistry.typedefs["ThrottleCmd"] must be a non-empty array; got: ${
          JSON.stringify(throttleCmdDecls)
        }`,
      );
    }
  },
);

// ---------------------------------------------------------------------------
// Test 6: Identical $Name + kind + shape across entries → no TYPL-002/003
// ---------------------------------------------------------------------------

const SAME_DECL_MD = `- [STK_TYPL_0010] Speed signal primary declaration

  The primary requirement declares $Speed as a signal.

  \`\`\`typl
  $Speed : signal float[0..300]
  \`\`\`

      Id: 01HZZZ0000000000000000006A

- [STK_TYPL_0011] Speed signal redundant declaration

  The secondary requirement repeats $Speed identically.

  \`\`\`typl
  $Speed : signal float[0..300]
  \`\`\`

      Id: 01HZZZ0000000000000000006B
`;

Deno.test(
  "validate: identical cross-entry declarations do not trigger TYPL-002/003",
  async () => {
    const { code, stderr } = await markspec(
      ["validate", "req.md"],
      {
        files: { "project.yaml": PROJECT_YAML, "req.md": SAME_DECL_MD },
      },
    );
    assertEquals(
      code,
      0,
      `Expected exit code 0 for identical declarations but got ${code}; stderr: ${stderr}`,
    );
    if (stderr.includes("TYPL-002") || stderr.includes("TYPL-003")) {
      throw new Error(
        `TYPL-002/003 must not fire for identical declarations; stderr: ${stderr}`,
      );
    }
  },
);
