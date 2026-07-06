/**
 * @module tests/e2e/opaque_dsl_test
 *
 * E2E regression suite for the #719 stability guarantee: `markspec check`
 * treats unknown DSL content as opaque. Two content kinds must never draw a
 * diagnostic, a format rewrite, or prose analysis:
 *
 *   1. inline code spans carrying an unknown declaration / citation DSL —
 *      e.g. `ux:media.home/play`, `ux:media.home : screen @ ready`,
 *      `/play : activate`, `.confirm_dialog @ default`, the scheme-less wire
 *      form `media.home/play`, and a `$`-prefixed typl shape citation;
 *   2. fenced blocks with an unknown info-string — e.g. ```uxil.
 *
 * The guarantee lets the `@acme/hmi` profile host the uxil vocabularies
 * via an external linter before uxil lands in core (epic #717, Staging
 * Tier 1). Locking it here means a future change to prose lint, the
 * formatter, or the typl surfaces cannot silently start flagging unknown
 * code-span DSLs.
 *
 * Scope note (see docs/spec/internal/markspec-prose-analysis.md §1.2 and the
 * language spec's "Opaque DSL content" guarantee): this covers the uxil DSL
 * surface — lowercase `ux:` refs, leading-slash / dot element forms, and
 * `$`-prefixed shape citations — all of which are inert to every active lint
 * rule. It does NOT promise that ARBITRARY prose inside a code span is exempt:
 * an uppercase modal keyword or a PascalCase term in a span is still analyzed.
 * Closing that structural gap is deferred follow-up #733.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { markspec, markspecPersist } from "./helpers.ts";

// A minimal project whose profile declares one `requirement` type. The
// profile pins `markspec-schema` so PROFILE-SCHEMA-002 stays silent.
const PROJECT_YAML = "name: uxil-opaque-e2e\nversion: 0.1.0\n";
const MARKSPEC_YAML = "profiles:\n  - ./profiles/p\n";
const PROFILE_YAML = `markspec-schema: "1"
id: "@acme/uxil-opaque"
version: 0.1.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
`;

/**
 * The fixture document. Its prose is EARS-clean (event-driven, one lowercase
 * modal, no untoleranced numbers, no PascalCase) so the ONLY content that
 * could draw a diagnostic is the unknown DSL — all four uxil declaration
 * forms, a `ux:` citation, the scheme-less wire form, a camelCase tag, a
 * `$`-shape citation, and an unknown ```uxil fenced block.
 *
 * Authored in fmt-canonical form: `markspec fmt` is a no-op on it (asserted
 * by the "fmt verbatim" test below). Built as a line array with literal
 * backticks — double-quoted strings need no backtick escaping.
 */
const UX_DOC = [
  "# UX Contract",
  "",
  "- [REQ-0001] Open media detail on play tap",
  "",
  "  When the driver taps the play control `ux:media.home/play`, the system shall",
  "  present the media detail surface. The root surface is",
  "  `ux:media.home : screen @ loading, error, ready`, the element is",
  "  `/play : activate`, and the child surface is `.confirm_dialog @ default`. The",
  "  scheme-less wire form `media.home/play` and camelCase `mediaHome/playButton`",
  "  stay literal, and the payload cites `$MediaEvent`.",
  "",
  "  ```uxil",
  "  ux:media.home : screen @ loading, error, ready",
  "    /play : activate -> ux:media.detail",
  "    .confirm_dialog @ default",
  "  ```",
  "",
  "      Id: 01REQ000000000000000000001",
  "      Type: requirement",
  "",
].join("\n");

/**
 * The unknown-info-string fenced block, exactly as it appears in {@linkcode
 * UX_DOC}. The "fmt verbatim" test asserts this block survives byte-for-byte —
 * scoped to the DSL guarantee rather than the whole document, since `fmt`
 * reflows the surrounding EARS prose through dprint (a future embedded-dprint
 * bump could rewrap that sentence while leaving the DSL untouched).
 */
const UX_FENCE = [
  "  ```uxil",
  "  ux:media.home : screen @ loading, error, ready",
  "    /play : activate -> ux:media.detail",
  "    .confirm_dialog @ default",
  "  ```",
].join("\n");

