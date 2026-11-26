/**
 * @module tests/e2e/scoped_display_id_test
 *
 * E2E tests for #1038: `next-id`, `create` and `insert` mint a free display
 * ID for a numbered `display-id-pattern` with a `{scope}` placeholder. The
 * `--scope <value>` flag replaces the placeholder, and the number is the
 * highest number in that scope plus one.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { markspec, markspecPersist } from "./helpers.ts";

const PROFILE_YAML = `id: "@acme/scoped"
version: 0.1.0
profile:
  types:
    software-requirement:
      extends: Requirement
      display-id-pattern: "SRS_{scope}_{n:04d}"
    stakeholder-requirement:
      extends: Requirement
      display-id-pattern: "STK_{n:04d}"
    named-element:
      extends: Item
      display-id-pattern: "XREQ_{scope}"
`;

const BASE_FILES = {
  "project.yaml": `name: x\nversion: 0.1.0\n`,
  ".markspec.yaml": `profiles:\n  - ./profiles/acme\n`,
  "profiles/acme/markspec.yaml": PROFILE_YAML,
};

const REQ_MD = `# Requirements

- [SRS_BRK_0001] Brake request

  The brake controller shall apply the brake within 100 ms.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

- [SRS_ENG_0007] Engine request

  The engine controller shall stop the engine within 200 ms.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`;

const FILES = { ...BASE_FILES, "req.md": REQ_MD };

// ---------------------------------------------------------------------------
// next-id
// ---------------------------------------------------------------------------

Deno.test("next-id --scope: the number follows the highest ID in that scope", async () => {
  const { code, stdout, stderr } = await markspec(
    ["next-id", "software-requirement", "--scope", "BRK", "req.md"],
    { files: FILES },
  );
  assertEquals(code, 0, stderr);
  assertEquals(stdout.trim(), "SRS_BRK_0002");
});

Deno.test("next-id --scope: other scopes do not affect the number", async () => {
  const { code, stdout, stderr } = await markspec(
    ["next-id", "software-requirement", "--scope", "ENG", "req.md"],
    { files: FILES },
  );
  assertEquals(code, 0, stderr);
  assertEquals(stdout.trim(), "SRS_ENG_0008");
});

Deno.test("next-id --scope: a new scope starts at 1", async () => {
  const { code, stdout, stderr } = await markspec(
    ["next-id", "software-requirement", "--scope", "STR", "req.md"],
    { files: FILES },
  );
  assertEquals(code, 0, stderr);
  assertEquals(stdout.trim(), "SRS_STR_0001");
});

Deno.test("next-id --scope --format json keeps the {type, displayId} shape", async () => {
  const { code, stdout, stderr } = await markspec(
    [
      "next-id",
      "software-requirement",
      "--scope",
      "BRK",
      "--format",
      "json",
      "req.md",
    ],
    { files: FILES },
  );
  assertEquals(code, 0, stderr);
  assertEquals(JSON.parse(stdout), {
    type: "software-requirement",
    displayId: "SRS_BRK_0002",
  });
});

Deno.test("next-id: a {scope} pattern without --scope fails and lists the scopes in use", async () => {
  const { code, stdout, stderr } = await markspec(
    ["next-id", "software-requirement", "req.md"],
    { files: FILES },
  );
  assertEquals(code, 1);
  assertEquals(stdout, "");
  assertStringIncludes(stderr, "--scope");
  assertStringIncludes(stderr, "scopes in use: BRK, ENG");
  assert(!stderr.includes("SRS_{scope}_0001"), stderr);
});

Deno.test("next-id: a {scope} pattern without --scope and no IDs yet says so", async () => {
  const { code, stderr } = await markspec(
    ["next-id", "software-requirement", "req.md"],
    { files: { ...BASE_FILES, "req.md": "# Empty\n" } },
  );
  assertEquals(code, 1);
  assertStringIncludes(stderr, "--scope");
  assertStringIncludes(stderr, "no scope is in use yet");
});

Deno.test("next-id: --scope on a pattern without {scope} fails", async () => {
  const { code, stdout, stderr } = await markspec(
    ["next-id", "stakeholder-requirement", "--scope", "BRK", "req.md"],
    { files: FILES },
  );
  assertEquals(code, 1);
  assertEquals(stdout, "");
  assertStringIncludes(stderr, "--scope");
  assertStringIncludes(stderr, "STK_{n:04d}");
});

Deno.test("next-id: an invalid --scope value fails", async () => {
  const { code, stdout, stderr } = await markspec(
    ["next-id", "software-requirement", "--scope", "B_K", "req.md"],
    { files: FILES },
  );
  assertEquals(code, 1);
  assertEquals(stdout, "");
  assertStringIncludes(stderr, "'B_K'");
  assertStringIncludes(stderr, "[A-Za-z0-9]+");
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

Deno.test("create --scope: scaffolds the next ID in that scope", async () => {
  const { code, stdout, stderr } = await markspec(
    ["create", "software-requirement", "--scope", "BRK", "req.md"],
    { files: FILES },
  );
  assertEquals(code, 0, stderr);
  assertStringIncludes(stdout, "- [SRS_BRK_0002] ");
  assert(!stdout.includes("{scope}"), stdout);
});

Deno.test("create: a {scope} pattern without --scope fails and prints no block", async () => {
  const { code, stdout, stderr } = await markspec(
    ["create", "software-requirement", "req.md"],
    { files: FILES },
  );
  assertEquals(code, 1);
  assertEquals(stdout, "");
  assertStringIncludes(stderr, "--scope");
  assertStringIncludes(stderr, "scopes in use: BRK, ENG");
});

Deno.test("create: --scope on a pattern without {scope} fails", async () => {
  const { code, stdout, stderr } = await markspec(
    ["create", "stakeholder-requirement", "--scope", "BRK", "req.md"],
    { files: FILES },
  );
  assertEquals(code, 1);
  assertEquals(stdout, "");
  assertStringIncludes(stderr, "--scope");
});

Deno.test("create: an invalid --scope value fails", async () => {
  const { code, stdout, stderr } = await markspec(
    ["create", "software-requirement", "--scope", "B-K", "req.md"],
    { files: FILES },
  );
  assertEquals(code, 1);
  assertEquals(stdout, "");
  assertStringIncludes(stderr, "'B-K'");
});

// ---------------------------------------------------------------------------
// insert
// ---------------------------------------------------------------------------

Deno.test("insert --scope: appends the next ID in that scope", async () => {
  const run = await markspecPersist(
    ["insert", "software-requirement", "--scope", "BRK", "req.md"],
    { files: FILES },
  );
  try {
    assertEquals(run.code, 0, run.stderr);
    assertStringIncludes(run.stderr, "SRS_BRK_0002");
    const text = await Deno.readTextFile(`${run.dir}/req.md`);
    assertStringIncludes(text, "- [SRS_BRK_0002] ");
    assert(!text.includes("{scope}"), text);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("insert: a {scope} pattern without --scope fails and writes nothing", async () => {
  const run = await markspecPersist(
    ["insert", "software-requirement", "req.md"],
    { files: FILES },
  );
  try {
    assertEquals(run.code, 1);
    assertStringIncludes(run.stderr, "--scope");
    assertStringIncludes(run.stderr, "scopes in use: BRK, ENG");
    assertEquals(await Deno.readTextFile(`${run.dir}/req.md`), REQ_MD);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("insert: --scope on a pattern without {scope} fails and writes nothing", async () => {
  const run = await markspecPersist(
    ["insert", "stakeholder-requirement", "--scope", "BRK", "req.md"],
    { files: FILES },
  );
  try {
    assertEquals(run.code, 1);
    assertStringIncludes(run.stderr, "--scope");
    assertEquals(await Deno.readTextFile(`${run.dir}/req.md`), REQ_MD);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

Deno.test("insert: an invalid --scope value fails and writes nothing", async () => {
  const run = await markspecPersist(
    ["insert", "software-requirement", "--scope", "B K", "req.md"],
    { files: FILES },
  );
  try {
    assertEquals(run.code, 1);
    assertStringIncludes(run.stderr, "'B K'");
    assertEquals(await Deno.readTextFile(`${run.dir}/req.md`), REQ_MD);
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// nothing between {scope} and the counter
// ---------------------------------------------------------------------------

const GLUED_FILES = {
  ...BASE_FILES,
  "profiles/acme/markspec.yaml": `id: "@acme/glued"
version: 0.1.0
profile:
  types:
    glued:
      extends: Requirement
      display-id-pattern: "G_{scope}{n:04d}"
`,
  "req.md": `# Requirements

- [G_BR10001] Scope BR1 request

  The controller shall respond within 100 ms.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`,
};

Deno.test("next-id --scope: an ID of another scope that starts with the scoped prefix does not count", async () => {
  // G_BR10001 classifies as scope BR1, number 0001: it is not in scope BR.
  const { code, stdout, stderr } = await markspec(
    ["next-id", "glued", "--scope", "BR", "req.md"],
    { files: GLUED_FILES },
  );
  assertEquals(code, 0, stderr);
  assertEquals(stdout.trim(), "G_BR0001");
});

Deno.test("next-id --scope: the scope the classifier reads keeps counting", async () => {
  const { code, stdout, stderr } = await markspec(
    ["next-id", "glued", "--scope", "BR1", "req.md"],
    { files: GLUED_FILES },
  );
  assertEquals(code, 0, stderr);
  assertEquals(stdout.trim(), "G_BR10002");
});

// ---------------------------------------------------------------------------
// a number wider than the padding
// ---------------------------------------------------------------------------

const OVERFLOW_FILES = {
  ...BASE_FILES,
  "req.md": `# Requirements

- [SRS_BRK_10000] Brake request

  The brake controller shall apply the brake within 100 ms.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: software-requirement
`,
};

Deno.test("next-id: the missing --scope error lists a scope whose only ID is wider than the padding", async () => {
  const { code, stderr } = await markspec(
    ["next-id", "software-requirement", "req.md"],
    { files: OVERFLOW_FILES },
  );
  assertEquals(code, 1);
  assertStringIncludes(stderr, "scopes in use: BRK");
});

Deno.test("next-id --scope: a number wider than the padding still moves the counter on", async () => {
  const { code, stdout, stderr } = await markspec(
    ["next-id", "software-requirement", "--scope", "BRK", "req.md"],
    { files: OVERFLOW_FILES },
  );
  assertEquals(code, 0, stderr);
  assertEquals(stdout.trim(), "SRS_BRK_10001");
});

Deno.test("next-id: --scope on a counter-less pattern with {scope} fails", async () => {
  const { code, stdout, stderr } = await markspec(
    ["next-id", "named-element", "--scope", "BRK", "req.md"],
    { files: FILES },
  );
  assertEquals(code, 1);
  assertEquals(stdout, "");
  assertStringIncludes(
    stderr,
    "--scope applies only to a numbered display-id-pattern with a {scope} " +
      "placeholder; 'XREQ_{scope}' is not one",
  );
});

// ---------------------------------------------------------------------------
// nothing between {scope} and the counter: never mint an existing ID (#1041)
// ---------------------------------------------------------------------------

/** Files for a `glued` type with `pattern`, and `req.md` holding `ids`. */
function gluedFiles(pattern: string, ids: readonly string[]) {
  const blocks = ids.map((id, i) =>
    `- [${id}] Request ${i + 1}

  The controller shall respond within 100 ms.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDE${i}
`
  ).join("\n");
  return {
    ...BASE_FILES,
    "profiles/acme/markspec.yaml": `id: "@acme/glued"
version: 0.1.0
profile:
  types:
    glued:
      extends: Requirement
      display-id-pattern: "${pattern}"
`,
    "req.md": `# Requirements\n\n${blocks}`,
  };
}

