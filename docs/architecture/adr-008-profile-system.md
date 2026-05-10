# ADR-008: Profile System — Vocabulary, Rules, and Extension Distribution

## Context

ADR-009 establishes the core / profile boundary: the core recognizes two
semantics-free entry shapes (**identified** and **referenced**) and a single
`Id:` identity attribute. All type vocabulary, relation names, attribute
spellings beyond `Id:`, and compliance rules are declared in profiles.

This ADR specifies the **profile format, distribution, and extends-chain
semantics** that realize that boundary. It also covers coding-standard and
language-pack profiles (rule-profiles and adapter-bearing profiles per ADR-011),
though the specifics of those live in their own ADRs.

Since ADR-002 was drafted (and amended by ADR-009), three characteristics of the
extension need have become clear:

- **Layered authorship.** Public domain profiles (ASPICE, ISO 26262, DO-178C,
  IEC 62304) form a baseline. Organizations tune that baseline with
  corporate-wide refinements (mandatory labels, extra attributes, internal
  status values). Teams refine further (stricter traceability requirements for a
  safety-critical component). Individual projects may tune again
  (project-specific TYPEs, overrides). Each layer builds on the one above it.
- **Compliance-grade review.** Profiles encode the rules auditors and quality
  engineers care about. They must be reviewable as declarative artifacts, not as
  executable code. A diff of a profile YAML is the primary review surface.
- **Heterogeneous distribution.** OSS profiles flow through public git and
  package registries. Corporate profiles flow through private git and internal
  npm mirrors, behind the firewall and through audit pipelines. The same
  mechanism must cover both.

The profile system also anticipates a second extension layer — **hooks** — code
that extends the parser, language server, and agent integration beyond what a
declarative profile can express (custom parsing, context-aware completion, MCP
tools). Hooks are introduced in this ADR as a structural slot but specified in a
separate ADR (ADR-009, deferred).

## Decision

### 1. Profile as a distributable package

A **profile** is a reusable, versioned, distributable unit that declares
vocabulary, rules, and (optionally) hook code. It is a directory containing:

```text
<profile-id>/
├── markspec.yaml        # manifest + declarative content
├── hooks/               # optional — JS/TS hooks (deferred to ADR-009)
│   └── ...
└── README.md            # recommended
```

`markspec.yaml` is authoritative. Nothing else in the directory is required by
the profile system; `hooks/` is loaded only when it exists; everything else is
documentation.

`package.json` is **not** committed to the profile source tree. When publishing
to npm, `markspec profile publish` generates a transient `package.json` from the
`markspec.yaml` manifest, runs `npm publish`, and discards the generated file.
Authors edit one manifest only.

### 2. Distribution channels

v1 supports three specifier schemes, each addressing a different operational
reality:

| Scheme | Form                                                      | Use case                                                                |
| ------ | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| Local  | `./path/to/profile`                                       | Project-local overrides; monorepo-vendored profiles; development        |
| Git    | `git+https://<host>/<owner>/<repo>.git[/<subpath>]#<tag>` | OSS baselines; corporate profiles in any git host; zero-infra sharing   |
| npm    | `npm:@scope/name@<semver-range>`                          | Corporate environments with npm mirrors, audit pipelines, vuln scanning |

The loader resolves each scheme via Deno's native import machinery. No bespoke
resolver or registry is required. `jsr:` and raw `https:` remain admissible
extension points but are not v1 requirements.

**Git monorepo support.** Multiple profiles may live in one git repository. The
subpath between `.git` and the fragment selects which profile; the fragment is a
per-profile tag using `<profile-id>/v<semver>` convention (matches Lerna / pnpm
/ Changesets monorepo practice).

```text
git+https://github.com/driftsys/markspec-profiles.git/aspice-4#aspice-4/v1.2.0
git+https://github.com/driftsys/markspec-profiles.git/iso-26262#iso-26262/v0.3.0
```

Single-profile repos may tag with bare `v<semver>` and omit the subpath.

