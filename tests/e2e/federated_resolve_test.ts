/**
 * @module tests/e2e/federated_resolve_test
 *
 * E2E acceptance suite for the federated-upstream epic, slice 4 (Task 10).
 * Builds on the slice-2 `file://` projectRef fixture pattern established
 * by `federated_lock_test.ts`: a producer project compiles a compile-output
 * snapshot to `api/` via `markspec compile --output`, and a consumer
 * project declares a `references:` projectRef pointing at that snapshot
 * over a `file://` URL, then runs `markspec lock` to pin + cache it.
 *
 * Six scenarios (brief §Scenarios):
 *   1. Cross-repo `Satisfies:` resolves — no MSL-L006/MSL-T014.
 *   2. A broken upstream target fires MSL-T014 (not MSL-L006), naming the
 *      searched upstream.
 *   3. A project entry colliding with an upstream display ID fires
 *      MSL-R014, naming the upstream origin.
 *   4. `report coverage` treats a `references:` upstream entry as a
 *      traceability leaf (excluded from the orphan gap list); a project
 *      entry without `Satisfies:` is not.
 *   5. `show` and `report traceability` surface an upstream entry's
 *      `Origin:` / origin column.
 *   6. Root/diamond (design §4.9): ROOT references both B and C; C also
 *      references B, so C's own published snapshot re-exports B's entries
 *      with an upstream origin already stamped. The authoritative-source
 *      rule in `loadUpstreamCorpus` (`core/upstream/mod.ts`) skips a
 *      snapshot entry that already carries an `origin` — so ROOT's graph
 *      counts B's entries exactly once (via its direct reference), never
 *      via C's re-export, and no MSL-R014 collision fires.
 *
 * Blackbox only — every assertion is made against exit codes, stdout,
 * stderr, and on-disk file contents produced by the compiled CLI
 * (`packages/markspec/main.ts`, run via `Deno.Command` through the
 * `markspecInDir` helper). No imports from `packages/markspec/core` or
 * any other source module.
 */

import { assertEquals, assertMatch } from "@std/assert";
import { join, toFileUrl } from "@std/path";
import { markspecInDir } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Shared fixtures — producer "producta" (SYS_ prefix) / consumer "productb"
// (SWE_ prefix), used by scenarios 1-5.
// ---------------------------------------------------------------------------

const PROJECT_A_YAML = `name: producta\nversion: 0.1.0\n`;

/** `requirement` type only — mintable display IDs `SYS_{n:04d}`. */
const PROFILE_A_YAML = `id: "@acme/federated-resolve-a"
version: 0.1.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "SYS_{n:04d}"
`;

const REQS_A = `# Product A requirements

- [SYS_0001] First requirement

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
      Type: requirement
`;

/**
 * B's profile declares BOTH `requirement` (same `SYS_` prefix as A's own
 * type — scenario 3 needs B to be able to author a legitimate `SYS_0001`
 * under its own profile, so the collision is a realistic same-prefix
 * clash, not a classification error) and `system-requirement` (the
 * `SWE_` prefix, satisfying `requirement`).
 */
const PROFILE_B_YAML = `id: "@acme/federated-resolve-b"
version: 0.1.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "SYS_{n:04d}"
    system-requirement:
      extends: Requirement
      display-id-pattern: "SWE_{n:04d}"
      traceability:
        Satisfies:
          target: [requirement]
          cardinality: 0..3
          required: false
`;

function projectBYaml(fileUrl: string): string {
  return `name: productb\nversion: 0.1.0\nreferences:\n  - url: ${
    JSON.stringify(fileUrl)
  }\n    name: producta\n`;
}

const REQS_B_SATISFIES_OK = `# Product B requirements

- [SWE_0001] Derived requirement satisfying the upstream

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEH
      Type: system-requirement
      Satisfies: SYS_0001
`;

const REQS_B_SATISFIES_BROKEN = `# Product B requirements

- [SWE_0001] Derived requirement with a broken upstream link

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEH
      Type: system-requirement
      Satisfies: SYS_9999
`;

const REQS_B_COLLIDE = `# Product B requirements

- [SYS_0001] An independently authored colliding requirement

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEK
      Type: requirement
`;

const REQS_B_COVERAGE = `# Product B requirements

- [SWE_0001] Derived requirement satisfying the upstream

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEH
      Type: system-requirement
      Satisfies: SYS_0001

- [SWE_0002] Derived requirement with no upstream link

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEJ
      Type: system-requirement
`;

