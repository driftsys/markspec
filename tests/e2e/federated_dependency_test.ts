/**
 * @module tests/e2e/federated_dependency
 *
 * End-to-end proof for the federated-upstream git-dependency-fetcher
 * story (slice 3): `markspec lock` acquiring a `dependencies:` git
 * repository, `markspec check` resolving a cross-repo `Satisfies:`
 * against it, idempotence of a second lock, and the `check --strict`
 * unreleased-pin gate (MSL-L215).
 *
 * Fully offline — the "remote" is a local bare git repository built in
 * a temp dir (fetch-by-sha requires
 * `uploadpack.allowReachableSHA1InWant`, which `makeUpstream` sets on
 * the bare fixture). Blackbox per the e2e convention: no imports from
 * source modules, only `Deno.Command` against the real CLI binary
 * (`deno run … main.ts`) and real `git`.
 *
 * This suite does NOT route through `tests/e2e/helpers.ts`'s shared
 * `markspec()` helper — that helper only grants `--allow-read
 * --allow-write`, but the `lock` command spawns `git` as a subprocess
 * to acquire a dependency tree, which additionally requires
 * `--allow-run`.
 */

import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";

const CLI = new URL("../../packages/markspec/main.ts", import.meta.url)
  .pathname;

/** Run the real CLI binary with the permissions `lock` needs to spawn `git`. */
async function run(
  args: string[],
  cwd: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      "--allow-env",
      CLI,
      ...args,
    ],
    cwd,
    stdout: "piped",
    stderr: "piped",
  });
  const o = await cmd.output();
  return {
    code: o.code,
    stdout: new TextDecoder().decode(o.stdout),
    stderr: new TextDecoder().decode(o.stderr),
  };
}

/**
 * Repo-context env vars git reads to locate the repository it operates on.
 * The `git()` helper strips these so a fixture `git init`/`commit` in a temp
 * dir isn't redirected to the ambient repo when the suite itself runs inside
 * a git hook (e.g. the pre-push hook that runs the test suite exports
 * GIT_DIR/GIT_WORK_TREE). Mirrors the same strip the CLI's own `runGit`
 * applies in `packages/markspec/cli/commands/lock.ts` (blackbox e2e can't
 * import it).
 */
const GIT_DISCOVERY_ENV_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_COMMON_DIR",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_NAMESPACE",
] as const;

/** Run real `git`, returning trimmed stdout. Throws on non-zero exit. */
async function git(args: string[], cwd: string): Promise<string> {
  // Copy the full parent env, strip the repo-discovery vars an ambient git
  // hook would export, and pass clearEnv so only the curated env reaches
  // git — the fixture's own temp-dir working tree is what git discovers.
  const env = { ...Deno.env.toObject() };
  for (const key of GIT_DISCOVERY_ENV_VARS) delete env[key];
  const o = await new Deno.Command("git", {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
    env,
    clearEnv: true,
  }).output();
  if (o.code) throw new Error(new TextDecoder().decode(o.stderr));
  return new TextDecoder().decode(o.stdout).trim();
}

/**
 * Small profile declaring a `requirement` type for the upstream (icd)
 * repo, so `STK_ICD_0001` classifies cleanly. Mirrors the fixture
 * pattern in `federated_lock_test.ts`'s cross-repo `Satisfies` scenario
 * — without a declared type, an unclassified entry authoring a
 * `Satisfies:`/being the target of one trips unrelated MSL-T024/MSL-A005
 * attribute-scope warnings that have nothing to do with this scenario.
 * This profile travels IN the git tree (committed + tagged), so
 * `compileAcquiredTree` resolves it from the acquired snapshot exactly
 * as the real producer repo would.
 */
const UPSTREAM_PROFILE_YAML = `id: "@acme/federated-dep-icd"
version: 0.1.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "STK_ICD_{n:04d}"
`;

/** The upstream's ICD document at v1.0.0 — one entry. */
const ICD_V1 = [
  "# ICD",
  "",
  "- [STK_ICD_0001] Brake torque interface",
  "",
  "  The interface shall carry brake torque within 5 ms.",
  "",
  "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
  "      Type: requirement",
  "",
].join("\n");

/** The upstream's ICD document at v2.0.0 — adds a second entry so the
 * v2.0.0 commit is a genuinely different tree than v1.0.0. */
