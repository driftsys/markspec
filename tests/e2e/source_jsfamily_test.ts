/**
 * @module tests/e2e/source_jsfamily_test
 *
 * E2E test: `markspec compile --format json` over TS / TSX / JS source-file
 * doc-comment entries produces correct entries with `properties.source`
 * populated from the JS-family extractor.
 */

import { assert, assertEquals } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: source-jsfamily-e2e\nversion: 0.1.0\n`;

const TS_SRC = `/**
 * [SRS_BRK_0001] TypeScript entry
 *
 * The system shall do something.
 *
 *     Id: 01HGW2R9QLP4ABCDEFGHJKMNPQ
 */
export class BrakingSensor {}
`;

const TSX_SRC = `/**
 * [SRS_BRK_0002] TSX entry
 *
 * The system shall do something.
 *
 *     Id: 01HGW2R9QLP4ABCDEFGHJKMNP0
 */
export const BrakingSensor = () => <div>x</div>;
`;

const JS_SRC = `/**
 * [SRS_BRK_0003] JavaScript entry
 *
 * The system shall do something.
 *
 *     Id: 01HGW2R9QLP4ABCDEFGHJKMNP1
 */
export const BrakingSensor = function () {};
`;

Deno.test("compile: TypeScript source-file entry populates properties.source", async () => {
  const { code, stdout, stderr } = await markspec(
    ["compile", "--format", "json", "lib.ts"],
    {
      files: { "project.yaml": PROJECT_YAML, "lib.ts": TS_SRC },
      permissions: ["--allow-env", "--allow-ffi"],
    },
  );
  assertEquals(code, 0, `stderr: ${stderr}`);
  const compiled = JSON.parse(stdout);
  const entry = compiled.entries["SRS_BRK_0001"];
  assert(entry, "SRS_BRK_0001 missing from compile output");
  assertEquals(entry.properties.source.type, "code");
  assertEquals(entry.properties.source.adapter, "tree-sitter");
  assertEquals(entry.properties.source.language, "typescript");
  assertEquals(entry.properties.source.function, "BrakingSensor");
  assertEquals(entry.properties.source.rule, "block-doc-comment");
});

Deno.test("compile: TSX source-file entry populates properties.source", async () => {
  const { code, stdout, stderr } = await markspec(
    ["compile", "--format", "json", "App.tsx"],
    {
      files: { "project.yaml": PROJECT_YAML, "App.tsx": TSX_SRC },
      permissions: ["--allow-env", "--allow-ffi"],
    },
  );
  assertEquals(code, 0, `stderr: ${stderr}`);
  const compiled = JSON.parse(stdout);
  const entry = compiled.entries["SRS_BRK_0002"];
  assert(entry, "SRS_BRK_0002 missing from compile output");
  assertEquals(entry.properties.source.type, "code");
  assertEquals(entry.properties.source.adapter, "tree-sitter");
  assertEquals(entry.properties.source.language, "tsx");
  assertEquals(entry.properties.source.function, "BrakingSensor");
  assertEquals(entry.properties.source.rule, "block-doc-comment");
});

Deno.test("compile: JavaScript source-file entry populates properties.source", async () => {
  const { code, stdout, stderr } = await markspec(
    ["compile", "--format", "json", "lib.js"],
    {
      files: { "project.yaml": PROJECT_YAML, "lib.js": JS_SRC },
      permissions: ["--allow-env", "--allow-ffi"],
    },
  );
  assertEquals(code, 0, `stderr: ${stderr}`);
  const compiled = JSON.parse(stdout);
  const entry = compiled.entries["SRS_BRK_0003"];
  assert(entry, "SRS_BRK_0003 missing from compile output");
  assertEquals(entry.properties.source.type, "code");
  assertEquals(entry.properties.source.adapter, "tree-sitter");
  assertEquals(entry.properties.source.language, "javascript");
  assertEquals(entry.properties.source.function, "BrakingSensor");
  assertEquals(entry.properties.source.rule, "block-doc-comment");
});
