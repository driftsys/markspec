# ADR-029: Profile-Delivered Documents

## Status

Accepted (2026-07-02).

## Context

Until now, a profile package (ADR-008) shipped vocabulary only: entry types,
attributes, traceability rules, display-ID patterns. It could not ship content —
no way for a compliance profile to include a standard's objectives as
satisfiable entries, for a platform team to publish a reference architecture
that downstream projects `Allocated-to:`/`Realizes:` against, or for an org to
distribute a requirement baseline reused across products. Every consuming
project had to re-author (or copy-paste, with drift) any shared requirement or
reference material.

The three use cases above are the same mechanism at different altitudes: a
profile directory can hold files a consuming project reads or traces against,
sourced from the same package that already supplies the profile's vocabulary.
Value appears once at least two projects consume the same profile, or one
project traces against a real external standard — this design is deliberately
cut to the load-bearing spine (§"Non-features") and defers polish until a real
corpus exists.

Two prior mechanisms were considered and rejected — see "Alternatives
considered" below — before settling on first-class profile-delivered documents.

## Decision

### D1 — `delivers:` manifest section, additive merge across the chain

A profile manifest gains a `profile.delivers:` list:

```yaml
profile:
  delivers:
    - path: reference/platform-architecture.md
      corpus: true # entries join the consumer's graph
      description: Shared platform components and interfaces
    - path: reference/integration-guide.md
      # corpus defaults to false → documentation-only
```

Rules, enforced by the manifest parser
(`core/profile/manifest.ts::parseDeliversSection`):

- `path` is required, relative to the profile directory (next to its
  `markspec.yaml`). Absolute paths (POSIX or drive-letter) and any `..` segment
  are a load-time error, `PROFILE-DELIVERS-003`.
- `corpus` is optional, boolean, defaults to `false`. `corpus: true` on a
  non-`.md` path is a load-time error, `PROFILE-DELIVERS-004` — only Markdown is
  corpus-eligible.
- `description` is optional free text.
- Any other key, a non-list `delivers:`, a non-mapping item, or a duplicate
  `path` within one manifest is `PROFILE-LOAD-003` (the generic manifest-shape
  code — these are authoring mistakes in the section's own grammar, not the
  path/corpus semantic checks above).