**Git fetch mechanics.** The loader uses shallow + sparse checkout
(`git clone --depth=1 --branch=<tag> --filter=blob:none --sparse --no-checkout`,
then `git sparse-checkout set <subpath>`). Bandwidth is minimal (single commit,
single blob); auth is inherited from the user's git configuration.

**npm vs jsr for profile YAML.** npm is selected over jsr for v1 because:

- Corporate npm mirrors (Nexus, Artifactory, JFrog) are ubiquitous; jsr mirrors
  are not yet established.
- jsr requires a TypeScript entry point and static analysis; a pure-YAML profile
  does not fit. npm accepts data-only packages with a trivial manifest.

Profiles that also carry hook code can be published to jsr later without
changing the specifier scheme's semantics.

**Vendoring.** `markspec profile add <spec>` resolves the specifier, vendors the
profile contents into `profiles/<id>/` at the consumer's repo root, and records
the pinned version in the consumer's `.markspec.yaml`. Vendored profiles are
committed. This preserves PR-diff reviewability, offline usage, and a single
source of truth for what the project consumes.

### 3. Consumer binding

A consumer project declares its active profiles in `.markspec.yaml`:

```yaml
profiles:
  - npm:@markspec/profile-aspice-4@^1.2
  - git+https://github.com/acme/markspec-profile-corp.git#v1.0.0
  - ./profiles/project-overrides
```

**Multi-profile composition rules:**

- At most **one content-bearing profile chain** per project. The chain is
  resolved via `extends:` (single parent, see §5). Declaring two independent
  content-bearing profiles at the consumer level is a configuration error.
- Any number of **hook-only profiles** may be loaded alongside the content
  chain. Hook-only profiles carry no `markspec.yaml` content section; they
  contribute only `hooks/` contents.

Projects wanting to combine two domain standards (e.g., ASPICE + ISO 26262)
publish a pre-merged profile rather than stacking two in `.markspec.yaml`.
Merging at the consumer is too error-prone for compliance use.

### 4. Profile schema

`markspec.yaml` has two top-level regions: **manifest fields** (identity,
distribution) and **content** (the `profile:` subtree that participates in
`extends:` merging).

```yaml
# Manifest — identity, versioning, distribution
id: "@markspec/profile-aspice-4"
version: 1.2.0
description: ASPICE 4.0 software engineering profile
license: MIT
extends: "npm:@markspec/profile-default@^1.0"

# Content — participates in the extends-chain merge
profile:

  # Universal scope — applies to any entry regardless of shape or type
  required: []
  attributes: []
  labels: []

  # Per-shape scope (the two core shapes from ADR-009 §1)
  identified:
    required: []
    attributes: []
    traceability: {}
  referenced:
    required: []
    attributes: []

  # Per-type scope (keyed map; type-name is the key)
  types:
    requirement:
      shape: identified
      display-id-pattern: "SPEC-{n:03d}"
      required: [Derived-from]
      traceability: {}
    test:
      shape: identified
      display-id-pattern: "TEST-{n:03d}"
      required: [Tests, Verifies]
      traceability: {}
    standard:
      shape: referenced
      attributes: []
    dependency:
      shape: referenced
      attributes: []

  # Document-level scope (per ADR-007)
  documents:
    types: []
    frontMatter: []
```

**Terminology note.** The schema uses `identified` / `referenced` as the
per-shape scope keys, matching ADR-009's vocabulary. The earlier four-family
scope keys (`spec`, `test`, `element`, `reference`) no longer exist: those
distinctions become profile-declared types within a shape (see `types:` above).

**Type shape requirement.** Every entry under `types:` must declare a `shape:`
of either `identified` or `referenced`. The shape determines which per-shape
scope its rules inherit from and which identity-value format its entries must
carry (ULID or URI, per ADR-009 §2).

**Fixed key set.** Inside `profile:` the recognized keys are:

- Universal content: `required`, `attributes`, `labels`.
- Shape scopes: `identified`, `referenced`.
- Type scope: `types` (keyed map; each type declares `shape:` and optional
  `display-id-pattern:`, `required:`, `attributes:`, `traceability:`).
- Document scope: `documents`.

