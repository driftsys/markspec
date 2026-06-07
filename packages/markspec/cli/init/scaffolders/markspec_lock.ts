/**
 * @module cli/init/scaffolders/markspec_lock
 *
 * Stub-path scaffolder for `markspec.lock`. `init` always writes a
 * minimal lock with zero upstreams — it does not resolve the profile
 * chain (resolution needs network I/O, which `init` deliberately
 * avoids). For the bundled default profile that stub is the final,
 * correct lock. For a non-default (git/local) profile the stub is a
 * starting point: the orchestrator emits a `LOCKFILE_STUB_NEEDS_PIN`
 * warning telling the user to run `markspec lock` to resolve and pin
 * the profile's upstreams (#581).
 */

import { join } from "@std/path";
import {
  hashCanonicalEdges,
  type Lockfile,
  LOCKFILE_SCHEMA_VERSION,
  serializeLockfile,
} from "../../../core/mod.ts";
import type { MemFs } from "../fake_fs.ts";

export interface MarkspecLockStubInput {
  /** Floor for `meta.toolchain.minVersion`, e.g. `"0.6"`. */
  readonly toolchainMinVersion: string;
  /** RFC 3339 UTC timestamp, e.g. `"2026-05-28T12:00:00Z"`. */
  readonly lockedAt: string;
}

/**
 * Return the TOML text for a minimal markspec.lock with no upstreams.
 * Round-trips through `parseLockfile`. The hash for an empty edge list
 * is computed via `hashCanonicalEdges([])` — async because of WebCrypto.
 */
export async function buildMarkspecLockStub(
  input: MarkspecLockStubInput,
): Promise<string> {
  const edgesHash = await hashCanonicalEdges([]);
  const stub: Lockfile = {
    schema: LOCKFILE_SCHEMA_VERSION,
    meta: {
      markspecSchema: LOCKFILE_SCHEMA_VERSION,
      lockedAt: input.lockedAt,
      toolchain: { minVersion: input.toolchainMinVersion },
    },
    upstreams: [],
    boundEntries: [],
    edges: [],
    generatedCache: { edgesHash, edgesCount: 0 },
  };
  return serializeLockfile(stub);
}

/**
 * Write a minimal `markspec.lock` stub to `targetDir/markspec.lock`.
 * Skips the write and returns `false` when the file already exists.
 * Returns `true` when the file was written.
 */
export async function scaffoldMarkspecLock(
  fs: MemFs,
  targetDir: string,
  input: MarkspecLockStubInput,
): Promise<boolean> {
  const path = join(targetDir, "markspec.lock");
  if (await fs.exists(path)) return false;
  await fs.write(path, await buildMarkspecLockStub(input));
  return true;
}
