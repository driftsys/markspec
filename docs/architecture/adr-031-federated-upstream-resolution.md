# ADR-031: Federated Upstream Resolution

## Status

Accepted (2026-07-05). Closes #746. Slice 6 (gardening) of the
federated-upstream resolution epic (#741); records the ratified design from
`docs/archive/specs/2026-07-04-federated-upstream-resolution-design.md`.

## Context

MarkSpec had exactly one working cross-repository entry-sharing mechanism:
profile-delivered corpus (ADR-030), which ships a shared baseline _inside a
profile package_. True peer-to-peer references — repo B's requirement
`Satisfies:` a live entry authored in repo A — did not resolve. The federation
protocol was designed (compile-output spec, `language.md`, issue #22) but the
resolution side was never built: the lockfile could pin an upstream manifest
hash, yet nothing ever read an upstream's entries. The target topology is a mix
— product↔component references up the V-model, peer repos (ICDs), shared
standards resolution (RefHub-style), and a program/root repo that needs the
overall picture.

This design reuses four load-bearing pieces rather than inventing new ones. The
**ADR-030 origin model** (`Entry.origin`, read-only graph citizens) gains one
new discriminant, `kind: "upstream"`. The **ADR-022 lockfile** gains a new
upstream row kind and extends an existing one, so all pin/drift/restore
machinery is inherited. The **ADR-026 `[[edge]]` ULID ledger** already records
target ULIDs and needs no change — project-side edges to upstream ULIDs already
fit its row shape. And the **compile-output interchange** (`manifest.json` +
`compiled.json`/NDJSON) that `markspec compile --output` already emits becomes
the canonical wire format between repos, so no second serialization exists.

The network is touched in exactly one place — `markspec lock` — and everything
downstream (`check`, `compile`, LSP, MCP) resolves offline from a pinned cache,
preserving the deterministic-output rule (clig.dev). Several tempting
alternatives (live/TTL fetch, namespace-qualified refs, git submodules, a
markdown interchange) were weighed and rejected — see "Alternatives considered".

## Decision

### D1 — Model three relationships through two org-contract fields

`project.yaml` follows the org project-manifest contract (`driftsys/schemas`
`project/v1.json`). Upstreams are declared with two lists — `dependencies:`
(projects this project uses, whose URL is a git repository) and `references:`
(citation sources this project cites, whose URL is a published site) — each a
list of `projectRef` (`ProjectRef = { url; version?; name? }`, `url` required):

```yaml
name: io.acme.aeb-brake-controller
version: "1.2.0"

dependencies:                       # git repositories → clone + compile
  - url: git@github.com:acme/aeb-product.git
    name: product                   # short id: cache dir, lock rows, badges
    # version absent → auto: latest release tag, else default branch
  - url: git@github.com:acme/aeb-icd.git
    name: icd
    version: "v2.1.0"               # exact tag → frozen baseline

references:                         # published sites → fetch the index
  - url: https://driftsys.github.io/refhub
    name: refhub
```

`dependencies:` entries participate fully in traceability (coverage gaps are
reported across the boundary); `references:` entries are leaves (links resolve
to them, no coverage expected). The legacy `parents:` / `parent-fallback:` keys
are retired — RefHub is now an ordinary explicit `references:` entry, not an
implicit fallback (pre-1.0, no back-compat per project policy).

### D2 — Imply acquisition from the declaration field, not a `kind` flag

The two fields select two fetchers internally. A `dependencies:` git repository
is acquired and compiled in-process (`core/lock/upstream_deps.ts`); a
`references:` published site is fetched as ready compile-output JSON
(`core/lock/upstream_refs.ts`). Both write the identical `manifest.json` +
`compiled.json` cache layout, so the consumer reads either identically. A
`kind: git|registry` discriminator on `projectRef` was considered and dropped —
explicit-but-redundant today; recoverable as a non-breaking org-schema addition
if a closed-source dependency with a published API becomes real.

### D3 — Touch the network only in `markspec lock`

Resolution is lock-mediated. `markspec lock` runs three flows, and only these
touch the network: **first lock** (resolve intent → sha, acquire + compile or
fetch, snapshot to cache, write pin); **restore** (pin exists but cache is
missing — re-acquire _exactly the pinned sha_, intent not re-resolved, verify
snapshot hash); **update** (`lock --update[=<id>]` — re-resolve declared intent,
move the pin if changed). Snapshots live under `.markspec/cache/upstreams/<id>/`
(gitignored). `check`/`compile`/LSP/MCP read that cache offline. The
pre-existing `MSL-L212` drift gate gains one case: a locked upstream whose cache
snapshot is missing or hash-mismatched is an error instructing `markspec lock`.

### D4 — Join upstream entries as read-only graph citizens

Upstream entries join the compiled graph as read-only citizens via
`Entry.origin`, the ADR-030 model with a new discriminant:

```ts
export type EntryOrigin =
  | { kind: "profile"; profileId: string; profileVersion: string }
  | { kind: "upstream"; upstreamId: string; version: string };
```

`formatEntryOrigin` renders the upstream badge as `<upstreamId>@<version>` (e.g.
`product@v2.1.0`); `isUpstreamEntry` gates the validator and lint loops.
`loadUpstreamCorpus` (`core/upstream/mod.ts`) — the sibling of ADR-030's
`loadDeliveredCorpus`, same purity rules (injected `readFile`, no I/O of its
own) — hydrates each cached snapshot into `Entry[]` and stamps the origin.
Upstream entries seed at the same three sites as the ADR-030 corpus, after it,
before project files: the CLI compiler, the LSP `seedUpstreamCorpus()`, and the
MCP server via the shared compile cache. Read-only is structural, not a runtime
flag — upstream entries have no local `.md` file, so `fmt`/`insert` cannot touch
them and rename is refused by the existing `origin` guard. The one new rule:
**go-to-definition is a no-op** for an upstream entry
(`resolveNavigableLocation` returns `null`) — its `location.file` is an
upstream-repo path that does not exist locally. Hover, `show`, `context`, and
completion work from the hydrated entry.

### D5 — Keep one flat display-ID space; collisions are hard diagnostics

There is one flat display-ID space (project + delivered corpus + all upstreams).
Trace targets resolve against that union; `MSL-L006` and broken-ref diagnostics
stop firing for IDs found upstream. Any collision (project↔upstream,
upstream↔upstream, upstream↔corpus) reuses the ADR-030 `MSL-R014` shape, naming
both origins and the remedy. There is no precedence and no qualified-ref grammar
— first-entry-wins (declaration order) only keeps the graph functional while the
error shows.

### D6 — Reuse the compiled-JSON output as the interchange format

The compiled-JSON output `markspec compile --output` already emits — a
`manifest.json` pointing at inline `compiled.json` (Tier 1) or an NDJSON
entries/edges pair (Tier 2) — is the canonical interchange. The git fetcher
produces the same JSON by compiling the acquired checkout in-process
(`compileAcquiredTree`); a published `references:` site serves it directly. Type
classification happens upstream with the upstream's _own_ profile — the consumer
never re-classifies a foreign vocabulary, so a resolved upstream target is
exempt from the consumer's `MSL-L004` target-type check. Hydration is guarded by
a schema-skew check (`checkSnapshotSchema`): a snapshot whose
`markspecSchemaVersion` / `generator.coreSchema` does not match the running core
is rejected (`UPSTREAM-SNAPSHOT-001`), never silently misparsed.
**Authoritative-source rule:** hydration skips any snapshot entry that already
carries an `origin` — an upstream's re-export of _its_ upstreams (or its profile
corpus) never enters the consumer's graph. Every entry joins an aggregate only
from its authoring repo, which is what makes the diamond/root pattern (D8)
collision-free while publishers still publish everything.

### D7 — Track intent in the manifest, the resolved pin in the lockfile

Version tracking is two-level, npm/cargo-style, carried by `projectRef.version`.
The declaration states _intent_; `markspec.lock` records the _resolved pin_.
Intent semantics: exact tag = frozen baseline; branch name = track head;
**absent = auto** (prefer latest semver release tag, else default-branch head).
Intent resolution never clones — `git ls-remote --symref` (tags + heads) feeds a
pure resolver (`resolveIntent`) that semver-sorts tags. As-built lockfile rows
(`core/lock/serializer.ts` + `model.ts`):

```toml
[[upstream.dependency]] # dependencies: — new row kind
id = "product"
url = "git@github.com:acme/aeb-product.git"
intent = "auto" # auto | <tag> | <branch>
resolved = "tag:v2.1.0" # tag:<t> | branch:<b> | sha:<s>
sha = "3cdde94…" # exact commit
snapshot = "sha256:…" # hash of the cached compiled JSON
locked-at = "2026-07-05T…"

[[upstream.registry]] # references: — the extended existing kind
id = "refhub"
api = "https://driftsys.github.io/refhub"
resolved-manifest-hash = "sha256:…"
markspec-schema = 1
version = "1.4.0" # upstream project.version, when published
snapshot = "sha256:…" # hash of the entries data file
locked-at = "2026-07-05T…"
```

The design's draft `[[upstream.reference]]` federation row did **not** ship as a
new kind — `references:` reuses and extends the existing `[[upstream.registry]]`
row (which gained optional `version`, `snapshot`, `locked-at`), settling design
open-question §10 and follow-up §9 #3 in favour of no lock-schema churn. Three
pre-existing rows are unchanged: `[[upstream.reference]]` (bibliographic
citation), `[[upstream.profile]]` (profile chain), and `[[edge]]` (the ULID
ledger). The published `manifest.json` (`ManifestJson`) gained an optional
`project.version` field (from `project.yaml`) — settling design open-question
§10 **yes** — plus `federation: string[]` (the declared `references:` URLs)
alongside `markspecSchemaVersion: 1` and `generator.coreSchema: 1`; a reference
row records the upstream's version from that manifest field.

### D8 — Authorize unreleased pins, gate them at release

Pinning a dependency to an unreleased state (branch/bare-sha resolution) is
allowed during development, under two stacked guarantees:

- **Pin-level.** Every `[[upstream.dependency]]` row whose `resolved` is not
  `tag:*` emits `MSL-L215` (`dependencyPinAssurance`) — a non-blocking advisory
  by default, promoted to an error under `markspec check --strict`. Under
  `--strict` this is the release gate: you cannot release against a dependency
  that never baselined. The message names the dependency and the remedy (ask the
  upstream to cut a tag, then `lock --update=<id>`).
- **Content-level.** After `lock --update` moves a pin to a tag, the cache holds
  the _tag's_ entries; a reference to an ID that exists only on `main` now fails
  resolution as `MSL-T014` — the correct failure at the correct moment.

`references:` entries have no tags — they are released-by-publication, and their
manifest may carry the upstream's `project.version` so the lockfile records
`refhub@1.4.0`.

### D9 — Adopt the org contract as the `project.yaml` SSOT

`project.yaml` validates against the org contract (`driftsys/schemas`
`project/v1.json`) — a closed schema with `name` + `version` required. MarkSpec
tool config leaves `project.yaml` entirely: `exclude:` and
`caption-conventions:` migrate to `.markspec.yaml`, `labels:` vocabulary is
retired (governed by the profile), `version:` becomes required, and the local
`schemas/project/v1.json` is retired in favour of the org SSOT. `ProjectConfig`
now carries `dependencies:
ProjectRef[]` and `references: ProjectRef[]` as
first-class fields.

### D10 — Keep core pure; fetchers live at the lock/CLI layer

Core gains only pure pieces: the origin model, snapshot hydration
(`deserializeCompileResult` + skew guard), and the corpus loader with an
injected `readFile`. Every network- and git-touching fetcher (HTTP fetch for
references, `ls-remote` + shallow git fetch for dependencies) lives at the
lock/CLI layer beside the existing resolvers. Core never grows a network or git
dependency, so Node compatibility is preserved. The in-process compile of an
acquired tree (`compileAcquiredTree`) runs with sorted, tree-relative file paths
and no stat/git callbacks, so the cached `compiled.json` and its `snapshot` hash
are byte-reproducible across machines from `(tree, markspec version)`.

## Non-features (out of scope for v1, deliberately)

1. **Transitive federation** — direct dependencies/references only. Refs _from_
   upstream entries are validation-exempt (`isUpstreamEntry` skips them), so
   this never false-errors; the program graph is the composition of each repo's
   committed lockfile.
2. **Live / TTL fetching** — rejected: `check` output would depend on network
   state, violating the deterministic-output rule. Issue #22's original
   7-day-TTL model is superseded and to be rewritten.
3. **Namespace-qualified refs** (`product/STK_0001`) — rejected: a new token
   grammar in every trace surface for a collision problem that prefix discipline
   plus a hard `MSL-R014` diagnostic already handles.
4. **Vendoring snapshots into the repo** — the cache stays gitignored; the
   lockfile is the durable record.
5. **`kind` discriminator on `projectRef`** — deferred (D2); returns as a
   non-breaking org-schema addition if a real case appears.
6. **Forge-tarball acquisition rung** — deferred. v1 acquires only via shallow
   `git fetch`-by-sha (`git init` →
   `fetch --depth 1 --filter=blob:none origin
   <sha>` → `checkout FETCH_HEAD`,
   then drop `.git`). Preferring a GitHub/GitLab tarball endpoint for recognized
   forge hosts is a fast-follow.
7. **Owner-publishes escalation** — a large repo's own CI running
   `compile --output` and publishing its `/api/` (reusing the `references:`
   machinery, the moment the deferred `kind` addition returns) is designed, not
   built.
8. **Shared remote snapshot cache** — an org-level `(repo, sha)` cache (the
   ADR-020 "lockfile-pinned federated cache" trajectory) slots behind the same
   cache interface later; needs infrastructure, YAGNI now.
9. **Hub mode** — member repos resolving siblings via the root's re-exports is
   deferred; v1 keeps per-repo direct dependencies plus an aggregation-only
   root. The authoritative-source rule (D6) is the hook a future hub opt-in
   relaxes.
10. **Federation registry-URL document directive** — the designed
    `markspec:references <url>` registry directive (with RefHub implicit
    fallback) was **not built**. `markspec:references` exists only as a
    references-listing document marker; federation upstreams are declared in
    `project.yaml` `references:` instead.
11. **Cross-repo rename-heal / edge-ledger changes** — v1 records `[[edge]]`
    rows from the project side only.
12. **Peer-to-peer reverse visibility** — a member repo cannot see its
    downstreams under one-directional pinning; the supported way to see the
    overall picture is the program-root pattern (D6), rendered as a website by
    #591.

## Consequences

- Peer-to-peer traceability works: a downstream `Satisfies:`/`Derived-from:`/…
  resolves against an entry authored in another repository, offline, from a
  pinned cache — with zero per-command wiring beyond `loadUpstreamCorpus`.
- A program/root repo that declares every member in `dependencies:` gets the
  aggregate picture for free: all repos hydrate into one flat graph, cross-repo
  edges resolve, so program-wide `report` (coverage, matrix), `dependents`, and
  `context` all work at the root. Its committed `markspec.lock` is the program
  baseline record; its `check --strict` is the program release gate; its
  `compile --output` publishes the overall picture (#591 input). Membership is
  curated config (the `dependencies:` list), never network discovery.
- `markspec lock` is the only online step and adopts a warn-and-write posture:
  an upstream that fails to acquire (unreachable, malformed, no derivable id,
  git/compile error) yields an `MSL-L213` warning naming it, and every pin that
  _did_ resolve still writes — one bad upstream never blocks the others. This
  applies uniformly to `references:` and `dependencies:`.
- New diagnostics, all shipped: `MSL-T014` (unresolved-after-chain ref when
  upstreams are declared, naming the searched set); `MSL-L213` (upstream could
  not be locked, unified across both fields); `MSL-L214` (restore-flow snapshot
  hash mismatch — the published site or recompile moved); `MSL-L215` (unreleased
  pin advisory, error under `--strict`); `MSL-L216` (an id claimed by both a
  `references:` and a `dependencies:` entry — the dependency is skipped, the
  reference snapshot owns the shared cache); plus the `MSL-L212` cache-drift
  case.
- `check`, `compile`, `show`, `context`, `dependents`, `report`, the LSP, and
  the MCP server all see upstream entries with their origin badge; `report`
  coverage counts `dependencies:` and ignores `references:`; LSP completion
  offers upstream IDs with a `— from <id>@<version>` badge; LSP go-to-definition
  is a no-op for them.
- Acquisition cost is bounded by _lock events_, not daily work — a dependency is
  acquired once per pin movement per machine. The documented CI recipe caches
  `.markspec/cache/upstreams/` keyed on the lockfile hash.
- The org contract's `process:` field (compliance-framework declaration) stays
  opaque org metadata to every MarkSpec surface — its relationship to profile
  activation is settled separately by ADR-032.

## Alternatives considered

- **Keep `parents:` / rename to `upstreams:`** — both rejected. "Parent" is
  semantically inverted at the root (children listed as parents) and already
  means three other things in MarkSpec (profile `extends`, type hierarchy, book
  directive); `upstreams:` would collide with the org contract's `upstream`
  (fork lineage). The `dependencies`/`references` split is adopted — it also
  encodes the coverage distinction a flat list left implicit.
- **`kind: git|registry` discriminator on `projectRef`** — dropped: acquisition
  is implied by the field. Explicit-but-redundant today; a non-breaking addition
  when a real case appears.
- **Markdown interchange (reuse `loadDeliveredCorpus` literally)** — rejected:
  the consumer would need the upstream's profile chain for type classification
  (silent misclassification under profile drift), and references have no `.md`
  sources, forcing a JSON path anyway.
- **Thin existence-only index** (`displayId, ulid, title, type`) — rejected at
  the depth fork in favour of full graph citizens; the compiled output already
  exists, so the thinner format saves little.
- **Live fetch + TTL cache** (issue #22's original model) — rejected: `check`
  output would depend on network state, violating deterministic output and
  making CI flaky.
- **Namespace-qualified refs** (`product/STK_0001`) — rejected: a new token
  grammar in every trace surface (parser, LSP, rename, skills) for a collision
  problem that prefix discipline plus a hard diagnostic handles.
- **Git submodules / subtrees as the root manifest** — rejected: they vendor
  full sources where compiled snapshots are needed, force the root to
  re-implement per-member compilation, cannot express registries or version
  intent, and add clone/CI tax. `markspec.lock` already gives exact pins, the
  intent layer, the restore flow, and a diffable baseline record.
- **Per-file forge-API reads instead of tarball** — rejected: the file set is
  unknown without discovery, so it degenerates into many round-trips that lose
  to one fetch.
- **Explicit-only version intent (no auto mode)** — rejected: "prefer baseline,
  fall back to unreleased" is the correct default and removes a decision from
  every declaration site.
- **Hub mode** (members resolve siblings via the root's aggregate) — deferred:
  it gives one-pin program coherence and O(N) config at the cost of members
  never moving ahead of the root's last publish; not worth the coupling until
  O(N²) `dependencies:` maintenance actually hurts.

## References

- Design doc:
  `docs/archive/specs/2026-07-04-federated-upstream-resolution-design.md`
  (superseded by this ADR; gardened to `docs/archive/` per the working-memory
  lifecycle rule).
- [ADR-030](./adr-030-profile-delivered-documents.md) — the `Entry.origin`
  read-only-corpus model this reuses with a new `kind: "upstream"` discriminant;
  `loadUpstreamCorpus` is the sibling of `loadDeliveredCorpus`.
- [ADR-022](./adr-022-lockfile-and-external-sync.md) — the `markspec.lock`
  format extended here with the `[[upstream.dependency]]` row and the widened
  `[[upstream.registry]]` row.
- [ADR-026](./adr-026-display-id-trace-resolution.md) — the `[[edge]]` ULID
  ledger, unchanged: project-side edges to upstream ULIDs already fit its shape.
- [ADR-009](./adr-009-core-profile-boundary.md) /
  [ADR-010](./adr-010-default-profile.md) — the core/profile boundary: upstream
  type classification happens upstream, with the upstream's own profile; the
  consumer never re-classifies a foreign vocabulary.
- [ADR-020](./adr-020-sqlite-indexing-eval.md) — the "lockfile-pinned federated
  cache" trajectory the deferred shared-remote-cache non-feature composes with.
- [ADR-032](./adr-032-process-profile-boundary.md) — settles the sibling
  `process:` ↔ profile-activation question this design scoped out (§9 #2).
- As-built: `core/model/mod.ts` (`EntryOrigin`, `formatEntryOrigin`,
  `isUpstreamEntry`, `ProjectRef`, `ProjectConfig`), `core/upstream/mod.ts`
  (`loadUpstreamCorpus`), `core/upstream/refs.ts` (`upstreamRefsFromLockfile`),
  `core/lock/model.ts` + `serializer.ts` (`UpstreamDependency`, extended
  `UpstreamRegistry`), `core/lock/upstream_refs.ts` (`resolveProjectReferences`,
  `MSL-L213`/`L214`), `core/lock/upstream_deps.ts`
  (`resolveProjectDependencies`, `MSL-L216`), `core/lock/git_intent.ts`
  (`resolveIntent`), `core/lock/acquire_compile.ts` (`compileAcquiredTree`),
  `core/lock/pin_assurance.ts` (`MSL-L215`), `core/validator/traceability.ts`
  (`MSL-T014`), `core/compiler/manifest.ts` (`ManifestJson.project.version`,
  `federation`), `core/compiler/deserialize.ts` (`checkSnapshotSchema`,
  `deserializeEntry`), `cli/commands/lock.ts` (`denoGitIO` shallow
  fetch-by-sha), `lsp/server.ts` (`seedUpstreamCorpus`), `lsp/definition.ts`
  (`resolveNavigableLocation`).
