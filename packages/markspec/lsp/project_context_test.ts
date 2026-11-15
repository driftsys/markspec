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

/** A context over an in-memory file system, with the diagnostics it sends. */
interface Fixture {
  readonly ctx: ProjectContext;
  /** File contents by {@linkcode key}; tests change it to simulate edits. */
  readonly files: Map<string, string>;
  /** The latest diagnostics sent per URI. */
  readonly published: Map<string, { code: string; message: string }[]>;
}

/** Build a loaded context. `readDir` lists the in-memory files, so
 * {@linkcode ProjectContext.indexProject} walks them. */
async function fixture(files: Record<string, string>): Promise<Fixture> {
  const published = new Map<string, { code: string; message: string }[]>();
  const byKey = new Map(
    Object.entries(files).map(([path, text]) => [key(path), text]),
  );
  const host: ProjectContextHost = {
    readFile: (path) => Promise.resolve(byKey.get(key(path))),
    realPath: (path) => Promise.resolve(path),
    readDir: async function* (dir) {
      const prefix = key(dir).replace(/\/+$/, "") + "/";
      const seen = new Map<string, boolean>();
      for (const file of byKey.keys()) {
        if (!file.startsWith(prefix)) continue;
        const [first, ...rest] = file.slice(prefix.length).split("/");
        seen.set(first, rest.length > 0);
      }
      for (const [name, isDirectory] of seen) {
        yield { name, isDirectory, isFile: !isDirectory };
      }
    },
    sendDiagnostics: (uri, diagnostics) =>
      published.set(
        uri,
        diagnostics.map((d) => ({ code: d.code, message: d.message })),
      ),
    sendNotification: () => {},
    refreshLenses: () => {},
    log: () => {},
    warn: () => {},
    logEvent: () => {},
  };
  const ctx = new ProjectContext(ROOT, host);
  await ctx.load();
  return { ctx, files: byKey, published };
}

/** Load a context over in-memory files, index `md`, publish, and return the
 * diagnostics published for `doc.md` at the root. */
async function publishedFor(
  files: Record<string, string>,
  md: string,
): Promise<{ code: string; message: string }[]> {
  const { ctx, published } = await fixture(files);
  const docPath = join(ROOT, "doc.md");
  await ctx.index.parseAndUpdateFile(docPath, md);
  ctx.publishAllDiagnostics();
  ctx.dispose();
  return published.get(pathToUri(docPath)) ?? [];
}

