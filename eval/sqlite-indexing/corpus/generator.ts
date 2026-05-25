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
 *
 * Distribution choices (locked in for Phase 1, document in ADR-020):
 *   - File-path distribution: 100 entries per file, single `docs/synth/`
 *     directory. 1k → 10 files, 10k → 100 files, 100k → 1 000 files.
 *   - Edge target selection: 70 % preferential attachment to the hub set
 *     (entries 0..hubCount-1), 30 % uniform. Concentrates reverse-edge
 *     in-degree on the hubs — exactly the §5.2 worst-case to calibrate.
 *   - Title / body length: short and uniform. Realistic distribution
 *     deferred — bench latency is dominated by row count, not content size.
 *   - content_hash: FNV-1a over `(seed, index, body)`. Not cryptographic;
 *     deterministic and changes when body changes (what warm-bench needs).
 *   - Id shape: 26-char Crockford-base32 deterministic from (seed, index).
 *     Matches ULID width without depending on wall-clock time.
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

const ENTRIES_PER_FILE = 100;
const HUB_TARGET_PROBABILITY = 0.7;
const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Linear-congruential RNG. Deterministic from `seed`. */
function makeRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomInt(rng: () => number, max: number): number {
  return Math.floor(rng() * max);
}

/** Deterministic 26-char Crockford-base32 identifier from (seed, index). */
function deterministicId(seed: number, index: number): string {
  let a = (Math.imul(seed, 2654435761) ^ index) >>> 0;
  let b = (Math.imul(index, 1597334677) ^ seed) >>> 0;
  const out: string[] = [];
  for (let i = 0; i < 26; i++) {
    out.push(CROCKFORD_BASE32[a & 31]);
    a = ((a >>> 5) | (Math.imul(b, 31) << 27)) >>> 0;
    b = (Math.imul(b, 1103515245) + 12345) >>> 0;
  }
  return out.join("");
}

/** FNV-1a 32-bit hash, hex-encoded. Cheap, deterministic, not cryptographic. */
function fnv1a(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * Generate a synthetic project according to `opts`. Pure function: same
 * `(seed, opts)` always yields the same `SyntheticProject`.
 */
export function generateProject(opts: GenOptions): SyntheticProject {
  const rng = makeRng(opts.seed);

  const hubCount = Math.max(1, Math.floor(opts.entryCount * opts.hubRatio));
  const referenceIndices = pickIndices(
    rng,
    opts.entryCount,
    opts.referenceCount,
  );
  const referenceSet = new Set(referenceIndices);
  const componentIndices: number[] = [];
  while (
    componentIndices.length < opts.componentCount &&
    componentIndices.length < opts.entryCount
  ) {
    const idx = randomInt(rng, opts.entryCount);
    if (referenceSet.has(idx) || componentIndices.includes(idx)) continue;
    componentIndices.push(idx);
  }
  const componentSet = new Set(componentIndices);

  const entries: SyntheticEntry[] = new Array(opts.entryCount);
  for (let i = 0; i < opts.entryCount; i++) {
    const fileIdx = Math.floor(i / ENTRIES_PER_FILE);
    const file = `docs/synth/file_${String(fileIdx).padStart(4, "0")}.md`;
    const line = (i % ENTRIES_PER_FILE) * 6 + 1;
    const isReference = referenceSet.has(i);
    const isComponent = componentSet.has(i);
    const shape: SyntheticEntry["shape"] = isReference
      ? "Reference"
      : "Authored";
    const type = isReference
      ? "Reference"
      : isComponent
      ? "Component"
      : "Requirement";
    const displayId = `REQ_${String(i + 1).padStart(5, "0")}`;
    const id = deterministicId(opts.seed, i);
    const title = `Title for entry ${displayId}`;
    const body = `Body text for ${displayId}. ` +
      `Lorem ipsum dolor sit amet, consectetur adipiscing elit. ` +
      `Sed do eiusmod tempor incididunt ut labore et dolore.`;
    const contentHash = fnv1a(`${opts.seed}:${i}:${body}`);
    entries[i] = {
      id,
      displayId,
      type,
      shape,
      title,
      file,
      line,
      contentHash,
      body,
    };
  }

  const edges: SyntheticEdge[] = [];
  for (let i = 0; i < opts.entryCount; i++) {
    const outDegree = Math.max(0, randomInt(rng, opts.edgeDensity * 2 + 1));
    for (let j = 0; j < outDegree; j++) {
      let targetIdx: number;
      if (rng() < HUB_TARGET_PROBABILITY) {
        targetIdx = randomInt(rng, hubCount);
      } else {
        targetIdx = randomInt(rng, opts.entryCount);
      }
      if (targetIdx === i) continue;
      edges.push({
        from: entries[i].id,
        to: entries[targetIdx].id,
        kind: "satisfies",
        generated: false,
      });
    }
  }

  const glossary: SyntheticGlossary[] = new Array(opts.glossarySize);
  for (let i = 0; i < opts.glossarySize; i++) {
    glossary[i] = {
      slug: `term-${String(i + 1).padStart(4, "0")}`,
      term: `Term ${i + 1}`,
      file: "docs/synth/glossary.md",
    };
  }

  const references: SyntheticReference[] = new Array(referenceIndices.length);
  for (let i = 0; i < referenceIndices.length; i++) {
    const idx = referenceIndices[i];
    references[i] = {
      slug: entries[idx].displayId.toLowerCase(),
      uri: `https://example.com/ref/${entries[idx].displayId}`,
      type: "external",
    };
  }

  const schemes: SyntheticComponent["scheme"][] = [
    "pkg",
    "mfg",
    "gtin",
    "cpe",
    "urn",
  ];
  const components: SyntheticComponent[] = new Array(componentIndices.length);
  for (let i = 0; i < componentIndices.length; i++) {
    const idx = componentIndices[i];
    components[i] = {
      id: entries[idx].id,
      scheme: schemes[i % schemes.length],
      file: entries[idx].file,
    };
  }

  return { entries, edges, glossary, references, components };
}

/** Pick `count` distinct indices from `[0, total)`. */
function pickIndices(
  rng: () => number,
  total: number,
  count: number,
): number[] {
  const picked = new Set<number>();
  const cap = Math.min(count, total);
  while (picked.size < cap) {
    picked.add(randomInt(rng, total));
  }
  return [...picked];
}
