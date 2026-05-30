import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

Deno.test("validate in nested dir finds files", async () => {
  const { code } = await markspec(["check", "req.md"], {
    files: {
      "project.yaml": "name: test-project\n",
      "req.md": `# Test

- [SRS_BRK_0001] Title

  Body.

  Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
    },
  });
  assertEquals(code, 0);
});

Deno.test("format outside project works with defaults", async () => {
  const { code, stderr } = await markspec(["fmt", "req.md"], {
    files: {
      "req.md": "# Test\n",
    },
    // No project.yaml — format should work anyway
  });
  assertEquals(code, 0);
  assertStringIncludes(stderr, "0 file(s) formatted");
});

Deno.test("compile without project.yaml produces clear error", async () => {
  const { code, stderr } = await markspec(["compile", "**/*.md"], {
    files: {
      "req.md": "# Test\n",
    },
    // No project.yaml
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "no project.yaml found");
});

Deno.test("invalid project.yaml produces actionable error on compile", async () => {
  const { code, stderr } = await markspec(["compile", "**/*.md"], {
    files: {
      "project.yaml": "domain: bad\n",
      "req.md": "# Test\n",
    },
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "invalid project.yaml");
  assertStringIncludes(stderr, "name");
});

// ---------------------------------------------------------------------------
// M-1 fix: malformed caption-conventions surfaces instead of being swallowed
//
// Pre-fix: a bad caption-conventions block in project.yaml was silently
// swallowed by `catch { /* non-fatal */ }` in the validate and hook commands,
// silently disabling MSL-C072 with no message.
//
// Post-fix: a ConfigError thrown by loadConfig IS surfaced to stderr and the
// command exits 1.  A *missing* config or absent project.yaml still stays
// non-fatal (the rule just stays inactive — no false error).
// ---------------------------------------------------------------------------

const VALID_REQ = `# Test

- [REQ-001] A requirement

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

Deno.test("validate: malformed caption-conventions in project.yaml surfaces error (M-1 fix)", async () => {
  // "unknown-keyword" is not a valid caption keyword; loadConfig throws
  // ConfigError.  The validate command must surface it rather than silently
  // continuing with MSL-C072 disabled.
  const { code, stderr } = await markspec(["check", "req.md"], {
    files: {
      "project.yaml":
        "name: test-project\ncaption-conventions:\n  unknown-keyword: above\n",
      "req.md": VALID_REQ,
    },
  });
  assertEquals(code, 1, `expected exit 1, got ${code}; stderr:\n${stderr}`);
  assertStringIncludes(
    stderr,
    "error:",
    "expected an error message on stderr for malformed caption-conventions",
  );
});

Deno.test("validate: absent project.yaml still works silently — no false error (M-1 regression guard)", async () => {
  // No project.yaml: validate must still succeed for a valid file and
  // must NOT emit any caption-conventions error.  This is the non-fatal
  // path that must remain unchanged by the M-1 fix.
  const { code, stderr } = await markspec(["check", "req.md"], {
    files: {
      "req.md": VALID_REQ,
    },
  });
  assertEquals(code, 0, `expected exit 0, got ${code}; stderr:\n${stderr}`);
  assertEquals(
    stderr.includes("caption"),
    false,
    `expected no caption-conventions mention in stderr; got:\n${stderr}`,
  );
});

Deno.test("validate: well-formed caption-conventions in project.yaml succeeds silently", async () => {
  const { code, stderr } = await markspec(["check", "req.md"], {
    files: {
      "project.yaml":
        "name: test-project\ncaption-conventions:\n  Figure: above\n",
      "req.md": VALID_REQ,
    },
  });
  assertEquals(code, 0, `expected exit 0, got ${code}; stderr:\n${stderr}`);
});
