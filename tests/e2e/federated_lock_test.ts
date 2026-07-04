/**
 * @module tests/e2e/federated_lock_test
 *
 * E2E: the federated `file://` projectRef scenario (federated-upstream
 * epic, slice 2). Project A publishes a compile-output snapshot via
 * `markspec compile --output`; project B declares a `references:`
 * projectRef pointing at A's snapshot directory over a `file://` URL
 * and exercises `markspec lock` / `markspec check` against it: first
 * lock, offline cache-drift detection, restore, restore-mismatch
 * detection, and `--update` to move the pin.
 *
 * Blackbox only — every assertion is made against exit codes, stdout,
 * stderr, and on-disk file contents produced by the compiled CLI
 * (`packages/markspec/main.ts`, run via `Deno.Command` through the
 * `markspecInDir` helper). No imports from `packages/markspec/core` or
 * any other source module.
 */

import { assertEquals, assertMatch, assertNotEquals } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { markspec, markspecInDir } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_A_YAML = `name: producta\nversion: 0.1.0\n`;

const REQS_A_V1 = `# Product A requirements

- [STK_0001] First requirement

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;

/** Adds a second entry so recompiling changes the snapshot content hash. */
const REQS_A_V2 = `# Product A requirements

- [STK_0001] First requirement

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF

- [STK_0002] Second requirement added later

  More body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG
`;

function projectBYaml(fileUrl: string): string {
  return `name: productb\nversion: 0.1.0\nreferences:\n  - url: ${
    JSON.stringify(fileUrl)
  }\n    name: producta\n`;
}

const REQS_B = `# Product B requirements

- [STK_0100] A B-side requirement

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEH
`;

/** Permissions `markspec lock` needs beyond the helper's read/write default. */
const LOCK_PERMISSIONS = ["--allow-env", "--allow-run"];

/** Extract the sole `[[upstream.registry]]` block from a lockfile's TOML. */
function registryBlock(lockToml: string): string {
  const start = lockToml.indexOf("[[upstream.registry]]");
  if (start < 0) {
    throw new Error(`no [[upstream.registry]] block in lockfile:\n${lockToml}`);
  }
  const rest = lockToml.slice(start);
  const nextSection = rest.indexOf("\n[", 1);
  return nextSection < 0 ? rest : rest.slice(0, nextSection);
}

/** Extract a `<field> = "<value>"` scalar from a TOML block. */
function tomlField(block: string, field: string): string {
  const match = new RegExp(`^${field}\\s*=\\s*"([^"]*)"`, "m").exec(block);
  if (!match) {
    throw new Error(`field '${field}' not found in block:\n${block}`);
  }
  return match[1];
}

// ---------------------------------------------------------------------------
// The six scenarios — sequential steps sharing one A + one B directory,
// because each step's assertions depend on the on-disk state the previous
// step left behind (a pinned lockfile, a populated or emptied cache dir).
// ---------------------------------------------------------------------------