/** Permissions `markspec lock` needs beyond the helper's read/write default. */
const LOCK_PERMISSIONS = ["--allow-env", "--allow-run"];

/**
 * Compile producer A (project.yaml + `.markspec.yaml` profile + `reqs.md`)
 * to `api/` and return its `file://` snapshot URL. Shared setup for
 * scenarios 1-5, each of which only varies B's `reqs.md` content.
 */
async function setupProducerA(dirA: string): Promise<string> {
  await Deno.mkdir(dirA, { recursive: true });
  await Deno.writeTextFile(`${dirA}/project.yaml`, PROJECT_A_YAML);
  await Deno.writeTextFile(
    `${dirA}/.markspec.yaml`,
    "profiles:\n  - ./profiles/p\n",
  );
  await Deno.mkdir(`${dirA}/profiles/p`, { recursive: true });
  await Deno.writeTextFile(`${dirA}/profiles/p/markspec.yaml`, PROFILE_A_YAML);
  await Deno.writeTextFile(`${dirA}/reqs.md`, REQS_A);

  const compileA = await markspecInDir(dirA, [
    "compile",
    "--output",
    "api",
    "reqs.md",
  ]);
  assertEquals(compileA.code, 0, compileA.stderr);

  return toFileUrl(join(dirA, "api")).href;
}

/** Write consumer B's project files (does not lock or check). */
async function setupConsumerB(
  dirB: string,
  fileUrl: string,
  reqsMd: string,
): Promise<void> {
  await Deno.mkdir(dirB, { recursive: true });
  await Deno.writeTextFile(`${dirB}/project.yaml`, projectBYaml(fileUrl));
  await Deno.writeTextFile(
    `${dirB}/.markspec.yaml`,
    "profiles:\n  - ./profiles/p\n",
  );
  await Deno.mkdir(`${dirB}/profiles/p`, { recursive: true });
  await Deno.writeTextFile(`${dirB}/profiles/p/markspec.yaml`, PROFILE_B_YAML);
  await Deno.writeTextFile(`${dirB}/reqs.md`, reqsMd);
}

// ---------------------------------------------------------------------------
// 1. Cross-repo Satisfies resolves.
// ---------------------------------------------------------------------------

