/**
 * @module core/lock/git_intent
 *
 * Pure git-intent resolution for federated dependencies (design §4.3).
 * Parses `git ls-remote --symref` output into a {@linkcode RefList} and
 * resolves a declared version intent (`auto` | `<tag>` | `<branch>` |
 * `<sha>`) to an exact commit + a resolution-kind label. No I/O — the CLI
 * runs git and hands the raw stdout in; unit tests feed fixture strings.
 */

import { compare, type parse as parseSemver, tryParse } from "@std/semver";

export interface GitRef {
  readonly name: string;
  readonly kind: "tag" | "branch";
  readonly sha: string;
}

export interface RefList {
  readonly refs: readonly GitRef[];
  readonly headSha?: string;
  readonly defaultBranch?: string;
}

export interface ResolvedIntent {
  readonly sha: string;
  readonly resolved: string;
}

const SHA_RE = /^[0-9a-fA-F]{40}$/;
/** Strip a single leading `v`/`V` so `v2.1.0` parses as semver. */
function semverText(tag: string): string {
  return /^[vV]/.test(tag) ? tag.slice(1) : tag;
}

/**
 * Parse `git ls-remote --symref <url>` output. Peeled annotated-tag lines
 * (`refs/tags/x^{}`) override the tag-object sha with the underlying commit
 * — that commit is what a checkout resolves to and what we pin.
 */
export function parseLsRemote(stdout: string): RefList {
  const branches = new Map<string, string>();
  const tags = new Map<string, string>();
  let headSha: string | undefined;
  let defaultBranch: string | undefined;

  for (const raw of stdout.split("\n")) {
    const line = raw.trimEnd();
    if (line.length === 0) continue;
    if (line.startsWith("ref: ")) {
      // `ref: refs/heads/main\tHEAD` — the symref for HEAD.
      const m = line.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD$/);
      if (m) defaultBranch = m[1];
      continue;
    }
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const sha = line.slice(0, tab);
    const ref = line.slice(tab + 1);
    if (ref === "HEAD") {
      headSha = sha;
    } else if (ref.startsWith("refs/heads/")) {
      branches.set(ref.slice("refs/heads/".length), sha);
    } else if (ref.startsWith("refs/tags/")) {
      const rest = ref.slice("refs/tags/".length);
      const peeled = rest.endsWith("^{}");
      const name = peeled ? rest.slice(0, -3) : rest;
      // A peeled line always wins; a bare tag line only sets the sha if no
      // peeled sha was recorded yet.
      if (peeled || !tags.has(name)) tags.set(name, sha);
    }
  }

  const refs: GitRef[] = [
    ...[...branches].map(([name, sha]): GitRef => ({
      name,
      kind: "branch",
      sha,
    })),
    ...[...tags].map(([name, sha]): GitRef => ({ name, kind: "tag", sha })),
  ];
  return { refs, headSha, defaultBranch };
}

/**
 * Resolve a declared intent to an exact `{ sha, resolved }`.
 *
 * - `auto` → highest valid-semver tag (leading `v` tolerated); if none, the
 *   default-branch head.
 * - a name matching a tag → `tag:<name>` (tag wins if a branch shares the name).
 * - a name matching a branch → `branch:<name>`.
 * - a 40-hex string (any case) → normalized to lowercase → `sha:<sha>` (the
 *   acquire step validates it). Lowercasing keeps the pin byte-identical
 *   regardless of the case a developer typed, so two lockfiles never differ
 *   on sha case alone.
 * - otherwise → `{ error }`.
 */
export function resolveIntent(
  intent: string,
  refs: RefList,
): ResolvedIntent | { error: string } {
  if (intent === "auto") {
    const semverTags = refs.refs
      .filter((r) => r.kind === "tag")
      .map((r) => ({ r, v: tryParse(semverText(r.name)) }))
      .filter((x): x is { r: GitRef; v: ReturnType<typeof parseSemver> } =>
        x.v !== undefined
      )
      .sort((a, b) => compare(b.v, a.v));
    if (semverTags.length > 0) {
      const top = semverTags[0].r;
      return { sha: top.sha, resolved: `tag:${top.name}` };
    }
    if (refs.headSha !== undefined) {
      return {
        sha: refs.headSha,
        resolved: `branch:${refs.defaultBranch ?? "HEAD"}`,
      };
    }
    return { error: "intent 'auto': remote has no tags and no HEAD" };
  }

  const tag = refs.refs.find((r) => r.kind === "tag" && r.name === intent);
  if (tag) return { sha: tag.sha, resolved: `tag:${tag.name}` };
  const branch = refs.refs.find((r) =>
    r.kind === "branch" && r.name === intent
  );
  if (branch) return { sha: branch.sha, resolved: `branch:${branch.name}` };
  if (SHA_RE.test(intent)) {
    const sha = intent.toLowerCase();
    return { sha, resolved: `sha:${sha}` };
  }
  return { error: `intent '${intent}' matched no tag or branch on the remote` };
}