Deno.test(
  "federated file:// reference: lock pins+caches, detects drift, restores, detects restore-mismatch, and --update moves the pin",
  async (t) => {
    const root = await Deno.makeTempDir();
    const dirA = `${root}/a`;
    const dirB = `${root}/b`;
    const cacheDir = `${dirB}/.markspec/cache/upstreams/producta`;

    try {
      await Deno.mkdir(dirA, { recursive: true });
      await Deno.mkdir(dirB, { recursive: true });
      await Deno.writeTextFile(`${dirA}/project.yaml`, PROJECT_A_YAML);
      await Deno.writeTextFile(`${dirA}/reqs.md`, REQS_A_V1);

      const compileA = await markspecInDir(dirA, [
        "compile",
        "--output",
        "api",
        "reqs.md",
      ]);
      assertEquals(compileA.code, 0, compileA.stderr);

      // Build the file URL via toFileUrl so the drive letter + separators
      // are correct on Windows (a raw `file://${dir}` yields a malformed
      // URL there); this is exactly how a user authors a file:// reference.
      const fileUrl = toFileUrl(join(dirA, "api")).href;
      await Deno.writeTextFile(`${dirB}/project.yaml`, projectBYaml(fileUrl));
      await Deno.writeTextFile(`${dirB}/.markspec.yaml`, "");
      await Deno.writeTextFile(`${dirB}/reqs.md`, REQS_B);

      let firstLock = "";
      let firstSnapshot = "";

      await t.step("1. lock pins + caches the file:// upstream", async () => {
        const r = await markspecInDir(dirB, ["lock"], LOCK_PERMISSIONS);
        assertEquals(r.code, 0, r.stderr);

        firstLock = await Deno.readTextFile(`${dirB}/markspec.lock`);
        assertMatch(firstLock, /\[\[upstream\.registry\]\]/);
        const block = registryBlock(firstLock);
        assertEquals(tomlField(block, "id"), "producta");
        assertEquals(tomlField(block, "api"), fileUrl);
        firstSnapshot = tomlField(block, "snapshot");
        assertMatch(firstSnapshot, /^sha256:[0-9a-f]+$/);

        const manifest = await Deno.readTextFile(`${cacheDir}/manifest.json`);
        assertMatch(manifest, /"markspecSchemaVersion"/);
        const compiled = await Deno.readTextFile(`${cacheDir}/compiled.json`);
        assertNotEquals(compiled.length, 0);
      });

      await t.step(
        "2. check detects a missing upstream cache → MSL-L212",
        async () => {
          await Deno.remove(cacheDir, { recursive: true });
          const r = await markspecInDir(dirB, ["check"]);
          assertEquals(r.code, 1, r.stderr);
          assertMatch(r.stderr, /MSL-L212/);
          assertMatch(r.stderr, /producta/);
        },
      );

      await t.step(
        "3. lock restores the cache without moving the pin",
        async () => {
          const r = await markspecInDir(dirB, ["lock"], LOCK_PERMISSIONS);
          assertEquals(r.code, 0, r.stderr);

          // Cache repopulated.
          const manifest = await Deno.readTextFile(
            `${cacheDir}/manifest.json`,
          );
          assertMatch(manifest, /"markspecSchemaVersion"/);
          await Deno.readTextFile(`${cacheDir}/compiled.json`);

          // The pin itself — every field of producta's registry row — is
          // unchanged (the keep/restore flow never re-derives a new row
          // when the refetched snapshot still matches the locked one).
          const restoredLock = await Deno.readTextFile(
            `${dirB}/markspec.lock`,
          );
          const firstBlock = registryBlock(firstLock);
          const restoredBlock = registryBlock(restoredLock);
          assertEquals(restoredBlock, firstBlock);

          // NOTE (determinism finding, expected — not a bug): the full
          // lockfile is NOT byte-identical run-to-run. `[meta] locked-at`
          // is a fresh `new Date().toISOString()` wall-clock stamp taken
          // on every `markspec lock` invocation (core/lock/resolve.ts),
          // independent of whether any upstream pin moved. Confirmed here
          // rather than asserted as equal — a whole-file byte comparison
          // would be flaky by design.
          assertNotEquals(restoredLock, firstLock);
          const metaLineRe = /^locked-at = "[^"]*"$/m;
          const withoutMeta = (s: string) =>
            s.replace(metaLineRe, 'locked-at = "<redacted>"');
          assertEquals(withoutMeta(restoredLock), withoutMeta(firstLock));

          const check = await markspecInDir(dirB, ["check"]);
          assertEquals(check.code, 0, check.stderr);
        },
      );

      await t.step(
        "4. restore mismatch: a moved snapshot is refused with MSL-L214",
        async () => {
          // Regenerate A's published snapshot with an extra entry, so the
          // published site now hashes differently than B's locked pin.
          await Deno.writeTextFile(`${dirA}/reqs.md`, REQS_A_V2);
          const recompile = await markspecInDir(dirA, [
            "compile",
            "--output",
            "api",
            "reqs.md",
          ]);
          assertEquals(recompile.code, 0, recompile.stderr);

          const beforeLock = await Deno.readTextFile(`${dirB}/markspec.lock`);
          await Deno.remove(cacheDir, { recursive: true });

          const r = await markspecInDir(dirB, ["lock"], LOCK_PERMISSIONS);
          assertEquals(r.code, 1, r.stdout + r.stderr);
          assertMatch(r.stderr, /MSL-L214/);
          assertMatch(r.stderr, /producta/);
          assertMatch(r.stderr, /restore mismatch/);

          // Lockfile is left untouched — a mismatch aborts before writing.
          const afterLock = await Deno.readTextFile(`${dirB}/markspec.lock`);
          assertEquals(afterLock, beforeLock);

          // Cache is NOT repopulated with the mismatched content either.
          let cacheExists = true;
          try {
            await Deno.stat(cacheDir);
          } catch {
            cacheExists = false;
          }
          assertEquals(cacheExists, false);
        },
      );

      await t.step(
        "5. --update=producta moves the pin to the new snapshot",
        async () => {
          const r = await markspecInDir(
            dirB,
            ["lock", "--update=producta"],
            LOCK_PERMISSIONS,
          );
          assertEquals(r.code, 0, r.stderr);

          const updatedLock = await Deno.readTextFile(`${dirB}/markspec.lock`);
          const updatedBlock = registryBlock(updatedLock);
          const updatedSnapshot = tomlField(updatedBlock, "snapshot");
          assertNotEquals(updatedSnapshot, firstSnapshot);
          assertEquals(tomlField(updatedBlock, "id"), "producta");

          // Cache repopulated to match the new pin.
          await Deno.readTextFile(`${cacheDir}/manifest.json`);
          await Deno.readTextFile(`${cacheDir}/compiled.json`);

          const check = await markspecInDir(dirB, ["check"]);
          assertEquals(check.code, 0, check.stderr);
        },
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// 6. `check` resolves a cross-repo `Satisfies:` against a locked upstream
// snapshot (federated-upstream epic, slice 4). Project B's entry satisfies
// an upstream (A) entry; `check` must feed the hydrated upstream entries
// into its own pipeline so the reference resolves — no MSL-L006. Each
// project declares its own small profile so the entries classify cleanly
// (an unclassified entry authoring `Satisfies:` would otherwise trip
// unrelated MSL-T024/MSL-A005 attribute-scope warnings that have nothing to
// do with this scenario) — mirrors `tests/e2e/check_project_test.ts`'s
// requirement / system-requirement fixture.
// ---------------------------------------------------------------------------

const TRACE_PROFILE_A_YAML = `id: "@acme/federated-a"
version: 0.1.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "STK_{n:04d}"
`;

const TRACE_REQS_A = `# Product A requirements

- [STK_0001] First requirement

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
`;

const TRACE_PROFILE_B_YAML = `id: "@acme/federated-b"
version: 0.1.0
profile:
  types:
    system-requirement:
      extends: Requirement
      display-id-pattern: "SREQ-{n:04d}"
      traceability:
        Satisfies:
          target: [requirement]
          cardinality: 0..3
          required: false
`;

const TRACE_REQS_B = `# Product B requirements

- [SREQ-0001] Derived requirement satisfying the upstream

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEH
      Type: system-requirement
      Satisfies: STK_0001
`;

Deno.test(
  "check: cross-repo Satisfies against a locked upstream resolves (no MSL-L006)",
  async () => {
    const root = await Deno.makeTempDir();
    const dirA = `${root}/a`;
    const dirB = `${root}/b`;

    try {
      await Deno.mkdir(dirA, { recursive: true });
      await Deno.mkdir(dirB, { recursive: true });
      await Deno.writeTextFile(`${dirA}/project.yaml`, PROJECT_A_YAML);
      await Deno.writeTextFile(
        `${dirA}/.markspec.yaml`,
        "profiles:\n  - ./profiles/p\n",
      );
      await Deno.mkdir(`${dirA}/profiles/p`, { recursive: true });
      await Deno.writeTextFile(
        `${dirA}/profiles/p/markspec.yaml`,
        TRACE_PROFILE_A_YAML,
      );
      await Deno.writeTextFile(`${dirA}/reqs.md`, TRACE_REQS_A);

      const compileA = await markspecInDir(dirA, [
        "compile",
        "--output",
        "api",
        "reqs.md",
      ]);
      assertEquals(compileA.code, 0, compileA.stderr);

      const fileUrl = toFileUrl(join(dirA, "api")).href;
      await Deno.writeTextFile(`${dirB}/project.yaml`, projectBYaml(fileUrl));
      await Deno.writeTextFile(
        `${dirB}/.markspec.yaml`,
        "profiles:\n  - ./profiles/p\n",
      );
      await Deno.mkdir(`${dirB}/profiles/p`, { recursive: true });
      await Deno.writeTextFile(
        `${dirB}/profiles/p/markspec.yaml`,
        TRACE_PROFILE_B_YAML,
      );
      await Deno.writeTextFile(`${dirB}/reqs.md`, TRACE_REQS_B);

      const lock = await markspecInDir(dirB, ["lock"], LOCK_PERMISSIONS);
      assertEquals(lock.code, 0, lock.stderr);

      const check = await markspecInDir(dirB, ["check"]);
      assertEquals(check.code, 0, check.stderr);
      assertEquals(/MSL-L006/.test(check.stderr), false, check.stderr);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// 7. Migration errors — org project.yaml closed-schema validation. These are
// independent of the A/B fixture above: any command that loads project.yaml
// (here, `markspec lock`) surfaces a ConfigError before doing any lock work.
// ---------------------------------------------------------------------------

Deno.test(
  "migration error: project.yaml 'exclude:' key → moved to .markspec.yaml",
  async () => {
    const r = await markspec(["lock"], {
      "project.yaml": "name: t\nversion: 0.1.0\nexclude:\n  - foo\n",
    });
    assertEquals(r.code, 1, r.stderr);
    assertMatch(r.stderr, /moved to \.markspec\.yaml/);
  },
);

Deno.test(
  "migration error: project.yaml 'parents:' key → retired",
  async () => {
    const r = await markspec(["lock"], {
      "project.yaml": "name: t\nversion: 0.1.0\nparents:\n  - foo\n",
    });
    assertEquals(r.code, 1, r.stderr);
    assertMatch(r.stderr, /retired/);
  },
);

Deno.test(
  "migration error: project.yaml missing 'version:' → version is required",
  async () => {
    const r = await markspec(["lock"], {
      "project.yaml": "name: t\n",
    });
    assertEquals(r.code, 1, r.stderr);
    assertMatch(r.stderr, /version is required/);
  },
);
