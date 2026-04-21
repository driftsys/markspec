# ADR-008 Profile System — v1 Implementation Design

**Date**: 2026-04-21 **Scope**: MarkSpec core **References**:
[ADR-008](../../architecture/adr-008-profile-system.md),
[ADR-009](../../architecture/adr-009-core-profile-boundary.md),
[ADR-002](../../architecture/adr-002-entry-model.md)

## 1. Overview

This spec defines the v1 implementation of the markspec profile system, bringing
ADR-008's declarative profile mechanism to life so that external profiles can
declare entry types, attributes, and traceability rules. MarkSpec's core
validator and compiler gain a profile-aware layer.

No profile content ships in this repo. v1 is the mechanism; real profiles
(custom, ASPICE/ISO draft) are authored elsewhere and consumed via
`.markspec.yaml`.

### In v1

- **Profile manifest schema** — full ADR-008 §4 shape: manifest fields,
  `profile:` content section with universal / shape / type / document scopes.
- **Attribute value types** — all 14 from ADR-002 Annex C.
- **Traceability rules** — target matchers (type name, `{shape: …}`),
  cardinality, required.
- **Generated inverses** — synthetic back-link attributes on targets at compile
  time.
- **Loader** — local path + git specifier (`git+https://…#<tag>`), shallow +
  sparse clone, per-project cache.
- **`extends:` chain with merge semantics** — additive lists, tightening
  constraints, subset target matchers (per ADR-008 §5). Designed in from day one
  so merge rules and schema decisions are coherent.
- **Consumer binding** — new `.markspec.yaml` at project root.
- **Validator pipeline** — core hygiene → type classification → typed attributes
  → traceability (stages skipped in core-only mode).
- **CLI surface** — `markspec profile add <spec>`, `markspec doctor`.

### Explicitly deferred (not v1)

| Item                                                 | Reason                                          |
| ---------------------------------------------------- | ----------------------------------------------- |
| `markspec profile new` scaffolding template          | Can hand-edit a manifest                        |
| `markspec profile publish`                           | Requires npm registry integration               |
| npm distribution scheme                              | Corporate-mirror feature, no immediate use case |
| Profile hooks (`hooks/` directory)                   | Deferred to ADR-012                             |
| Anonymous entry classification (doc-scope inference) | ADR-008 §4 note: "purely a convenience"         |
| Named check registry (RFC 2119, content-match)       | No default profile in v1                        |
| Default profile (ADR-010)                            | Explicit scope decision; ships later            |
| Language pack (ADR-011)                              | Separate phase                                  |

## 2. Architecture

### 2.1 Module layout

```
packages/markspec/core/
├── config/
│   ├── mod.ts              (existing: project.yaml loader)
│   └── markspec.ts         (NEW: .markspec.yaml loader)
├── profile/                (NEW)
│   ├── mod.ts              (public API: load, resolve, merge)
│   ├── manifest.ts         (parse markspec.yaml, validate schema)
│   ├── resolver.ts         (local + git specifier resolution)
│   ├── chain.ts            (walk extends, build chain with provenance)
│   └── merge.ts            (additive + tightening + subset rules)
├── validator/
│   ├── mod.ts              (existing: core hygiene — unchanged)
│   ├── pipeline.ts         (NEW: runs all stages in order)
│   ├── types.ts            (NEW: classify entries)
│   ├── attributes.ts       (NEW: typed attribute value validation)
│   └── traceability.ts     (NEW: target / cardinality / required)
├── compiler/
│   ├── mod.ts              (existing)
│   └── inverses.ts         (NEW: generate back-link attributes)
└── model/
    ├── mod.ts              (existing: Entry, TypedAttributes — minor additions)
    └── profile.ts          (NEW: Profile, ProfileChain, TypeDef, AttrDef, TraceRule types)
```

### 2.2 Phase flow (per command)

```
discover → resolve chain → merge → parse → validate pipeline → compile
```

