/**
 * @module bench/harness
 *
 * Shared timing harness. Every bench produces structured JSON output via
 * `record()` so the orchestrator can collect a homogeneous matrix without
 * each bench inventing its own format.
 *
 * Times are captured with `performance.now()` (monotonic, sub-ms resolution).
 * Each measured operation runs `iterations` times after a `warmup` count, so
 * single-call jitter and JIT/cache effects are filtered out. Percentiles
 * (p50, p95, p99) come from the post-warmup samples.
 */

export interface BenchResult {
  readonly bench: string;
  readonly scale: "1k" | "10k" | "100k";
  readonly driver: string;
  readonly pragmas: Record<string, string | number>;
  readonly iterations: number;
  readonly warmup: number;
  readonly samplesMs: readonly number[];
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly meanMs: number;
  readonly maxMs: number;
  readonly totalMs: number;
  /** Free-form bench-specific notes (e.g. "hub-rename, closure=178"). */
  readonly notes?: Record<string, string | number>;
  readonly timestamp: string;
}

export async function measure(
  label: string,
  fn: () => Promise<void>,
  opts: { iterations: number; warmup: number },
): Promise<{ samplesMs: number[]; totalMs: number }> {
  for (let i = 0; i < opts.warmup; i++) await fn();
  const samples: number[] = [];
  const startTotal = performance.now();
  for (let i = 0; i < opts.iterations; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  const totalMs = performance.now() - startTotal;
  console.error(
    `[${label}] iter=${opts.iterations} warmup=${opts.warmup} totalMs=${
      totalMs.toFixed(1)
    }`,
  );
  return { samplesMs: samples, totalMs };
}

export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

export function summarise(
  partial: Omit<
    BenchResult,
    "p50Ms" | "p95Ms" | "p99Ms" | "meanMs" | "maxMs" | "timestamp"
  >,
): BenchResult {
  const { samplesMs } = partial;
  const sum = samplesMs.reduce((a, b) => a + b, 0);
  return {
    ...partial,
    p50Ms: percentile(samplesMs, 0.5),
    p95Ms: percentile(samplesMs, 0.95),
    p99Ms: percentile(samplesMs, 0.99),
    meanMs: samplesMs.length === 0 ? 0 : sum / samplesMs.length,
    maxMs: samplesMs.length === 0 ? 0 : Math.max(...samplesMs),
    timestamp: new Date().toISOString(),
  };
}

/** Append a bench result as one NDJSON line under results/. */
export async function record(
  result: BenchResult,
  outDir: string,
): Promise<void> {
  const filename = `${outDir}/${result.bench}-${result.scale}-${
    result.timestamp.replaceAll(":", "-")
  }.ndjson`;
  await Deno.writeTextFile(filename, JSON.stringify(result) + "\n", {
    append: true,
  });
  console.error(`recorded: ${filename}`);
}