Any other top-level key under `profile:` is a validation error.

**Note — per-type attribute shortcuts are profile-specific.** The earlier
`element.kinds:` and `test.levels:` shortcut syntax no longer exists; kinds and
levels are no longer core concepts. A profile that wants to declare an
enum-valued attribute on a type uses the ordinary `attributes:` list:

```yaml
types:
  unit:
    shape: identified
    attributes:
      - name: Test-level
        type: enum
        values: [unit, integration, system, acceptance]
```

Compliance profiles may publish shortcuts of their own (e.g., a "unit-test" type
declaration with `Test-level` baked in), but these are profile-level
conveniences, not schema-level shortcuts.

**Note — default cardinality.** When an attribute declaration omits
`cardinality:`, the default is inferred from `type:`:

| Type family                                                              | Default cardinality |
| ------------------------------------------------------------------------ | ------------------- |
| Singular (`string`, `id`, `enum`, `date`, `url`, `boolean`, `number`, …) | `0..1`              |
| List (`id-list`, `string-list`, `tag-list`, …)                           | `0..N`              |

Setting `required: true` at the attribute level, or naming the attribute in a
scope's `required:` list, promotes the lower bound (`0..1` → `1..1`, `0..N` →
`1..N`).

**Note — link attributes and generated inverses.** Link kinds are not declared
in a separate schema section. A link is simply an attribute whose `type:` is
`id` or `id-list`. The attribute declaration may carry an optional `inverse:`
field describing the auto-generated back-link that markspec produces on the
target entry:

```yaml
profile:
  test:
    attributes:
      - name: Verifies
        type: id-list
        description: Specs verified by this test
        inverse:
          name: Verified-by
          category: spec # where the generated inverse appears
      - name: Tests
        type: id-list
        inverse:
          name: Tested-by
          category: element
```

Markspec generates the inverse attribute on every target entry matching the
traceability rule's `target:` matchers. The generated attribute appears in
compiled output but is not authored in source (per the generated-attribute
semantics from ADR-002).

**Note — retirement and draft semantics.** The core's retirement and draft
handling (ADR-002 §Retirement semantics, §Draft state) is structural, not
label-group based:

- **Draft state** — `Labels: DRAFT` is a plain universal tag; no exclusive
  group. Profiles treat it like any other label.
- **Retirement via replacement** — `Supersedes:` on successor; `Superseded-by:`
  generated on predecessor. Standard attribute machinery (see §Merge semantics
  and the note on generated inverses).
- **Retirement without replacement** — `Deprecated:` attribute with a free-text
  reason string; universal, authored, optional.
- **No `statuses:` section, no `lifecycle` exclusive label group.** Profiles do
  not need to declare lifecycle vocabulary beyond what the core already
  provides; extending retirement semantics is not in scope for v1.

Link-resolution severity on target entries is defined in ADR-002:

| Target state                                        | Severity |
| --------------------------------------------------- | -------- |
| Active (no marker)                                  | OK       |
| `Labels: DRAFT`                                     | info     |
| Retired (`Superseded-by:` set OR `Deprecated:` set) | warning  |
| Unresolved                                          | error    |

This replaces the former single-threshold MSL-T013 rule that targeted
`Status: deprecated|withdrawn`. ADR-002 and ADR-007 are updated accordingly
(Status attribute and document-level `status:` front-matter key removed;
`Deprecated:` added as a universal attribute).

**Note — document types and the `contains:` mapping.** Each entry in
`profile.documents.types:` is structured, not a bare string:

```yaml
documents:
  types:
    - id: requirements
      contains: [requirement]
      description: Requirement specifications
    - id: tests
      contains: [test]
    - id: references
      contains: [standard, glossary]
  frontMatter: []
```

The `contains:` field declares which **entry types** (not shapes) may appear in
documents of that type. Two uses:

