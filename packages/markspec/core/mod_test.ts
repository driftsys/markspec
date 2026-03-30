import { assertEquals } from "@std/assert";
import {
  compile,
  ConfigError,
  DEFAULT_PROJECT_CONFIG,
  format,
  parse,
  REFHUB_URL,
  report,
  validate,
  VERSION,
} from "./mod.ts";
import type {
  Attribute,
  CompileResult,
  ConfigFieldError,
  Diagnostic,
  Entry,
  FormatResult,
  ParseOptions,
  ProjectConfig,
  ReportOptions,
  SourceLocation,
  ValidateResult,
} from "./mod.ts";

// ---------------------------------------------------------------------------
// VERSION
// ---------------------------------------------------------------------------

Deno.test("version is set", () => {
  assertEquals(VERSION, "0.0.1");
});

// ---------------------------------------------------------------------------
// Model types are importable and usable
// ---------------------------------------------------------------------------

Deno.test("model types are constructible", () => {
  const loc: SourceLocation = { file: "test.md", line: 1, column: 1 };
  assertEquals(loc.file, "test.md");

  const attr: Attribute = { key: "Id", value: "SRS_01HGW2Q8MNP3" };
  assertEquals(attr.key, "Id");

  const diag: Diagnostic = {
    code: "MSL-E001",
    severity: "error",
    message: "broken reference",
    location: loc,
  };
  assertEquals(diag.severity, "error");

  const entry: Entry = {
    displayId: "SRS_BRK_0001",
    title: "Sensor debouncing",
    body: "The sensor driver shall debounce raw inputs.",
    attributes: [attr],
    id: "SRS_01HGW2Q8MNP3",
    entryType: "SRS",
    location: loc,
    source: "markdown",
  };
  assertEquals(entry.displayId, "SRS_BRK_0001");
  assertEquals(entry.entryType, "SRS");

  const config: ProjectConfig = {
    name: "test-project",
    version: "1.0.0",
    labels: ["ASIL-B"],
    parents: [],
    parentFallback: REFHUB_URL,
  };
  assertEquals(config.name, "test-project");
});

// ---------------------------------------------------------------------------
// Config exports
// ---------------------------------------------------------------------------

Deno.test("DEFAULT_PROJECT_CONFIG has expected defaults", () => {
  assertEquals(DEFAULT_PROJECT_CONFIG.name, "");
  assertEquals(DEFAULT_PROJECT_CONFIG.version, "0.0.0");
  assertEquals(DEFAULT_PROJECT_CONFIG.labels, []);
  assertEquals(DEFAULT_PROJECT_CONFIG.parents, []);
  assertEquals(DEFAULT_PROJECT_CONFIG.parentFallback, REFHUB_URL);
});

Deno.test("ConfigError is constructible", () => {
  const fieldErr: ConfigFieldError = {
    field: "name",
    message: "required",
    line: 1,
  };
  const err = new ConfigError("project.yaml", [fieldErr]);
  assertEquals(err.name, "ConfigError");
  assertEquals(err.configPath, "project.yaml");
  assertEquals(err.fieldErrors.length, 1);
  assertEquals(err.message.includes("name"), true);
});

// ---------------------------------------------------------------------------
// parse() — extracts entries from markdown
// ---------------------------------------------------------------------------

Deno.test("parse extracts entries from markdown", () => {
  const entries = parse("# Test\n\n- [SRS_BRK_0001] Title\n\n  Body.\n");
  assertEquals(entries.length, 1);
  assertEquals(entries[0].displayId, "SRS_BRK_0001");

  // Accepts options
  const opts: ParseOptions = { file: "test.md" };
  const entries2 = parse("# Test\n\n- [SRS_BRK_0001] Title\n\n  Body.\n", opts);
  assertEquals(entries2[0].location.file, "test.md");

  // No entries in plain markdown
  const entries3 = parse("# Test");
  assertEquals(entries3, []);
});

// ---------------------------------------------------------------------------
// format() stub
// ---------------------------------------------------------------------------

Deno.test("format returns input unchanged", () => {
  const input = "# Test\n";
  const result: FormatResult = format(input);
  assertEquals(result.output, input);
  assertEquals(result.diagnostics, []);
  assertEquals(result.changed, false);
});

// ---------------------------------------------------------------------------
// validate() stub
// ---------------------------------------------------------------------------

Deno.test("validate returns valid for empty input", () => {
  const result: ValidateResult = validate([]);
  assertEquals(result.diagnostics, []);
  assertEquals(result.valid, true);
});

// ---------------------------------------------------------------------------
// compile() stub
// ---------------------------------------------------------------------------

Deno.test("compile with no matching files returns empty result", async () => {
  const result: CompileResult = await compile([], {
    readFile: () => Promise.reject(new Error("not found")),
  });
  assertEquals(result.entries.size, 0);
  assertEquals(result.links.length, 0);
});

// ---------------------------------------------------------------------------
// report()
// ---------------------------------------------------------------------------

Deno.test("report produces traceability output", () => {
  const emptyResult: CompileResult = {
    entries: new Map(),
    links: [],
    forward: new Map(),
    reverse: new Map(),
    diagnostics: [],
  };
  const opts: ReportOptions = { kind: "traceability", format: "md" };
  const output = report(emptyResult, opts);
  // Should at least contain the header row
  assertEquals(output.includes("ID"), true);
});
