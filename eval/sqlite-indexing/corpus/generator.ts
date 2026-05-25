/**
 * @module corpus/generator
 *
 * Synthetic project generator for the Background Indexing eval.
 *
 * Produces in-memory entries, edges, glossary, references, and components
 * sized and shaped to stress the indexer along the dimensions §5.2 + §6 of
 * markspec-background-indexing.md care about:
 *
 *   - `entryCount` — total entries (1k / 10k / 100k scales)
 *   - `edgeDensity` — mean trace-relation edges per entry
 *   - `hubRatio` — fraction of entries that are reverse-edge hubs (used to
 *     calibrate the §5.2 / §9 Q5 invalidation cap)
 *   - `glossarySize` — Definition items (backs xref-glossary-undefined)
 *   - `referenceCount` — Reference-shape entries (backs MSL-R085)
 *   - `componentCount` — Component-typed entries (listing-directives §5)
 *
 * Distribution shapes are kept simple and seeded — every run with the same
 * (seed, options) tuple produces identical output, so bench numbers are
 * reproducible.
 */

export interface GenOptions {
  readonly seed: number;
  readonly entryCount: number;
  readonly edgeDensity: number;
  readonly hubRatio: number;
  readonly glossarySize: number;
  readonly referenceCount: number;
  readonly componentCount: number;
}

export const SCALE_1K: GenOptions = {
  seed: 1,
  entryCount: 1_000,
  edgeDensity: 3,
  hubRatio: 0.005,
  glossarySize: 50,
  referenceCount: 100,
  componentCount: 50,
};

export const SCALE_10K: GenOptions = {
  ...SCALE_1K,
  entryCount: 10_000,
  glossarySize: 200,
  referenceCount: 500,
  componentCount: 200,
};

export const SCALE_100K: GenOptions = {
  ...SCALE_1K,
  entryCount: 100_000,
  glossarySize: 1_000,
  referenceCount: 3_000,
  componentCount: 1_000,
};

export interface SyntheticEntry {
  readonly id: string;
  readonly displayId: string;
  readonly type: string;
  readonly shape: "Authored" | "Reference";
  readonly title: string;
  readonly file: string;
  readonly line: number;
  readonly contentHash: string;
  readonly body: string;
}

export interface SyntheticEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: string;
  readonly generated: boolean;
}

export interface SyntheticGlossary {
  readonly slug: string;
  readonly term: string;
  readonly file: string;
}

export interface SyntheticReference {
  readonly slug: string;
  readonly uri: string;
  readonly type: string;
}

export interface SyntheticComponent {
  readonly id: string;
  readonly scheme: "pkg" | "mfg" | "gtin" | "cpe" | "urn";
  readonly file: string;
}

export interface SyntheticProject {
  readonly entries: readonly SyntheticEntry[];
  readonly edges: readonly SyntheticEdge[];
  readonly glossary: readonly SyntheticGlossary[];
  readonly references: readonly SyntheticReference[];
  readonly components: readonly SyntheticComponent[];
}

/**
 * Generate a synthetic project according to `opts`.
 *
 * TODO(phase-1): implement. The signature is fixed; the body is the work.
 * Distribution choices to make (and document in ADR-020):
 *   - file-path distribution: how many files, how many entries per file
 *   - edge target selection: uniform vs preferential-attachment for hubs
 *   - title/body length: realistic distribution from this repo's corpus
 *   - content_hash: deterministic from (seed, id) so warm-bench can simulate
 *     a one-byte change by perturbing one entry's hash
 */
export function generateProject(_opts: GenOptions): SyntheticProject {
  throw new Error(
    "generateProject: not yet implemented (Phase 1 measurement work)",
  );
}