1. **Discover** — walk up cwd to find `project.yaml`, look for `.markspec.yaml`
   alongside.
2. **Resolve chain** — load each profile in `profiles:` array, follow `extends:`
   pointers, build chain.
3. **Merge** — combine chain tiers into one `EffectiveProfile`, preserving
   per-rule provenance.
4. **Parse** — existing parser, unchanged.
5. **Validate pipeline** — stages 1–4 (see §5).
6. **Compile** — existing compilation + inverse generation pass.

### 2.3 Key invariants

- Profile resolution runs **once per command** before parsing. Any load or merge
  failure surfaces immediately with a clean profile-system error, not a cascade
  of per-entry failures.
- Parser is unchanged. Profile awareness is all downstream.
- Existing core validator (`validator/mod.ts`) is untouched; runs as stage 1 of
  the pipeline.
- Pipeline stages share shape `(entries, profile, diagnostics) → diagnostics`.
  Stages accumulate diagnostics; only stage 2 attaches classification to entries
  (`entry.type`).

## 3. Profile chain and merge semantics

### 3.1 In-memory model

```typescript
type ProfileChain = {
  tiers: LoadedProfile[]; // ordered root parent → leaf child
  effective: EffectiveProfile; // merged, used by validator / compiler
};

type LoadedProfile = {
  id: string;
  version: string;
  specifier: ProfileSpecifier;
  manifest: ProfileManifest;
  parent: LoadedProfile | null;
};

type EffectiveProfile = {
  required: ProvenancedValue<string[]>;
  attributes: ProvenancedMap<string, AttrDef>;
  labels: ProvenancedValue<string[]>;
  shapes: {
    identified: EffectiveShapeScope;
    referenced: EffectiveShapeScope;
  };
  types: ProvenancedMap<string, EffectiveTypeDef>;
  documents: {
    types: ProvenancedMap<string, DocTypeDef>;
    frontMatter: ProvenancedMap<string, AttrDef>;
  };
};

type ProvenancedValue<T> = { value: T; origin: ProfileId };
type ProvenancedMap<K, V> = Map<K, {
  value: V;
  origin: ProfileId; // which tier contributed the final value
  overrides?: ProfileId[]; // tiers whose value was narrowed / replaced
}>;
```

