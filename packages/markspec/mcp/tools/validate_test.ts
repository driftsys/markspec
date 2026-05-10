/**
 * @module mcp/tools/validate_test
 *
 * Unit tests for the validate tool's Markdown report.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Diagnostic } from "../../core/mod.ts";
import { filterDiagnostics, renderDiagnosticsReport } from "./validate.ts";

const ERR: Diagnostic = {
  code: "MSL-R004",
  severity: "error",
  message: "unresolved reference: SYS_NONEXISTENT",
  location: {
    file: "/proj/docs/req.md",
    line: 128,
    column: 3,
  },
};

const WARN: Diagnostic = {
  code: "MSL-R010",
  severity: "warning",
  message: "unrecognized attribute Priority",
  location: { file: "/proj/docs/req.md", line: 200, column: 3 },
};

Deno.test("renderDiagnosticsReport: clean report", () => {
  const md = renderDiagnosticsReport([], "@org/x@1.0.0", 100);
  assertStringIncludes(md, "✓ All 100 entries pass validation");
});

Deno.test("renderDiagnosticsReport: errors and warnings sections", () => {
  const md = renderDiagnosticsReport([ERR, WARN], null, 1);
  assertStringIncludes(md, "# Validation: 1 error, 1 warning");
  assertStringIncludes(md, "## Errors");
  assertStringIncludes(md, "### MSL-R004");
  assertStringIncludes(md, "unresolved reference: SYS_NONEXISTENT");
  assertStringIncludes(md, "/proj/docs/req.md:128:3");
  assertStringIncludes(md, "## Warnings");
  assertStringIncludes(md, "### MSL-R010");
});

Deno.test("renderDiagnosticsReport: renders locations relative to projectRoot", () => {
  const md = renderDiagnosticsReport([ERR, WARN], null, 1, "/proj");
  assertStringIncludes(md, "docs/req.md:128:3");
  assertStringIncludes(md.split("\n").join(" "), " docs/req.md:128:3");
});

Deno.test("renderDiagnosticsReport: scrubs projectRoot from embedded message paths", () => {
  const dup: Diagnostic = {
    code: "MSL-R006",
    severity: "error",
    message:
      "duplicate display ID 'STK_AEB_0001' (also at /proj/docs/other.md:12)",
    location: { file: "/proj/docs/req.md", line: 5, column: 1 },
  };
  const md = renderDiagnosticsReport([dup], null, 1, "/proj");
  assertStringIncludes(
    md,
    "duplicate display ID 'STK_AEB_0001' (also at docs/other.md:12)",
  );
  assertEquals(md.includes("/proj/docs/other.md"), false);
});

Deno.test("filterDiagnostics: passes all when files undefined", () => {
  const out = filterDiagnostics([ERR, WARN], undefined, "/proj");
  assertStringIncludes(out.length.toString(), "2");
});

Deno.test("filterDiagnostics: keeps matching relative path", () => {
  const out = filterDiagnostics([ERR, WARN], ["docs/req.md"], "/proj");
  assertStringIncludes(out.length.toString(), "2");
});

Deno.test("filterDiagnostics: drops non-matching paths", () => {
  const out = filterDiagnostics([ERR, WARN], ["docs/other.md"], "/proj");
  assertStringIncludes(out.length.toString(), "0");
});

Deno.test("filterDiagnostics: absolute path match", () => {
  const out = filterDiagnostics([ERR], ["/proj/docs/req.md"], "/proj");
  assertStringIncludes(out.length.toString(), "1");
});
