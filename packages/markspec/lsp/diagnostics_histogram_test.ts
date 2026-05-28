/**
 * @module lsp/diagnostics_histogram_test
 *
 * Unit tests for the per-validateAll diagnostic-code histogram
 * surfaced through the `kind=diagnostics` event_log entry.
 */

import { assertEquals } from "@std/assert";
import type { Diagnostic as CoreDiagnostic } from "../core/mod.ts";
import { buildDiagnosticsHistogram } from "./diagnostics_histogram.ts";

/** Build a minimal core Diagnostic with just the code field — the
 * only field the histogram reads. */
function diag(code: string): CoreDiagnostic {
  return {
    code,
    severity: "warning",
    message: code,
    location: { file: "x.md", line: 1, column: 1 },
  };
}

Deno.test("buildDiagnosticsHistogram: empty input → empty object", () => {
  const hist = buildDiagnosticsHistogram([], 20);
  assertEquals(hist, {});
});

Deno.test("buildDiagnosticsHistogram: groups by code with exact counts", () => {
  const hist = buildDiagnosticsHistogram(
    [
      diag("MSL-R002"),
      diag("MSL-R002"),
      diag("MSL-Q401"),
    ],
    20,
  );
  assertEquals(hist, { "MSL-R002": 2, "MSL-Q401": 1 });
});

Deno.test("buildDiagnosticsHistogram: sorts by count desc", () => {
  const hist = buildDiagnosticsHistogram(
    [
      diag("MSL-A001"),
      diag("MSL-B002"),
      diag("MSL-B002"),
      diag("MSL-B002"),
      diag("MSL-C003"),
      diag("MSL-C003"),
    ],
    20,
  );
  // Object.keys preserves insertion order — verifying the sort.
  assertEquals(Object.keys(hist), ["MSL-B002", "MSL-C003", "MSL-A001"]);
  assertEquals(hist["MSL-B002"], 3);
  assertEquals(hist["MSL-C003"], 2);
  assertEquals(hist["MSL-A001"], 1);
});

Deno.test("buildDiagnosticsHistogram: caps at topN and adds 'other' bucket", () => {
  // 25 distinct codes, each firing a unique number of times so the
  // sort order is deterministic. Code "MSL-R000" fires 25×, R001 24×,
  // …, R024 once. With topN=20 we keep R000..R019 and roll R020..R024
  // (5+4+3+2+1 = 15 events) into "other".
  const diags: CoreDiagnostic[] = [];
  for (let i = 0; i < 25; i++) {
    const code = `MSL-R${String(i).padStart(3, "0")}`;
    const fireCount = 25 - i;
    for (let n = 0; n < fireCount; n++) diags.push(diag(code));
  }
  const hist = buildDiagnosticsHistogram(diags, 20);
  // 20 code keys + 1 "other" field
  assertEquals(Object.keys(hist).length, 21);
  // Top entries present
  assertEquals(hist["MSL-R000"], 25);
  assertEquals(hist["MSL-R019"], 25 - 19);
  // Lumped tail correctness: 5+4+3+2+1 = 15
  assertEquals(hist["other"], 15);
  // Codes past the cap are not surfaced by name
  assertEquals(hist["MSL-R020"], undefined);
  assertEquals(hist["MSL-R024"], undefined);
});

Deno.test("buildDiagnosticsHistogram: ties at cutoff resolve by code name (deterministic)", () => {
  // Three codes each fire twice; topN=2 forces one into 'other'.
  // The deterministic tiebreak is alphabetical by code, so MSL-A001
  // and MSL-B002 are kept and MSL-C003 is lumped.
  const diags = [
    diag("MSL-C003"),
    diag("MSL-C003"),
    diag("MSL-A001"),
    diag("MSL-A001"),
    diag("MSL-B002"),
    diag("MSL-B002"),
  ];
  const hist = buildDiagnosticsHistogram(diags, 2);
  assertEquals(hist["MSL-A001"], 2);
  assertEquals(hist["MSL-B002"], 2);
  assertEquals(hist["MSL-C003"], undefined);
  assertEquals(hist["other"], 2);
});

Deno.test("buildDiagnosticsHistogram: topN exactly matches distinct count → no 'other'", () => {
  const hist = buildDiagnosticsHistogram(
    [diag("MSL-A"), diag("MSL-B"), diag("MSL-C")],
    3,
  );
  assertEquals(Object.keys(hist).length, 3);
  assertEquals(hist["other"], undefined);
});
