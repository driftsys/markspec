# Federated upstream resolution — design

- **Date:** 2026-07-04 (revised same day after org-SSOT alignment)
- **Status:** draft, awaiting spec review
- **Scope:** true peer-to-peer cross-repository references — a downstream repo's
  entry traces (`Satisfies:`, `Derived-from:`, …) to an entry authored in
  another repository, resolved and validated by `markspec check`; plus the
  program root project that aggregates the overall picture.

## 1. Problem

MarkSpec today has exactly one working cross-repo entry-sharing mechanism:
profile-delivered corpus (ADR-030), which ships a shared baseline _inside a
profile package_. Peer-to-peer references — repo B's requirement satisfying a
live entry in repo A — do not resolve: the federation protocol is designed
(compile-output spec §5, `language.md` §3.2, issue #22) but the resolution side
was never built. `resolveRegistries` pins an upstream's manifest hash into
`markspec.lock`, yet nothing ever reads an upstream's entries.

Target topology is a mix: product→component references up the V-model, peer
repos (ICDs), shared standards resolution (RefHub-style registries), and a
root/program repo that needs the overall picture.

## 2. Prior art this design builds on

| Piece                             | Where                                          | Reused as                                         |
| --------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| Org project-manifest contract     | `driftsys/schemas` `project/v1.json` + README  | The declaration surface (SSOT for `project.yaml`) |
| Lockfile + `resolveUpstreams`     | ADR-022, `core/lock/`                          | Pinning + drift machinery; new upstream row kind  |
| Registry pinning                  | `core/lock/resolve.ts::resolveRegistries`      | Extended from pin-only to pin+snapshot            |
| `Entry.origin` read-only citizens | ADR-030, `core/profile/delivered.ts`           | Same model, new origin kind `upstream`            |
| Compile output (`/api/`)          | compile-output spec, `core/compiler/schema.ts` | The interchange format (already emitted today)    |
| `[[edge]]` ULID ledger            | ADR-026                                        | Unchanged; already records target ULIDs           |
| Reserved `MSL-T014`               | `language.md` §8                               | Lands as the post-federation unresolved-ref code  |

Issue #22's acceptance criteria (live fetch, 7-day TTL) are superseded by this
design's lock-mediated model and will be rewritten. The legacy
`parents:`/`parent-fallback:` config keys are retired (see §4.1 and D9).

## 3. Decisions

- **D1 — Topology:** support authored project dependencies, peer repos, and
  standards registries through the org contract's two relationship fields.
- **D2 — Acquisition is implied by the declaration field, not a `kind` flag:**
  `dependencies:` are projects → git repositories → clone at pinned version and
  compile in-process. `references:` are citation sources → published sites →
  fetch the published index. Two fetchers internally; selection by field. A
  `kind` discriminator was considered and dropped; it can return later as a
  non-breaking org-schema addition (see §5 #8).
- **D3 — Network model:** lock-mediated. Only `markspec lock` touches the
  network; `check`/`compile`/LSP/MCP resolve offline from the pinned cache.
  Deterministic output preserved (clig.dev rule).
- **D4 — Depth:** upstream entries join the compiled graph as read-only citizens
  via `Entry.origin` — the ADR-030 model with a new origin kind. The
  dependency/reference split adds a _coverage_ distinction, not a data-shape one
  (§4.7).
- **D5 — Namespacing:** one flat display-ID space (project + corpus + all
  upstreams). Any collision is a hard diagnostic naming both origins. No
  qualified-ref grammar.
- **D6 — Interchange:** the compiled-JSON output `markspec compile` already
  emits (`manifest.json` + `compiled.json` / NDJSON pair) is the canonical
  interchange. The git fetcher produces the same JSON by compiling the checkout
  in-process; a published reference serves it directly. Type classification
  happens upstream with the upstream's own profile — the consumer never needs
  it.
- **D7 — Version tracking:** two-level, npm/cargo-style, carried by
  `projectRef.version`. The manifest declares _intent_; `markspec.lock` records
  the _resolved pin_ (exact sha) plus the _resolution kind_ (`tag` | `branch` |
  `sha`). Intent semantics: exact tag = frozen baseline; branch name = track
  head; **absent = auto mode** (prefer latest release tag, else default-branch
  head).
- **D8 — Unreleased references are authorized but gated:** pinning a dependency
  to an unreleased state (branch/sha resolution) is allowed during development
  and surfaces as a non-blocking advisory; under `check --strict` any
  non-tag-resolved pin fails (pin-level gate), and references to entries that
  exist only outside the pinned baseline fail resolution once the pin moves to a
  tag (content-level gate). See §4.4.
- **D9 — Org schema is the SSOT for `project.yaml`:** markspec's local
  `schemas/project/v1.json` is retired in favour of
  `https://driftsys.github.io/schemas/project/v1.json` (closed schema,
  `name`+`version` required). markspec tool config leaves `project.yaml`
  entirely (§4.10).
- **D10 — Core stays pure:** core gains only pure pieces (origin model,
  hydration, corpus loader with injected `readFile`). Fetchers (HTTP, git,
  tarball) live at the lock/CLI layer beside `resolveUpstreams`. Core never
  grows a network or git dependency; Node compatibility preserved.

## 4. Design

### 4.1 Declaration surface — org `project.yaml` contract

`project.yaml` follows the org contract (`driftsys/schemas` `project/v1.json`):
relationships are declared with `dependencies:` and `references:`, each a list
of `projectRef` (`url` required; `version`, `name` optional):

```yaml
name: io.acme.aeb-brake-controller
version: "1.2.0"

dependencies:                       # projects this project uses (git repos)
  - url: git@github.com:acme/aeb-product.git
    name: product                    # short id: cache dir, lock rows, badges
    # version absent → auto mode: latest release tag, else default branch
  - url: git@github.com:acme/aeb-icd.git
    name: icd
    version: "v2.1.0"                # frozen baseline (exact tag)
  - url: ../aeb-sensor               # local path clone — sibling dev loop
    name: sensor
    version: "main"                  # deliberately track unreleased head

references:                          # citation sources (published sites)
  - url: https://driftsys.github.io/refhub
    name: refhub                     # was parent-fallback — now explicit
```

- **`dependencies:`** — projects this project uses. URL is a git repository
  (remote or local path). Entries participate fully in traceability: the
  compiler expects links across the boundary and reports coverage gaps.
- **`references:`** — registries and external sources this project cites. URL is
  a published site serving the compile-output artifacts. Traceability leaves:
  links resolve to them, no deeper chain or coverage expected. `file://` URLs
  are accepted (e2e vehicle).
- **`name`** on a projectRef is the upstream id (cache directory, lockfile rows,
  diagnostics, origin badges); derived from the URL when absent.
- **`version`** carries the intent per D7. The lockfile records what it resolved
  to.
- The legacy `parents:` / `parent-fallback:` keys are removed (pre-1.0, no
  back-compat per project policy). RefHub is no longer an implicit fallback — it
  is an ordinary explicit `references:` entry.
- Where a project _publishes its own_ `/api/` output is CI/build configuration
  (`compile --output` + a publish workflow), never `project.yaml`.

### 4.2 Lock flows and lockfile rows

The git/network scan happens in exactly three flows, all inside `markspec lock`
— never during `check`/`compile`/LSP:

| Flow       | Trigger                                                    | Behaviour                                                                                                             |
| ---------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| First lock | `lock` with a new dependency/reference                     | Resolve intent → exact sha, acquire + compile (or fetch), snapshot to cache, write pin                                |
| Restore    | `lock` when pins exist but cache doesn't (CI, fresh clone) | Fetch _exactly the pinned sha_ (intent is NOT re-resolved), verify snapshot hash, repopulate cache; error on mismatch |
| Update     | `lock --update` / `--update=<id>`                          | Re-resolve the declared intent against the remote, move the pin if changed, refresh snapshot                          |

Each upstream gets a lockfile row (extending the ADR-022 `[[upstream.*]]`
family; exact TOML naming is plan-time detail):

```toml
[[upstream.dependency]]
id = "product"
url = "git@github.com:acme/aeb-product.git"
intent = "auto" # auto | <tag> | <branch>
resolved = "tag:v2.1.0" # resolution kind + name: tag|branch|sha
sha = "3cdde94…" # exact commit
snapshot = "sha256:…" # hash of the cached compiled JSON
locked-at = "2026-07-04T…"

[[upstream.reference]]
id = "refhub"
url = "https://driftsys.github.io/refhub"
manifest-hash = "sha256:…"
snapshot = "sha256:…"
locked-at = "2026-07-04T…"
```

Snapshots live under `.markspec/cache/upstreams/<id>/` (gitignored). The
`MSL-L212` drift gate gains one case: a locked upstream whose cache snapshot is
missing or hash-mismatched → error instructing `markspec lock`.

### 4.3 Dependency acquisition — the ladder

The acquisition cost is bounded by _lock events_, not daily work: `check`,
`compile`, and the LSP only read the cached snapshot. A dependency is acquired
once per pin movement per machine.

**v1 mechanics (built now):**

1. **Never clone to resolve.** Version-intent resolution is `git ls-remote` only
   (tags + heads) — a few KB even against huge repos. Auto/tag intents
   semver-sort the tag list (default pattern `v*`).
2. **Never fetch history.** Acquire the tree at one sha: prefer the forge
   tarball endpoint when the URL is a recognized GitHub/GitLab host (one authed
   API request, no `.git` directory); else fall back to
   `git clone --depth 1 --filter=blob:none` at the sha. Full clones never
   happen.
3. **Content-addressed cache.** Snapshots are immutable per sha — acquire once,
   reuse until the pin moves. Compile runs in-process on the acquired tree
   (`compileProject`), producing the same JSON a published reference serves.
4. **CI recipe (documented in the guide):** cache `.markspec/cache/upstreams/`
   keyed on the lockfile hash, so CI pays acquisition only when a pin actually
   moved.

v1 constraint: the acquired dependency tree must be self-contained enough to
compile — its profile chain resolvable from its own tree (a profile-fetch during
`lock` is acceptable; `lock` is the designated online step).

**Escalation — owner-publishes (designed, not built):** when a specific repo is
too big to ship around, its own CI runs `compile --output` on main-merge/tag and
publishes its `/api/`. One build by the owner replaces N consumers each cloning
and compiling — the Maven insight, with git hosting + Pages as the registry.
This reuses the `references:` fetcher machinery and is the moment the deferred
`kind` addition (D2) returns to let a _dependency_ be acquired from a published
site.

**Deferred — shared remote snapshot cache:** an org-level cache keyed
`(repo, sha)` (the true Maven/Gradle remote-cache analogue; ADR-020's
"lockfile-pinned federated cache"). Slots behind the same cache interface later;
needs infrastructure; YAGNI now.

Dropped: per-file forge-API crawling — the file set isn't known without
discovery, so it degenerates into many round-trips that lose to one tarball.

### 4.4 Release assurance

Two stacked guarantees:

1. **Pin-level** — the release gate (`check --strict`, release CI) requires
   every dependency row to be tag-resolved. A `branch:`/`sha:` row fails with a
   message naming the dependency and the remedy (upstream cuts a tag, then
   `lock --update`). Organizationally this enforces "you cannot release against
   a dependency that never baselined."
2. **Content-level** — after `lock --update` moves a pin to a tag, the cache
   holds the _tag's_ entries. A reference to an ID that exists only on `main`
   now fails resolution (MSL-T014) — the correct failure at the correct moment:
   the trace referenced unreleased requirements.

Below `--strict`, a branch-resolved pin produces a non-blocking project-level
advisory ("dependency 'icd' is pinned to an unreleased state (main @ abc123)"),
following the gentle-by-default posture.

`references:` entries have no tags; they are released-by-publication (the
publisher publishes their baseline). Their manifest may carry the upstream's
`project.yaml` version so the lockfile records `refhub@1.4.0`.

### 4.5 Interchange and hydration

`SerializedEntry` (`core/compiler/schema.ts`) is already a lossless `Entry`
projection. New pieces, all pure core (D10):

- `EntryOrigin` becomes the discriminated union its doc comment anticipates:

  ```ts
  export type EntryOrigin =
    | { kind: "profile"; profileId: string; profileVersion: string }
    | { kind: "upstream"; upstreamId: string; version: string };
  ```

  `formatEntryOrigin` gains a switch; the upstream label is
  `<upstreamId>@<version>` (e.g. `product@v2.1.0`).
- `deserializeCompileResult` — inverse of `serializeCompileResult` (rebuild the
  `typedAttributes` map), guarded by a schema-skew check: a snapshot whose
  `markspecSchemaVersion` / `generator.coreSchema` doesn't match is rejected
  with a "re-lock with a compatible markspec version" diagnostic, never a silent
  misparse.
- `loadUpstreamCorpus` — sibling of `loadDeliveredCorpus`: reads the cached
  snapshot for each locked upstream (injected `readFile`, no I/O of its own),
  hydrates `Entry[]`, stamps
  `origin = { kind: "upstream", upstreamId,
  version }`.
- **Authoritative-source rule:** hydration _skips_ snapshot entries that already
  carry an `origin` — an upstream's re-export of _its_ upstreams' entries (or
  its profile corpus) never enters the consumer's graph. Every entry joins an
  aggregate only from its authoring repo (or the consumer's own profile corpus).
  This is what makes the diamond/root pattern (§4.9) collision-free: when the
  root pulls both A and B, and A's snapshot also contains B's entries, only B's
  own snapshot supplies them. Publishers still publish everything
  (`serializeCompileResult` is unchanged), so a root project's published `/api/`
  carries the full program picture.

### 4.6 Feed sites and read-only semantics

Upstream entries seed at the same three sites as the ADR-030 corpus, in
declaration order (dependencies, then references), before project files:

- CLI compiler (`compileProject`), immediately after delivered corpus
- LSP server — `seedUpstreamCorpus()` beside `seedDeliveredCorpus()`, re-seeded
  when lockfile/cache change
- MCP server — via the shared compile cache

Read-only semantics are mostly free because upstream entries have **no local
`.md` file** — they exist only as hydrated objects: `fmt`/`insert` cannot touch
them, rename is blocked by the existing `origin` guard, diagnostics for them are
never published. The one new rule: **go-to-definition is a no-op** for upstream
entries (their `location.file` is an upstream-repo path that does not exist
locally). Hover, `show`, `context`, completion work from the hydrated entry.

### 4.7 Validator behaviour

- **Resolution:** trace targets resolve against the flat union project +
  corpus + dependencies + references. `MSL-L006` and broken-ref diagnostics stop
  firing for IDs found upstream.
- **`MSL-T014` lands:** when any dependency/reference is declared,
  unresolved-after-chain refs fire T014 instead of L006, with a message naming
  the searched set ("not found in project or upstreams: product, icd, refhub").
- **Coverage semantics differ by field (org contract):** `dependencies:`
  participate in coverage analysis — at the root, a product requirement with no
  component coverage is a reported gap. `references:` are leaves — no coverage
  expectation ever points at or from them.
- **Collisions:** the ADR-030 collision pass generalizes. project↔upstream,
  upstream↔upstream, upstream↔corpus all produce the `MSL-R014` shape with a
  message naming both origins and the remedy. No precedence — every collision is
  a diagnostic; internal first-entry-wins (declaration order) merely keeps the
  graph functional while the error shows.
- **Upstream entries are validation-exempt, not edge-inert:** no prose lint, no
  structural checks, and refs _from_ upstream entries never produce
  _unresolved-ref_ diagnostics (their validation happened upstream; transitive
  upstreams are not pulled — §5 #2). But when such a ref _does_ resolve inside
  the flat union — component A's entry satisfying component B's entry, both
  hydrated at the root — the edge joins the graph like any other. This is what
  makes the §4.9 aggregate matrix complete.
- **Unreleased-pin advisory:** per §4.4, advisory by default, blocking under
  `--strict`.

### 4.8 Surface-by-surface

| Surface                           | Behaviour                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| `check`                           | Bigger resolution set; new L212 drift case; T014; collision + unreleased diagnostics       |
| `show` / `context` / `dependents` | Work on upstream entries; `context` walks into the upstream chain; origin badge shown      |
| `report` (coverage/matrix)        | Upstream entries appear with origin; dependencies count toward coverage, references don't  |
| LSP completion                    | Upstream IDs offered with `— from product@v2.1.0` badge (existing `origin` plumbing)       |
| LSP hover / highlights            | Work; definition → no-op                                                                   |
| MCP                               | `entry_show`/`entry_list`/`entry_context` see them via compile cache; no new resource kind |
| `lint` / `fmt` / `score`          | Untouched — project-scoped                                                                 |
| `[[edge]]` ledger                 | Unchanged — project-side edges to upstream ULIDs already fit the row shape                 |

### 4.9 The program root project — the overall picture

A root (program/product) repository provides the aggregate view. It is a usage
pattern, not a mechanism — it falls out of §4.1–4.8:

- The root declares **every member repo** in its `dependencies:`. It may author
  few or no entries of its own (typically program-level STK, or nothing).
- All repos' entries hydrate into the root's one flat graph, and cross-component
  edges resolve there (§4.7), so **program-wide `report` (coverage, traceability
  matrix), `dependents`, and `context` work at the root** — both ends of every
  cross-repo edge are present.
- The root's committed `markspec.lock` **is the program baseline record**: which
  version of each repo constitutes the program, diffable and auditable per PR.
- The root's `check --strict` is the **program release gate**: every repo
  tag-baselined (§4.4 guarantee 1) and every cross-repo reference resolving
  within those baselines (guarantee 2).
- The root's `markspec compile --output api/` publishes the **program-wide
  manifest + index** — the "overall picture" artifact. Entries carry their
  origin badges, so the published aggregate shows which repo authored what. This
  is exactly the input the #591 traceability website renders.
- Recommendation: the root should use the same profile chain as its member repos
  (or a program profile extending them) so shared corpora and type vocabularies
  are present when aggregating.
- **Membership is curated config, not discovery.** How the root knows the other
  repos: its `dependencies:` list _is_ the program membership list —
  `project.yaml` declares which repos are in the program (intent),
  `markspec.lock` records which exact version of each (resolved baseline).
  Onboarding a component is two reviewed PRs: the component adds its own
  dependencies; the root adds one `dependencies:` entry + re-locks. No
  auto-discovery (org scanning, naming conventions, self-registration) — program
  composition is a configuration item, and an implicit, network-derived
  membership list would defeat the baseline record. The detector for an
  unplugged repo is the root's coverage report: requirements meant to be
  satisfied by a missing component surface as coverage gaps.

### 4.10 Schema SSOT and tool-config migration

`project.yaml` validates against the org contract (`driftsys/schemas`
`project/v1.json`) — closed schema, `name` + `version` required. Consequences
inside markspec:

| Local artifact                      | Disposition                                                                                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schemas/project/v1.json`           | **Retired.** Org schema is SSOT; markspec's loader validates the org shape.                                                                                                            |
| `exclude:` (project.yaml)           | **Migrates to `.markspec.yaml`** — tool config, disallowed by the closed org schema.                                                                                                   |
| `caption-conventions:`              | **Migrates to `.markspec.yaml`** — same reason.                                                                                                                                        |
| `labels:` as vocabulary             | **Retired from project.yaml.** Org semantics: labels are tags _on_ the project; the vocabulary is governed by the process/profile. markspec's vocabulary constraint lives in profiles. |
| `version:` optional + git-describe  | **Becomes required** per org schema (the release-bump flow already writes it).                                                                                                         |
| `schemas/markspec/v1.json`          | Kept local (markspec tool binding); grows the migrated tool-config keys.                                                                                                               |
| `schemas/profile/`, `schemas/lock/` | Kept local; org `markspec/lock` overlap flagged for reconciliation (§9).                                                                                                               |

## 5. Non-features (explicit)

1. **Peer-to-peer reverse visibility** — a member repo cannot know its
   downstreams under one-directional pinning; the supported way to see the
   overall picture (including cross-repo `dependents`) is the root project
   pattern (§4.9). Rendering that aggregate as a website/dashboard stays #591
   territory.
2. **Transitive federation** — direct dependencies/references only; refs from
   upstream entries are validation-exempt so this never false-errors. The
   program graph is the composition of each repo's committed lockfile.
3. **Live/TTL fetching** — rejected (determinism); issue #22 to be rewritten.
4. **Namespace-qualified refs** — rejected; revisit only if flat+error hurts in
   practice.
5. **Vendoring snapshots into the repo** — cache stays gitignored (lockfile spec
   §6 deferral stands).
6. **Entry-level release status** (draft entries inside a baseline) — profile
   territory, deferred.
7. **Cross-repo rename-heal / edge-ledger changes** — v1 records edges from the
   project side only.
8. **`kind` discriminator on projectRef** — deferred; acquisition is implied by
   the field (D2). Returns as a non-breaking org-schema addition if a
   closed-source dependency with a published API gets real.
9. **Shared remote snapshot cache** — deferred (§4.3); ADR-020 trajectory.
10. **Publish-target configuration in `project.yaml`** — where a project
    publishes its own `/api/` is CI/build config, never manifest data.

## 6. Slices

| # | Slice                         | Contents                                                                                                                                                                                                                                            | Depends on |
| - | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1 | Origin + hydration core       | `EntryOrigin` union, `formatEntryOrigin`, `deserializeCompileResult` + skew guard, `loadUpstreamCorpus`                                                                                                                                             | —          |
| 2 | Org manifest adoption + lock  | Org-schema `project.yaml` loader (`dependencies`/`references`, projectRef), tool-config migration to `.markspec.yaml`, reference fetcher (`https`/`file`), cache write, lockfile rows, restore/update flows, L212 case, retire local project schema | 1          |
| 3 | Git dependency fetcher        | `ls-remote` intent resolution + semver tag sort, forge tarball / shallow-filter clone, sha-keyed cache, in-process compile, resolution-kind recording                                                                                               | 2          |
| 4 | Graph integration + validator | Three feed sites, flat resolution, MSL-T014, generalized R014, coverage semantics (deps vs refs), unreleased advisory + `--strict`                                                                                                                  | 1, 2       |
| 5 | LSP + MCP surfaces            | Completion badges, hover, definition no-op, read-only decorations                                                                                                                                                                                   | 4          |
| 6 | Docs + spec                   | Guide recipes (multi-repo + root project + CI cache), language.md §3.2 + T014, compile-output spec §5 as-built, rewrite issue #22, ADR at gardening                                                                                                 | 4          |

External prerequisite for slice 2: the org-schemas PR (§9, Change B) — the
version-intent contract should land in `driftsys/schemas` before markspec
implements it.

## 7. Testing

- **Unit:** hydration round-trip (`deserialize(serialize(x))` ≍ `x` modulo
  origin); collision-pass tables; semver tag sort; schema-skew rejection;
  org-manifest loader (valid/invalid projectRef shapes).
- **E2E (blackbox):** two temp projects — compile A to `/api/`, point B's
  `references:` at it via `file://`; and a local bare-repo fixture with tags as
  a `dependencies:` entry (no network). Assert through the CLI only: `lock`
  pins, `check` resolves a cross-project `Satisfies:`, broken ID → T014,
  colliding ID → R014, deleted cache → drift gate, branch-resolved pin →
  advisory and `--strict` failure, auto mode picks the newest tag.
- **E2E root pattern:** three temp projects — root depends on A and B, where A
  also depends on B (diamond). Assert: no duplicate/collision diagnostics
  (authoritative-source rule), A→B edge present in the root's matrix report,
  `dependents` at root crosses the repo boundary, coverage report flags a
  product requirement no component satisfies, and the root's published `/api/`
  counts equal A-authored + B-authored + root-authored entries.
- **Snapshots:** diagnostic wording for T014, collision, drift, and the
  unreleased advisory.

## 8. Alternatives considered

- **Keep `parents:` / rename to `upstreams:`** — both rejected. "Parent" is
  semantically inverted at the root project (children listed as parents) and
  already means three other things in MarkSpec (profile extends, type hierarchy,
  book directive). `upstreams:` would collide with the org contract's `upstream`
  field (fork lineage). The org contract's `dependencies`/`references` split is
  adopted instead — it also encodes the coverage distinction the flat list left
  implicit.
- **`kind: git|registry` discriminator on projectRef** — dropped: acquisition is
  implied by the field (dependencies = repos, references = published sites).
  Explicit-but-redundant today; recoverable as a non-breaking addition when a
  real case appears.
- **Markdown interchange (reuse `loadDeliveredCorpus` literally)** — rejected:
  consumer would need the upstream's profile chain for type classification
  (silent misclassification under profile drift), and references/standards have
  no `.md` sources, forcing a JSON path anyway.
- **Thin existence-only index (`displayId, ulid, title, type`)** — rejected at
  the depth fork in favour of full graph citizens; the compiled output already
  exists, so the thinner format saves little.
- **Live fetch + TTL cache (issue #22's original model)** — rejected: check
  output would depend on network state, violating the deterministic-output rule
  and making CI flaky.
- **Namespace-qualified refs (`product/STK_0001`)** — rejected: new token
  grammar in every trace surface (parser, LSP, rename, skills) for a collision
  problem that prefix discipline + a hard diagnostic handles.
- **Git submodules / subtrees as the root manifest** — rejected: they vendor
  full sources where compiled snapshots are needed, force the root to
  re-implement per-member compilation with worse ergonomics, cannot express
  registries or version intent, and add clone/CI tax. `markspec.lock` already
  provides exact pins plus the intent layer, restore flow, and diffable baseline
  record.
- **Per-file forge-API reads instead of tarball** — rejected: the file set isn't
  known without discovery; many round-trips lose to one tarball.
- **Explicit-only version intent (no auto mode)** — rejected: "prefer baseline,
  fall back to unreleased" is the correct default posture and removes a decision
  from every declaration site.
- **Hub mode (member repos resolve siblings via the root's aggregate)** —
  deferred (2026-07-04, "aggregate for sure, not sure hub's worth it"). Members
  would declare one dependency — the root — and opt into its re-exports, giving
  one-pin program coherence and O(N) config at the cost of members never moving
  ahead of the root's last publish. Not worth the coupling until the O(N²)
  `dependencies:` maintenance actually hurts; v1 keeps per-repo direct
  dependencies + the aggregation-only root (§4.9). The authoritative-source rule
  (§4.5) is the hook a future hub opt-in would relax.

## 9. Cross-repo follow-ups and reconciliations

1. **`driftsys/schemas` PR (Change B):** document the `projectRef.version`
   intent contract (exact tag = frozen; branch = track head; absent = auto) in
   `project/README.md` + schema description/examples, and sharpen the per-field
   guidance (dependencies → repository URLs, references → published-site URLs).
   Non-breaking; prerequisite for slice 2.
2. **`process:` vs `.markspec.yaml` profiles:** the org contract's `process`
   field maps onto MarkSpec profiles. Reconciling activation (`.markspec.yaml`
   `profiles:` list vs `process:` projectRefs) is a separate design effort — out
   of scope here; file an issue.
3. **Lock-schema overlap:** the org repo's `markspec/lock/v1.json` ("frozen
   sidecar `.markspec.lock`") vs ADR-022's `markspec.lock` — reconcile naming
   and shape before slice 2 extends lockfile rows.
4. **Site-API schema alignment:** the org repo's 12 `markspec/*` schemas (entry,
   index, traceability-graph, coverage, …) should be checked against the
   compile-output artifacts our interchange relies on — plan-time review in
   slice 2/6.
5. **Guide drift:** `docs/guide/cli.md` claims `project.yaml` has no JSON schema
   while `schemas/project/v1.json` exists (same family as #709); slice 6
   rewrites the config reference against the org SSOT anyway.

## 10. Open questions (plan-time, not blocking)

- Exact lockfile TOML row naming (`[[upstream.dependency]]` /
  `[[upstream.reference]]` vs extending `[[upstream.registry]]`) and its
  parser/serializer round-trip details.
- Diagnostic code assignment beyond T014 (collision reuses the R014 shape;
  whether the unreleased advisory gets an L-family or new code) — align with the
  ADR-012 phased catalogue at plan time.
- Whether the published manifest gains an optional `project.version` field so
  reference lockfile rows can record `refhub@1.4.0` (needs a compile-output spec
  touch, and intersects follow-up §9 #4).
- Forge tarball support matrix (GitHub/GitLab/self-hosted; auth via ambient
  `gh`/`glab` credentials vs git credential helper) — slice 3 detail.
