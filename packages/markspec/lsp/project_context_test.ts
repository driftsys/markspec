/**
 * @module lsp/project_context_test
 *
 * Wiring tests for {@linkcode ProjectContext.publishAllDiagnostics}: the
 * project's config reaches the core pipeline (#938).
 */

import { assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";
import { ProjectContext, type ProjectContextHost } from "./project_context.ts";
import { pathToUri } from "./util.ts";

/** Absolute project root: on Windows it carries a drive letter. */
const ROOT = resolve("/proj");

/** Lookup key for the fake file system: `/` separators on every platform,
 * so a path built with `join` and one built with `/` find the same file. */
function key(path: string): string {
  return path.replaceAll("\\", "/");
}

const PROFILE_YAML = `id: "@acme/wiring"
version: 0.1.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
    system-requirement:
      extends: Requirement
      display-id-pattern: "SREQ-{n:04d}"
      traceability:
        Satisfies:
          target: [requirement]
          cardinality: 0..3
          required: false
`;

const TRACE_MD = `- [SREQ-0001] A system requirement

  Body text.

      Id: 01SREQ00000000000000000001
      Type: system-requirement
      Satisfies: REQ-0099
`;

const CAPTION_MD = `# Requirements

- [REQ-0001] System diagram requirement

  See the brake diagram below.

  ![Brake diagram](brake.svg)

  Figure: Brake pressure schematic

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

/** Load a context over in-memory files, index `md`, publish, and return the
 * diagnostic codes published for `doc.md` at the root. */
async function publishedCodes(
  files: Record<string, string>,
  md: string,
): Promise<string[]> {
  const published = new Map<string, string[]>();
  const byKey = new Map(
    Object.entries(files).map(([path, text]) => [key(path), text]),
  );
  const docPath = join(ROOT, "doc.md");
  const host: ProjectContextHost = {
    readFile: (path) => Promise.resolve(byKey.get(key(path))),
    realPath: (path) => Promise.resolve(path),
    readDir: async function* () {},
    sendDiagnostics: (uri, diagnostics) =>
      published.set(uri, diagnostics.map((d) => d.code)),
    sendNotification: () => {},
    refreshLenses: () => {},
    log: () => {},
    warn: () => {},
    logEvent: () => {},
  };
  const ctx = new ProjectContext(ROOT, host);
  await ctx.load();
  await ctx.index.parseAndUpdateFile(docPath, md);
  ctx.publishAllDiagnostics();
  ctx.dispose();
  return published.get(pathToUri(docPath)) ?? [];
}

const PROFILE_FILES = {
  [`${ROOT}/.markspec.yaml`]: "profiles:\n  - ./profiles/p\n",
  [`${ROOT}/profiles/p/markspec.yaml`]: PROFILE_YAML,
};

Deno.test("ProjectContext: an unresolved trace target is MSL-L006 without declared upstreams", async () => {
  const codes = await publishedCodes({
    ...PROFILE_FILES,
    [`${ROOT}/project.yaml`]: "name: p\nversion: 0.1.0\n",
  }, TRACE_MD);
  assertEquals(codes.filter((c) => c === "MSL-L006").length, 1);
  assertEquals(codes.includes("MSL-T014"), false);
});

Deno.test("ProjectContext: project.yaml dependencies make an unresolved trace target MSL-T014", async () => {
  const codes = await publishedCodes({
    ...PROFILE_FILES,
    [`${ROOT}/project.yaml`]:
      "name: p\nversion: 0.1.0\ndependencies:\n  - url: https://example.invalid/icd.git\n    name: icd\n    version: v1.0.0\n",
  }, TRACE_MD);
  assertEquals(codes.filter((c) => c === "MSL-T014").length, 1);
  assertEquals(codes.includes("MSL-L006"), false);
});

Deno.test("ProjectContext: .markspec.yaml caption-conventions reach the pipeline as MSL-C072", async () => {
  const codes = await publishedCodes({
    [`${ROOT}/.markspec.yaml`]: "caption-conventions:\n  Figure: above\n",
    [`${ROOT}/project.yaml`]: "name: p\nversion: 0.1.0\n",
  }, CAPTION_MD);
  assertEquals(codes.includes("MSL-C072"), true);
  const without = await publishedCodes({
    [`${ROOT}/project.yaml`]: "name: p\nversion: 0.1.0\n",
  }, CAPTION_MD);
  assertEquals(without.includes("MSL-C072"), false);
});
