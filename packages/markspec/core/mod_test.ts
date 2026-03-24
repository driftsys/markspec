import { assertEquals } from "@std/assert";
import {
  compile,
  format,
  parse,
  report,
  validate,
  VERSION,
} from "./mod.ts";
import type {
  Attribute,
  CompileResult,
  Diagnostic,
  Entry,
  ExportFormat,
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
    types: ["STK", "SRS", "SAD"],
    include: ["**/*.md"],
    exclude: ["node_modules/**"],
    registries: [],
    variables: { project: "test" },
  };
  assertEquals(config.name, "test-project");
});

// ---------------------------------------------------------------------------
// parse() stub
// ---------------------------------------------------------------------------

Deno.test("parse returns empty array", () => {
  const entries = parse("# Test\n\n- [SRS_BRK_0001] Title\n\n  Body.\n");
  assertEquals(entries, []);

  // Accepts options
  const opts: ParseOptions = { file: "test.md" };
  const entries2 = parse("# Test", opts);
  assertEquals(entries2, []);
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

Deno.test("compile returns empty result", async () => {
  const result: CompileResult = await compile(["**/*.md"]);
  assertEquals(result.entries, []);
  assertEquals(result.diagnostics, []);
});

// ---------------------------------------------------------------------------
// report() stub
// ---------------------------------------------------------------------------

Deno.test("report returns empty string", () => {
  const fmt: ExportFormat = "json";
  const opts: ReportOptions = { format: fmt };
  const output = report([], opts);
  assertEquals(output, "");
});
