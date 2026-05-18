/**
 * @module tests/e2e/compile_output_test
 *
 * E2E tests for `markspec compile --output <dir>`:
 *   - Tier 1 (below split threshold): manifest.json + compiled.json
 *   - Tier 2 (at/above threshold): manifest.json + entries.ndjson +
 *     entries.idx + edges.ndjson
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const CLI_ENTRY = new URL(
  "../../packages/markspec/main.ts",
  import.meta.url,
).pathname;

const PROJECT_YAML = `name: test-project\nversion: 0.1.0\n`;

const SAMPLE_MD = `# Requirements

- [STK_0001] The system shall be fast

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

/** Run markspec with --output and return the contents of the output dir. */
async function compileWithOutput(files: Record<string, string>): Promise<{
  code: number;
  stdout: string;
  stderr: string;
  manifestJson: string | null;
  compiledJson: string | null;
}> {
  const dir = await Deno.makeTempDir();
  try {
    for (const [name, content] of Object.entries(files)) {
      const parts = name.split("/");
      if (parts.length > 1) {
        await Deno.mkdir(`${dir}/${parts.slice(0, -1).join("/")}`, {
          recursive: true,
        }).catch(() => {});
      }
      await Deno.writeTextFile(`${dir}/${name}`, content);
    }

    const parentEnv = Deno.env.toObject();
    const safeEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(parentEnv)) {
      if (!k.startsWith("GIT_")) safeEnv[k] = v;
    }

    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        CLI_ENTRY,
        "compile",
        "--output",
        "out",
        "req.md",
      ],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
      clearEnv: true,
      env: safeEnv,
    });
    const result = await cmd.output();

    let manifestJson: string | null = null;
    let compiledJson: string | null = null;
    try {
      manifestJson = await Deno.readTextFile(`${dir}/out/manifest.json`);
    } catch { /* file may not exist if the test is verifying failure */ }
    try {
      compiledJson = await Deno.readTextFile(`${dir}/out/compiled.json`);
    } catch { /* file may not exist */ }

    return {
      code: result.code,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
      manifestJson,
      compiledJson,
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("compile --output: exits 0 and writes manifest.json + compiled.json", async () => {
  const { code, manifestJson, compiledJson } = await compileWithOutput({
    "project.yaml": PROJECT_YAML,
    "req.md": SAMPLE_MD,
  });
  assertEquals(code, 0);
  assertEquals(typeof manifestJson, "string");
  assertEquals(typeof compiledJson, "string");
});

Deno.test("compile --output: manifest.json has markspecSchemaVersion 1", async () => {
  const { manifestJson } = await compileWithOutput({
    "project.yaml": PROJECT_YAML,
    "req.md": SAMPLE_MD,
  });
  const manifest = JSON.parse(manifestJson!);
  assertEquals(manifest.markspecSchemaVersion, 1);
});

Deno.test("compile --output: manifest.json counts.entries matches parsed entries", async () => {
  const { manifestJson } = await compileWithOutput({
    "project.yaml": PROJECT_YAML,
    "req.md": SAMPLE_MD,
  });
  const manifest = JSON.parse(manifestJson!);
  assertEquals(manifest.counts.entries, 1);
});

Deno.test("compile --output: manifest.json federation equals config.parents", async () => {
  const { manifestJson } = await compileWithOutput({
    "project.yaml": PROJECT_YAML,
    "req.md": SAMPLE_MD,
  });
  const manifest = JSON.parse(manifestJson!);
  assertEquals(Array.isArray(manifest.federation), true);
  assertEquals(manifest.federation.length, 0);
});

Deno.test("compile --output: manifest.json sqliteMirror is null", async () => {
  const { manifestJson } = await compileWithOutput({
    "project.yaml": PROJECT_YAML,
    "req.md": SAMPLE_MD,
  });
  const manifest = JSON.parse(manifestJson!);
  assertEquals(manifest.sqliteMirror, null);
});

Deno.test("compile --output: compiled.json matches --format json stdout", async () => {
  const { compiledJson } = await compileWithOutput({
    "project.yaml": PROJECT_YAML,
    "req.md": SAMPLE_MD,
  });
  const { code, stdout } = await markspec([
    "compile",
    "--format",
    "json",
    "req.md",
  ], {
    files: { "project.yaml": PROJECT_YAML, "req.md": SAMPLE_MD },
  });
  assertEquals(code, 0);
  // Both should parse to the same structure (comparing parsed objects,
  // not raw strings, to be resilient to whitespace differences).
  const fromFile = JSON.parse(compiledJson!);
  const fromStdout = JSON.parse(stdout);
  assertEquals(
    Object.keys(fromFile.entries).sort(),
    Object.keys(fromStdout.entries).sort(),
  );
  assertEquals(fromFile.links.length, fromStdout.links.length);
});

Deno.test("compile --output: prints wrote messages to stderr", async () => {
  const { stderr } = await compileWithOutput({
    "project.yaml": PROJECT_YAML,
    "req.md": SAMPLE_MD,
  });
  assertStringIncludes(stderr, "manifest.json");
  assertStringIncludes(stderr, "compiled.json");
});

Deno.test("compile without --output: stdout json path unchanged", async () => {
  // Regression guard: the existing --format json path must be unaffected.
  const { code, stdout } = await markspec([
    "compile",
    "--format",
    "json",
    "req.md",
  ], {
    files: { "project.yaml": PROJECT_YAML, "req.md": SAMPLE_MD },
  });
  assertEquals(code, 0);
  const parsed = JSON.parse(stdout);
  assertEquals(typeof parsed.entries, "object");
  assertEquals(parsed.entries["STK_0001"].displayId, "STK_0001");
});

// ---------------------------------------------------------------------------
// Tier 2: NDJSON streaming output (--split-threshold 1 forces the path)
// ---------------------------------------------------------------------------

/** Run markspec with --output and --split-threshold 1 (forces NDJSON). */
async function compileWithOutputStreaming(
  files: Record<string, string>,
): Promise<{
  code: number;
  stdout: string;
  stderr: string;
  manifestJson: string | null;
  entriesNdjson: string | null;
  entriesIdx: string | null;
  edgesNdjson: string | null;
}> {
  const dir = await Deno.makeTempDir();
  try {
    for (const [name, content] of Object.entries(files)) {
      const parts = name.split("/");
      if (parts.length > 1) {
        await Deno.mkdir(`${dir}/${parts.slice(0, -1).join("/")}`, {
          recursive: true,
        }).catch(() => {});
      }
      await Deno.writeTextFile(`${dir}/${name}`, content);
    }

    const parentEnv = Deno.env.toObject();
    const safeEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(parentEnv)) {
      if (!k.startsWith("GIT_")) safeEnv[k] = v;
    }

    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        CLI_ENTRY,
        "compile",
        "--output",
        "out",
        "--split-threshold",
        "1",
        "req.md",
      ],
      cwd: dir,
      stdout: "piped",
      stderr: "piped",
      clearEnv: true,
      env: safeEnv,
    });
    const result = await cmd.output();

    let manifestJson: string | null = null;
    let entriesNdjson: string | null = null;
    let entriesIdx: string | null = null;
    let edgesNdjson: string | null = null;
    try {
      manifestJson = await Deno.readTextFile(`${dir}/out/manifest.json`);
    } catch { /* file may not exist */ }
    try {
      entriesNdjson = await Deno.readTextFile(`${dir}/out/entries.ndjson`);
    } catch { /* file may not exist */ }
    try {
      entriesIdx = await Deno.readTextFile(`${dir}/out/entries.idx`);
    } catch { /* file may not exist */ }
    try {
      edgesNdjson = await Deno.readTextFile(`${dir}/out/edges.ndjson`);
    } catch { /* file may not exist */ }

    return {
      code: result.code,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
      manifestJson,
      entriesNdjson,
      entriesIdx,
      edgesNdjson,
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test(
  "compile --output --split-threshold 1: exits 0 and writes NDJSON files",
  async () => {
    const { code, manifestJson, entriesNdjson, entriesIdx, edgesNdjson } =
      await compileWithOutputStreaming({
        "project.yaml": PROJECT_YAML,
        "req.md": SAMPLE_MD,
      });
    assertEquals(code, 0);
    assertEquals(typeof manifestJson, "string");
    assertEquals(typeof entriesNdjson, "string");
    assertEquals(typeof entriesIdx, "string");
    assertEquals(typeof edgesNdjson, "string");
  },
);

Deno.test(
  "compile --output --split-threshold 1: manifest entries block is ndjson format",
  async () => {
    const { manifestJson } = await compileWithOutputStreaming({
      "project.yaml": PROJECT_YAML,
      "req.md": SAMPLE_MD,
    });
    const manifest = JSON.parse(manifestJson!);
    assertEquals(manifest.entries.format, "ndjson");
    assertEquals(manifest.entries.file, "entries.ndjson");
    assertEquals(manifest.entries.index, "entries.idx");
  },
);

Deno.test(
  "compile --output --split-threshold 1: manifest edges block is ndjson format",
  async () => {
    const { manifestJson } = await compileWithOutputStreaming({
      "project.yaml": PROJECT_YAML,
      "req.md": SAMPLE_MD,
    });
    const manifest = JSON.parse(manifestJson!);
    assertEquals(manifest.edges.format, "ndjson");
    assertEquals(manifest.edges.file, "edges.ndjson");
  },
);

Deno.test(
  "compile --output --split-threshold 1: entries.ndjson has one valid JSON line per entry",
  async () => {
    const { entriesNdjson } = await compileWithOutputStreaming({
      "project.yaml": PROJECT_YAML,
      "req.md": SAMPLE_MD,
    });
    const lines = entriesNdjson!.split("\n").filter((l) => l.trim().length > 0);
    assertEquals(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assertEquals(entry.displayId, "STK_0001");
  },
);

Deno.test(
  "compile --output --split-threshold 1: entries.idx byte offsets enable seek-and-compare",
  async () => {
    const { entriesNdjson, entriesIdx } = await compileWithOutputStreaming({
      "project.yaml": PROJECT_YAML,
      "req.md": SAMPLE_MD,
    });
    const index = JSON.parse(entriesIdx!) as Record<
      string,
      { offset: number; length: number }
    >;
    const ndjsonBytes = new TextEncoder().encode(entriesNdjson!);
    for (const [displayId, slot] of Object.entries(index)) {
      const sliceBytes = ndjsonBytes.slice(
        slot.offset,
        slot.offset + slot.length,
      );
      const line = new TextDecoder().decode(sliceBytes).trimEnd();
      const entry = JSON.parse(line);
      assertEquals(entry.displayId, displayId);
    }
  },
);

Deno.test(
  "compile --output --split-threshold 1: edges.ndjson is empty when no profile generates inverses",
  async () => {
    const { edgesNdjson } = await compileWithOutputStreaming({
      "project.yaml": PROJECT_YAML,
      "req.md": SAMPLE_MD,
    });
    // No profile → no generated inverses → edges.ndjson is an empty file.
    assertEquals(edgesNdjson!.trim(), "");
  },
);

Deno.test(
  "compile --output --split-threshold 1: prints wrote messages for NDJSON files to stderr",
  async () => {
    const { stderr } = await compileWithOutputStreaming({
      "project.yaml": PROJECT_YAML,
      "req.md": SAMPLE_MD,
    });
    assertStringIncludes(stderr, "entries.ndjson");
    assertStringIncludes(stderr, "entries.idx");
    assertStringIncludes(stderr, "edges.ndjson");
  },
);

Deno.test(
  "compile --output: below threshold (default 1000) writes compiled.json not NDJSON files",
  async () => {
    // 1 entry with default threshold of 1000 → Tier 1 path.
    const { code, compiledJson, manifestJson } = await compileWithOutput({
      "project.yaml": PROJECT_YAML,
      "req.md": SAMPLE_MD,
    });
    assertEquals(code, 0);
    assertEquals(typeof compiledJson, "string");
    const manifest = JSON.parse(manifestJson!);
    assertEquals(manifest.entries.format, "inline");
    assertEquals(manifest.edges.format, "inline");
  },
);
