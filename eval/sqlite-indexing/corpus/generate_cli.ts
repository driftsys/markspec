/**
 * @module corpus/generate_cli
 *
 * CLI front-end for the synthetic project generator. Writes the generated
 * project to disk as NDJSON (one entity per line, typed) so the bench
 * scripts can read it without re-generating each run.
 *
 * Usage:
 *   deno task gen                  # 1k scale (default)
 *   deno task gen -- --scale 10k
 *   deno task gen -- --scale 100k --seed 42
 */

import { SCALE_100K, SCALE_10K, SCALE_1K } from "./generator.ts";

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
  const opts = scale === "100k"
    ? SCALE_100K
    : scale === "10k"
    ? SCALE_10K
    : SCALE_1K;
  console.error(
    `gen: scale=${scale} seed=${seed} (entries=${opts.entryCount})`,
  );
  // TODO(phase-1): call generateProject({...opts, seed}), write NDJSON to
  // results/corpus-<scale>-<seed>.ndjson.
  throw new Error("generate_cli: not yet implemented");
}

if (import.meta.main) main();
