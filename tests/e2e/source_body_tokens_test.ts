/**
 * @module tests/e2e/source_body_tokens_test
 *
 * E2E test: `markspec compile --format json` over source-file doc-comment
 * entries produces non-empty `bodyTokens` with file-relative coordinates
 * pointing into the source file.
 */

import { assert, assertEquals } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: source-bodytokens-e2e\nversion: 0.1.0\n`;

const RUST_SRC = `/// [SRS_BRK_0001] Sensor debouncing
///
/// The sensor driver shall reject transient noise.
///
///     Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
fn dummy() {}
`;

const JAVA_SRC = `/**
 * [SRS_BRK_0002] Java entry
 *
 * The system shall do something.
 *
 *     Id: 01HGW2R9QLP4ABCDEFGHJKMNPQ
 */
class Dummy {}
`;

Deno.test(
  "compile: Rust source-file entry has file-relative bodyTokens",
  async () => {
    const { code, stdout, stderr } = await markspec(
      ["compile", "--format", "json", "lib.rs"],
      {
        files: { "project.yaml": PROJECT_YAML, "lib.rs": RUST_SRC },
        permissions: ["--allow-env", "--allow-ffi"],
      },
    );
    assertEquals(code, 0, `stderr: ${stderr}`);
    const compiled = JSON.parse(stdout);
    const entry = compiled.entries["SRS_BRK_0001"];
    assert(entry, "SRS_BRK_0001 missing from compile output");
    // bodyTokens is non-empty and includes a modal token.
    const modals = (entry.bodyTokens as Array<
      { kind: string; text: string; location: { file: string; line: number } }
    >)
      .filter((t) => t.kind === "modal");
    assertEquals(modals.length, 1);
    assertEquals(modals[0].text, "shall");
    assertEquals(modals[0].location.line, 3);
    assertEquals(modals[0].location.file, "lib.rs");
  },
);

Deno.test(
  "compile: Java source-file entry has file-relative bodyTokens",
  async () => {
    const { code, stdout, stderr } = await markspec(
      ["compile", "--format", "json", "Foo.java"],
      {
        files: { "project.yaml": PROJECT_YAML, "Foo.java": JAVA_SRC },
        permissions: ["--allow-env", "--allow-ffi"],
      },
    );
    assertEquals(code, 0, `stderr: ${stderr}`);
    const compiled = JSON.parse(stdout);
    const entry = compiled.entries["SRS_BRK_0002"];
    assert(entry, "SRS_BRK_0002 missing from compile output");
    const modals = (entry.bodyTokens as Array<
      { kind: string; text: string; location: { file: string; line: number } }
    >)
      .filter((t) => t.kind === "modal");
    assertEquals(modals.length, 1);
    assertEquals(modals[0].location.line, 4);
    assertEquals(modals[0].location.file, "Foo.java");
  },
);