Deno.test("next-id --scope: a number wider than the padding is never minted twice (#1041)", async () => {
  // G_BR100 reads as scope BR1, number 00, so scope BR counts only
  // G_BR99. The next number, 100, gives G_BR100, which exists.
  const { code, stdout, stderr } = await markspec(
    ["next-id", "glued", "--scope", "BR", "req.md"],
    { files: gluedFiles("G_{scope}{n:02d}", ["G_BR99", "G_BR100"]) },
  );
  assertEquals(code, 0, stderr);
  assertEquals(stdout.trim(), "G_BR101");
});

Deno.test("next-id --scope: an unpadded counter is never minted twice from 10 upward (#1041)", async () => {
  // G_BR10 reads as scope BR1, number 0.
  const { code, stdout, stderr } = await markspec(
    ["next-id", "glued", "--scope", "BR", "req.md"],
    { files: gluedFiles("G_{scope}{n}", ["G_BR9", "G_BR10"]) },
  );
  assertEquals(code, 0, stderr);
  assertEquals(stdout.trim(), "G_BR11");
});

Deno.test("create --scope: a number wider than the padding is never minted twice (#1041)", async () => {
  const { code, stdout, stderr } = await markspec(
    ["create", "glued", "--scope", "BR", "req.md"],
    { files: gluedFiles("G_{scope}{n:02d}", ["G_BR99", "G_BR100"]) },
  );
  assertEquals(code, 0, stderr);
  assertStringIncludes(stdout, "- [G_BR101] ");
});

Deno.test("insert --scope: a number wider than the padding is never minted twice (#1041)", async () => {
  const run = await markspecPersist(
    ["insert", "glued", "--scope", "BR", "req.md"],
    { files: gluedFiles("G_{scope}{n:02d}", ["G_BR99", "G_BR100"]) },
  );
  try {
    assertEquals(run.code, 0, run.stderr);
    const text = await Deno.readTextFile(`${run.dir}/req.md`);
    assertStringIncludes(text, "- [G_BR101] ");
  } finally {
    await Deno.remove(run.dir, { recursive: true });
  }
});
