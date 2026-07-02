# Profile-delivered documents — design

**Date:** 2026-07-02\
**Status:** approved design, awaiting implementation plan\
**Destined for:** new ADR (next free number at merge time) + `language.md` §8
codes + guide updates

## Summary

A profile package (ADR-008) can deliver document files to consuming projects.
Each delivered file is flagged per file as either a **traceable corpus** — its
MarkSpec entries become full citizens of the consumer's traceability graph,
marked with provenance — or **documentation-only** — surfaced for humans and
agents to read, never parsed into the graph.

This turns profiles from vocabulary packages into content packages: a compliance
profile ships a standard's objectives as satisfiable entries; a platform team
ships a reference architecture that downstream projects
`Allocated-to:`/`Realizes:` against; an org ships requirement baselines reused
across products. The mechanism is generic across all three.

Value appears at N≥2 consuming projects (or one project tracing a real standard
corpus). v1 is deliberately cut to the load-bearing spine; polish follows once a
real corpus exists.

## 1. Manifest shape

New `profile.delivers:` section in `markspec.yaml`:

```yaml
profile:
  delivers:
    - path: reference/platform-architecture.md
      corpus: true                    # entries join the consumer's graph
      description: Shared platform components and interfaces
    - path: reference/integration-guide.md
      # corpus defaults to false → documentation-only
```

Rules:

- `path` is relative to the profile directory (next to `markspec.yaml`) and must
  stay inside it — no `..` segments, no absolute paths. Violations are load-time
  errors.
- Only `.md` files are corpus-eligible; `corpus: true` on any other extension is
  a load-time error. Docs-only files may be any readable file.
- Duplicate `path` within one manifest is a load error.
- **Merge across the extends chain:** additive union keyed by
  `(profile-id, path)`, so two tiers delivering the same relative path never
  collide. A child cannot remove or override a parent's delivered file (ADR-008
  §5 non-relaxation).
- Naming: the section is `delivers:`; the term of art is **delivered
  documents**. Deliberately _not_ "reference documents" — "Reference" already
  names the URI-identified entry shape (ADR-002). Rejected key names:
  `provides:` (trace relation, ADR-024), `bundles:` (upskill terminology),
  `references:` (entry shape + relation), `exports:` (collides with the
  `markspec export` command), `documents:` (existing manifest section with a
  different meaning).

## 2. Loader exposure

Each resolved profile already records its on-disk directory
(`LoadedProfile.baseDir` — local path, git cache under `.markspec/cache/<sha>/`,
or npm cache). The chain loader exposes a merged, parent-first list on the
effective profile:

```ts
interface DeliveredDocument {
  profileId: string;        // which tier delivered it
  profileVersion: string;
  path: string;             // as declared, relative to the profile dir
  absPath: string;          // resolved against that tier's baseDir
  corpus: boolean;
  description?: string;
}
```

Missing-file policy at load time:

- Corpus file declared but absent from the package → **error** (silently losing
  trace targets is worse than failing loudly).
- Docs-only file absent → **warning** (nothing downstream depends on it).

## 3. Entry provenance

`Entry` gains one optional field:

```ts
origin?: { kind: "profile"; profileId: string; profileVersion: string }
```

- Absent = project-authored. Every existing entry, test, and serialization is
  untouched.
- `kind` is a discriminant so future origins (e.g. ADR-011 SBOM-generated
  entries) reuse the slot.
- The parser stays pure (file → entries); the origin stamp is applied by the
  corpus loader (§4), not the parser.
- Model addition is **additive and optional — no `CORE_SCHEMA_VERSION` bump**.
  (Plan-time correction: that constant is the profile-schema compatibility pin;
  `parseManifest` errors with PROFILE-SCHEMA-001 on any other pinned value, so
  bumping it would break every profile declaring `markspec-schema: "1"`. An
  optional `Entry` field does not alter that contract.)

**Non-feature:** delivered corpus files must ship already formatted and valid —
`Id:` ULIDs stamped by the profile author. The consumer toolchain never formats
or heals them, and prose lint (`markspec lint` / MSL-Q) does not run on them at
all; a malformed corpus file is a profile-authoring bug surfaced as a load-time
error naming the profile. (Cross-file _validation_ findings that involve corpus
entries are handled separately — see §5 diagnostic attribution.)

