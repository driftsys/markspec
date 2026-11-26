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
import {
  buildBlockScaffoldItems,
  buildMidTypedScaffoldItems,
  type EntryTypeInfo,
} from "./completions.ts";

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
  /** Called on every directory listing, so a test can act while the
   * project walk or the discovery check lists directories. */
  readonly hooks: { onReadDir?: (dir: string) => void };
}

/** Build a loaded context. `readDir` lists the in-memory files, so
 * {@linkcode ProjectContext.indexProject} walks them. */
async function fixture(
  files: Record<string, string>,
  root: string = ROOT,
): Promise<Fixture> {
  const hooks: Fixture["hooks"] = {};
  const published = new Map<string, { code: string; message: string }[]>();
  const byKey = new Map(
    Object.entries(files).map(([path, text]) => [key(path), text]),
  );
  const host: ProjectContextHost = {
    readFile: (path) => Promise.resolve(byKey.get(key(path))),
    realPath: (path) => Promise.resolve(path),
    readDir: async function* (dir) {
      hooks.onReadDir?.(dir);
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
  const ctx = new ProjectContext(root, host);
  await ctx.load();
  return { ctx, files: byKey, published, hooks };
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

Deno.test("ProjectContext.closeFile: a file created after startup that the walk would include is kept and parsed from disk (#955)", async () => {
  const f = await walkedProject();
  const created = join(ROOT, "later.md");
  const disk = TARGET_MD.replace("REQ-0001", "REQ-0003");
  f.files.set(key(created), disk);
  // The open buffer held an unsaved variant; the saved disk text differs.
  await f.ctx.index.parseAndUpdateFile(
    created,
    disk.replace("REQ-0003", "REQ-0004"),
  );
  await f.ctx.closeFile(created);
  const ids = f.ctx.index.getEntriesForFile(created).map((e) => e.displayId);
  // It is now a walked file: a later close parses it from disk again.
  await f.ctx.closeFile(created);
  const idsAgain = f.ctx.index.getEntriesForFile(created).map((e) =>
    e.displayId
  );
  f.ctx.dispose();
  assertEquals(ids, ["REQ-0003"]);
  assertEquals(idsAgain, ["REQ-0003"]);
});

Deno.test("ProjectContext.closeFile: a file created after startup keeps links to it resolving (#955)", async () => {
  const f = await walkedProject();
  const created = join(ROOT, "later.md");
  f.files.set(key(created), TARGET_MD.replace("REQ-0001", "REQ-0003"));
  await f.ctx.index.parseAndUpdateFile(created, f.files.get(key(created))!);
  await f.ctx.closeFile(created);
  f.files.set(
    key(join(ROOT, "doc.md")),
    TRACE_MD.replace("REQ-0099", "REQ-0003"),
  );
  await f.ctx.index.parseAndUpdateFile(
    join(ROOT, "doc.md"),
    f.files.get(key(join(ROOT, "doc.md")))!,
  );
  f.ctx.publishAllDiagnostics();
  f.ctx.dispose();
  assertEquals(codesFor(f, "doc.md").includes("MSL-L006"), false);
});

Deno.test("ProjectContext.closeFile: a reopen during the discovery check keeps the reopened buffer's entries (#955)", async () => {
  const f = await walkedProject();
  f.ctx.toolConfig = { ...f.ctx.toolConfig, exclude: ["skipped/"] };
  const created = join(ROOT, "skipped", "later.md");
  await f.ctx.index.parseAndUpdateFile(
    created,
    TARGET_MD.replace("REQ-0001", "REQ-0003"),
  );
  // The buffer is reopened while the discovery check lists directories, so
  // stillClosed is true before that check and false after it.
  let reopened = false;
  f.hooks.onReadDir = () => reopened = true;
  await f.ctx.closeFile(created, () => !reopened);
  const ids = f.ctx.index.getEntriesForFile(created).map((e) => e.displayId);
  f.ctx.dispose();
  assertEquals(reopened, true);
  assertEquals(ids, ["REQ-0003"]);
});

Deno.test("ProjectContext.closeFile: a file kept on close joins the walked set, so a later close keeps it even when the rules now exclude it (#955)", async () => {
  const f = await walkedProject();
  const created = join(ROOT, "later.md");
  f.files.set(key(created), TARGET_MD.replace("REQ-0001", "REQ-0003"));
  await f.ctx.index.parseAndUpdateFile(created, f.files.get(key(created))!);
  await f.ctx.closeFile(created);
  f.ctx.toolConfig = { ...f.ctx.toolConfig, exclude: ["later.md"] };
  // The saved text changes between the closes: the second close must read
  // the disk again, not return early.
  f.files.set(key(created), TARGET_MD.replace("REQ-0001", "REQ-0005"));
  await f.ctx.closeFile(created);
  const ids = f.ctx.index.getEntriesForFile(created).map((e) => e.displayId);
  f.ctx.dispose();
  assertEquals(ids, ["REQ-0005"]);
});

Deno.test("ProjectContext.closeFile: a context indexed without inheritance keeps a file that only an enclosing .gitignore names (#955)", async () => {
  const nested = join(ROOT, "nested");
  const f = await fixture({
    [`${ROOT}/.gitignore`]: "secret.md\n",
    [`${nested}/project.yaml`]: "name: n\nversion: 0.1.0\n",
    [`${nested}/old.md`]: TARGET_MD,
  }, nested);
  await f.ctx.indexProject(() => true);
  const created = join(nested, "secret.md");
  f.files.set(key(created), TARGET_MD.replace("REQ-0001", "REQ-0003"));
  await f.ctx.index.parseAndUpdateFile(created, f.files.get(key(created))!);
  await f.ctx.closeFile(created);
  const ids = f.ctx.index.getEntriesForFile(created).map((e) => e.displayId);
  f.ctx.dispose();
  assertEquals(ids, ["REQ-0003"]);
});

Deno.test("ProjectContext.closeFile: a nested project applies the enclosing project's .gitignore to a file created after startup (#955)", async () => {
  const nested = join(ROOT, "nested");
  const f = await fixture({
    [`${ROOT}/.gitignore`]: "secret.md\n",
    [`${nested}/project.yaml`]: "name: n\nversion: 0.1.0\n",
    [`${nested}/old.md`]: TARGET_MD,
  }, nested);
  await f.ctx.indexProject(() => true, () => undefined, ROOT);
  const hidden = join(nested, "secret.md");
  const open = join(nested, "open.md");
  for (const [path, id] of [[hidden, "REQ-0003"], [open, "REQ-0004"]]) {
    f.files.set(key(path), TARGET_MD.replace("REQ-0001", id));
    await f.ctx.index.parseAndUpdateFile(path, f.files.get(key(path))!);
    await f.ctx.closeFile(path);
  }
  const hiddenEntries = f.ctx.index.getEntriesForFile(hidden);
  const openIds = f.ctx.index.getEntriesForFile(open).map((e) => e.displayId);
  f.ctx.dispose();
  assertEquals(hiddenEntries, []);
  assertEquals(openIds, ["REQ-0004"]);
});

Deno.test("ProjectContext.closeFile: a context that never ran a walk removes the closed file", async () => {
  const f = await fixture({
    [`${ROOT}/project.yaml`]: "name: p\nversion: 0.1.0\n",
  });
  const created = join(ROOT, "later.md");
  f.files.set(key(created), TARGET_MD);
  await f.ctx.index.parseAndUpdateFile(created, TARGET_MD);
  await f.ctx.closeFile(created);
  assertEquals(f.ctx.index.getEntriesForFile(created), []);
  f.ctx.dispose();
});

Deno.test("ProjectContext.closeFile: a file created after startup that the exclude list covers is removed", async () => {
  const f = await walkedProject();
  f.ctx.toolConfig = { ...f.ctx.toolConfig, exclude: ["skipped/"] };
  const created = join(ROOT, "skipped", "later.md");
  f.files.set(key(created), TARGET_MD.replace("REQ-0001", "REQ-0003"));
  await f.ctx.index.parseAndUpdateFile(created, f.files.get(key(created))!);
  await f.ctx.closeFile(created);
  assertEquals(f.ctx.index.getEntriesForFile(created), []);
  f.ctx.dispose();
});

Deno.test("ProjectContext.closeFile: a file created after startup that is missing on disk is removed", async () => {
  const f = await walkedProject();
  const created = join(ROOT, "later.md");
  await f.ctx.index.parseAndUpdateFile(
    created,
    TARGET_MD.replace("REQ-0001", "REQ-0003"),
  );
  await f.ctx.closeFile(created);
  assertEquals(f.ctx.index.getEntriesForFile(created), []);
  f.ctx.dispose();
});

Deno.test("ProjectContext.closeFile: a file this context does not own is removed", async () => {
  const f = await fixture({
    ...PROFILE_FILES,
    [`${ROOT}/project.yaml`]: "name: p\nversion: 0.1.0\n",
    [`${ROOT}/target.md`]: TARGET_MD,
  });
  await f.ctx.indexProject((path) => !path.includes("nested"));
  const foreign = join(ROOT, "nested", "x.md");
  f.files.set(key(foreign), TARGET_MD.replace("REQ-0001", "REQ-0003"));
  await f.ctx.index.parseAndUpdateFile(foreign, f.files.get(key(foreign))!);
  await f.ctx.closeFile(foreign);
  assertEquals(f.ctx.index.getEntriesForFile(foreign), []);
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

Deno.test("ProjectContext.closeFile: a file removed on close is kept when it comes back on disk and the walk includes it (#955)", async () => {
  const f = await walkedProject();
  const target = join(ROOT, "target.md");
  f.files.delete(key(target));
  await f.ctx.closeFile(target);
  assertEquals(f.ctx.index.getEntriesForFile(target), []);
  // The file is created again on disk; the walk would include it, so a
  // second close parses it from disk.
  f.files.set(key(target), TARGET_MD);
  await f.ctx.closeFile(target);
  const ids = f.ctx.index.getEntriesForFile(target).map((e) => e.displayId);
  f.ctx.dispose();
  assertEquals(ids, ["REQ-0001"]);
});

// ---------------------------------------------------------------------------
// {scope} placeholder in scaffold types (#1038)
// ---------------------------------------------------------------------------

const SCOPED_PROFILE_YAML = `id: "@acme/scoped"
version: 0.1.0
profile:
  types:
    software-requirement:
      extends: Requirement
      display-id-pattern: "SRS_{scope}_{n:04d}"
`;

const SCOPED_MD = `- [SRS_BRK_0001] Brake request

  Body text.

      Id: 01SRS000000000000000000001

- [SRS_ENG_0004] Engine request

  Body text.

      Id: 01SRS000000000000000000002
`;

/** A loaded context with the scoped profile and {@linkcode SCOPED_MD}. */
async function scopedContext(): Promise<ProjectContext> {
  const { ctx } = await fixture({
    [`${ROOT}/.markspec.yaml`]: "profiles:\n  - ./profiles/p\n",
    [`${ROOT}/profiles/p/markspec.yaml`]: SCOPED_PROFILE_YAML,
    [`${ROOT}/project.yaml`]: "name: p\nversion: 0.1.0\n",
  });
  await ctx.index.parseAndUpdateFile(join(ROOT, "doc.md"), SCOPED_MD);
  return ctx;
}

/** The scaffold labels for `types`, as the bare `- [` trigger offers them. */
function scaffoldLabels(types: readonly EntryTypeInfo[]): string[] {
  return buildBlockScaffoldItems(types, () => "01HFAKEULID00000000000000")
    .map((i) => i.label);
}

Deno.test("ProjectContext.getEntryTypes: a scoped type offers one scaffold per scope in use plus a SCOPE template (#1038)", async () => {
  const ctx = await scopedContext();
  const types = ctx.getEntryTypes();
  ctx.dispose();
  assertEquals(scaffoldLabels(types), [
    "New software-requirement (SRS_BRK_0002)",
    "New software-requirement (SRS_ENG_0005)",
    "New software-requirement (SRS_SCOPE_NNNN)",
  ]);
  for (const type of types) assertEquals(type.prefix.includes("{"), false);
});

Deno.test("ProjectContext.getEntryTypes: a partial that holds a scope offers only that scope (#1038)", async () => {
  const ctx = await scopedContext();
  const brk = ctx.getEntryTypes("SRS_BRK_");
  const longer = ctx.getEntryTypes("SRS_BRK_00");
  const fresh = ctx.getEntryTypes("SRS_STR_");
  ctx.dispose();
  assertEquals(scaffoldLabels(brk), [
    "New software-requirement (SRS_BRK_0002)",
  ]);
  assertEquals(scaffoldLabels(longer), [
    "New software-requirement (SRS_BRK_0002)",
  ]);
  assertEquals(scaffoldLabels(fresh), [
    "New software-requirement (SRS_STR_0001)",
  ]);
});

Deno.test("ProjectContext.getEntryTypes: a shorter partial offers the matching scopes in use and the template (#1038)", async () => {
  const ctx = await scopedContext();
  const range = {
    start: { line: 0, character: 3 },
    end: { line: 0, character: 8 },
  };
  const items = buildMidTypedScaffoldItems(
    ctx.getEntryTypes("SRS_B"),
    "SRS_B",
    () => "01HFAKEULID00000000000000",
    range,
  );
  ctx.dispose();
  assertEquals(items.map((i) => i.label), [
    "New software-requirement (SRS_BRK_0002)",
    "New software-requirement (SRS_SCOPE_NNNN)",
  ]);
});

Deno.test("ProjectContext.releaseObservedReservations: releases a reservation of a scoped display ID (#1038)", async () => {
  const ctx = await scopedContext();
  ctx.reservations.reserve("SRS_BRK_", "", 2);
  ctx.reservations.reserve("SRS_ENG_", "", 5);
  const docPath = join(ROOT, "doc.md");
  await ctx.index.parseAndUpdateFile(
    docPath,
    SCOPED_MD + `
- [SRS_BRK_0002] Second brake request

  Body text.

      Id: 01SRS000000000000000000003
`,
  );
  ctx.releaseObservedReservations(docPath);
  ctx.dispose();
  assertEquals(ctx.reservations.isReserved("SRS_BRK_", "", 2), false);
  assertEquals(ctx.reservations.isReserved("SRS_ENG_", "", 5), true);
});

/** A loaded context with one type of `pattern` and `md` indexed. */
async function contextWithPattern(
  pattern: string,
  md: string,
): Promise<ProjectContext> {
  const { ctx } = await fixture({
    [`${ROOT}/.markspec.yaml`]: "profiles:\n  - ./profiles/p\n",
    [`${ROOT}/profiles/p/markspec.yaml`]: `id: "@acme/pattern"
version: 0.1.0
profile:
  types:
    release-requirement:
      extends: Requirement
      display-id-pattern: "${pattern}"
`,
    [`${ROOT}/project.yaml`]: "name: p\nversion: 0.1.0\n",
  });
  await ctx.index.parseAndUpdateFile(join(ROOT, "doc.md"), md);
  return ctx;
}

Deno.test("ProjectContext.getEntryTypes: {scope} after the counter offers a template when no scope is in use (#1038)", async () => {
  const ctx = await contextWithPattern("R-{n:03d}-{scope}", "# Empty\n");
  const types = ctx.getEntryTypes();
  ctx.dispose();
  assertEquals(scaffoldLabels(types), [
    "New release-requirement (R-NNN-SCOPE)",
  ]);
  assertEquals(types[0].prefix, "R-");
});

Deno.test("ProjectContext.getEntryTypes: {scope} after the counter offers each scope in use, the template, and the template for a partial (#1038)", async () => {
  const ctx = await contextWithPattern(
    "R-{n:03d}-{scope}",
    `- [R-001-BRK] Brake release

  Body text.

      Id: 01SRS000000000000000000001
`,
  );
  const bare = scaffoldLabels(ctx.getEntryTypes());
  const range = {
    start: { line: 0, character: 3 },
    end: { line: 0, character: 6 },
  };
  const midTyped = buildMidTypedScaffoldItems(
    ctx.getEntryTypes("R-0"),
    "R-0",
    () => "01HFAKEULID00000000000000",
    range,
  ).map((i) => i.label);
  ctx.dispose();
  assertEquals(bare, [
    "New release-requirement (R-002-BRK)",
    "New release-requirement (R-NNN-SCOPE)",
  ]);
  assertEquals(midTyped, bare);
});

Deno.test("ProjectContext.getEntryTypes: with nothing between {scope} and the counter, another scope's IDs do not count (#1038)", async () => {
  const ctx = await contextWithPattern(
    "G_{scope}{n:04d}",
    `- [G_BR10001] Scope BR1 request

  Body text.

      Id: 01SRS000000000000000000001

- [G_BR0003] Scope BR request

  Body text.

      Id: 01SRS000000000000000000002
`,
  );
  const types = ctx.getEntryTypes();
  ctx.dispose();
  // G_BR10001 is scope BR1: it starts with G_BR but must not make the next
  // BR number 10002.
  assertEquals(scaffoldLabels(types), [
    "New release-requirement (G_BR0004)",
    "New release-requirement (G_BR10002)",
    "New release-requirement (G_SCOPENNNN)",
  ]);
});

Deno.test("ProjectContext.getEntryTypes: a glued {scope} scaffold never offers an existing ID (#1041)", async () => {
  const ctx = await contextWithPattern(
    "G_{scope}{n:02d}",
    `- [G_BR99] Scope BR request

  Body text.

      Id: 01SRS000000000000000000001

- [G_BR100] Scope BR1 request

  Body text.

      Id: 01SRS000000000000000000002
`,
  );
  const types = ctx.getEntryTypes();
  ctx.dispose();
  // G_BR100 reads as scope BR1, number 00, so scope BR counts only
  // G_BR99: 100 is taken by G_BR100, and the scaffold offers 101.
  assertEquals(
    types.filter((t) => t.scope === "BR").map((t) => t.nextNumber),
    [101],
  );
});

Deno.test("ProjectContext.releaseObservedReservations: a glued ID releases the reservation of the scope that minted it (#1041)", async () => {
  const glued = `- [G_BR99] Scope BR request

  Body text.

      Id: 01SRS000000000000000000001
`;
  const ctx = await contextWithPattern("G_{scope}{n:02d}", glued);
  // A resolve for scope BR minted number 101, which formats to G_BR101.
  ctx.reservations.mintReservedNumber("G_BR", "", () => 101, () => "G_BR101");
  const docPath = join(ROOT, "doc.md");
  await ctx.index.parseAndUpdateFile(
    docPath,
    glued + `
- [G_BR101] Second request

  Body text.

      Id: 01SRS000000000000000000002
`,
  );
  // G_BR101 reads as scope BR1, number 01, yet the reservation of G_BR
  // (scope BR) is released.
  ctx.releaseObservedReservations(docPath);
  ctx.dispose();
  assertEquals(ctx.reservations.isReserved("G_BR", "", 101), false);
  assertEquals(ctx.reservations.isDisplayIdReserved("G_BR101"), false);
});

Deno.test("ProjectContext.releaseObservedReservations: releases a minted display ID with no scaffold pattern (#1041)", async () => {
  // No .markspec.yaml: only the default profile loads, which declares no
  // display-ID pattern, yet a parsed ID that a resolve minted still drops
  // both reservations.
  const { ctx } = await fixture({});
  ctx.reservations.mintReservedNumber("G_BR", "", () => 101, () => "G_BR101");
  const docPath = join(ROOT, "doc.md");
  await ctx.index.parseAndUpdateFile(
    docPath,
    `- [G_BR101] Request

  Body text.

      Id: 01SRS000000000000000000002
`,
  );
  ctx.releaseObservedReservations(docPath);
  ctx.dispose();
  assertEquals(ctx.getEntryTypes(), []);
  assertEquals(ctx.reservations.isReserved("G_BR", "", 101), false);
  assertEquals(ctx.reservations.isDisplayIdReserved("G_BR101"), false);
});

Deno.test("ProjectContext.reservations: a parse in another project never releases this project's reservation (#1041)", async () => {
  const request = (id: string, ulid: string) =>
    `- [${id}] Request

  Body text.

      Id: ${ulid}
`;
  const pattern = "G_{scope}{n:02d}";
  const a = await contextWithPattern(
    pattern,
    request("G_BR99", "01SRS000000000000000000001") + "\n" +
      request("G_BR100", "01SRS000000000000000000002"),
  );
  const b = await contextWithPattern(pattern, "# Empty\n");
  // One resolve for scope BR in project A, composed as server.ts composes it.
  const shape = { prefix: "G_BR", width: 2, suffix: "" };
  const mintInA = () =>
    a.reservations.mintReservedNumber(
      "G_BR",
      "",
      (reserved) =>
        a.index.getNextFreeDisplayIdNumber(
          shape,
          reserved,
          a.scopeFilter("release-requirement", "BR"),
          (id) => a.reservations.isDisplayIdReserved(id),
        ),
      (n) => `G_BR${n}`,
    );
  assertEquals(mintInA(), 101);
  // Project B parses a file that holds G_BR101 before A's own parse runs.
  const docB = join(ROOT, "other.md");
  await b.index.parseAndUpdateFile(
    docB,
    request("G_BR101", "01SRS000000000000000000003"),
  );
  b.releaseObservedReservations(docB);
  a.dispose();
  b.dispose();
  assertEquals(a.reservations.isDisplayIdReserved("G_BR101"), true);
  assertEquals(mintInA(), 102);
});

Deno.test("ProjectContext.scopeFilter: filters by scope for a {scope} type only (#1038)", async () => {
  const ctx = await contextWithPattern("G_{scope}{n:04d}", "# Empty\n");
  const accept = ctx.scopeFilter("release-requirement", "BR");
  const none = ctx.scopeFilter("release-requirement", undefined);
  const unknown = ctx.scopeFilter("no-such-type", "BR");
  ctx.dispose();
  assertEquals(accept?.("G_BR10001"), false);
  assertEquals(accept?.("G_BR0001"), true);
  assertEquals(none, undefined);
  assertEquals(unknown, undefined);
});

const OVERFLOW_MD = `- [SRS_BRK_10000] Brake request

  Body text.

      Id: 01SRS000000000000000000001
      Type: software-requirement
`;

Deno.test("ProjectContext.getEntryTypes: offers a scope whose only ID is wider than the padding (#1038)", async () => {
  const ctx = await contextWithPattern("SRS_{scope}_{n:04d}", OVERFLOW_MD);
  const types = ctx.getEntryTypes();
  ctx.dispose();
  assertEquals(scaffoldLabels(types), [
    "New release-requirement (SRS_BRK_10001)",
    "New release-requirement (SRS_SCOPE_NNNN)",
  ]);
});

Deno.test("ProjectContext.releaseObservedReservations: releases a reservation of an ID wider than the padding (#1038)", async () => {
  const ctx = await contextWithPattern("SRS_{scope}_{n:04d}", OVERFLOW_MD);
  ctx.reservations.reserve("SRS_BRK_", "", 10001);
  const docPath = join(ROOT, "doc.md");
  await ctx.index.parseAndUpdateFile(
    docPath,
    OVERFLOW_MD + `
- [SRS_BRK_10001] Second brake request

  Body text.

      Id: 01SRS000000000000000000002
      Type: software-requirement
`,
  );
  ctx.releaseObservedReservations(docPath);
  ctx.dispose();
  assertEquals(ctx.reservations.isReserved("SRS_BRK_", "", 10001), false);
});
