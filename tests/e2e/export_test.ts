/**
 * @module tests/e2e/export_test
 *
 * E2E tests for `markspec export <format> <paths...>` — serializes
 * the compiled graph in the requested format. Supports `json` and
 * `yaml` today; `csv` and `reqif` remain on the backlog.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { parse as parseYaml } from "@std/yaml";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: phase5-e2e\nversion: 0.1.0\n`;

const SAMPLE_MD = `# Example

- [REQ-001] First requirement

  The system shall debounce inputs.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

const BASE_FILES = {
  "project.yaml": PROJECT_YAML,
  "req.md": SAMPLE_MD,
};

Deno.test("export json: emits parsable JSON keyed by display ID", async () => {
  const { code, stdout } = await markspec(["export", "json", "req.md"], {
    files: BASE_FILES,
  });
  assertEquals(code, 0);
  const parsed = JSON.parse(stdout);
  // entries is Record<displayId, Entry>.
  assertEquals(typeof parsed.entries, "object");
  assertEquals(Object.keys(parsed.entries).length, 1);
  assertEquals(parsed.entries["REQ-001"].displayId, "REQ-001");
});

Deno.test("export yaml: emits parsable YAML matching the JSON shape", async () => {
  const { code, stdout } = await markspec(["export", "yaml", "req.md"], {
    files: BASE_FILES,
  });
  assertEquals(code, 0);
  // deno-lint-ignore no-explicit-any
  const parsed = parseYaml(stdout) as any;
  assertEquals(typeof parsed.entries, "object");
  assertEquals(parsed.entries["REQ-001"].displayId, "REQ-001");
});

Deno.test("export: unknown format fails with error", async () => {
  const { code, stderr } = await markspec(["export", "xml", "req.md"], {
    files: BASE_FILES,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "xml");
});

Deno.test("export csv: emits header row + one row per entry", async () => {
  const { code, stdout } = await markspec(["export", "csv", "req.md"], {
    files: BASE_FILES,
  });
  assertEquals(code, 0);
  const lines = stdout.split("\n").filter((l) => l.length > 0);
  // Header + 1 entry.
  assertEquals(lines.length, 2);
  assertEquals(
    lines[0],
    "displayId,title,type,shape,id,file,line",
  );
  // Row contains the display ID, title, ULID, and "req.md" location.
  assertStringIncludes(lines[1], "REQ-001");
  assertStringIncludes(lines[1], "First requirement");
  assertStringIncludes(lines[1], "01HGW2Q8MNP3RSTVWXYZABCDEF");
  assertStringIncludes(lines[1], "req.md");
});

Deno.test("export csv: quotes values that contain commas", async () => {
  const sample = `# Example

- [REQ-001] Title, with, commas

  Body.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const { code, stdout } = await markspec(["export", "csv", "req.md"], {
    files: { ...BASE_FILES, "req.md": sample },
  });
  assertEquals(code, 0);
  const lines = stdout.split("\n").filter((l) => l.length > 0);
  // The title cell must be quoted so commas inside don't split.
  assertStringIncludes(lines[1], `"Title, with, commas"`);
});

Deno.test("export csv: empty project emits header only", async () => {
  const { code, stdout } = await markspec(["export", "csv", "req.md"], {
    files: { ...BASE_FILES, "req.md": `# Empty\n` },
  });
  assertEquals(code, 0);
  const lines = stdout.split("\n").filter((l) => l.length > 0);
  assertEquals(lines.length, 1);
  assertEquals(lines[0], "displayId,title,type,shape,id,file,line");
});

Deno.test("export json: matches the compile --format json output", async () => {
  const exportRun = await markspec(["export", "json", "req.md"], {
    files: BASE_FILES,
  });
  const compileRun = await markspec(
    ["compile", "--format", "json", "req.md"],
    { files: BASE_FILES },
  );
  assertEquals(exportRun.code, 0);
  assertEquals(compileRun.code, 0);
  assertEquals(
    JSON.parse(exportRun.stdout),
    JSON.parse(compileRun.stdout),
    "export json and compile --format json should produce identical output",
  );
});
