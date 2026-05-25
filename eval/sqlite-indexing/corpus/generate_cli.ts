/**
 * @module corpus/generate_cli
 *
 * Sanity-check CLI for the synthetic project generator. Generates the
 * project in-memory and prints entity counts + a few sample rows to
 * stderr. Not the bench path — benches generate their own corpus inline
 * to avoid NDJSON serialization overhead on the timing measurement.
 *
 * Usage:
 *   deno task eval:gen                         # 1k scale (default)
 *   deno task eval:gen -- --scale 10k
 *   deno task eval:gen -- --scale 100k --seed 42
 */

import {
  generateProject,
  type GenOptions,
  SCALE_100K,
  SCALE_10K,
  SCALE_1K,
} from "./generator.ts";

function parseArgs(
  args: string[],
): { scale: "1k" | "10k" | "100k"; seed: number } {
  let scale: "1k" | "10k" | "100k" = "1k";
  let seed = 1;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--scale" && i + 1 < args.length) {
      const v = args[i + 1];
      if (v === "1k" || v === "10k" || v === "100k") scale = v;
      else throw new Error(`unknown --scale value: ${v}`);
      i++;
    } else if (args[i] === "--seed" && i + 1 < args.length) {
      seed = Number(args[i + 1]);
      i++;
    }
  }
  return { scale, seed };
}

function main() {
  const { scale, seed } = parseArgs(Deno.args);
  const baseOpts = scale === "100k"
    ? SCALE_100K
    : scale === "10k"
    ? SCALE_10K
    : SCALE_1K;
  const opts: GenOptions = { ...baseOpts, seed };

  const t0 = performance.now();
  const project = generateProject(opts);
  const tMs = performance.now() - t0;

  console.error(`gen: scale=${scale} seed=${seed}`);
  console.error(`  entries:    ${project.entries.length}`);
  console.error(`  edges:      ${project.edges.length}`);
  console.error(`  glossary:   ${project.glossary.length}`);
  console.error(`  references: ${project.references.length}`);
  console.error(`  components: ${project.components.length}`);
  console.error(`  elapsed:    ${tMs.toFixed(1)} ms`);

  console.error(`\nsample entries:`);
  for (const e of project.entries.slice(0, 3)) {
    console.error(`  ${e.displayId} (${e.shape}, type=${e.type}) ${e.id}`);
  }
  console.error(`\nsample edges (out of ${project.edges.length}):`);
  for (const edge of project.edges.slice(0, 3)) {
    console.error(
      `  ${edge.from.slice(0, 8)} -[${edge.kind}]-> ${edge.to.slice(0, 8)}`,
    );
  }
}

if (import.meta.main) main();
