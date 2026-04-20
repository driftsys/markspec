# ADR-008: Profile System — Vocabulary, Rules, and Extension Distribution

Status: Proposed\
Date: 2026-04-19\
Scope: MarkSpec\
Depends on: [ADR-002 — Entry Model](./adr-002-entry-model.md),
[ADR-006 — Property Model](./adr-006-property-model.md),
[ADR-007 — Document Structure](./adr-007-document-structure.md)

## Context

ADR-002 separates the **entry format** (four families: Spec, Test, Element,
Reference) from the **domain vocabulary** (concrete TYPE prefixes, Element
kinds, status values, traceability rules). It calls this extension layer a
**profile** and defers the profile format to a future ADR.

Since ADR-002 was drafted, three characteristics of the extension need have
become clear:

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
extends: "npm:@markspec/profile-generic@^1.0"

# Content — participates in the extends-chain merge
profile:

  # Universal scope — applies to any entry regardless of category
  required: []
  attributes: []
  labels: []

  # Per-category scope
  spec:
    required: []
    attributes: []
    traceability: {}
  test:
    required: []
    attributes: []
    levels: []
    traceability: {}
  element:
    required: []
    attributes: []
    kinds: []
    traceability: {}
  reference:
    required: []
    attributes: []

  # Per-TYPE scope (keyed map; TYPE prefix is the key)
  types:
    SRS: { category: spec, required: [Derived-from] }
    SWT: { category: test, level: unit, required: [Tests, Verifies] }

  # Document-level scope (per ADR-007)
  documents:
    types: []
    frontMatter: []
```

**Terminology mapping.** The YAML uses `category` where ADR-002 uses _family_.
The two terms refer to the same four values (`spec`, `test`, `element`,
`reference`). `category` is used in the YAML for clarity of reading; `family`
remains the normative term in the entry-model ADR. Implementations should accept
both in parser diagnostics.

**Fixed key set.** Inside `profile:` the recognized keys are:

- Universal content: `required`, `attributes`, `labels`.
- Category scopes: `spec`, `test`, `element`, `reference`.
- TYPE scope: `types` (keyed map).
- Document scope: `documents`.

Any other top-level key under `profile:` is a validation error.

**Note — `kinds:` and `levels:` sugar.** `element.kinds:` and `test.levels:` are
documented shortcuts for extending the core-defined enum attributes
`Element-kind` and `Test-level` respectively. Each expands as an implicit
attribute declaration with enum-union merge (per the standard `attributes:`
merge semantics):

```yaml
# Shortcut form
element:
  kinds: [ecu, sensor, actuator]

# Equivalent to
element:
  attributes:
    - { name: Element-kind, type: enum, values: [ecu, sensor, actuator] }
```

Profiles may use either form; tooling treats them identically. The shortcut
exists because profile authors commonly extend only these two enums.

**Note — TYPE-scoped `level:` semantics.** A TYPE declaration may carry a
`level:` field (e.g., `SWT: { category: test, level: unit }`). Its semantics
follow ADR-002 §"Test-level inference from TYPE":

- On `markspec format`, if an entry of the TYPE omits `Test-level:`, the
  formatter pre-fills it with the TYPE's declared level and commits it to source
  (so the inferred value is inspectable in diffs).
- The author's explicit `Test-level:` value always wins. The validator accepts
  any valid Test-level regardless of the TYPE mapping.

This is default / inference behavior, not enforcement. Profiles that need strict
TYPE-to-level binding should express it through `rules.required` (not in scope
for v1).

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
      contains: [spec]
      description: Requirement specifications
    - id: architecture
      contains: [spec, element]
    - id: tests
      contains: [test]
  frontMatter: []
```

The `contains:` field declares which entry categories may appear in documents of
that type. Two uses:

- **Anonymous entry classification** — an entry without an explicit identity
  attribute (e.g., `[SWT_AUTH_0001]` with no `Test-id:`) is classified into the
  category listed in the enclosing document's `contains:`. Closes part of the
  classification heuristic gap from ADR-002.