## 4. Injection: one core loader, three callers

`markspec compile` only runs when invoked; the LSP builds its own in-memory
`WorkspaceIndex`; the MCP server builds its own compiled view. Injection
therefore lives in **core**, not in the compiler:

```ts
loadDeliveredCorpus(chain, readFile): Promise<{ entries, diagnostics }>
```

resolves the `corpus: true` delivered files from the chain (parent-first tier
order, then manifest order — deterministic), parses them, stamps `origin`, and
returns the entries. Callers:

- **Compiler** — when building a graph. All CLI graph consumers (`check`,
  `compile`, `show`, `context`, `dependents`, `report`, `export`) get corpus
  entries with zero per-command work. File-local `check <file>` without a
  project is unchanged.
- **LSP server** — in `onInitialized`, immediately after the profile chain loads
  and **before** the concurrent project-file walk: corpus entries are seeded
  into the `WorkspaceIndex` first. Re-seeded on profile reload (the existing
  `.markspec.yaml`/`project.yaml` watcher). Corpus files are not watched or
  editable — parsed once per (re)load, never per keystroke.
- **MCP server** — when building its project context (and on
  `markspec_refresh`).

### First-index guarantees (LSP)

- One database: corpus entries live in the same index and `byDisplayId` lookup
  as project entries; only `origin` distinguishes them.
- The first `validateAll()` already sees corpus IDs — no transient false
  "unresolved reference" warnings on startup.
- Corpus-first seeding makes duplicate-ID ownership deterministic: a project
  entry reusing a corpus ID always loses first-entry-wins and is always flagged,
  on every startup.
- First completion request after startup includes corpus IDs.

### Cold-cache degradation

For git/npm profiles with an unfetched cache and a failing fetch (offline, no
credentials): the LSP/MCP index **without** corpus, log a warning, and the
resulting MSL-L006 "unresolved target" warnings are accurate. Profile reload
re-seeds as soon as the cache materializes. The editor never blocks on a fetch.

## 5. Validator semantics

- **Resolution:** corpus display IDs and ULIDs join the known-target set;
  MSL-L006 stops firing for them. Trace-rule target filtering
  (`targetsForRelation`) works unchanged — corpus entries carry profile-declared
  types.