Deno.test(
  "check: cross-repo Satisfies resolves against a locked upstream — no MSL-L006/MSL-T014",
  async () => {
    const root = await Deno.makeTempDir();
    try {
      const dirA = `${root}/a`;
      const dirB = `${root}/b`;
      const fileUrl = await setupProducerA(dirA);
      await setupConsumerB(dirB, fileUrl, REQS_B_SATISFIES_OK);

      const lock = await markspecInDir(dirB, ["lock"], LOCK_PERMISSIONS);
      assertEquals(lock.code, 0, lock.stderr);

      const check = await markspecInDir(dirB, ["check"]);
      assertEquals(check.code, 0, check.stderr);
      assertEquals(/MSL-L006/.test(check.stderr), false, check.stderr);
      assertEquals(/MSL-T014/.test(check.stderr), false, check.stderr);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// 2. Broken upstream ID fires MSL-T014, not MSL-L006.
// ---------------------------------------------------------------------------

Deno.test(
  "check: an unresolved upstream Satisfies target fires MSL-T014 (not MSL-L006), naming the upstream",
  async () => {
    const root = await Deno.makeTempDir();
    try {
      const dirA = `${root}/a`;
      const dirB = `${root}/b`;
      const fileUrl = await setupProducerA(dirA);
      await setupConsumerB(dirB, fileUrl, REQS_B_SATISFIES_BROKEN);

      const lock = await markspecInDir(dirB, ["lock"], LOCK_PERMISSIONS);
      assertEquals(lock.code, 0, lock.stderr);

      const check = await markspecInDir(dirB, ["check"]);
      // MSL-T014 is a warning, not an error — `check` exits 2 (warnings
      // only), not 1.
      assertEquals(check.code, 2, check.stderr);
      assertMatch(check.stderr, /MSL-T014/);
      assertMatch(check.stderr, /producta/);
      assertEquals(/MSL-L006/.test(check.stderr), false, check.stderr);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// 3. A colliding display ID fires MSL-R014, naming the upstream origin.
// ---------------------------------------------------------------------------

Deno.test(
  "check: a project entry colliding with an upstream display ID fires MSL-R014 naming the upstream origin",
  async () => {
    const root = await Deno.makeTempDir();
    try {
      const dirA = `${root}/a`;
      const dirB = `${root}/b`;
      const fileUrl = await setupProducerA(dirA);
      await setupConsumerB(dirB, fileUrl, REQS_B_COLLIDE);

      const lock = await markspecInDir(dirB, ["lock"], LOCK_PERMISSIONS);
      assertEquals(lock.code, 0, lock.stderr);

      const check = await markspecInDir(dirB, ["check"]);
      // MSL-R014 is an error — `check` exits 1.
      assertEquals(check.code, 1, check.stderr);
      assertMatch(check.stderr, /MSL-R014/);
      assertMatch(check.stderr, /producta/);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// 4. A references: upstream entry is a coverage leaf, excluded from orphans;
//    a project entry without Satisfies is not.
// ---------------------------------------------------------------------------

Deno.test(
  "report coverage: an upstream references: leaf is excluded from orphans; an uncovered project entry is not",
  async () => {
    const root = await Deno.makeTempDir();
    try {
      const dirA = `${root}/a`;
      const dirB = `${root}/b`;
      const fileUrl = await setupProducerA(dirA);
      await setupConsumerB(dirB, fileUrl, REQS_B_COVERAGE);

      const lock = await markspecInDir(dirB, ["lock"], LOCK_PERMISSIONS);
      assertEquals(lock.code, 0, lock.stderr);

      const rep = await markspecInDir(dirB, [
        "report",
        "coverage",
        "--format",
        "json",
        "reqs.md",
      ]);
      assertEquals(rep.code, 0, rep.stderr);
      const stats = JSON.parse(rep.stdout);
      const orphans: string[] = stats.gaps.orphans;
      assertEquals(
        orphans.includes("SYS_0001"),
        false,
        `orphans should not include the upstream reference leaf: ${
          JSON.stringify(orphans)
        }`,
      );
      assertEquals(
        orphans.includes("SWE_0002"),
        true,
        `orphans should include B's own uncovered entry: ${
          JSON.stringify(orphans)
        }`,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// 5. `show` and `report traceability` surface an upstream entry's origin.
// ---------------------------------------------------------------------------

Deno.test(
  "show + report traceability: an upstream entry surfaces its Origin: / origin column",
  async () => {
    const root = await Deno.makeTempDir();
    try {
      const dirA = `${root}/a`;
      const dirB = `${root}/b`;
      const fileUrl = await setupProducerA(dirA);
      await setupConsumerB(dirB, fileUrl, REQS_B_SATISFIES_OK);

      const lock = await markspecInDir(dirB, ["lock"], LOCK_PERMISSIONS);
      assertEquals(lock.code, 0, lock.stderr);

      const show = await markspecInDir(dirB, ["show", "SYS_0001", "reqs.md"]);
      assertEquals(show.code, 0, show.stderr);
      assertMatch(show.stdout, /Origin: producta@/);

      const rep = await markspecInDir(dirB, [
        "report",
        "traceability",
        "--format",
        "json",
        "reqs.md",
      ]);
      assertEquals(rep.code, 0, rep.stderr);
      // deno-lint-ignore no-explicit-any
      const rows: any[] = JSON.parse(rep.stdout);
      const row = rows.find((r) => r.id === "SYS_0001");
      assertEquals(row !== undefined, true, JSON.stringify(rows));
      assertMatch(row.origin, /^producta@/);
      // The Origin column is populated AND the cross-repo edge is present
      // on the same row — B's SWE_0001 satisfies A's upstream SYS_0001.
      assertMatch(row.satisfiedBy, /SWE_0001/);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// 6. Root/diamond (design §4.9). Three projects:
//   - B ("productb"): standalone, authors SYSB_0001.
//   - C ("productc"): references B, authors SYSC_0001 satisfying SYSB_0001.
//     C's own published snapshot therefore re-exports B's SYSB_0001 with an
//     upstream origin already stamped (origin: productb).
//   - ROOT: references BOTH B and C. Its graph must count SYSB_0001 exactly
//     once (via the direct B reference) — the authoritative-source rule in
//     `loadUpstreamCorpus` skips C's re-exported copy (it already carries
//     an `origin`) — so no MSL-R014 collision fires and the published
//     entry count is B + C + ROOT, never B + C + ROOT + 1.
// ---------------------------------------------------------------------------

const DIAMOND_PROJECT_B_YAML = `name: productb\nversion: 0.1.0\n`;

const DIAMOND_PROFILE_B_YAML = `id: "@acme/federated-resolve-diamond-b"
version: 0.1.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "SYSB_{n:04d}"
`;

const DIAMOND_REQS_B = `# Product B requirements

- [SYSB_0001] B root requirement

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEM
      Type: requirement
`;

function diamondProjectYaml(
  name: string,
  refs: readonly { readonly url: string; readonly name: string }[],
): string {
  const refLines = refs
    .map((r) => `  - url: ${JSON.stringify(r.url)}\n    name: ${r.name}\n`)
    .join("");
  return `name: ${name}\nversion: 0.1.0\nreferences:\n${refLines}`;
}

const DIAMOND_PROFILE_C_YAML = `id: "@acme/federated-resolve-diamond-c"
version: 0.1.0
profile:
  types:
    derived:
      extends: Requirement
      display-id-pattern: "SYSC_{n:04d}"
      traceability:
        Satisfies:
          target: [requirement]
          cardinality: 0..3
          required: false
`;

const DIAMOND_REQS_C = `# Product C requirements

- [SYSC_0001] C requirement satisfying B

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEN
      Type: derived
      Satisfies: SYSB_0001
`;

const DIAMOND_PROFILE_ROOT_YAML = `id: "@acme/federated-resolve-diamond-root"
version: 0.1.0
profile:
  types:
    root-item:
      extends: Requirement
      display-id-pattern: "SYSR_{n:04d}"
`;

const DIAMOND_REQS_ROOT = `# Root requirements

- [SYSR_0001] Root aggregation note

  Body text.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEP
      Type: root-item
`;

async function writeMarkspecProject(
  dir: string,
  projectYaml: string,
  profileYaml: string,
  reqsMd: string,
): Promise<void> {
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(`${dir}/project.yaml`, projectYaml);
  await Deno.writeTextFile(
    `${dir}/.markspec.yaml`,
    "profiles:\n  - ./profiles/p\n",
  );
  await Deno.mkdir(`${dir}/profiles/p`, { recursive: true });
  await Deno.writeTextFile(`${dir}/profiles/p/markspec.yaml`, profileYaml);
  await Deno.writeTextFile(`${dir}/reqs.md`, reqsMd);
}

Deno.test(
  "root/diamond: ROOT counts B's entries exactly once via the direct reference, never via C's re-export — no MSL-R014",
  async () => {
    const root = await Deno.makeTempDir();
    try {
      const dirB = `${root}/b`;
      const dirC = `${root}/c`;
      const dirRoot = `${root}/root`;

      // --- B: standalone producer ---
      await writeMarkspecProject(
        dirB,
        DIAMOND_PROJECT_B_YAML,
        DIAMOND_PROFILE_B_YAML,
        DIAMOND_REQS_B,
      );
      const compileB = await markspecInDir(dirB, [
        "compile",
        "--output",
        "api",
        "reqs.md",
      ]);
      assertEquals(compileB.code, 0, compileB.stderr);
      const fileUrlB = toFileUrl(join(dirB, "api")).href;

      // --- C: references B, authors an entry satisfying B ---
      await writeMarkspecProject(
        dirC,
        diamondProjectYaml("productc", [{ url: fileUrlB, name: "productb" }]),
        DIAMOND_PROFILE_C_YAML,
        DIAMOND_REQS_C,
      );
      const lockC = await markspecInDir(dirC, ["lock"], LOCK_PERMISSIONS);
      assertEquals(lockC.code, 0, lockC.stderr);
      const compileC = await markspecInDir(dirC, [
        "compile",
        "--output",
        "api",
        "reqs.md",
      ]);
      assertEquals(compileC.code, 0, compileC.stderr);
      const fileUrlC = toFileUrl(join(dirC, "api")).href;

      // Confirm the diamond premise: C's OWN published snapshot re-exports
      // B's entry with an upstream origin already stamped. Without this,
      // scenario 6 would not actually exercise the authoritative-source
      // rule at ROOT.
      const compiledC = JSON.parse(
        await Deno.readTextFile(`${dirC}/api/compiled.json`),
      );
      assertEquals(
        Object.keys(compiledC.entries).length,
        2,
        "C's own /api/ should carry its own entry plus B's re-exported entry",
      );
      assertEquals(
        compiledC.entries["SYSB_0001"]?.origin?.upstreamId,
        "productb",
        JSON.stringify(compiledC.entries["SYSB_0001"]),
      );

      // --- ROOT: references BOTH B and C (diamond) ---
      await writeMarkspecProject(
        dirRoot,
        diamondProjectYaml("root", [
          { url: fileUrlB, name: "productb" },
          { url: fileUrlC, name: "productc" },
        ]),
        DIAMOND_PROFILE_ROOT_YAML,
        DIAMOND_REQS_ROOT,
      );
      const lockRoot = await markspecInDir(dirRoot, ["lock"], LOCK_PERMISSIONS);
      assertEquals(lockRoot.code, 0, lockRoot.stderr);

      const compileRoot = await markspecInDir(dirRoot, [
        "compile",
        "--output",
        "api",
        "reqs.md",
      ]);
      assertEquals(compileRoot.code, 0, compileRoot.stderr);
      assertEquals(
        /MSL-R014/.test(compileRoot.stderr),
        false,
        compileRoot.stderr,
      );

      const manifestRoot = JSON.parse(
        await Deno.readTextFile(`${dirRoot}/api/manifest.json`),
      );
      // B-authored (1) + C-authored (1) + ROOT-authored (1) = 3 — B's
      // entry must not be double-counted via C's re-export.
      assertEquals(manifestRoot.counts.entries, 3);

      const compiledRoot = JSON.parse(
        await Deno.readTextFile(`${dirRoot}/api/compiled.json`),
      );
      assertEquals(Object.keys(compiledRoot.entries).length, 3);
      assertEquals(
        compiledRoot.entries["SYSB_0001"]?.origin?.upstreamId,
        "productb",
        "B's entry at ROOT must carry origin from the DIRECT reference, " +
          JSON.stringify(compiledRoot.entries["SYSB_0001"]),
      );
      assertEquals(
        compiledRoot.entries["SYSC_0001"]?.origin?.upstreamId,
        "productc",
      );
      assertEquals(
        compiledRoot.entries["SYSR_0001"]?.origin,
        undefined,
        "ROOT's own entry must not carry an upstream origin",
      );

      // check: exit 0, no collision diagnostic.
      const checkRoot = await markspecInDir(dirRoot, ["check"]);
      assertEquals(checkRoot.code, 0, checkRoot.stderr);
      assertEquals(
        /MSL-R014/.test(checkRoot.stderr),
        false,
        checkRoot.stderr,
      );

      // The C→B cross-repo edge resolves in ROOT's graph: `dependents` on
      // B's entry lists C's entry as a dependent.
      const dependents = await markspecInDir(dirRoot, [
        "dependents",
        "SYSB_0001",
        "--format",
        "json",
        "reqs.md",
      ]);
      assertEquals(dependents.code, 0, dependents.stderr);
      // deno-lint-ignore no-explicit-any
      const depRows: any[] = JSON.parse(dependents.stdout);
      assertEquals(
        depRows.some((r) => r.from === "SYSC_0001" && r.kind === "satisfies"),
        true,
        JSON.stringify(depRows),
      );

      // Same cross-repo edge, seen from the traceability matrix: B's row
      // shows C as a satisfier, C's row shows its own upstream origin.
      const rep = await markspecInDir(dirRoot, [
        "report",
        "traceability",
        "--format",
        "json",
        "reqs.md",
      ]);
      assertEquals(rep.code, 0, rep.stderr);
      // deno-lint-ignore no-explicit-any
      const rows: any[] = JSON.parse(rep.stdout);
      const rowB = rows.find((r) => r.id === "SYSB_0001");
      const rowC = rows.find((r) => r.id === "SYSC_0001");
      assertEquals(rowB !== undefined, true, JSON.stringify(rows));
      assertEquals(rowC !== undefined, true, JSON.stringify(rows));
      assertMatch(rowB.origin, /^productb@/);
      assertMatch(rowB.satisfiedBy, /SYSC_0001/);
      assertMatch(rowC.origin, /^productc@/);
      assertMatch(rowC.satisfies, /SYSB_0001/);
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);