- **Scope validation** — placing an entry of a category not listed in
  `contains:` produces a validation error
  (`specs don't belong in a tests
  document`).

Core ships with baked-in `contains:` mappings for the reserved doc types:

| Doc type       | `contains:`       |
| -------------- | ----------------- |
| `requirements` | `[spec]`          |
| `architecture` | `[spec, element]` |
| `tests`        | `[test]`          |
| `references`   | `[reference]`     |

**Profiles may add new doc types, but cannot override the core mapping for
reserved doc types.** Profile-added types must declare `contains:` explicitly.

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

### 6. TYPE enforcement

Presence of `profile.types:` determines whether the profile enforces TYPE
prefixes on entry display IDs:

- **`types:` absent or empty** — anonymous entries permitted; no TYPE
  vocabulary. Core markspec defaults apply.
- **`types:` declared with at least one entry** — every entry's display ID must
  begin with a declared TYPE prefix. Unknown TYPEs are validation errors.

v1 does not support a `'*'` wildcard entry. Profiles wanting "strict on some,
permissive on others" can be added later without breaking compatibility; the
two-mode model is easier to teach.

### 7. Traceability rules

Link rules are declared co-located with the **source** of the link — the
category or TYPE where the link originates. This matches the authoring mental
model ("when I write an SRS, what are the rules on its outgoing links?").

Each scope may carry a `traceability:` map keyed by link-attribute name. Each
entry in the map declares:

| Field         | Meaning                                                                                                                                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target`      | A list of matchers. Each matcher is a TYPE prefix string, a list of TYPE strings, or an object `{ category: <name> }` matching any member of a category. |
| `cardinality` | Count bounds (`0..1`, `1..1`, `0..N`, `1..N`). Optional; tightens the attribute's declared cardinality.                                                  |
| `required`    | Boolean; whether the link attribute must be present. Defaults to false.                                                                                  |

**Example (ASPICE SWE.4 BP5 bidirectional traceability):**

```yaml
profile:
  spec:
    traceability:
      Derived-from:
        target: [{ category: spec }] # Specs derive from Specs (default)

  test:
    traceability:
      Verifies:
        target: [{ category: spec }]
      Tests:
        target: [{ category: element }]

  types:
    SRS:
      category: spec
      traceability:
        Derived-from:
          target: [STK] # narrows: SRS derives only from STK
          cardinality: 1..N
          required: true

    SWT:
      category: test
      traceability:
        Verifies:
          target: [SRS, SWE]
          cardinality: 1..N
          required: true
        Tests:
          target: [{ category: element }]
          cardinality: 1..N
          required: true