- **Collisions are hard errors:** a project entry reusing a corpus display ID
  (or ULID) fails `check` with a **new MSL code** (not the existing duplicate-ID
  code — the fix is different: "rename _your_ entry; the other one isn't
  yours"), message naming the profile
  (`already delivered by platform-arch@1.2.0`). Corpus↔corpus collisions between
  tiers likewise.
- **Diagnostic attribution** — consumer builds must not go red from upstream
  bugs they cannot fix:
  - Corpus file fails to parse → load-time error (incomplete graph).
  - Corpus entries' own validation findings (internal unresolved refs, lint) →
    downgraded to warnings, attributed to the profile, never affecting the
    consumer's exit code.
  - Project-side diagnostics keep full severity, including "project entry points
    at a nonexistent corpus ID".
- **Read-only is structural, not a check:** `fmt` and ADR-026 rename-heal
  operate on the project file set only; delivered files never enter their scope.
  No code path writes into the profile cache.

## 6. CLI surfaces

- `markspec profile show` — new _Delivered documents_ block per tier: path, role
  (corpus/doc), entry count for corpus files, description.
- `markspec show <id>` — prints `Origin: <profile-id>@<version>` for corpus
  entries.
- `markspec doctor` — delivered-file health: declared-but-missing, unfetched
  cache, corpus parse failures.
- **Location rendering:** human-facing diagnostics and report cells never show
  raw `.markspec/cache/<sha>/…` paths; corpus locations render as
  `<profile-id>@<version>:<relative-path>:<line>`. Machine formats carry the
  real absolute path in a separate field.
- **Reports/export:** traceability matrix and coverage gain an origin column
  (`project` or `<profile-id>@<version>`); `export json|yaml|csv` includes
  `origin`. Deterministic-output rule holds.

## 7. MCP surfaces (in v1 scope)

- **Docs-only files** become MCP resources —
  `markspec://delivered/{profile-id}/{path}` — listed in `resources/list` with
  the manifest `description`, read from the profile cache. The
  `markspec://profile` overview gains a _Delivered documents_ section listing
  these URIs (progressive-discovery pattern).
- **Corpus files** get the same raw-file resource, and their entries appear
  automatically through every existing entry surface (`entry_search`,
  `entry_list`, `markspec://entry/{id}`, `entry_context`) with origin shown in
  the rendered entry view.

## 8. LSP scope (v1, exactly this)

1. Corpus seeding into the index (§4).
2. Rename refuses on corpus-origin entries.
3. Completion items for corpus IDs carry an origin badge in the detail text
   (e.g. `from platform-arch@1.2.0`).

No decorations, no corpus-aware code actions.

## 9. New diagnostics

| Working name         | Severity | Meaning                                       |
| -------------------- | -------- | --------------------------------------------- |
| PROFILE-DELIVERS-001 | error    | corpus file declared but missing from package |
| PROFILE-DELIVERS-002 | warning  | docs-only file declared but missing           |
| PROFILE-DELIVERS-003 | error    | `path` escapes the profile directory          |
| (new MSL-R-family)   | error    | project entry ID collides with corpus entry   |

Final code numbers are assigned against the `language.md` §8 catalogue at
implementation time, per ADR-012 constraints.

## 10. Testing

Repo conventions: colocated unit tests + blackbox e2e.

- **Unit:** manifest parsing of `delivers:` (shapes, path-escape rejection,
  in-manifest duplicate paths); chain merge (additive union keyed by
  profile-id + path); `loadDeliveredCorpus` (origin stamping, missing-corpus
  error vs missing-doc warning, parse-failure attribution); `WorkspaceIndex`
  corpus seeding (corpus-first determinism, collision ownership); location
  rendering; MCP resource list/read for delivered files.
- **E2E:** fixture profile via **local specifier** (no network in tests)
  delivering one corpus + one docs-only file. Assertions: `check` resolves a
  project `Satisfies:` into the corpus; ID collision → non-zero exit + the new
  MSL code; `profile show` snapshot; `export json` carries `origin`; two
  consecutive `compile` runs byte-identical.

## 11. Documentation plan

Ships in the same PR series (repo rule: code + tests + docs together):

- New ADR _Profile-delivered documents_ — this design, including rejected
  alternatives.
- New MSL codes registered in `language.md` §8.
- `delivers:` added to the hosted `markspec.yaml` JSON schema.
- Guide: `configuration.md`, `commands.md`; new recipe _"Shipping a reference
  architecture in a profile"_.

## 12. Out of scope for v1 (recorded as ADR non-features)

1. **Vendoring** — a command copying delivered files into the consumer repo;
   possible later convenience on the same manifest field.
2. **Coverage policy** for unrealized corpus entries — reports show origin;
   whether an unsatisfied corpus entry is a _gap_ waits for a real corpus.
3. **Profile-authoring-side validation** (`profile publish` refusing to ship a
   broken corpus) — authoring tooling, separate track.
4. **Lockfile integration** (pinning profile/corpus hashes in `markspec.lock`) —
   composes later with ADR-020/022 machinery.
5. **LSP polish beyond §8.**

## Alternatives considered

- **B — Vendoring as the mechanism** (copy delivered files into
  `docs/references/<profile-id>/` with do-not-edit headers; normal discovery
  picks them up). Rejected for v1: provenance becomes a convention instead of a
  model fact; permanent drift/sync problem; repo pollution on every profile
  upgrade. May return as an offline convenience on top of the same `delivers:`
  field.
- **C — Reuse ADR-022 upstream / Reference-URI machinery.** Rejected: upstreams
  model _citations of external documents_; corpus entries are ordinary
  ULID-identified entries that happen to live in the profile package.
- **Shallow cut (resolution targets only).** Rejected by product call: full
  graph citizenship chosen — corpus entries appear in compile output, reports,
  and coverage, marked by provenance.

## Key clarifications from the brainstorm

- Injection must not depend on `markspec compile` being run: LSP and MCP need
  corpus IDs at first index for completion and AI assist. Hence the
  core-loader-with-three-callers shape (§4).
- Per-file corpus/doc flag (not per-profile): the author decides file by file.
- Primary use case is deliberately mixed (platform architecture + compliance
  corpus + org baselines) — the mechanism is generic.