const ICD_V2 = [
  "# ICD",
  "",
  "- [STK_ICD_0001] Brake torque interface",
  "",
  "  The interface shall carry brake torque within 5 ms.",
  "",
  "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF",
  "      Type: requirement",
  "",
  "- [STK_ICD_0002] Wheel-speed interface",
  "",
  "  The interface shall report wheel speed within 10 ms.",
  "",
  "      Id: 01HGW2Q8MNP3RSTVWXYZABCDEG",
  "      Type: requirement",
  "",
].join("\n");

/**
 * Create an upstream repo with two tagged releases. First commit is
 * tagged `v1.0.0` (one entry); a second commit adds a second entry and
 * is tagged `v2.0.0`. Two tags are essential so the `auto` intent has a
 * real choice to make — a lone `v1.0.0` would let a "picks any tag"
 * regression pass. Both tags travel in the bare clone (cloned after both
 * exist). Returns the bare repo's path (used as a `dependencies:` `url:`)
 * plus each tag's resolved sha.
 */
async function makeUpstream(
  root: string,
): Promise<{ bare: string; shaV1: string; shaV2: string }> {
  const work = join(root, "up-work");
  await Deno.mkdir(join(work, "docs"), { recursive: true });
  await Deno.writeTextFile(
    join(work, "project.yaml"),
    "name: aeb-icd\nversion: 1.0.0\n",
  );
  await Deno.writeTextFile(
    join(work, ".markspec.yaml"),
    "profiles:\n  - ./profiles/p\n",
  );
  await Deno.mkdir(join(work, "profiles", "p"), { recursive: true });
  await Deno.writeTextFile(
    join(work, "profiles", "p", "markspec.yaml"),
    UPSTREAM_PROFILE_YAML,
  );
  await git(["init", "-q", "-b", "main"], work);
  await git(["config", "user.email", "t@t.test"], work);
  await git(["config", "user.name", "t"], work);

  // v1.0.0 — one entry.
  await Deno.writeTextFile(join(work, "docs", "icd.md"), ICD_V1);
  await git(["add", "."], work);
  await git(["commit", "-q", "-m", "init"], work);
  await git(["tag", "v1.0.0"], work);
  const shaV1 = await git(["rev-parse", "v1.0.0"], work);

  // v2.0.0 — a second commit + higher tag, so `auto` picks v2.0.0 over
  // v1.0.0 (proving "highest tag", not just "a tag").
  await Deno.writeTextFile(join(work, "docs", "icd.md"), ICD_V2);
  await git(["add", "."], work);
  await git(["commit", "-q", "-m", "add wheel-speed interface"], work);
  await git(["tag", "v2.0.0"], work);
  const shaV2 = await git(["rev-parse", "v2.0.0"], work);

  // Bare clone as the "remote" (after BOTH tags exist so it carries
  // them); allow fetch-by-sha for the acquire path (`markspec lock`'s
  // `acquireTree` fetches the resolved sha directly rather than a ref
  // name — a plain bare repo rejects that fetch).
  const bare = join(root, "up.git");
  await git(["clone", "-q", "--bare", work, bare], root);
  await git(["config", "uploadpack.allowReachableSHA1InWant", "true"], bare);
  return { bare, shaV1, shaV2 };
}

/**
 * Small profile declaring a `system-requirement` type for the consumer
 * project — classifies `SAD_AEB_0001` and declares `Satisfies:` as a
 * valid trace to the upstream's `requirement` type by name (cross-repo
 * type-name matching, same as `federated_lock_test.ts`'s scenario 6).
 */
const CONSUMER_PROFILE_YAML = `id: "@acme/federated-dep-consumer"
version: 0.1.0
profile:
  types:
    system-requirement:
      extends: Requirement
      display-id-pattern: "SAD_AEB_{n:04d}"
      traceability:
        Satisfies:
          target: [requirement]
          cardinality: 0..3
          required: false
`;