async function publishedCodes(
  files: Record<string, string>,
  md: string,
): Promise<string[]> {
  return (await publishedFor(files, md)).map((d) => d.code);
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

const DEPENDENCY_PROJECT =
  "name: p\nversion: 0.1.0\ndependencies:\n  - url: https://example.invalid/icd-upstream.git\n    version: v1.0.0\n";

Deno.test("ProjectContext: the declared upstream id is derived from the url, not copied from it", async () => {
  const diags = await publishedFor({
    ...PROFILE_FILES,
    [`${ROOT}/project.yaml`]: DEPENDENCY_PROJECT,
  }, TRACE_MD);
  const t014 = diags.filter((d) => d.code === "MSL-T014");
  assertEquals(t014.length, 1);
  assertEquals(t014[0].message.includes("icd-upstream"), true);
  assertEquals(t014[0].message.includes("example.invalid"), false);
});

Deno.test("ProjectContext: project.yaml references make an unresolved trace target MSL-T014", async () => {
  const codes = await publishedCodes({
    ...PROFILE_FILES,
    [`${ROOT}/project.yaml`]:
      "name: p\nversion: 0.1.0\nreferences:\n  - url: https://example.invalid/icd-ref.git\n    version: v1.0.0\n",
  }, TRACE_MD);
  assertEquals(codes.filter((c) => c === "MSL-T014").length, 1);
  assertEquals(codes.includes("MSL-L006"), false);
});

Deno.test("ProjectContext: a reference with no derivable id declares no upstream", async () => {
  const codes = await publishedCodes({
    ...PROFILE_FILES,
    [`${ROOT}/project.yaml`]:
      "name: p\nversion: 0.1.0\ndependencies:\n  - url: https://example.invalid/.git\n    version: v1.0.0\n",
  }, TRACE_MD);
  assertEquals(codes.filter((c) => c === "MSL-L006").length, 1);
  assertEquals(codes.includes("MSL-T014"), false);
});

Deno.test("ProjectContext: a project.yaml reload is picked up by the next validation", async () => {
  const { ctx, files, published } = await fixture({
    ...PROFILE_FILES,
    [`${ROOT}/project.yaml`]: "name: p\nversion: 0.1.0\n",
  });
  const docPath = join(ROOT, "doc.md");
  await ctx.index.parseAndUpdateFile(docPath, TRACE_MD);
  ctx.publishAllDiagnostics();
  const first = published.get(pathToUri(docPath))!.map((d) => d.code);
  assertEquals(first.includes("MSL-L006"), true);

  files.set(key(`${ROOT}/project.yaml`), DEPENDENCY_PROJECT);
  const reload = await ctx.reloadProfile();
  assertEquals(reload.ok, true);
  ctx.publishAllDiagnostics();
  const second = published.get(pathToUri(docPath))!.map((d) => d.code);
  ctx.dispose();
  assertEquals(second.includes("MSL-T014"), true);
  assertEquals(second.includes("MSL-L006"), false);
});

// --- closing a buffer (D6, #938) ---

const TARGET_MD = `- [REQ-0001] A requirement

  Body text.

      Id: 01REQ000000000000000000001
      Type: requirement
`;

const CITING_MD = TRACE_MD.replace("REQ-0099", "REQ-0001");

/** A walked project with `doc.md` citing `REQ-0001` in `target.md`. */
async function walkedProject(): Promise<Fixture> {
  const f = await fixture({
    ...PROFILE_FILES,
    [`${ROOT}/project.yaml`]: "name: p\nversion: 0.1.0\n",
    [`${ROOT}/doc.md`]: CITING_MD,
    [`${ROOT}/target.md`]: TARGET_MD,
  });
  await f.ctx.indexProject(() => true);
  return f;
}

function codesFor(f: Fixture, name: string): string[] {
  return (f.published.get(pathToUri(join(ROOT, name))) ?? []).map((d) =>
    d.code
  );
}

Deno.test("ProjectContext.closeFile: a walked file is parsed again from disk, so links to it still resolve", async () => {
  const f = await walkedProject();
  const target = join(ROOT, "target.md");
  // The open buffer replaced the entries with an edit that renames the id.
  await f.ctx.index.parseAndUpdateFile(
    target,
    TARGET_MD.replace("REQ-0001", "REQ-0002"),
  );
  await f.ctx.closeFile(target);
  f.ctx.publishAllDiagnostics();
  f.ctx.dispose();
  assertEquals(codesFor(f, "doc.md").includes("MSL-L006"), false);
});

Deno.test("ProjectContext.closeFile: the disk text's parse diagnostics are kept", async () => {
  const f = await walkedProject();
  const target = join(ROOT, "target.md");
  // The saved file now has an empty trailer key, which is MSL-P021.
  f.files.set(
    key(target),
    TARGET_MD.replace(
      "      Type: requirement\n",
      "      Type: requirement\n      Satisfies:\n",
    ),
  );
  await f.ctx.closeFile(target);
  const codes = f.ctx.index.getParseDiagnostics(target).map((d) => d.code);
  f.ctx.dispose();
  assertEquals(codes.includes("MSL-P021"), true);
});

Deno.test("ProjectContext.closeFile: a walked file deleted from disk is removed", async () => {
  const f = await walkedProject();
  f.files.delete(key(join(ROOT, "target.md")));
  await f.ctx.closeFile(join(ROOT, "target.md"));
  f.ctx.publishAllDiagnostics();
  f.ctx.dispose();
  assertEquals(codesFor(f, "doc.md").includes("MSL-L006"), true);
});

Deno.test("ProjectContext.closeFile: a file outside the walk is removed", async () => {
  const f = await walkedProject();
  const outside = join(ROOT, "later.md");
  f.files.set(key(outside), TARGET_MD.replace("REQ-0001", "REQ-0003"));
  await f.ctx.index.parseAndUpdateFile(outside, f.files.get(key(outside))!);
  await f.ctx.closeFile(outside);
  assertEquals(f.ctx.index.getEntriesForFile(outside), []);
  f.ctx.dispose();
});

Deno.test("ProjectContext.closeFile: a reopen during the read wins", async () => {
  const f = await walkedProject();
  const target = join(ROOT, "target.md");
  const buffer = TARGET_MD.replace("REQ-0001", "REQ-0002");
  await f.ctx.index.parseAndUpdateFile(target, buffer);
  await f.ctx.closeFile(target, () => false);
  const ids = f.ctx.index.getEntriesForFile(target).map((e) => e.displayId);
  f.ctx.dispose();
  assertEquals(ids, ["REQ-0002"]);
});

Deno.test("ProjectContext.closeFile: a reopen during the parse keeps the reopened buffer's entries", async () => {
  const f = await walkedProject();
  const target = join(ROOT, "target.md");
  let scheduled = 0;
  f.ctx.scheduleValidateAll = () => {
    scheduled++;
  };
  // Closed after the read; the reopened buffer's parse lands while the
  // close's disk parse is still pending, so the second check sees a reopen.
  const answers = [true];
  const closing = f.ctx.closeFile(target, () => {
    const answer = answers.shift() ?? false;
    return answer;
  });
  await f.ctx.index.parseAndUpdateFile(
    target,
    TARGET_MD.replace("REQ-0001", "REQ-0002"),
  );
  await closing;
  const ids = f.ctx.index.getEntriesForFile(target).map((e) => e.displayId);
  f.ctx.dispose();
  assertEquals(ids, ["REQ-0002"]);
  assertEquals(scheduled, 0);
});

Deno.test("ProjectContext.closeFile: a reopen wins for a walked file deleted from disk", async () => {
  const f = await walkedProject();
  const target = join(ROOT, "target.md");
  await f.ctx.index.parseAndUpdateFile(
    target,
    TARGET_MD.replace("REQ-0001", "REQ-0002"),
  );
  f.files.delete(key(target));
  await f.ctx.closeFile(target, () => false);
  const ids = f.ctx.index.getEntriesForFile(target).map((e) => e.displayId);
  f.ctx.dispose();
  assertEquals(ids, ["REQ-0002"]);
});

Deno.test("ProjectContext.closeFile: a file removed on close is not read again when it comes back on disk", async () => {
  const f = await walkedProject();
  const target = join(ROOT, "target.md");
  f.files.delete(key(target));
  await f.ctx.closeFile(target);
  assertEquals(f.ctx.index.getEntriesForFile(target), []);
  // The file is created again on disk; the walk no longer lists it for this
  // context, so a second close removes it instead of reading it.
  f.files.set(key(target), TARGET_MD);
  await f.ctx.closeFile(target);
  const entries = f.ctx.index.getEntriesForFile(target);
  f.ctx.dispose();
  assertEquals(entries, []);
});