Provenance allows diagnostics to blame the right tier ("constraint tightened by
`acme-corp@1.2`").

### 3.2 Merge rules (per ADR-008 §5)

**Additive (union across tiers):**

| Field                            | Rule                                                      |
| -------------------------------- | --------------------------------------------------------- |
| `profile.required`               | Union                                                     |
| `profile.attributes` (universal) | Merged by name; duplicates require compatible value-types |
| `profile.labels`                 | Union                                                     |
| `profile.types` keys             | Union (children can introduce new types)                  |
| `types.<T>.attributes`           | Merged by name across tiers                               |
| `types.<T>.traceability` keys    | Union                                                     |

**Tightening (child may narrow, never relax):**

| Field                            | Tightening                                         |
| -------------------------------- | -------------------------------------------------- |
| `cardinality`                    | `0..N` → `1..N` ✓ ; `1..N` → `0..N` ✗              |
| `enum values`                    | Remove values from parent's set ✓ ; add unlisted ✗ |
| `required` flag                  | `false` → `true` ✓ ; `true` → `false` ✗            |
| `display-id-pattern-enforcement` | `off → warn → error` ✓ ; reverse ✗                 |
| `display-id-pattern`             | Must be identical across tiers for a given type    |

**Subset (traceability targets):**

| Field                       | Rule                                   |
| --------------------------- | -------------------------------------- |
| `traceability.<rel>.target` | Child's target list must be ⊆ parent's |

### 3.3 Scope layering within one profile

Three scopes compose inside a single profile:

```
profile.required  ⊂  profile.<shape>.required  ⊂  profile.types.<T>.required
profile.attributes  ⊂  profile.<shape>.attributes  ⊂  profile.types.<T>.attributes
```

Same tightening rules apply across scopes within one profile as apply across
tiers of the chain.

### 3.4 Load-time merge validation

Merge happens once at load. Violations surface as `PROFILE-MERGE-*` diagnostics
with:

- Violating child profile's id + version + specifier
- Parent profile's id + version + specifier
- Constraint path (e.g.,
  `types.requirement.traceability.Derived-from.cardinality`)
- What parent said, what child said, why the move is a relaxation / non-subset

## 4. Manifest schema

### 4.1 Top-level manifest fields

| Field         | Type             | Required | Notes                                       |
| ------------- | ---------------- | -------- | ------------------------------------------- |
| `id`          | string           | ✓        | npm-scope-shape recommended (`@scope/name`) |
| `version`     | semver           | ✓        | `major.minor.patch`                         |
| `description` | string           | —        |                                             |
| `license`     | SPDX id          | —        |                                             |
| `extends`     | specifier string | —        | Local path or `git+https://…#<tag>`         |

Any other top-level key at manifest root → validation error.

### 4.2 `profile:` content section

Recognized top-level keys (any other → error):

- `required` (list of attribute names) — universal scope
- `attributes` (list of `AttrDecl`) — universal scope
- `labels` (list of strings)
- `identified` (`{required, attributes, traceability}`) — shape scope
- `referenced` (`{required, attributes}`) — shape scope (no traceability)
- `types` (keyed map: `<type-name> → TypeDef`)
- `documents` (`{types, frontMatter}`)

### 4.3 `AttrDecl`

```yaml
name: Rationale # required, Title-Case (trailer convention)
type: enum # required — one of the 14 value types
required: true # optional; default false
cardinality: 1..1 # optional; default inferred from type
values: [QM, A, B, C, D] # required when type=enum
inverse: # optional, only when type=id or id-list
  name: Verified-by
  category: requirement
```

**Inferred cardinality defaults:**

| Type family                                                                                                                 | Default |
| --------------------------------------------------------------------------------------------------------------------------- | ------- |
| Singular: `id`, `uri`, `url`, `path`, `path-or-id`, `enum`, `text`, `citation`, `external-id`, `integer`, `date`, `boolean` | `0..1`  |
| List: `id-list`, `tag-list`                                                                                                 | `0..N`  |

### 4.4 `TypeDef`

```yaml
shape: identified # required
display-id-pattern: "REQ-{n:04d}" # optional; enables inference
display-id-pattern-enforcement: error # off | warn | error (default off)
required: [Rationale]
attributes: [{ AttrDecl }, ...]
traceability:
  <link-attr-name>: { TraceRule }
```

### 4.5 `TraceRule`

```yaml
Derived-from:
  target: [stakeholder-requirement, { shape: identified }]
  cardinality: 1..N
  required: true
```

`target` entries are either:

- A type name (string)
- A shape matcher (`{shape: identified}` or `{shape: referenced}`)

### 4.6 Display-ID pattern grammar

Per ADR-009 §5: literal prefix + `{n}` placeholder with optional zero-padding.

- `REQ-{n:04d}` → `REQ-0001`, `REQ-9999`
- `REQ-{n}` → `REQ-1`, `REQ-123` (no padding)
- Multi-segment prefix allowed: `STAKE-REQ-{n:06d}`

## 5. Validator pipeline

### 5.1 Stage contract

```typescript
type PipelineInput = {
  entries: Entry[];
  profile: EffectiveProfile | null;
  diagnostics: Diagnostic[];
};

type Stage = (ctx: PipelineInput) => PipelineInput;
```

Pipeline:

```
core hygiene → type classification → typed attributes → traceability
```

Stages 2–4 are skipped when `profile === null`.

### 5.2 Stage 1 — Core hygiene (existing)

Unchanged. Emits current codes (`MSL-R003`–`MSL-R007`).

### 5.3 Stage 2 — Type classification (new)

For each entry, resolve `type:`:

1. If entry has explicit `Type:` trailer, use that (error `MSL-T001` if value
   not in profile vocabulary).
2. Otherwise, collect types with `shape == entry.shape`, match display ID
   against each type's `display-id-pattern:`.
   - One match → assigned.
   - Multiple matches → `MSL-T002` ambiguity.
   - No match → un-classified.

Strict-mode handling (types declared → strict):

- Un-classified in strict profile → `MSL-T003` error.
- Display-ID pattern violation (classified via `Type:` but pattern mismatch) →
  `MSL-T004` warn or error per `display-id-pattern-enforcement`.

**Stage-2 diagnostic codes:**

| Code       | Severity   | Meaning                                    |
| ---------- | ---------- | ------------------------------------------ |
| `MSL-T001` | error      | Explicit `Type:` not in profile vocabulary |
| `MSL-T002` | error      | Display ID matches multiple type patterns  |
| `MSL-T003` | error      | Un-classified entry in strict profile      |
| `MSL-T004` | warn/error | Display ID doesn't match type's pattern    |

### 5.4 Stage 3 — Typed attributes (new)

Compute effective attribute set from scope layering:

```
universal.attributes  ∪  <shape>.attributes  ∪  types[entry.type].attributes
```

Per entry:

1. **Required check** — each required attribute present (`MSL-A001`).
2. **Cardinality check** — values count within bounds (`MSL-A002`, `MSL-A003`).
3. **Value-type check** — each attribute's values conform (`MSL-A004`).
4. **Unknown attribute** — not declared in scope → `MSL-A005` warning.

**Value-type validators:**

| Type          | Check                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------- |
| `id`          | ULID or URI, resolves in graph                                                                                   |
| `id-list`     | List of ids, each resolves                                                                                       |
| `uri`         | RFC 3986, any scheme                                                                                             |
| `url`         | RFC 3986, http/https scheme                                                                                      |
| `path`        | Relative path; absolute paths rejected; `..` traversal allowed but resolved path must remain inside project root |
| `path-or-id`  | Try id format first, fall back to path                                                                           |
| `enum`        | Value in declared `values:` list                                                                                 |
| `tag-list`    | Space-separated bareword tokens                                                                                  |
| `text`        | Any string                                                                                                       |
| `citation`    | Multi-line trailer format (ADR-002)                                                                              |
| `external-id` | Non-empty opaque string                                                                                          |
| `integer`     | Parseable integer                                                                                                |
| `date`        | ISO 8601 `YYYY-MM-DD`                                                                                            |
| `boolean`     | `true` / `false`                                                                                                 |

**Stage-3 diagnostic codes:**

| Code       | Severity | Meaning                                   |
| ---------- | -------- | ----------------------------------------- |
| `MSL-A001` | error    | Required attribute missing                |
| `MSL-A002` | error    | Value count exceeds upper cardinality     |
| `MSL-A003` | error    | Value count below lower cardinality       |
| `MSL-A004` | error    | Value doesn't match declared type         |
| `MSL-A005` | warning  | Attribute not declared in effective scope |

### 5.5 Stage 4 — Traceability (new)

Collect effective traceability rules:

```
<shape>.traceability  ∪  types[entry.type].traceability
```

Per rule `(linkAttrName, {target, cardinality, required})`:

1. **Required check** — link attribute present if `required: true` (`MSL-L001`).
2. **Cardinality check** — count within bounds (`MSL-L002`, `MSL-L003`).
3. **Target match** — each link value resolves to a target whose type or shape
   matches (`MSL-L004`).

**Target matcher semantics:**

- `target: [requirement]` — target entry's `type == requirement`.
- `target: [requirement, test-case]` — type in list.
- `target: [{shape: identified}]` — any identified entry.
- Mixed: `target: [requirement, {shape: referenced}]` — type match OR shape
  match.

**Stage-4 diagnostic codes:**

| Code       | Severity | Meaning                                              |
| ---------- | -------- | ---------------------------------------------------- |
| `MSL-L001` | error    | Required link missing                                |
| `MSL-L002` | error    | Link count exceeds upper cardinality                 |
| `MSL-L003` | error    | Link count below lower cardinality                   |
| `MSL-L004` | error    | Target type/shape doesn't match any matcher          |
| `MSL-L005` | warning  | Authored inverse inconsistent with generated inverse |

### 5.6 Pipeline runner

```typescript
export function runPipeline(
  entries: Entry[],
  profile: EffectiveProfile | null,
): Diagnostic[] {
  const stages: Stage[] = profile
    ? [coreHygiene, classifyTypes, validateAttributes, validateTraceability]
    : [coreHygiene];
  const final = stages.reduce(
    (ctx, stage) => stage(ctx),
    { entries, profile, diagnostics: [] },
  );
  return final.diagnostics;
}
```

## 6. Generated inverses

### 6.1 When

Runs during `compile`, after validation. Not part of `validate`.

### 6.2 Mechanism

For each entry:

1. Look up `entry.type` (set by stage 2).
2. For each traceability rule on that type with an `inverse:` clause:
   - For each forward link value (target Id):
     - Resolve target.
     - If `target.type === inverse.category`, append source's Id to the target's
       synthetic `<inverse.name>:` attribute.
     - Otherwise skip (forward link remains valid; the inverse just doesn't
       apply to targets of other types).

In v1 with strict typing (types declared → every entry classified), every link
target has a resolved `type`, so the category-match step is deterministic.

Multiple incoming links aggregate as `id-list` (order preserved, deduplicated).

### 6.3 Representation

`Entry.attributes` values carry `origin: 'authored' | 'generated'`:

```typescript
type AttributeValue = {
  raw: string;
  origin: "authored" | "generated";
  source?: { fromEntry: EntryId; viaAttr: string };
};
```

Downstream uses:

- `markspec format` rewrites only `authored` values; `generated` values never
  touch disk.
- Compiled artifact includes both with `origin` preserved.
- `context` / `report` query either.

### 6.4 Conflicts

Authored `<inverse.name>:` values merge with generated values (append, dedupe by
Id). A mismatch — authored inverse value not matched by any generating source —
emits `MSL-L005` warning at compile time.

### 6.5 Module

```typescript
// compiler/inverses.ts
export function generateInverses(
  entries: Entry[],
  profile: EffectiveProfile,
): Entry[];
```

Pure function, fixture-testable.

## 7. Loader and distribution

### 7.1 Specifier schemes

**Local**: `./path/to/profile` — resolved against `.markspec.yaml`'s directory.

**Git**: `git+https://host/owner/repo.git[/subpath]#<tag>`. Subpath enables
monorepo layouts; tag required.

### 7.2 Git fetch (shallow + sparse per ADR-008 §2)

```bash
git clone --depth=1 --branch=<tag> --filter=blob:none --sparse --no-checkout <repo> <cache-dir>
git -C <cache-dir> sparse-checkout set <subpath>
git -C <cache-dir> checkout <tag>
```

Auth inherits from user's git config. No markspec-specific auth.

### 7.3 Cache

```
<project-root>/.markspec/cache/<sha256-of-specifier>/<profile-content>/
```

Keyed by hash of `(host, repo, subpath, tag)`. Cache hit → reuse. Tags are
treated as immutable: once cached for a given tag, the loader never re-fetches
unless the cache directory is missing. If a user needs fresh content, they
delete the cache directory.

Offline: cached profiles work; uncached specifier → `PROFILE-LOAD-001`.

`.markspec/cache/` should be git-ignored (added to `.gitignore` on first use).

### 7.4 Vendoring (optional, via `markspec profile add`)

CLI command resolves + copies profile into `profiles/<manifest.id>/` at project
root; updates `.markspec.yaml` to point at the vendored path. Users can commit
vendored profiles for reproducibility.

### 7.5 Chain resolution

```
loadChain(rootSpecifier):
  visited = new Set()
  chain = []
  cursor = rootSpecifier
  while cursor is not null:
    if cursor in visited → PROFILE-LOAD-004 (cycle)
    visited.add(cursor)
    if chain.length >= MAX_CHAIN_DEPTH (20) → PROFILE-LOAD-005
    loaded = loadOne(cursor)
    chain.push(loaded)
    cursor = loaded.manifest.extends
  return chain   // ordered leaf → root; reverse for merge
```

`loadOne`:

1. Resolve specifier (local read / git fetch).
2. Read `markspec.yaml`.
3. Parse YAML (`PROFILE-LOAD-002` on parse error).
4. Validate manifest schema (`PROFILE-LOAD-003` on schema error).
5. Return `LoadedProfile`.

### 7.6 Consumer binding

`.markspec.yaml` at project root (sibling of `project.yaml`):

```yaml
profiles:
  - ./profiles/custom
```

v1 rule: at most one content-bearing profile per project (per ADR-008 §3).
Multiple → `PROFILE-LOAD-006`.

Discovery on every profile-aware command:

1. Walk up cwd to find `project.yaml` → `<project-root>`.
2. Look for `<project-root>/.markspec.yaml`. 3a. Absent or `profiles: []` →
   core-only mode. 3b. `profiles: [x]` → load chain from `x`, merge. 3c.
   `profiles: [x, y, …]` → `PROFILE-LOAD-006`.

### 7.7 Load error codes

| Code                | Meaning                                                 |
| ------------------- | ------------------------------------------------------- |
| `PROFILE-LOAD-001`  | Specifier unresolvable (local missing, git unreachable) |
| `PROFILE-LOAD-002`  | YAML parse error                                        |
| `PROFILE-LOAD-003`  | Manifest schema error                                   |
| `PROFILE-LOAD-004`  | `extends:` cycle                                        |
| `PROFILE-LOAD-005`  | Chain too deep (>20)                                    |
| `PROFILE-LOAD-006`  | Multiple content-bearing profiles                       |
| `PROFILE-MERGE-001` | Child relaxes parent constraint                         |
| `PROFILE-MERGE-002` | Child traceability target not subset of parent          |
| `MARKSPEC-YAML-001` | Unknown top-level key in `.markspec.yaml` (warn)        |

All load/merge errors fail fast before parsing any `.md` file.

## 8. CLI surface (v1)

### 8.1 `markspec profile add <spec>`

```bash
markspec profile add ./path/to/local-profile
markspec profile add git+https://github.com/acme/base-profile.git#v1.0
markspec profile add --dry-run <spec>
```

1. Resolve specifier.
2. Load + validate chain.
3. Copy resolved leaf profile into `<project-root>/profiles/<manifest.id>/`.
4. Update `.markspec.yaml` to point at vendored path.
5. Print resolved chain.

Idempotent: re-running with same `<spec>` replaces the vendored copy with the
freshly resolved version.

### 8.2 `markspec doctor`

Prints profile resolution state without running validate/compile:

- Project root and config location.
- Active chain (root → leaf) with id, version, specifier, resolved location.
- Merge status + summary counts.
- Cache state.

Exit codes:

| Code | Meaning              |
| ---- | -------------------- |
| 0    | Clean (or core-only) |
| 1    | Load or merge error  |
| 2    | Warnings only        |

### 8.3 Deferred CLI

- `markspec profile new <id>` (scaffolding template).
- `markspec profile publish` (requires npm).
- `markspec profile update` (registry checks).

## 9. Testing strategy

### 9.1 Fixture layout

```
tests/
├── e2e/
│   ├── profile_loader_test.ts
│   ├── profile_merge_test.ts
│   ├── profile_validator_test.ts
│   ├── profile_inverses_test.ts
│   └── profile_cli_test.ts
└── fixtures/
    └── profiles/
        ├── minimal/
        ├── with-types/
        ├── all-attribute-types/
        ├── with-traceability/
        ├── with-inverses/
        ├── extends-valid/
        ├── extends-relaxation/
        ├── extends-cycle/
        ├── extends-depth/
        └── bad-manifest/
    └── docs/
        └── <scenario>/
            ├── project.yaml
            ├── .markspec.yaml
            └── *.md
```

Each doc-scenario directory contains an `expected-diagnostics.json` file; tests
run the pipeline and assert diagnostics match.

### 9.2 Coverage matrix

| Area                       | Cases                                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Loader (local)**         | Happy, missing path, malformed YAML, unknown top-level key                                               |
| **Loader (git)**           | Happy, unreachable URL, bad tag, cache hit reuse, subpath                                                |
| **Chain resolution**       | Happy, cycle, too deep, multiple profiles in `.markspec.yaml`                                            |
| **Merge: additive**        | New type, new attribute on existing type, new traceability rule                                          |
| **Merge: tightening**      | Cardinality narrow, enum narrow, required promotion, enforcement tighten                                 |
| **Merge: relaxation**      | Each tightening inverted → `PROFILE-MERGE-001`                                                           |
| **Merge: subset targets**  | Valid subset, target not in parent → `PROFILE-MERGE-002`                                                 |
| **Stage 2 classification** | Pattern match, no match (strict error), ambiguity, explicit `Type:` override, unknown `Type:`            |
| **Stage 3 attributes**     | Required missing, cardinality over/under, each of 14 value types (happy + sad), unknown attribute (warn) |
| **Stage 4 traceability**   | Required missing, cardinality, type match, shape match, mixed target, target mismatch                    |
| **Inverses**               | Single link, multi-link aggregate, category-mismatch skip, authored + generated conflict (`MSL-L005`)    |
| **Core-only mode**         | No `.markspec.yaml` / empty `profiles:` → stages 2–4 skipped                                             |
| **CLI `profile add`**      | Local path, git specifier, `--dry-run`, idempotent replace                                               |
| **CLI `doctor`**           | Clean chain, merge violation, missing config                                                             |

### 9.3 Unit tests

Narrower tests alongside e2e:

- `merge.ts` — each rule family with synthetic tier structs (no filesystem).
- Each value-type validator — parse happy + malformed strings.
- `chain.ts` — cycle and depth detection with in-memory fakes.
- Display-ID pattern matcher — regex generation for `{n:04d}` variants.

## 10. Acceptance criteria

- [ ] `markspec.yaml` schema specified and validated (manifest + content).
- [ ] Local + git distribution schemes resolve end-to-end.
- [ ] Monorepo subpath + per-profile tag convention supported.
- [ ] `extends:` chain resolution with additive + tightening + subset merge.
- [ ] Type enforcement (strict vs absent) implemented at validator layer.
- [ ] `profile.types.<name>.traceability` merges across chain and scope tiers.
- [ ] CLI surface (`profile add`, `doctor`) available.
- [ ] Vendored profiles reproducible (byte-identical output against pinned
      version).
- [ ] Generated inverses appear in compiled artifact with `origin: generated`.
- [ ] All 14 attribute value types validated.
- [ ] Core-only mode (no `.markspec.yaml`) works with no regressions.
- [ ] All listed diagnostic codes emit with expected severities and message
      shapes.

## 11. Out of scope / future work

- Default profile (ADR-010).
- Named check registry (RFC 2119 keyword diagnostic, content-match rules).
- Language pack + SBOM ingestion (ADR-011).
- Profile hooks (`hooks/` directory, ADR-012).
- npm distribution scheme + `markspec profile publish`.
- `markspec profile new` scaffolding template.
- Anonymous entry classification via enclosing doc type.
- Registry-based version-drift checks in `markspec doctor`.
- Wildcard `'*'` type fallback (ADR-008 §6 note).
