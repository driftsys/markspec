# MarkSpec — Profile Schema

> **Retired.** The normative profile manifest schema has moved to
> [Model Reference — Annex B](../model/annex-profile-schema.md).
>
> This file is kept for historical reference only. Its reconciliation stance
> (§1), options analyses, and open questions remain below unchanged.

---

Status: **Retired** (Prompt 2 of the next-gen refactor)\
Superseded by: [Model Reference — Annex B](../model/annex-profile-schema.md)\
Scope: historical rationale and options analyses only

---

Status: Draft (Prompt 2 of the next-gen refactor)\
Date: 2026-05-16\
Scope: MarkSpec profile layer — how profiles declare concrete types, inherit the
core taxonomy, stack via `extends:`, and pin compatibility\
Builds on: [markspec-core-data-model.md](markspec-core-data-model.md) (Prompt 1
output — the frozen core model), ADR-003 (information & traceability model),
ADR-004 (authoring model), ADR-008 (profile system — distribution and
extends-chain mechanics), ADR-009 (core / profile boundary), ADR-010 (default
profile)

This spec is the build target for the Prompt-2 profile-schema implementation. It
freezes the **profile manifest schema**, the **inheritance rule** that binds
profile-declared concrete types to the core's built-in taxonomy, the
**`extends:` stacking and conflict-resolution rules**, the **type-inference
precedence** a profile participates in, the **default profile contents**, and
the **versioning / compatibility** contract. It does not specify listing
directives ([markspec-listing-directives.md](markspec-listing-directives.md)),
the toolchain wiring (Prompt 3), or end-user documentation (Prompt 4).

The companion file
[markspec-listing-directives.md](markspec-listing-directives.md) depends on this
one for the Component type vocabulary and the `term` → `Definition` binding;
cross-references are flagged inline.

---

## 0. Terminology

This spec inherits the terminology of
[markspec-core-data-model.md §0](markspec-core-data-model.md) verbatim
(**entry**, **Entry**, **Authored**, **Reference**, **Item**, **shape**,
**type**, **attribute**, **trailers**) and adds:

| Term                    | Meaning in this spec                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **profile**             | A distributable, versioned package declaring concrete types, attributes, relations, and rules. ADR-008 §1.                                              |
| **manifest**            | The `markspec.yaml` file at a profile's root: manifest fields (identity, distribution) + the `profile:` content subtree. ADR-008 §4.                    |
| **core type**           | One of the 4 abstract (`Item`, `Specification`, `Component`, `Unit`) or 15 concrete built-in types frozen by core-data-model §1.3. Reserved (MSL-A040). |
| **profile type**        | A concrete type a profile declares by `extends:`-ing a core type or another profile type. Lowercase-with-hyphens by convention (ADR-004 §Part 2).       |
| **chain**               | The linear `extends:` inheritance path of profiles: default → compliance → org → team → project. ADR-008 §5; ADR-009 §11.                               |
| **tier**                | One profile in the chain.                                                                                                                               |
| **effective profile**   | The single merged view produced by collapsing the chain per §5. What the validator / compiler consume.                                                  |
| **core schema version** | The contract-surface version of core-data-model.md a profile pins against (§8). Distinct from a profile's own `version:`.                               |

---

## 1. Reconciliation stance (authoritative)

The profile layer sits on a fault line between two ADR generations:

- **ADR-008 / ADR-009 / ADR-010** (the profile system as first drafted) frame
  the core as carrying _no type vocabulary_ — every type, including
  `requirement`, is profile-declared; the manifest keys each type by a `shape:`
  (`identified` / `referenced`); the bundled default profile (ADR-010 §2) ships
  four types (`requirement`, `note`, `term`, `reference`).
- **core-data-model.md** (Prompt 1, merged) supersedes that framing per its §1.3
  reconciliation note: the **15 concrete types are core**, with the abstract
  parents (`Specification` / `Component` / `Unit` / `Item`) serving as
  direct-instantiation fallbacks _and_ as roots for profile subtypes; §4.4
  `MSL-A040` reserves the 15-type vocabulary against profile shadowing.

This spec resolves the fault line as follows, and the resolution is normative
for `main` after the refactor (per `nextgen/README.md` §Spec authority — the
nextgen ADRs and each prompt's output spec are authoritative for `main` once the
refactor lands):

1. **The core taxonomy is authoritative.** Profiles do not _declare_ the base
   vocabulary; they **extend** it. core-data-model §1.3 / §1.6 govern; ADR-008
   §4 "Profile schema" and §6 "Type enforcement", and ADR-010 §2 "Type
   vocabulary", are superseded where they conflict. Annex B enumerates the exact
   deltas.
2. **ADR-008 retains distribution mechanics unchanged.** Package layout (§1),
   distribution channels (§2), consumer binding (§3), the `extends:` _chain_
   resolution and vendoring (§5), CLI surface (§9), and the hooks slot (§10) of
   ADR-008 stand. This spec only redefines what goes _inside_ the `profile:`
   content subtree.
3. **Shape leaves the manifest.** Under the orthogonal two-layer model
   (core-data-model §1.1) shape is decided by the `Id:` value format alone and
   is independent of type. ADR-008's per-type `shape:` key is therefore not
   meaningful — a `requirement` may be Authored (a ULID-identified spec) or
   Reference (a cited standard whose `Type:` resolves to `Requirement`, ADR-004
   §Part 3). The manifest replaces per-type `shape:` with per-type `extends:`
   (§3).

**Options analysis — reconciliation stance.**