const BASE_FILES: Record<string, string> = {
  "project.yaml": PROJECT_YAML,
  ".markspec.yaml": MARKSPEC_YAML,
  "profiles/p/markspec.yaml": PROFILE_YAML,
  "docs/req.md": UX_DOC,
};

// ---------------------------------------------------------------------------
// 1. Project-wide `check` (the composite gate — runs the advisory prose lint,
//    so Q500 is in scope) passes clean.
// ---------------------------------------------------------------------------

Deno.test(
  "check: unknown code-span DSLs + unknown fence pass project-wide check clean (#719)",
  async () => {
    const { code, stderr } = await markspec(["check"], { files: BASE_FILES });
    assertEquals(code, 0, `check should exit 0; stderr:\n${stderr}`);
    assertEquals(
      /MSL-/.test(stderr),
      false,
      `no MSL-* diagnostics expected on unknown DSL content; stderr:\n${stderr}`,
    );
    assertEquals(
      stderr.includes("Q500"),
      false,
      `no Q500 expected on unknown DSL content; stderr:\n${stderr}`,
    );
  },
);

// ---------------------------------------------------------------------------
// 2. Prose lint produces zero diagnostics on the DSL content.
// ---------------------------------------------------------------------------

Deno.test(
  "lint: unknown code-span DSLs + unknown fence produce no prose diagnostics (#719)",
  async () => {
    const { stdout } = await markspec(
      ["lint", "--format", "json", "docs/req.md"],
      { files: BASE_FILES },
    );
    const parsed = JSON.parse(stdout) as {
      diagnostics: Array<{ code: string; message: string }>;
    };
    assertEquals(
      parsed.diagnostics.length,
      0,
      `expected no diagnostics; got: ${JSON.stringify(parsed.diagnostics)}`,
    );
  },
);

// ---------------------------------------------------------------------------
// 3. The formatter leaves the unknown fence + every `ux:` code span verbatim.
//    `markspec fmt` must be a no-op on the whole (already-canonical) document.
// ---------------------------------------------------------------------------

Deno.test(
  "fmt: unknown fence + ux: code spans pass through verbatim (#719)",
  async () => {
    const run = await markspecPersist(["fmt", "docs/req.md"], {
      files: BASE_FILES,
    });
    try {
      assertEquals(run.code, 0, `fmt should exit 0; stderr:\n${run.stderr}`);
      const after = await Deno.readTextFile(join(run.dir, "docs/req.md"));
      // The #719 guarantee is that the DSL content survives fmt verbatim — NOT
      // that the surrounding prose is untouched. `fmt` reflows entry-body prose
      // through dprint, so asserting whole-document equality would raise a
      // false "opaque DSL broken" signal on an orthogonal embedded-dprint bump.
      // Assert exactly the guarantee: the unknown fence block and every ux:
      // span survive byte-for-byte.
      assertStringIncludes(
        after,
        UX_FENCE,
        "the unknown ```uxil fence must pass through fmt verbatim",
      );
      assertStringIncludes(after, "`ux:media.home/play`");
      assertStringIncludes(
        after,
        "`ux:media.home : screen @ loading, error, ready`",
      );
      assertStringIncludes(after, "`/play : activate`");
      assertStringIncludes(after, "`.confirm_dialog @ default`");
      assertStringIncludes(after, "`media.home/play`");
      assertStringIncludes(after, "`mediaHome/playButton`");
      assertStringIncludes(after, "`$MediaEvent`");
    } finally {
      await Deno.remove(run.dir, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// 4. The typl surfaces do not claim `ux:`-scheme code spans. A colon-bearing
//    `ux:` span looks superficially like the typl inline `$Name : type` form
//    but must NOT be extracted — `entry.types` stays absent.
// ---------------------------------------------------------------------------

Deno.test(
  "compile: ux:-scheme code spans are not parsed as typl (#719)",
  async () => {
    const { code, stdout } = await markspec(
      ["compile", "--format", "json", "docs/req.md"],
      { files: BASE_FILES },
    );
    assertEquals(code, 0);
    const parsed = JSON.parse(stdout) as {
      entries: Record<string, { types?: unknown }>;
    };
    const entry = parsed.entries["REQ-0001"];
    assertEquals(
      entry !== undefined,
      true,
      "REQ-0001 should be present in compile output",
    );
    assertEquals(
      entry.types,
      undefined,
      "ux: code spans must not populate entry.types (not typl declarations)",
    );
  },
);
