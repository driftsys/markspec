/**
 * @module tests/e2e/ast_fidelity_matrix_test
 *
 * SP3 — the CI-runnable AST fidelity-matrix harness.
 *
 * This is the epic SUCCESS ORACLE. It deliberately does NOT assert that
 * the RESIDUAL count is zero here — that mandate is enforced by the SP3
 * spec / Task-7 review gate, not by a self-fulfilling test assertion
 * (the harness measures, it does not pin its own answer; SP1 design §4.5).
 *
 * The only assertion here is the in-test staleness guard: the committed
 * catalogue must byte-match what the harness regenerates. The shell gate
 * scripts/check_ast_fidelity_matrix.sh enforces the same in CI; this
 * keeps the signal inside `deno test` too (the harness is the primary
 * surface — §4.6).
 */

import { assertEquals } from "@std/assert";
import { renderCatalogue, runMatrix } from "./ast_fidelity.ts";

const REPO_ROOT = new URL("../../", import.meta.url).pathname;
const CATALOGUE_PATH = `${REPO_ROOT}docs/product/ast-fidelity-matrix.md`;

Deno.test("ast-fidelity-matrix: committed catalogue is not stale", async () => {
  const matrix = await runMatrix();
  const expected = renderCatalogue(matrix);
  const committed = await Deno.readTextFile(CATALOGUE_PATH);

  // Visible baseline signal (informational, never an assertion).
  console.log(
    `ast-fidelity surface = RESIDUAL(${matrix.counts.RESIDUAL}) = ` +
      `${matrix.surface} of ${matrix.rows.length}; ` +
      `OK=${matrix.counts.OK} UNOWNED=${matrix.counts.UNOWNED}`,
  );

  assertEquals(
    committed,
    expected,
    "docs/product/ast-fidelity-matrix.md is stale — run " +
      "`just ast-fidelity-matrix` and stage the result.",
  );
});
