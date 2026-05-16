/**
 * Generate docs/product/ast-fidelity-matrix.md from the SP1 corpus.
 *
 * Usage: deno run --allow-read --allow-write scripts/gen_ast_fidelity_matrix.ts
 *
 * SP1 — pure characterization. This script does not modify any production
 * code; it only (re)writes the committed catalogue. The staleness gate
 * scripts/check_ast_fidelity_matrix.sh re-runs this and fails CI on drift.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { renderCatalogue, runMatrix } from "../tests/e2e/ast_fidelity.ts";

const ROOT = join(dirname(fromFileUrl(import.meta.url)), "..");
const OUT_PATH = join(ROOT, "docs/product/ast-fidelity-matrix.md");

const matrix = await runMatrix();
const markdown = renderCatalogue(matrix);
await Deno.writeTextFile(OUT_PATH, markdown);
console.error(
  `wrote ${OUT_PATH} (surface = ${matrix.surface}/${matrix.rows.length})`,
);