Deno.test("lock acquires a git dependency and resolves a cross-repo Satisfies", async () => {
  const root = await Deno.makeTempDir();
  try {
    // Explicit `version: v1.0.0` pins v1.0.0 even though v2.0.0 exists —
    // an explicit tag intent overrides "highest".
    const { bare, shaV1 } = await makeUpstream(root);
    const proj = join(root, "consumer");
    await Deno.mkdir(join(proj, "docs"), { recursive: true });
    await Deno.writeTextFile(
      join(proj, "project.yaml"),
      `name: aeb\nversion: 0.1.0\ndependencies:\n  - url: ${bare}\n    name: icd\n    version: v1.0.0\n`,
    );
    await Deno.writeTextFile(
      join(proj, ".markspec.yaml"),
      "profiles:\n  - ./profiles/p\n",
    );
    await Deno.mkdir(join(proj, "profiles", "p"), { recursive: true });
    await Deno.writeTextFile(
      join(proj, "profiles", "p", "markspec.yaml"),
      CONSUMER_PROFILE_YAML,
    );
    await Deno.writeTextFile(
      join(proj, "docs", "sys.md"),
      [
        "# Sys",
        "",
        "- [SAD_AEB_0001] Brake actuation",
        "",
        "  The system shall actuate braking.",
        "",
        "      Id: 01HGW3A2BCD5ABCDEFGHJKMNPQ",
        "      Type: system-requirement",
        "      Satisfies: STK_ICD_0001",
        "",
      ].join("\n"),
    );

    // First lock — pins the tag.
    const lock1 = await run(["lock"], proj);
    assertEquals(lock1.code, 0, `lock1 stderr: ${lock1.stderr}`);
    const lockText = await Deno.readTextFile(join(proj, "markspec.lock"));
    assertStringIncludes(lockText, "[[upstream.dependency]]");
    // Whitespace-tolerant so a future lockfile column-alignment change in
    // core/lock/serializer.ts doesn't break this spuriously (the emitter
    // currently pads `resolved` with two spaces before `=`). Still asserts
    // the full `tag:v1.0.0` value; the sha is checked separately below.
    assertMatch(lockText, /resolved\s*=\s*"tag:v1\.0\.0"/);
    assertStringIncludes(lockText, shaV1);

    // check resolves the cross-repo Satisfies (no broken-ref error).
    const chk = await run(["check"], proj);
    assertEquals(
      chk.stderr.includes("STK_ICD_0001"),
      false,
      `check stderr unexpectedly mentions STK_ICD_0001: ${chk.stderr}`,
    );
    assertEquals(chk.code, 0, `check stderr: ${chk.stderr}`);

    // Idempotence — second lock does not re-acquire (cache intact).
    const cachePath = join(
      proj,
      ".markspec",
      "cache",
      "upstreams",
      "icd",
      "compiled.json",
    );
    const before = (await Deno.stat(cachePath)).mtime;
    const lock2 = await run(["lock"], proj);
    assertEquals(lock2.code, 0, `lock2 stderr: ${lock2.stderr}`);
    const after = (await Deno.stat(cachePath)).mtime;
    assertEquals(before?.getTime(), after?.getTime());
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("auto intent pins the highest tag; --strict passes on a tag pin", async () => {
  const root = await Deno.makeTempDir();
  try {
    // No `version:` → `auto` intent. The upstream has both v1.0.0 and
    // v2.0.0, so a correct resolver MUST pick the higher (v2.0.0).
    const { bare, shaV2 } = await makeUpstream(root);
    const proj = join(root, "consumer");
    await Deno.mkdir(proj, { recursive: true });
    await Deno.writeTextFile(
      join(proj, "project.yaml"),
      `name: aeb\nversion: 0.1.0\ndependencies:\n  - url: ${bare}\n    name: icd\n`,
    );
    const lock = await run(["lock"], proj);
    assertEquals(lock.code, 0, `lock stderr: ${lock.stderr}`);
    const lockText = await Deno.readTextFile(join(proj, "markspec.lock"));
    // Highest tag wins (v2.0.0, not v1.0.0), and the pinned sha is
    // v2.0.0's — both must hold, or a "picks any/lowest tag" regression
    // slips through. Whitespace-tolerant match (see scenario 1's note).
    assertMatch(lockText, /resolved\s*=\s*"tag:v2\.0\.0"/);
    assertStringIncludes(lockText, shaV2);
    // Tag pin → --strict has no unreleased-pin error.
    const strict = await run(["check", "--strict"], proj);
    assertEquals(strict.stderr.includes("MSL-L215"), false);
    assertEquals(strict.code, 0, `strict stderr: ${strict.stderr}`);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("branch pin trips MSL-L215 under --strict", async () => {
  const root = await Deno.makeTempDir();
  try {
    const { bare } = await makeUpstream(root);
    const proj = join(root, "consumer");
    await Deno.mkdir(proj, { recursive: true });
    await Deno.writeTextFile(
      join(proj, "project.yaml"),
      `name: aeb\nversion: 0.1.0\ndependencies:\n  - url: ${bare}\n    name: icd\n    version: main\n`,
    );
    const lock = await run(["lock"], proj);
    assertEquals(lock.code, 0, `lock stderr: ${lock.stderr}`);
    const strict = await run(["check", "--strict"], proj);
    assertStringIncludes(strict.stderr, "MSL-L215");
    assertEquals(strict.code, 1);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