| Alternative                                                                                                     | Rejected because                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purely additive (keep ADR-008 §4 verbatim, add inheritance as new optional keys, keep ADR-010's 4-type default) | Leaves the 15-type-core vs 4-type-default contradiction unresolved; core-data-model §1.6 already states profiles _extend_ the 15 core types, so a 4-type independent default is incoherent.                                                        |
| Defer the reconciliation to an open question                                                                    | The manifest schema is the build target of this prompt; an unresolved core/profile boundary makes the schema unimplementable. core-data-model §6 caps open questions for exactly this reason — forks that block the build are decided, not parked. |
| Authoritative redefine + supersession annex (**chosen**)                                                        | Matches the nextgen spec-authority rule and core-data-model §1.3; the only stance that yields a coherent, implementable manifest. Cost: an explicit deltas annex (Annex B) — accepted.                                                             |

---

## 2. Manifest format, location, discovery

### 2.1 Package and manifest

A profile is the directory shape ADR-008 §1 fixes:

```text
<profile-id>/
├── markspec.yaml        # manifest + declarative content (authoritative)
├── hooks/               # optional — deferred to ADR-012
└── README.md            # recommended
```

`markspec.yaml` has two regions (ADR-008 §4): **manifest fields** (identity,
versioning, distribution, compatibility) and the **`profile:` content subtree**
(the part this spec redefines). Region boundary:

```yaml
# ── Manifest fields ───────────────────────────────────────────────
id: "@markspec/profile-aspice-4"
version: 1.2.0
description: ASPICE 4.0 software engineering profile
license: MIT
extends: "npm:@markspec/profile-default@^1.0"   # one parent, ADR-008 §5
markspec-schema: "1"                              # core schema pin, §8

# ── Content subtree (participates in extends merge, §5) ────────────
profile:
  attributes: []          # universal-scope attribute declarations
  labels: []              # well-known label values
  types: {}               # concrete-type declarations, §3 / §4
  documents:              # ADR-007 / ADR-008 §4 "document types"
    types: []
    frontMatter: []
```

The fixed key set inside `profile:` is **`attributes`**, **`labels`**,
**`types`**, **`documents`**. Any other key under `profile:` is a profile-load
error (`PROFILE-LOAD-002`, carried from the ADR-008 implementation). Three
ADR-008 keys are **removed** (Annex B): the per-shape scopes `identified:` and
`referenced:` (shape is not a profile concept, §1.3) and the universal
`required:` list (subsumed by per-attribute `required:` and per-type
`required:`, §4.2).

### 2.2 Location, discovery, binding

Unchanged from ADR-008 §3 and ADR-010 §1:

- A consumer project lists active profiles in `.markspec.yaml` (`profiles:`). At
  most one content-bearing chain (ADR-008 §3); any number of hook-only profiles.
- The **default profile** (§7) is bundled in the binary and registered as the
  implicit bottom of the chain unless `default-profile: false` is set in
  `.markspec.yaml` (ADR-010 §1).
- `markspec profile add <spec>` vendors a resolved profile into `profiles/<id>/`
  and pins the version in `.markspec.yaml` (ADR-008 §2 "Vendoring"). Vendored
  profiles are committed.
- Discovery walks up from the working directory to find `.markspec.yaml`
  alongside `project.yaml` (core-data-model is silent on discovery; this matches
  the shipped `core/config` + `core/profile` loader behaviour and is unchanged).

**Core-only mode** (no profile, `default-profile: false` and empty `profiles:`)
remains valid (ADR-009 §10): the 15-type core taxonomy and core hygiene
(`MSL-I*`, `MSL-R080`) still apply; only profile-declared types, relations, and
promoted-to-error rules are dormant.

---

## 3. Declaring concrete types and inheritance to the core

### 3.1 The `extends:` rule

Every profile type is declared as a keyed entry under `profile.types:` and
**must** declare a single `extends:` target naming the type it specializes:

```yaml
profile:
  types:
    software-requirement:
      extends: Requirement              # a core concrete type
      display-id-pattern: "SRS_{scope}_{n:04d}"
    stakeholder-requirement:
      extends: Requirement
      display-id-pattern: "STK_{scope}_{n:04d}"
    hazard:
      extends: Risk                     # core concrete type
    ecu:
      extends: HardwareComponent        # core concrete type
    safety-requirement:
      extends: software-requirement     # another *profile* type (same chain)
```

Rules (ADR-003 §Part 7 "Profiles cannot remove or replace core types … Only
extend"; ADR-004 §Part 2 "Inheritance is declared in the profile manifest"):

- **R3.1-a.** `extends:` is **required** for every profile type. A type with no
  parent has no place in the taxonomy and inherits no attributes or relations.
  Omitting it is a profile-load error (`PROFILE-TYPE-001`, new).
- **R3.1-b.** The `extends:` target is resolved against the union of (1) the 19
  core type names (4 abstract + 15 concrete, core-data-model §1.3) and (2) every
  profile type in the _same effective profile_ (§5). Resolution is by name over
  that union, not by declaration order — acyclicity and the root-at-core
  requirement (R3.1-c) make order irrelevant. An unresolved target is
  `PROFILE-TYPE-002` (new, error).
- **R3.1-c.** The inheritance graph must be acyclic and must root at a core
  type. A cycle, or a chain that never reaches a core type, is
  `PROFILE-TYPE-003` (new, error).
- **R3.1-d.** A profile type **may not** be named identically to any core type
  (the 19 reserved names). That is shadowing, not extension — `MSL-A040` /
  `PROFILE-TYPE-004` (core-data-model §4.4 reserves the vocabulary).
- **R3.1-e.** Shape is **not** declared. An entry's shape is the `Id:`-format
  decision of core-data-model §1.2 and is orthogonal to its `Type:`. A profile
  type is usable by both shapes unless a profile rule (§4.3) restricts it.

The resolved abstract ancestor (`Specification` / `Component` / `Unit` / `Item`)
of every type — core or profile — is what core validation rules operate on
(direction of `Derived-from`, applicability of `Realizes`, the per-relation
target columns of ADR-003 §Part 2). This is ADR-004 §Part 2 "Tooling resolves
any concrete `Type:` value to its abstract parent".

### 3.2 Options analysis — inheritance declaration

| Decision                                   | Alternative                                                     | Why rejected                                                                                                                                                                                                                                            |
| ------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-type `extends:` naming the parent type | Keep ADR-008 per-type `shape:` (identified/referenced)          | `shape:` is obsolete under the orthogonal model (§1.3): a profile type can be authored or cited. Keeping it forces the contradiction core-data-model §1.1 removes, and gives no inheritance edge to the 15-type taxonomy core-data-model §1.6 requires. |
| Per-type `extends:`                        | Separate `abstract-parent:` (only the 4 abstract roots allowed) | Forbids `SRS extends Requirement` / `Hazard extends Risk` — the exact multi-level subtyping ADR-003 §Part 7 enumerates. Collapsing every profile type onto an abstract root loses the concrete core attributes (e.g. `Test.Verifies`).                  |
| Per-type `extends:`                        | Infer the parent from `display-id-pattern:` prefix only         | Reference-shape and slug-keyed profile types have no numeric display-ID pattern (core-data-model §1.7); inference would leave them parentless. Explicit `extends:` is the single declaration that works for every type.                                 |
| `extends:` required (R3.1-a)               | Default missing `extends:` to `Item`                            | Silent reparenting to the permissive fallback hides author error and yields a type with no inherited trace attributes. An explicit required edge is auditable — the compliance-review property ADR-008 §Context demands.                                |

---

## 4. Per-concrete-type declarations

A `profile.types.<name>` entry recognizes this fixed key set (superseding
ADR-008's per-type key set — Annex B):

| Key                              | Meaning                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `extends`                        | Parent type (§3). Required.                                                                          |
| `description`                    | Human-readable summary. Optional.                                                                    |
| `display-id-pattern`             | Template (ADR-009 §5 grammar): literal prefix + `{n}`/`{n:Nd}` + optional `{scope}`. Optional.       |
| `display-id-pattern-enforcement` | `off` \| `warn` \| `error`. Default `warn`. ADR-008 §6; ADR-010 §5.                                  |
| `required`                       | List of attribute names that must be present on entries of this type. §4.2.                          |
| `attributes`                     | Per-type attribute declarations (extend the inherited set). §4.1.                                    |
| `traceability`                   | Map keyed by link-attribute name; per-relation `target` / `cardinality` / `required`. ADR-008 §7.    |
| `body`                           | Allowed / required body-block constraint over the closed catalogue. §4.4.                            |
| `color`                          | Render bucket hint (carried from the shipped implementation; consumed by render, out of scope here). |

Any other per-type key is `PROFILE-TYPE-005` (new, error). The ADR-008 per-type
`shape:` key is **removed** (§1.3 / Annex B).

A malformed `display-id-pattern` — more than one `{n}` counter, an invalid or
zero-width padding specifier, a counter-less pattern with no literal anchor, or
a duplicate named placeholder — is a `PROFILE-TYPE-008` profile-load error
(new). It is compile-checked once when the profile loads, against the same
grammar the classifier uses, so a typo is reported cleanly at load instead of
throwing an uncaught exception during validation.

### 4.1 Attributes — inherited, optional, required

A type's effective attribute set is the **union** of:

1. The universal attributes (core-data-model §1.4) and, for Reference-shape
   entries, the promoted Reference attributes (core-data-model §1.5).
2. The core attributes of every type on the `extends:` chain up to the abstract
   root (core-data-model §1.6 / ADR-003 §Part 2 — e.g. `software-requirement`
   inherits `Requirement` ⊂ `Specification`: `Derived-from`, `Satisfies`,
   `Allocated-to`).
3. The profile `attributes:` declared on this type and on every ancestor profile
   type.

Each profile attribute declaration uses the ADR-008 §4 attribute schema (`name`,
`type`, `required`, `cardinality`, `values`, `inverse`) unchanged. The
default-cardinality inference (ADR-008 §4 "default cardinality" — singular types
→ `0..1`, list types → `0..N`) is unchanged.

**Inherited attributes may be tightened, never relaxed** (§5 merge rule applied
within a single profile across the `extends:` edge): a profile type may mark an
inherited optional attribute `required`, narrow an inherited `enum`'s `values`,
or tighten an inherited `cardinality`. It may not widen any of these, nor remove
an inherited attribute (ADR-003 §Part 7; ADR-008 §5 constraint-field rule).

### 4.2 `required`

`required:` at the type scope and `required: true` at the attribute scope both
promote an attribute's lower cardinality bound (`0..1`→`1..1`, `0..N`→`1..N`),
exactly as ADR-008 §4 "default cardinality" specifies. The ADR-008 _universal_
`profile.required:` list is removed (Annex B): an attribute that must be present
on every entry is declared `required: true` on the universal `attributes:` entry
instead. This removes the only ADR-008 path by which `required` could name an
attribute not declared in scope.

### 4.3 Validation rules a profile may add

Per ADR-003 §Part 7 and core-data-model §4.10, a profile may add — and only
_add_ — validation:

- Required attributes / required relations on its types.
- Tighter cardinality than the inherited / core default.
- Type-compatibility constraints (e.g. an ASIL-D `Requirement` may not be
  `Realizes`-d by a QM `Component`).
- Display-ID format enforcement (`display-id-pattern-enforcement: error`).
- Promotion of any core `warning`/`info` to `error` (core-data-model §4.10).
- A per-type _shape restriction_: an optional `shape:` **constraint** (not the
  removed declaration key) under a profile rule that an entry of this type must
  be Authored or must be Reference — e.g. `dependency` entries must be
  Reference. Violations are profile-defined errors. This is opt-in policy, not
  the ADR-008 structural key.

A profile **may not** demote a core `error`, remove a core type/relation, or
relax an inherited constraint (ADR-009 §profile-extension; core-data-model
§4.10; ADR-003 §Part 7). Attempting any is a profile-load error
(`PROFILE-MERGE-010`, new).

### 4.4 Allowed body blocks

The body-block catalogue is **closed** at the core level (core-data-model §2.4 —
ten block types) and a profile cannot extend it (core-data-model §5.4: a new
block type requires an ADR amendment, not a profile). A profile may _constrain_
which of the ten a type admits, via an optional `body:` key:

```yaml
types:
  contract:
    extends: Contract
    body:
      require: [Code]        # a Contract entry's body must contain a Code block
      forbid:  [Feature]     # … and must not contain a Gherkin Feature block
```

`require:` / `forbid:` name body-AST node types from core-data-model §2.4.
Unknown node names are `PROFILE-TYPE-006` (new, error). A violated `require:` /
`forbid:` is a profile-defined error on the entry. Profiles cannot _add_ block
types (`PROFILE-TYPE-007`, new, error) — the catalogue is core-frozen.

### 4.5 Id-scheme hints

For Reference-shape types, a profile may declare which URI schemes are expected,
feeding type inference (§6) and listing validation
([markspec-listing-directives.md §5](markspec-listing-directives.md)):

```yaml
types:
  dependency:
    extends: SoftwareComponent
    id-schemes: ["pkg:cargo", "pkg:npm"]   # purl, listing-directives §5
  hardware-part:
    extends: HardwareComponent
    id-schemes: ["mfg:", "gtin:", "urn:system:"]
```

`id-schemes:` is advisory at the profile layer (a non-matching `Id:` scheme is a
`warning`, not an error, unless the profile promotes it). The authoritative
scheme→type map is ADR-003 §Part 6 plus profile extensions (§6). The exact
per-scheme parsers live in
[markspec-listing-directives.md §5](markspec-listing-directives.md) — this spec
references them; it does not duplicate the grammars.

---

## 5. `extends:` stacking and conflict resolution

The chain (default → compliance → org → team → project) is resolved by ADR-008
§5 unchanged: a profile names at most one `extends:` parent; the resolved chain
is linear; the **effective profile** is the per-field merge of all tiers.

### 5.1 Merge rules (ADR-008 §5, restated for the typed model)

| Field category                                                                                 | Rule                                                                                                                      |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| List-additive (`attributes`, `labels`, `types`, `traceability` entries)                        | Union across tiers. Same-named declarations must be _compatible_ (§5.3).                                                  |
| Constraint fields (`cardinality`, `enum` values, `required`, `display-id-pattern-enforcement`) | Child may tighten; child may not relax. Relaxation is `PROFILE-MERGE-010` (error) at profile load.                        |
| `traceability.target` matchers                                                                 | Child's target set must be a subset of the parent's. Introducing a target outside the parent's set is a relaxation error. |

Scope precedence within one tier is unchanged (ADR-008 §5):
`profile.* (universal) ⊂ inherited core/profile type ⊂ profile.types.<name>.*`.

### 5.2 Attribute-name collision policy (resolves core-data-model §6 OpenQ5)

core-data-model §6 Open Question 5 — "are profile attribute names namespaced by
their declaring profile, or is the trailer-key space global?" — is **resolved
here: the trailer-key namespace is flat and global.**

- Trailers are git-trailers (core-data-model §2.3 / ADR-002 §Part 1).
  git-trailer keys are a single flat namespace by construction; per-profile
  prefixing (`aspice:ASIL`) would break `git interpret-trailers`, grep-ability,
  and ADR-009 §6 "attribute spelling is stable across profiles".
- Therefore two tiers (or a profile type and a core type) declaring the **same
  attribute name** must declare it **compatibly** (§5.3). A compatible
  re-declaration merges (constraints take the tightest). An **incompatible**
  re-declaration is a profile-load error `PROFILE-MERGE-011` (new): _"attribute
  `X` redeclared with incompatible {type|cardinality-family|inverse}"_.
- A profile attribute name equal to a **core-reserved** name (`Id`, the
  per-core- type attribute set of core-data-model §1.4–1.6, the 19 type names)
  is `MSL-A040` (core-data-model §4.4) — reserved, unshadowable, regardless of
  compatibility.

**Options analysis — collision policy.**

| Alternative                                             | Rejected because                                                                                                                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flat global namespace, compatible-or-error (**chosen**) | Matches git-trailer reality and ADR-009 §6; ADR-008 §5 already says "same-named attribute in multiple tiers requires compatible definitions" — this names the failure code. |
| Per-profile namespacing (`profile:Attr`)                | Breaks git-trailer tooling and the stable-spelling contract; authors would write profile-qualified keys in source, defeating the plain-text-in-Git goal.                    |
| Per-type namespacing only                               | Two profile types under different parents could still both reach the same entry via inheritance; the collision resurfaces at the entry. Doesn't actually scope.             |
| Last-tier-wins                                          | The exact "not last one wins" failure the Prompt-2 context calls out; silently drops a parent's stricter definition — a compliance-audit hole.                              |

### 5.3 The four stacking cases (Prompt 2 A, cases a–d)

Resolved by applying §5.1 + §5.2:

**(a) Same type name, different abstract parent.** Two tiers declare
`type: audit-record`, one `extends: Record`, one `extends: Risk`. The abstract
ancestors differ (`Specification` either way here, but consider
`extends: Record` vs `extends: Component`). This is a **structural
incompatibility**, not a tighten — there is no single parent. Error
`PROFILE-MERGE-012` (new): _"type `T` redeclared with conflicting `extends:`
(`P1` vs `P2`)"_. Resolution requires the child profile to pick one parent
explicitly; the chain does not guess.

**(b) Same type name, additive attribute sets.** Two tiers declare
`type: requirement-x` with disjoint `attributes:`. Merge = union (§5.1
list-additive). Both attribute sets apply. No diagnostic. Same-named attributes
within the union follow §5.2.

**(c) Same type name, conflicting `required:` sets.** Tier-1 marks attribute `A`
required on `T`; tier-2 (child) does not mention `A`. `required` is a constraint
field and **monotone-tightening**: the union of required sets applies (`A` stays
required). A child can _add_ to `required:`; it cannot drop a parent's required
attribute (that is relaxation → `PROFILE-MERGE-010`). "Conflicting" required
sets therefore _don't_ conflict — they accumulate. The only error case is a
child attempting to _un-require_ (e.g. declaring `A` with an explicitly wider
cardinality), which §5.1 already rejects.

**(d) Same `display-id-pattern`, different concrete types.** Tier-1
`requirement` and tier-2 `safety-requirement` both compile to a pattern matching
`SRS_*`. At parse time an `SRS_…` entry now matches two patterns. This is
**not** a profile-load error (the patterns are individually valid); it is a
_per-entry_ type-inference ambiguity, resolved by §6: tooling emits
`MSL-T021`/an ambiguity warning and the author disambiguates with an explicit
`Type:` (core-data-model §1.3.1 step 1 always wins; ADR-009 §5 "Ambiguity and
diagnostics"). A profile that wants the patterns mutually exclusive must make
them non-overlapping; the schema does not forbid overlap because legitimate
subtype refinement (`SRS_SAFETY_*` ⊂ `SRS_*`) needs it.

### 5.4 Generated inverses across the chain

Generated inverses (core-data-model §1.6 / ADR-003 §Part 3) are computed by the
compiler from the forward relation's `inverse:` declaration; they are never
authored and never merged as authored attributes. A child profile may add a
forward relation whose inverse name collides with an inherited inverse — that is
a §5.2 collision on the _generated_ key and is `PROFILE-MERGE-011` (the inverse
name participates in the same flat namespace).

---

## 6. Type-inference precedence (resolves core-data-model §6 OpenQ2)

core-data-model §1.3.1 fixes the 8-step resolution chain; §6 Open Question 2
asks how profile step 2 (`display-id-pattern`) races profile/core step 5 (URI
scheme map) and whether the answer is profile-author-controllable. **Resolved
here:**

1. **Step 2 is Authored-only.** A `display-id-pattern` compiles to a recognizer
   over the _display ID_ of an **Authored** entry (ULID `Id:`). A Reference
   entry's display ID is a slug (core-data-model §1.7) and does **not** feed
   step 2. Step 5 (URI scheme map) applies **only** to Reference entries. The
   two steps are shape-disjoint and never race for the same entry — closing the
   first half of OpenQ2.
2. **Profile URI-scheme mappings beat the core map, for covered prefixes only.**
   A profile may declare additional scheme→type mappings (ADR-003 §Part 6
   "Profile extension"). For a given Reference `Id:`, the **longest matching
   declared prefix wins**; profile-declared prefixes take precedence over the
   core map (ADR-003 §Part 6) _only for the prefixes they cover_; the core map
   (ADR-003 §Part 6 "Core scheme map") is the universal fallback. Two profile
   tiers mapping the same prefix to different types is a §5.2-class incompatible
   redeclaration → `PROFILE-MERGE-013` (new).
3. **Explicit `Type:` always wins** (core-data-model §1.3.1 step 1). This is the
   profile-author- and entry-author-controllable escape hatch OpenQ2 asks for:
   when a profile _also_ declares a Reference-shape type with a
   `display-id-pattern` (a slug-shaped pattern), and that races the URI scheme
   map, the entry **must** carry an explicit `Type:` or tooling emits `MSL-T021`
   (late-stage inference) and falls back to the URI scheme map result.

Profiles do not reorder the core chain; they only populate steps 2, 5, and 6
(document directives). The chain order itself is core-frozen (core-data-model
§1.3.1).

---

## 7. The default profile

> **Implementation status (2026-05-19):** §2.2 bundling + auto-registration
>
> - `default-profile: false` opt-out shipped (identity/minimal manifest). §7.1
>   pattern bindings, §7 RFC 2119 hygiene, and the glossary `{{def.}}` binding
>   remain deferred — blocked on a core-type-binding construct. CLI
>   `profile show`/`doctor` and the MCP `markspec://profile` resource headline
>   the leaf (user) profile; `profile show` additionally prints the full
>   root→leaf chain while the MCP resource lists strict ancestors under
>   **Inherits** — this presentation difference is intentional.

### 7.1 Contents — thin, by construction

Under the 15-type core taxonomy the default profile is **much smaller** than
ADR-010 §2 describes. The core already provides `Requirement`, `Test`,
`Contract`, `Record`, `Risk`, the Component/Unit families, and `Definition`
(core-data-model §1.3). The default profile therefore declares **no new concrete
types**. It contributes only _bindings and hygiene_ over the core taxonomy:

1. **Display-ID pattern bindings** for the five core Specification prefixes,
   `display-id-pattern-enforcement: warn` (opinion-light, ADR-010 §5):

   | Core type     | Pattern (suggested, not enforced) |
   | ------------- | --------------------------------- |
   | `Requirement` | `REQ-{n:03d}`                     |
   | `Test`        | `TST-{n:03d}`                     |
   | `Contract`    | `ICD-{n:03d}`                     |
   | `Record`      | `REC-{n:03d}`                     |
   | `Risk`        | `RSK-{n:03d}`                     |

   These are _bindings to core types_, not new types. They make the five
   core-reserved prefixes (core-data-model §1.7) mintable/recognized out of the
   box. Enforcement `warn` (not `error`) keeps the default opinion-light
   (ADR-010 §5).
2. **RFC 2119 / RFC 8174 hygiene** on `Requirement` (ADR-010 §3): an
   **informational** diagnostic (`MSL-M061`, core-data-model §4.6) when a
   `Requirement` entry's body carries no uppercase RFC 2119 keyword.
   Recommended, not enforced; overridable by `normative-language: none` (ADR-010
   §3, §7).
3. **Glossary `term` convenience.** ADR-010's `term` type maps to the core
   `Definition` type (core-data-model §1.3 / ADR-003 §Part 2 "Definition"). The
   default profile binds a free-form-slug display-ID rule
   (`display-id-pattern-enforcement: off`) to `Definition` and declares the
   `{{def.<slug>}}` prose-resolution convenience (ADR-010 §6). See
   [markspec-listing-directives.md §4](markspec-listing-directives.md) for the
   glossary heading-shape grammar that produces `Definition` items.
4. **Hygiene-rule restatement.** ADR-010 §4's eight hygiene rules are restated
   at the profile layer for user-facing diagnostic messages. The first five
   (unique `Id:`, unique display ID, references resolve, well-formed URI for
   Reference, well-formed ULID for Authored) are core hygiene (core-data-model
   §4.1–4.8) surfaced with explanatory text — _named, not re-enforced_ (ADR-010
   §4).
5. **Optional front-matter keys** `normative-language` and `glossary-scope`
   (ADR-010 §7) — unchanged, neither required.

### 7.2 What ADR-010's four types become

| ADR-010 §2 type | Disposition under the 15-type core                                                                                                                                                                                                                                                           |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `requirement`   | **Collapses into** core `Requirement` (core-data-model §1.3). The default profile binds the `REQ-` pattern + RFC 2119 hygiene to it. No new type.                                                                                                                                            |
| `term`          | **Maps to** core `Definition` (ADR-003 §Part 2). The default profile binds slug display-IDs + `{{def.}}` resolution. No new type.                                                                                                                                                            |
| `reference`     | **Subsumed by** the Reference _shape_ + the type the `Id:` URI scheme infers (core-data-model §1.5, §1.3.1 step 5). Not a type at all under the orthogonal model.                                                                                                                            |
| `note`          | **Dropped from the default baseline.** An informational callout that backs no Item is the "Informative entries" item ADR-003 §Open-questions defers. Until that ADR lands, `note` is not a default-profile type; authors needing a stable-ID callout use core `Record` or a project profile. |

### 7.3 Rationale and options analysis

| Decision                                            | Alternative                                                    | Why rejected                                                                                                                                                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Thin default — bindings + hygiene only (**chosen**) | Re-declare ADR-010's 4 types as profile subtypes of core types | `requirement extends Requirement` is a no-op rename; `reference` cannot be a type (it is a shape). Re-declaration adds a vocabulary the core already owns and re-introduces the 15-vs-4 contradiction §1 resolves. |
| Thin default                                        | Empty default profile (core taxonomy alone)                    | Loses the out-of-box display-ID patterns + RFC 2119 hygiene ADR-010 §Context justifies as the tech-writer first-run experience. The default profile earns its keep purely as bindings.                             |
| `note` dropped                                      | Keep `note` as a default `extends: Record`                     | A Record is a _logged decision/event with rationale_ (ADR-003 §Part 2) — semantically wrong for a generic callout. Forcing it distorts the taxonomy; deferral (ADR-003 open questions) is honest.                  |

---

## 8. Versioning, compatibility, and schema pinning

### 8.1 Profile version

A profile carries `version: <semver>` (ADR-008 §4). Consumers pin via the
`.markspec.yaml` specifier range (npm `@^1.2`, git `#<tag>`, local pin recorded
on `profile add`) — ADR-008 §2/§3 unchanged. `extends:` targets are range-pinned
identically (ADR-008 §5).

### 8.2 Core schema pin (`markspec-schema:`)

A profile written against this spec depends on a specific **core data-model
contract surface** — the type vocabulary (core-data-model §1.3), attribute
catalogue (§1.4–1.6), value types (§1.8), and lint codes (§4). A profile
declares the core schema it targets with a new manifest field:

```yaml
markspec-schema: "1"          # major contract version of core-data-model.md
```

- `markspec-schema:` is a single integer naming the **major** version of the
  core data-model contract. The Prompt-1 frozen model (core-data-model.md,
  Status: Draft) is core schema **`1`**. Subsequent breaking changes to the core
  type vocabulary, reserved names, or lint-code semantics bump it.
- The MarkSpec binary advertises the core schema version(s) it implements.
  Loading a profile whose `markspec-schema:` the binary does not implement is a
  profile-load error `PROFILE-SCHEMA-001` (new): _"profile targets core schema
  N; this MarkSpec implements {…}"_.
- Absent `markspec-schema:` → assumed `1` with a `warning`
  (`PROFILE-SCHEMA-002`, new) recommending an explicit pin. (Warning, not error,
  so pre-existing ADR-008 manifests still load.)
- The core schema version is **independent** of the binary's release version and
  of any profile's `version:`. A profile may track core schema `1` across many
  of its own releases.

### 8.3 Options analysis — schema pinning

| Decision                             | Alternative                                                | Why rejected                                                                                                                                                                                                                          |
| ------------------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dedicated integer `markspec-schema:` | Pin via `extends:` to a versioned bundled default profile  | Couples schema compatibility to the default profile's release cadence; a compliance profile that opts out of the default (`default-profile: false`) would have nothing to pin against.                                                |
| Dedicated `markspec-schema:`         | An `engines`-style semver range against the binary version | The binary version and the data-model contract version move independently (a binary patch release does not change the model). Pinning to the contract, not the tool, is what compliance review needs.                                 |
| Integer major only                   | Full semver `markspec-schema: "1.2.0"`                     | The core contract surface is frozen per-prompt and changes only at major boundaries (core-data-model §3.1 determinism contract / §5 round-trip invariants). Minor/patch granularity implies a cadence the frozen model does not have. |

---

## 9. Worked examples

### 9.1 Minimal ASPICE profile (stacked on default)

`@markspec/profile-aspice-4/markspec.yaml`:

```yaml
id: "@markspec/profile-aspice-4"
version: 0.1.0
description: Minimal ASPICE 4.0 software-engineering profile
license: MIT
extends: "npm:@markspec/profile-default@^1"
markspec-schema: "1"

profile:
  labels: [ASIL-A, ASIL-B, ASIL-C, ASIL-D, QM]

  types:
    stakeholder-requirement:
      extends: Requirement
      display-id-pattern: "STK_{scope}_{n:04d}"
      display-id-pattern-enforcement: error

    system-requirement:
      extends: Requirement
      display-id-pattern: "SYS_{scope}_{n:04d}"
      display-id-pattern-enforcement: error
      required: [Derived-from]
      traceability:
        Derived-from:
          target: [stakeholder-requirement]
          cardinality: 1..N
          required: true

    software-requirement:
      extends: Requirement
      display-id-pattern: "SRS_{scope}_{n:04d}"
      display-id-pattern-enforcement: error
      traceability:
        Derived-from:
          target: [system-requirement]
          cardinality: 1..N
          required: true

    software-unit-test:
      extends: Test
      display-id-pattern: "SWT_{scope}_{n:04d}"
      traceability:
        Verifies:
          target: [software-requirement]
          cardinality: 1..N
          required: true
```

Notes:

- Each type `extends:` a core concrete type (§3.1). No `shape:` (§1.3).
- `Derived-from` / `Verifies` are **core** Specification/Test attributes
  (core-data-model §1.6); the profile only tightens their `target` /
  `cardinality` / `required` (§4.1, §5.1). It declares no new attribute names.
- Stacked on the default (§7): the default's `REQ-`/`TST-` _warn_ bindings are
  inherited; ASPICE's typed patterns are stricter (`error`) — a legal tighten
  (§5.1).

### 9.2 Minimal ISO 26262 profile (stacked on default)

`@markspec/profile-iso-26262/markspec.yaml`:

```yaml
id: "@markspec/profile-iso-26262"
version: 0.1.0
description: Minimal ISO 26262 functional-safety profile
license: MIT
extends: "npm:@markspec/profile-default@^1"
markspec-schema: "1"

profile:
  attributes:
    - name: ASIL
      type: enum
      values: [A, B, C, D, QM]

  types:
    hazard:
      extends: Risk
      display-id-pattern: "HAZ_{scope}_{n:04d}"
      display-id-pattern-enforcement: error
      required: [ASIL]
      attributes:
        - name: ASIL
          type: enum
          values: [A, B, C, D]        # tightened: QM not valid for a hazard
      traceability:
        Mitigated-by:
          target: [safety-requirement]
          cardinality: 1..N
          required: true

    safety-requirement:
      extends: software-requirement   # extends an ASPICE *profile* type …
      display-id-pattern: "SAF_{scope}_{n:04d}"
      required: [ASIL]
```

Notes:

- `hazard extends Risk` (core), inheriting `Caused-by` / `Mitigated-by`
  (core-data-model §1.6 / ADR-003 §Part 2 "Risk"); the profile only adds the
  `ASIL` attribute and tightens trace rules.
- `ASIL` is declared at universal scope (`enum [A,B,C,D,QM]`) and **tightened**
  on `hazard` to `[A,B,C,D]` (§4.1 inherited-tighten; §5.1 constraint-narrow).
  The two declarations share a name and are _compatible_ (§5.2) — same value
  type, narrowed values.
- `safety-requirement extends software-requirement` demonstrates a profile type
  extending another profile type **in the same effective chain** (R3.1-b) — only
  valid when the ASPICE profile is also in the chain. If ISO 26262 is loaded
  without ASPICE, `extends: software-requirement` is unresolved
  (`PROFILE-TYPE-002`). A standalone ISO 26262 profile would instead
  `extends: Requirement`.
- Stacking order in `.markspec.yaml`: a project combining both publishes a
  pre-merged profile (ADR-008 §3 "Projects wanting to combine two domain
  standards … publish a pre-merged profile") — the consumer does not list ASPICE
  and ISO 26262 as two independent content chains.

---

## 10. Open questions

Capped at five (Prompt-2 constraint).

1. **`note` / informative entries.** §7.2 drops `note` pending ADR-003's
   deferred "Informative entries" decision. Until that ADR lands, projects
   needing a stable-ID non-Item callout have no default-profile vehicle. Should
   the default profile ship a provisional `note` binding (to what core type?),
   or is the deferral acceptable for Stage 1?
2. **Pre-merged combined profiles.** ADR-008 §3 mandates a _pre-merged_ profile
   for ASPICE + ISO 26262 rather than two consumer chains. This spec specifies
   the merge algebra (§5) but not a `markspec profile merge` authoring command.
   Is producing the pre-merged artifact a manual authoring task, or does it need
   tooling (Prompt 3 territory)?
3. **`id-schemes:` enforcement strength.** §4.5 makes `id-schemes:` advisory
   (warning). A compliance profile may want a Reference `dependency` whose `Id:`
   is _not_ a `pkg:` URL to be a hard error. Is per-scheme enforcement mode
   (`off`/`warn`/`error`, mirroring display-ID enforcement) worth the schema
   surface, or does the profile express this via an ordinary validation rule?
4. **Core schema version cadence.** §8.2 defines `markspec-schema:` as an
   integer major. The trigger for a bump (any reserved-name change? any new lint
   code? only round-trip-invariant changes?) is not enumerated. Who owns the
   core schema version registry and its change policy — this spec, an ADR, or
   Prompt 3's toolchain spec?
5. **Profile-declared body-block _constraints_ vs the closed catalogue.** §4.4
   lets a profile `require:`/`forbid:` core block types but not add new ones.
   Some domains (e.g. a formal-methods profile wanting a `tla` block) will want
   a new block. Is the closed catalogue (core-data-model §2.4 / §5.4) a hard
   ADR-amendment boundary forever, or should a future profile-extension ADR
   carve a controlled block-extension point?

---

## Annex A — Cross-reference summary

| Section here                      | Source                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| §0 Terminology                    | core-data-model §0; ADR-008 §1/§4                                                         |
| §1 Reconciliation stance          | core-data-model §1.3 reconciliation note; nextgen/README §Spec authority; ADR-003 §Part 1 |
| §2 Manifest format / discovery    | ADR-008 §1–§4; ADR-010 §1; ADR-009 §10                                                    |
| §3 `extends:` inheritance         | ADR-003 §Part 7; ADR-004 §Part 2; core-data-model §1.3/§1.6                               |
| §4 Per-type declarations          | ADR-008 §4/§6/§7; ADR-003 §Part 2/§Part 7; core-data-model §1.6/§2.4/§4.10                |
| §5 Stacking & conflict resolution | ADR-008 §5/§7; core-data-model §6 OpenQ5; ADR-009 §6/§profile-extension                   |
| §6 Type-inference precedence      | core-data-model §1.3.1 / §6 OpenQ2; ADR-003 §Part 5/§Part 6; ADR-009 §5                   |
| §7 Default profile                | ADR-010 §2–§7; core-data-model §1.3; ADR-003 §Part 2/§Open-questions                      |
| §8 Versioning & schema pin        | ADR-008 §2/§4/§5; core-data-model §3.1/§5                                                 |
| §9 Worked examples                | ADR-008 §3/§5; ADR-003 §Part 2/§Part 7; core-data-model §1.6                              |
| §5/§6 listing cross-refs          | [markspec-listing-directives.md](markspec-listing-directives.md) §4/§5                    |

---

## Annex B — Changes from ADR-008 §4/§6 and ADR-010 §2

This spec supersedes the following, per §1 (authoritative for `main` after the
refactor lands):

| Superseded                                                                                          | Replaced by                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-008 §4 per-type `shape: identified\|referenced` key                                             | Per-type `extends: <type>` (§3.1). Shape is an `Id:`-format decision, orthogonal to type (core-data-model §1.1).                                                                                                            |
| ADR-008 §4 per-shape scopes `profile.identified:` / `profile.referenced:`                           | Removed (§2.1). Shape is not a profile scope. Universal + per-type scopes remain.                                                                                                                                           |
| ADR-008 §4 universal `profile.required:` list                                                       | Removed (§4.2). Use `required: true` on the universal `attributes:` entry.                                                                                                                                                  |
| ADR-008 §6 "types declared ⇒ every entry must carry a `type:`" enforcement framing                  | Type is now _always_ resolvable via the core chain (core-data-model §1.3.1 — never errors). Profiles tighten via `display-id-pattern-enforcement` and explicit-`Type:` rules (§6), not a global "must declare type" switch. |
| ADR-010 §2 four default types (`requirement`/`note`/`term`/`reference`)                             | §7.2: `requirement`→core `Requirement`; `term`→core `Definition`; `reference`→Reference shape; `note` dropped (deferred). Default profile declares no new concrete types.                                                   |
| ADR-010 §2 "Profiles may extend the type catalog but may not shadow these names" (applied to the 4) | Generalized to the 19 core-reserved names (core-data-model §4.4 `MSL-A040`); the default profile adds none.                                                                                                                 |

ADR-008 §§1–3, §5, §7, §9, §10 and ADR-009 in full are **unchanged** and remain
authoritative for distribution, the `extends:` chain algorithm, traceability
rule shape, the CLI surface, and the core/profile boundary principle.