- **Scope validation** — placing an entry of a type not listed in `contains:`
  produces a validation error ("requirements document does not admit entries of
  type `test`").
- **Anonymous entry classification (optional, per profile)** — a profile that
  declares `contains:` for a doc type may additionally allow an entry with no
  explicit `type:` attribute to be classified by the enclosing document's
  `contains:` list, provided the list contains exactly one entry-type. This is
  purely a convenience and does not make display-ID parsing dependent on
  document context.

The core does not pre-populate `contains:` for any document type; ADR-009
removes the four-family baked-in mapping. Each profile declares its own document
types and their accepted entry types. The default profile (ADR-010) declares
baseline document types appropriate to its type vocabulary (`requirement`,
`note`, `term`, `reference`); compliance profiles extend or replace them.

### 5. `extends:` chain and merge semantics

A profile may specify at most one `extends:` target. That target is itself a
profile (resolved via any valid specifier). The resolved chain forms a linear
inheritance path: **public profile → org → team → project**.

**Merge semantics (per-field):**

| Field category                                                              | Merge rule                                                                                                        |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| List-like additive (`required`, `attributes`, `labels`, `levels`, `kinds`)  | Union of all tiers. Declaring the same-named attribute in multiple tiers requires compatible definitions.         |
| Constraint fields (`cardinality`, enum narrowing, `required` flag on attrs) | Child may tighten (narrow). Child may not relax. Relaxation is a validation error at profile load.                |
| Traceability `target` matchers                                              | Child's target must be a subset of parent's target. Introducing a target not in the parent is a relaxation error. |

**The rule of thumb:** _more specific tiers can add new constraints and tighten
existing ones; they can never relax._

**Scope precedence within one profile** (unchanged by the chain):

```text
profile.* (universal)  ⊂  profile.<category>.*  ⊂  profile.types.<PREFIX>.*
```

Each scope accumulates on `required`, `attributes`, and vocabulary lists; each
scope may tighten constraints.

### 6. Type enforcement and display-ID patterns

Presence of `profile.types:` determines whether the profile enforces typed
entries:

- **`types:` absent or empty** — type-less entries permitted; profile validates
  only shape-level rules. Core hygiene (ADR-009 §10) still applies.
- **`types:` declared with at least one entry** — every entry must carry a
  `type:` attribute whose value is a declared type-name. Unknown types are
  validation errors.

**Display-ID patterns** are declared per type via the `display-id-pattern:`
template specified in ADR-009 §5 (literal prefix + `{n}` placeholder with
optional padding). Enforcement modes (`error`, `warn`, `off`) are
profile-controlled per type:

```yaml
types:
  requirement:
    shape: identified
    display-id-pattern: "REQ-{n:03d}"
    display-id-pattern-enforcement: error # strict
```

Display-ID patterns also drive **type inference** (ADR-009 §5): an entry whose
display ID matches a type's `display-id-pattern:` acquires that `type:`
automatically, with no `type:` attribute in source. An explicit `type:`
attribute in source **overrides** inference and is used when the display ID
matches no pattern, matches multiple patterns ambiguously, or when the author
wants the type visible in the trailers without consulting the profile.

v1 does not support a `'*'` wildcard type. Profiles wanting "strict on some,
permissive on others" can be added later without breaking compatibility; the
two-mode model is easier to teach.

### 7. Traceability rules

Link rules are declared co-located with the **source** of the link — the shape
or type where the link originates. This matches the authoring mental model
("when I write a requirement, what are the rules on its outgoing links?").

Each scope may carry a `traceability:` map keyed by link-attribute name. Each
entry in the map declares:

| Field         | Meaning                                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `target`      | A list of matchers. Each matcher is a type-name string, a list of type-names, or an object `{ shape: identified }` / `{ shape: referenced }`. |
| `cardinality` | Count bounds (`0..1`, `1..1`, `0..N`, `1..N`). Optional; tightens the attribute's declared cardinality.                                       |
| `required`    | Boolean; whether the link attribute must be present. Defaults to false.                                                                       |

**Example (ASPICE SWE.4 BP5 bidirectional traceability):**

```yaml
profile:
  identified:
    traceability:
      Derived-from:
        target: [{ shape: identified }] # default: any identified entry

  types:
    requirement:
      shape: identified
      traceability:
        Derived-from:
          target: [stakeholder-requirement] # narrows by type
          cardinality: 1..N
          required: true

    test:
      shape: identified
      traceability:
        Verifies:
          target: [requirement, software-requirement]
          cardinality: 1..N
          required: true
        Tests:
          target: [unit, component]
          cardinality: 1..N
          required: true
```

**Generated inverses are not declared in profiles.** The downstream half of each
link (`Verified-by`, `Tested-by`, `Realizes`) is generated by markspec from the
forward declaration, per ADR-002 (as revised alongside ADR-009).

### 8. Identity model — superseded by ADR-009

This section's earlier content — which retained the four family-specific
identity attributes (`Spec-id`, `Test-id`, `Element-id`, `Reference-id`) and
explicitly rejected the single-`Id:` variant — is **superseded by
[ADR-009 — Core / Profile Boundary](./adr-009-core-profile-boundary.md) §2** and
its §12 rebuttal of the four rejection reasons.

Summary of the new model, for readers who arrive here via `extends:` chains or
older documentation:

- Every entry carries exactly one identity attribute, **`Id:`**.
- The value is either a **ULID** (26-char Crockford base32 → identified shape)
  or a **URI** with a scheme (RFC 3986 → referenced shape).
- Shape is determined by `Id:` value format alone; no discriminator attribute,
  no display-ID prefix, no profile lookup participates.
- The former family-specific identity attributes are not accepted by the core
  parser; `markspec migrate` rewrites them to `Id:`.

Profiles do not redeclare identity — `Id:` is core-reserved. A profile may
declare its `types:` vocabulary using any naming it wishes; identity is uniform
across profiles.

### 9. CLI surface

Four commands are in scope for v1. The `profile` subcommand group contains
author-side and consumer-side operations; `doctor` is top-level and covers
consumer diagnostics.

```text
markspec profile new <id>             # author — scaffold a new profile directory
markspec profile publish [--dry-run]  # author — validate + npm publish
                                      #          (git users: git tag + git push)
markspec profile add <spec>           # consumer — resolve, vendor to profiles/<id>/
markspec doctor                       # consumer — diagnostics: active chain,
                                      #            resolution errors, version
                                      #            drift, hook load status
```

**Deliberately not in v1:**

- `markspec profile lint` — `publish --dry-run` covers the same ground.
- `markspec profile update` — registry checks are surfaced as hints inside
  existing commands (e.g., `markspec build` / `markspec validate`) when a newer
  in-range version is available.
- `markspec profile show` — replaced by `markspec doctor`, which covers it
  alongside other diagnostic content.

### 10. Hooks — structural slot

Profiles may contain a `hooks/` directory. When loaded, hooks extend markspec's
parser, language server, or MCP surface. The interfaces, sandboxing, and
lifecycle are specified in a separate ADR (ADR-012, deferred; this was
originally reserved as ADR-009 but that number was reclaimed by the Core /
Profile Boundary ADR) and are not in scope here.

This ADR reserves the directory and the loader's awareness of it. Profiles
without hooks ship pure declarative content; profiles with hooks ship both.
Hook-only profiles (no `profile:` content section) are valid distribution units.

## Consequences

### What this ADR enables

- A single source of truth for how profiles are authored, distributed, and
  consumed, closing the deferral in ADR-002.
- OSS domain profiles (ASPICE, ISO 26262, DO-178C, IEC 62304) can be authored
  and distributed through git, with organizations layering corporate profiles on
  top via `extends:`.
- Corporate environments can route profiles through their existing npm
  infrastructure without markspec introducing a new distribution channel.
- Profile changes are reviewed as declarative YAML diffs, keeping compliance
  audit trails legible.
- The distinction between declarative profiles and imperative hooks is explicit,
  preserving the "no code in the compliance artifact" property that regulated
  industries need.

### What shifts for existing consumers

- Projects using core-only mode (no profile) continue to work — they run against
  markspec core defaults. The default profile (ADR-010) loads automatically
  unless explicitly disabled, providing generic types and hygiene rules.
- Projects already using the pre-ADR-009 four-family identity attributes
  (`Spec-id` / `Test-id` / `Element-id` / `Reference-id`) run `markspec migrate`
  to rewrite those attributes to `Id:`; see ADR-009 §12.
- The identity model is now **single-`Id:`-with-format-discrimination** per
  ADR-009 §2.

### What is explicitly deferred

- **Hook API and lifecycle** — ADR-012 (separate; originally reserved as
  ADR-009).
- **Attribute declaration schema detail** — the full list of value types,
  per-attribute option flags, and validation helpers is a refinement of this
  ADR. Skeleton shape is defined here; full detail is a follow-up.
- **Built-in default profile** — specified in
  [ADR-010 — Default Profile](./adr-010-default-profile.md).
- **Wildcard `'*'` type fallback** — deferred until a real use case demands
  "strict on some, permissive on others".
- **`jsr:` and raw `https:` profile schemes** — admissible extension, not v1
  scope.
- **Publish-time cross-profile validation** — checking that a child's `extends:`
  chain resolves cleanly before publish is a quality-of-life enhancement; v1
  validates at consumer-side resolution time.

## Dependencies

- ✅ [ADR-002 — Entry Model](./adr-002-entry-model.md) (as revised alongside
  ADR-009) — entry model this ADR extends.
- ✅ [ADR-007 — Document Structure](./adr-007-document-structure.md) — the
  front-matter mechanism profiles extend via `profile.documents.frontMatter`.
- ✅ [ADR-009 — Core / Profile Boundary](./adr-009-core-profile-boundary.md) —
  core / profile split, two-shape model, identity contract. Supersedes the
  previous ADR-008 §8.
- 🔗 [ADR-006 — Property Model](./adr-006-property-model.md) — profile-declared
  generated attributes populate the property layer defined here.
- 🔗 [ADR-010 — Default Profile](./adr-010-default-profile.md) — the bundled
  profile that loads by default, using the schema specified here.
- 🔗
  [ADR-011 — Language Pack and Dependency Ingestion](./adr-011-language-pack-and-dependency-ingestion.md)
  — language packs and rule-profiles as instances of this schema.
- 🔗 ADR-012 — Profile Hooks (deferred; originally reserved as ADR-009): API,
  sandbox, lifecycle.

## Acceptance criteria

- [ ] `markspec.yaml` schema is specified and validated (manifest + content).
- [ ] Three distribution channels (local, git, npm) resolve end-to-end.
- [ ] Monorepo subpath + per-profile tag convention supported.
- [ ] `extends:` chain resolution with additive + tightening merge implemented.
- [ ] Type enforcement (strict vs absent) implemented at validator layer.
- [ ] `profile.types.<name>.traceability` merges correctly across the chain and
      across scope tiers (universal → shape → type).
- [ ] CLI surface (`new`, `publish`, `add`, `doctor`) available with the
      described behavior.
- [ ] Vendored profiles are reproducible: running `markspec profile add` against
      the same pinned version always yields byte-identical output.
- [ ] ADR-002 §"Out of scope — Profile document format", ADR-006 §Dependencies,
      and ADR-007 §"Out of scope — Profile document format" updated to reference
      this ADR.
- [ ] Identity contract conforms to ADR-009 §2: `Id:` with ULID-or-URI
      discrimination; no family-specific identity attributes accepted.

## Out of scope (future work)

- **Profile hooks** — code that extends parser, LSP, MCP. ADR-012.
- **Profile registry / discovery** — a markspec-specific registry beyond reusing
  git and npm.
- **Profile-level traceability validation** — automated checks across a resolved
  `extends:` chain (e.g., "this child's Derived-from rule cannot possibly be
  satisfied given the parent's type vocabulary").
- **Signing and provenance** — SLSA-style provenance for published profiles;
  reuses whatever git tag signing / npm signing the ecosystem offers.
- **Profile composition at the consumer** — merging two content-bearing profiles
  inside `.markspec.yaml`. Projects use a pre-merged domain profile instead.
- **`jsr:` and `https:` specifier schemes** for profiles.
- **Wildcard `'*'` type entry** for permissive-with-fallback mode.
