/**
 * @module concurrency/schema_mismatch
 *
 * Schema-version mismatch rebuild test. §7 of the spec says:
 *   "A mismatch on either [schema or markspec-schema] ⇒ treated exactly as
 *    corruption ⇒ silent rebuild."
 *
 * Procedure:
 *   1. Cold-scan the 1k corpus.
 *   2. Manually UPDATE the schema_version row to a different value.
 *   3. Re-open the index.
 *   4. Verify:
 *        a. The adapter detected the mismatch.
 *        b. The db was deleted + cold-rebuilt (or, depending on the chosen
 *           policy, the adapter exposed a "rebuild required" error and the
 *           caller did the rebuild — match whatever the spec lands on).
 *        c. A warning was logged exactly once.
 *
 * Repeat for both pieces of version state (the db's own `schema` integer
 * and the `markspec-schema` it was built under).
 */

export type VersionField = "schema" | "markspec-schema";

export interface SchemaMismatchResult {
  readonly field: VersionField;
  readonly detected: boolean;
  readonly rebuilt: boolean;
  readonly warningCount: number;
  readonly timestamp: string;
}

export async function runSchemaMismatch(_field: VersionField): Promise<void> {
  // TODO(phase-1):
  //   1. Cold-scan, close.
  //   2. Open raw sqlite, UPDATE the version row, close.
  //   3. Re-open via the adapter, capture warnings + behavior.
  throw new Error("runSchemaMismatch: not yet implemented");
}

if (import.meta.main) {
  await runSchemaMismatch("schema");
  await runSchemaMismatch("markspec-schema");
}
