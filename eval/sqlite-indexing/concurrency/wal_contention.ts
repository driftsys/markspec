/**
 * @module concurrency/wal_contention
 *
 * SQLite WAL concurrency stress test. §4 of the spec says WAL "readers never
 * block the writer, the writer never blocks readers" — this verifies that's
 * true under sustained mixed load.
 *
 * Topology:
 *   - 1 writer process: continuous updateEntry() calls
 *   - 8 reader processes: random getEntryById() / getEntryByDisplayId() calls
 *   - Duration: 60 s
 *
 * Observables:
 *   - reader throughput (ops/sec, per-reader and aggregate)
 *   - writer throughput (ops/sec)
 *   - reader p95 latency (should not degrade vs single-process baseline)
 *   - any SQLite errors or busy-loop retries
 *
 * Implementation: spawn the readers/writer as separate Deno processes via
 * Deno.Command (NOT workers — we want real OS process isolation matching the
 * LSP-writer + CLI-reader topology in production). Each process opens the
 * same db.
 */

export interface WalContentionResult {
  readonly readerCount: number;
  readonly durationSec: number;
  readonly writerOps: number;
  readonly readerOps: number;
  readonly writerP95Ms: number;
  readonly readerP95Ms: number;
  readonly errors: readonly string[];
  readonly timestamp: string;
}

export async function runWalContention(): Promise<void> {
  // TODO(phase-1):
  //   1. Cold-scan the 10k-scale corpus into a tmp db.
  //   2. Spawn 1 writer + 8 reader subprocesses, each running for 60s.
  //   3. Collect per-process op counts + latency samples via stdout pipes.
  //   4. Aggregate, summarise, record.
  throw new Error("runWalContention: not yet implemented");
}

if (import.meta.main) await runWalContention();