**Merge across the `extends:` chain** (`core/profile/merge.ts`): additive union
keyed by `(profileId, path)`, parent-tier-first. Two tiers delivering the same
relative path never collide (they're namespaced by `profileId`); a child cannot
remove or override a parent's delivered file, matching ADR-008 §5's
non-relaxation rule for every other manifest section.

Naming: `delivers:`; the term of art is **delivered documents**. Rejected
alternatives: `provides:` (already a trace relation, ADR-024), `bundles:`
(upskill terminology), `references:` (already an entry shape and a relation),
`exports:` (collides with the `markspec export` command), `documents:` (an
existing manifest section with different meaning — doc-type/front-matter
declarations).

### D2 — `DeliveredDocument` + `Entry.origin`, no `CORE_SCHEMA_VERSION` bump

Each resolved profile tier already records its on-disk directory
(`LoadedProfile.baseDir`). The chain merge resolves each tier's `delivers:`
declarations against that `baseDir` into the effective profile's
`delivers: readonly DeliveredDocument[]`:

```ts
interface DeliveredDocument {
  profileId: string; // which tier delivered it
  profileVersion: string;
  path: string; // as declared, relative to the profile dir
  absPath: string; // resolved against that tier's baseDir
  corpus: boolean;
  description?: string;
}
```

`Entry` gains one optional field, stamped only by the corpus loader (§D3), never
by the parser:

```ts
interface EntryOrigin {
  readonly kind: "profile"; // discriminant — future origins reuse the slot
  readonly profileId: string;
  readonly profileVersion: string;
}
// on Entry:
readonly origin?: EntryOrigin;
```

Absent `origin` means project-authored — every pre-existing entry, test, and
serialization is untouched.

**Correction made during implementation:** the design's first draft assumed
adding `Entry.origin` would need a `CORE_SCHEMA_VERSION` bump. It does not.
`CORE_SCHEMA_VERSION` (`core/mod.ts`) is the **profile-schema compatibility
pin** — `parseManifest` raises `PROFILE-SCHEMA-001` on any `markspec-schema:`
value other than the one it targets. Bumping it would break every
already-published profile declaring `markspec-schema: "1"` for a change that is
purely additive and optional on the `Entry` model. There is no profile-schema
change here (the _profile manifest_ schema for `delivers:` changed — schema
`v1.json`, not `CORE_SCHEMA_VERSION`). `Entry.origin` ships without a version
bump.

### D3 — One core loader, three callers

`markspec compile` only runs when invoked; the LSP builds its own in-memory
`WorkspaceIndex`; the MCP server builds its own compiled view independently.
Injection therefore lives in **core**, not in the compiler command:

```ts
loadDeliveredCorpus(delivers, readFile): Promise<{ entries, diagnostics }>
```

(`core/profile/delivered.ts`) iterates `delivers` in parent-first,
manifest-declaration order (deterministic), and per document:

- missing file, `corpus: true` → `PROFILE-DELIVERS-001`, error.
- missing file, `corpus: false` → `PROFILE-DELIVERS-002`, warning (nothing
  downstream depends on a docs-only file).
- present, `corpus: false` → existence check only, never parsed.
- present, `corpus: true` → parsed, every resulting entry stamped with `origin`;
  the file's own parse diagnostics are prefixed
  `delivered by <profileId>@<profileVersion>: …` and carried through.

Three callers wire this into their own graph:

- **CLI** (`cli/helpers.ts::compileProject`) — every graph-consuming command
  (`check`, `compile`, `show`, `context`, `dependents`, `report`, `export`) gets
  corpus entries with zero per-command work. A corpus-load **error** is fatal
  before compilation proceeds — silently compiling with a partial corpus would
  hide a broken profile package. File-local `check <file>` without a project
  root is unchanged (no profile, no corpus).
- **LSP server** (`lsp/server.ts::seedDeliveredCorpus`) — corpus entries are
  seeded into the `WorkspaceIndex` in `onInitialized`, **before** the concurrent
  project-file walk starts, and re-seeded on every profile reload (the existing
  `.markspec.yaml`/`project.yaml` watcher). Corpus-first seeding makes
  duplicate-ID ownership deterministic: a project entry reusing a corpus ID
  always loses first-entry-wins and is always flagged, on every startup,
  regardless of project-file parse order. The first `validateAll()` already sees
  corpus IDs, so there is no transient false "unresolved reference" warning
  window on startup, and the first completion request after startup includes
  corpus IDs.
- **MCP server** (`mcp/project.ts::runCompile`) — loads the corpus on every
  compile (including `markspec_refresh`) and passes it to `compile()` as
  `corpusEntries`.

### D4 — Collision is a distinct error code (`MSL-R014`), not the generic duplicate code

A project entry reusing a corpus display ID or `Id:` fails `check` with
**`MSL-R014`**, not the pre-existing duplicate-ID codes (`MSL-R005`, `MSL-R006`,
`MSL-I007`, `MSL-I008`). The fix is different in kind: those codes mean "you
declared the same ID twice, pick one"; `MSL-R014` means "rename _your_ entry —
the other one isn't yours to change; it belongs to
`<profileId>@<profileVersion>`."
`core/validator/corpus.ts::detectCorpusCollisions` detects the collision and
`attributeCorpusDiagnostics` suppresses the generic duplicate codes for the same
collided token so a single collision does not double-report under two codes.
Corpus↔corpus collisions between tiers are detected the same way
(first-tier-wins on the corpus side is never silently swallowed — the second
tier's entry still collides).

**Diagnostic attribution and downgrade policy** — a consumer build must not go
red from an upstream bug it cannot fix:

- A corpus file that fails to **parse** is a load-time error (the graph is
  incomplete without it — this is the one case where an upstream defect does
  block the consumer, because there is no meaningful partial result).
- A corpus entry's own validation findings (its internal unresolved
  `Satisfies:`, its own prose-lint hits, etc.) are **downgraded to a warning**
  and re-attributed with a `delivered by <profileId>@<version>:` message prefix
  — visible, never fatal, never the consumer's fault.
- Project-side diagnostics keep full severity, including "a project entry points
  at a nonexistent corpus ID" — that _is_ the consumer's problem.

**Non-feature:** delivered corpus files must ship already formatted and valid —
`Id:` ULIDs stamped by the profile author. The consumer toolchain never formats
or heals them, and `markspec lint` / MSL-Q prose analysis does not run on them
at all. A malformed corpus file is a profile-authoring bug, surfaced as the
load-time error above, naming the profile.

### D5 — Read-only is structural, not a runtime check

`fmt` and the ADR-026 rename-heal machinery operate on the discovered project
file set only; delivered files are never in that set, so there is no code path
that can write into a profile's cache or local directory. This extends into the
LSP: document-sync events (`onDidOpen` / `onDidChangeContent` / `onDidClose`)
for a path the server has seeded as corpus are ignored outright — the buffer is
never reparsed from an edit, because the index slot for that path is owned by
`seedDeliveredCorpus`, not by the ordinary per-file debounced-parse path.
`onPrepareRename` and `onRenameRequest` both check `entry.origin` and refuse
(return `null`) when the target is corpus-origin. There is deliberately no
separate "read-only" flag or permission check to maintain — the file simply
never enters a writable code path.

Corpus **seed failures soft-fail** rather than blocking the editor: if
`loadDeliveredCorpus` throws (e.g. a git/npm profile cache that hasn't been
fetched yet, offline), the LSP logs a warning and continues indexing the project
without the corpus. `MSL-L006` "unresolved target" warnings in that state are
accurate, not false positives — the corpus really isn't loaded. The next profile
reload (cache watcher, or the file materializing) re-seeds without requiring an
editor restart. The editor must never block on a network fetch.

### D6 — The `MSL-L212` lockfile gate stays corpus-blind

`markspec lock` computes its canonical edge hash by walking only the project's
discovered files — the corpus is outside discovery scope by construction (§D7)
and `markspec lock` has no corpus-awareness added in this design. Consequently
`check`'s `MSL-L212` drift gate (`cli/commands/check.ts`) filters `allEntries`
to `!e.origin` **before** calling `extractEdgeQuads`, so corpus-internal trace
edges are never counted against the lockfile:

```ts
// Corpus-blind by design: the lockfile is not corpus-aware yet (ADR-029
// defers lockfile integration), so `markspec lock` never counts corpus
// edges. Counting them here would raise an MSL-L212 drift error that
// `markspec lock` can never fix.
const projectEntries = allEntries.filter((e) => !e.origin);
const quads = extractEdgeQuads(projectEntries);
```

If this filter were absent, a corpus file containing its own internal trace
edges (e.g. `PLT_0002 satisfies PLT_0001`, both corpus-origin) would inflate the
edge count `check` computes on every run relative to what `markspec
lock`
persisted, producing a permanent, unfixable `MSL-L212` failure — `lock` never
sees those edges to pin them in the first place. **Consequence recorded as a
known v1 limitation:** corpus-internal trace edges are not lock-pinned; identity
tracking for them waits on the lockfile-integration non-feature
(§"Non-features").

### D7 — Local-path profiles must be excluded from project discovery

A profile referenced with a `local` specifier (`./profile` in `.markspec.yaml`)
lives inside the consumer's own repository tree. Nothing about `delivers:` moves
it outside that tree. If the consumer's `project.yaml` does not `exclude:` the
profile directory, the ordinary gitignore-aware project walk (`core/discovery/`)
finds the same corpus `.md` file the corpus loader also parses — the file's
entries get indexed twice, under two different `origin` states (once with
`origin` unset via ordinary discovery, once with `origin` set via the corpus
loader), which self-collides as `MSL-R014` against itself.

This is **not** a code defect to fix: git and npm profile specifiers already
resolve into `.markspec/cache/<sha>/…`, which project discovery already skips by
convention (it's outside the repository proper). Only the `local` specifier
shares a filesystem root with the consuming project, so only it needs an
explicit `exclude:`:

```yaml
# project.yaml
exclude:
  - profile/
```

This is documented as an operational requirement for `local`-specifier profiles
(guide + recipe, §"Consequences") rather than solved in code — enforcing it
automatically would require `check`/`fmt`/discovery to know about profile
directories before the profile itself has loaded, inverting the load order for
no benefit over one `exclude:` line.

### D8 — MCP/CLI diagnostic parity

`markspec check` (CLI) and the MCP `validate` tool must agree on whether a
project is clean. Before this design, the MCP server's compiled context
(`mcp/project.ts::runCompile`) built its `CompileResult` and returned its
`diagnostics` as-is; corpus-load diagnostics (e.g. `PROFILE-DELIVERS-001` for a
missing delivered file, which is fatal for the CLI in `compileProject`) had no
path into that result, so the MCP server could report a project clean while
`markspec check` was failing on the same project. `runCompile` now merges
corpus-loader diagnostics ahead of the compiler's own diagnostics (corpus-first,
deterministic ordering) into the cached `CompileResult`, so `validate` and
`check` see the same failures.

## Non-features (out of scope for v1, deliberately)

1. **Vendoring** — a command copying delivered files into the consumer
   repository. Provenance would become a convention instead of a model fact, and
   every profile upgrade would need a re-copy step; may return later as an
   offline convenience layered on the same `delivers:` field.
2. **Coverage policy for unrealized corpus entries** — reports show origin
   (`project` vs `<profileId>@<version>`); whether an unsatisfied corpus entry
   counts as a coverage gap is a policy decision that waits for a real corpus to
   make a judgment call against.
3. **Profile-authoring-side validation** — `markspec profile publish` refusing
   to ship a broken corpus is authoring tooling, a separate track from the
   consumer-side loader this design specifies.
4. **Lockfile integration** — pinning profile/corpus content hashes in
   `markspec.lock` composes later with the ADR-020/ADR-022 machinery; v1 ships
   the corpus-blind gate (§D6) instead.
5. **LSP polish beyond the three items shipped** — corpus seeding, rename
   refusal, and a completion-detail origin badge
   (`— from
   <profileId>@<version>`). No gutter decorations, no corpus-aware
   code actions.

## Consequences

- Profiles are no longer vocabulary-only packages — a `delivers:` section turns
  a profile into a content package, reusable across every project that consumes
  it.
- `check`, `compile`, `show`, `context`, `dependents`, `report`, `export`, the
  LSP, and the MCP server all resolve trace targets that live in a
  profile-delivered corpus, with zero per-caller wiring beyond
  `loadDeliveredCorpus`.
- `markspec show <id>` prints `Origin: <profileId>@<version>` for corpus
  entries; `markspec profile show` gains a _Delivered documents_ block (path,
  role, entry count or docs-only description, missing-file issues);
  `markspec doctor` reports delivered-document health. Human-facing diagnostics
  and the `show` command never print a raw `.markspec/cache/<sha>/…` path —
  corpus locations render as `<profileId>@<version>:<relative-path>:<line>`
  (`cli/helpers.ts::renderDiagnosticLocation`); machine formats
  (`--format
  json`) still carry the real absolute path.
- The traceability matrix and `export json|yaml|csv` gain an origin column/field
  (`"project"` or `<profileId>@<version>`); the deterministic-output rule holds
  — origin is a stable function of the entry's source, not a timestamp. The
  coverage report is untouched: it has no per-entry surface (aggregate stats and
  gap ID lists only), so there is no origin cell to add — per-origin coverage
  policy is the deferred non-feature above.
- MCP: every delivered file — corpus and docs-only alike — becomes a resource at
  `markspec://delivered/{profileId}/{path}`, listed with the manifest
  `description` (or a role-derived fallback); corpus entries additionally
  surface through every existing entry surface (`entry_search`, `entry_list`,
  `markspec://entry/{id}`, `entry_context`) with origin visible in the rendered
  entry.
- A `local`-specifier profile directory must be `exclude:`d in the consumer's
  `project.yaml` (§D7) — undocumented, this produces a confusing self-collision
  (`MSL-R014` naming the same file on both sides).
- Corpus-internal trace edges are invisible to `markspec lock` / `MSL-L212`
  (§D6) until the deferred lockfile-integration work lands.
- No `CORE_SCHEMA_VERSION` bump; no migration required for existing profiles or
  projects. `delivers:` absent is the previous behavior exactly.

## Alternatives considered

- **B — Vendoring as the mechanism.** Copy delivered files into
  `docs/references/<profileId>/` with do-not-edit headers; ordinary project
  discovery picks them up with no new loader. Rejected for v1: provenance
  becomes a convention (a comment header) instead of a model fact
  (`Entry.origin`); every profile upgrade creates a permanent drift/sync problem
  between the vendored copy and the source; repo pollution scales with every
  profile a project consumes. Recorded as a possible offline convenience layered
  on the same `delivers:` field later (§"Non-features" item 1), not a
  replacement for it.
- **C — Reuse ADR-022 upstream / Reference-URI machinery.** ADR-022's upstream
  model represents _citations of external documents_ (locators, fetch metadata,
  sync state) — a fundamentally different relationship from a corpus entry,
  which is an ordinary ULID-identified `Entry` that happens to live in a profile
  package and joins the same traceability graph as everything else. Forcing
  corpus entries through the upstream/citation model would mean every corpus
  entry needs a synthetic citation wrapper for no representational benefit, and
  would block the "full graph citizenship" requirement below.
- **Shallow cut — resolution targets only.** Corpus entries would resolve
  `Satisfies:`/`MSL-L006` targets but never appear in `compile` output, reports,
  or coverage. Rejected by product call: full graph citizenship was chosen
  instead — corpus entries appear everywhere a project entry does, distinguished
  only by `origin`, because a reference architecture or compliance corpus that a
  project traces against needs to be inspectable, reportable, and MCP-readable
  exactly like project content, not a second-class shadow graph.

## References

- Design doc: `docs/wip/2026-07-02-profile-delivered-documents-design.md`
  (superseded by this ADR; garden to `docs/archive/` per the working-memory
  lifecycle rule).
- [ADR-008](./adr-008-profile-system.md) — profile manifest, distribution,
  `extends:` chain; §5 non-relaxation rule that `delivers:` merge follows.
- [ADR-009](./adr-009-core-profile-boundary.md) /
  [ADR-010](./adr-010-default-profile.md) — core/profile boundary that
  `delivers:` extends into content, not just vocabulary.
- [ADR-020](./adr-020-sqlite-indexing-eval.md) /
  [ADR-022](./adr-022-lockfile-and-external-sync.md) — lockfile and
  federated-cache machinery the deferred lockfile-integration non-feature will
  compose with.
- [ADR-026](./adr-026-display-id-trace-resolution.md) — display-ID resolution
  and the `fmt`/rename write-back paths that delivered corpus files are
  structurally excluded from (§D5).
- As-built: `core/profile/manifest.ts` (`parseDeliversSection`,
  `ALLOWED_DELIVERS_KEYS`), `core/profile/merge.ts` (`deliveredFromTier`,
  additive `delivers` union), `core/profile/delivered.ts`
  (`loadDeliveredCorpus`, `corpusOriginLabel`, `buildCorpusIndex`),
  `core/validator/corpus.ts` (`detectCorpusCollisions`,
  `attributeCorpusDiagnostics`), `core/model/mod.ts` (`EntryOrigin`,
  `DeliveredDocument`), `core/reporter/mod.ts` (`originCell`), `cli/helpers.ts`
  (`compileProject`, `renderDiagnosticLocation`),
  `cli/commands/{show,profile,doctor,check}.ts`, `lsp/server.ts`
  (`seedDeliveredCorpus`, corpus-aware document-sync guards), `mcp/project.ts`
  (`runCompile` diagnostic merge), `mcp/uri.ts` (`DELIVERED_URI_PREFIX`,
  `deliveredUri`), `schemas/profile/v1.json` (`$defs.deliversItem`).