```

**Generated inverses are not declared in profiles.** The downstream half of each
link (`Verified-by`, `Tested-by`, `Realizes`) is generated by markspec from the
forward declaration, per ADR-002.

### 8. Identity model — unchanged

This ADR **does not modify** the identity-attribute decisions from ADR-002. Each
family keeps its dedicated identity attribute:

- `Spec-id` → Spec entries (bare ULID)
- `Test-id` → Test entries (bare ULID)
- `Element-id` → Element entries (namespace path / file+symbol)
- `Reference-id` → Reference entries (slug / Pandoc cite / URI)

Categorized identity attributes remain the discrimination mechanism. Display IDs
follow the conventions laid out in ADR-002 (human-readable `TYPE_DOMAIN_NUMBER`
for Spec/Test; symbolic path for Element; slug/cite/URL for Reference). A
profile's `types:` section declares the TYPE prefixes admitted for Spec and Test
display IDs; profile authors may further constrain display-ID shapes via
additional rules in future revisions.

A variant design considered during this ADR's design phase — a single `Id:`
attribute with family derived by inference — was rejected. Rationale:

- Introduces a multi-input resolution cascade (value shape, discriminator
  attribute, display-ID TYPE prefix, profile map).
- Breaks core-only mode (no profile needed to parse entries correctly).
- Worsens error messages; an explicit `Test-id` says what it is.
- Would invalidate the PR #217 migration shipped earlier in April 2026.
- Saves one attribute name per entry — not worth the cost.

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
lifecycle are specified in a separate ADR (ADR-009, deferred) and are not in
scope here.

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

- Projects using an implicit vocabulary (no profile) continue to work — they run
  against markspec core defaults. Profile adoption is opt-in.
- Projects already using the four-family model (post-ADR-002) pick up a profile
  by running `markspec profile add <spec>`; no source changes required.
- The `Spec-id` / `Test-id` / `Element-id` / `Reference-id` model survives as
  the identity mechanism; no additional migration beyond what PR #217 already
  introduced.

### What is explicitly deferred

- **Hook API and lifecycle** — ADR-009 (separate).
- **Attribute declaration schema detail** — the full list of value types,
  per-attribute option flags, and validation helpers is a refinement of this
  ADR. Skeleton shape is defined here; full detail is a follow-up.
- **Built-in default profile** — whether markspec ships a `generic` profile that
  registers the common automotive TYPEs (SRS, SWT, …) is a tooling decision, not
  an architectural one.
- **Wildcard `'*'` TYPE fallback** — deferred until a real use case demands
  "strict on some, permissive on others".
- **`jsr:` and raw `https:` profile schemes** — admissible extension, not v1
  scope.
- **Publish-time cross-profile validation** — checking that a child's `extends:`
  chain resolves cleanly before publish is a quality-of-life enhancement; v1
  validates at consumer-side resolution time.

## Dependencies

- ✅ [ADR-002 — Entry Model](./adr-002-entry-model.md) — the four-family model
  and categorized identity attributes this ADR extends.
- ✅ [ADR-007 — Document Structure](./adr-007-document-structure.md) — the
  front-matter mechanism profiles extend via `profile.documents.frontMatter`.
- 🔗 [ADR-006 — Property Model](./adr-006-property-model.md) — profile-declared
  generated attributes populate the property layer defined here.
- 🔗 ADR-009 — Profile Hooks (deferred): API, sandbox, lifecycle.

## Acceptance criteria

- [ ] `markspec.yaml` schema is specified and validated (manifest + content).
- [ ] Three distribution channels (local, git, npm) resolve end-to-end.
- [ ] Monorepo subpath + per-profile tag convention supported.
- [ ] `extends:` chain resolution with additive + tightening merge implemented.
- [ ] TYPE enforcement (strict vs absent) implemented at validator layer.
- [ ] `profile.types.<PREFIX>.traceability` merges correctly across the chain
      and across scope tiers (universal → category → TYPE).
- [ ] CLI surface (`new`, `publish`, `add`, `doctor`) available with the
      described behavior.
- [ ] Vendored profiles are reproducible: running `markspec profile add` against
      the same pinned version always yields byte-identical output.
- [ ] ADR-002 §"Out of scope — Profile document format", ADR-006 §Dependencies,
      and ADR-007 §"Out of scope — Profile document format" updated to reference
      this ADR.

## Out of scope (future work)

- **Profile hooks** — code that extends parser, LSP, MCP. ADR-009.
- **Profile registry / discovery** — a markspec-specific registry beyond reusing
  git and npm.
- **Profile-level traceability validation** — automated checks across a resolved
  `extends:` chain (e.g., "this child's Derived-from rule cannot possibly be
  satisfied given the parent's TYPE vocabulary").
- **Signing and provenance** — SLSA-style provenance for published profiles;
  reuses whatever git tag signing / npm signing the ecosystem offers.
- **Profile composition at the consumer** — merging two content-bearing profiles
  inside `.markspec.yaml`. Projects use a pre-merged domain profile instead.
- **`jsr:` and `https:` specifier schemes** for profiles.
- **Wildcard `'*'` TYPE entry** for permissive-with-fallback mode.
