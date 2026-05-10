# ADR-010: Default Profile — RFC 2119 Hygiene and Generic Types

## Context

ADR-009 moves the four-family taxonomy out of the core into the profile layer
and reduces the core to two semantics-free shapes (identified, referenced). The
core itself enforces only hygiene (unique `Id:` values, resolvable
cross-references, well-formed value shapes); it carries no type vocabulary.

A core-only MarkSpec is usable — a tech-writing persona can author Markdown, get
stable IDs, render PDF/book/deck — but the experience is under-powered for the
authors MarkSpec was first built to serve. Spec authors expect to write numbered
requirements, cite external standards, define glossary terms, and have the tool
notice the difference. Loading a full ASPICE or ISO 26262 profile to get that
baseline is a disproportionate first-run cost.

This ADR specifies the **default profile**: a small, opinion-light profile that
ships bundled with MarkSpec, loads by default, provides a generic type
vocabulary grounded in community standards rather than any compliance framework,
and gets out of the way when a compliance profile is loaded on top.

The default profile's reference point is **RFC 2119 / BCP 14** — the
MUST/SHALL/SHOULD/MAY vocabulary used by every IETF, W3C, and OASIS
specification. It is the closest thing the general tech-writing world has to a
universal normative-language standard, it is compact, it is compliance-neutral,
and most authors recognize it.

## Decision

### 1. The default profile is a profile

The default profile is an ordinary profile (per ADR-008): a `markspec.yaml`
manifest plus optional hooks, distributable via the same mechanisms. It happens
to be bundled with the MarkSpec binary rather than fetched, and it loads
automatically unless the consumer opts out.

**Bundling.** The default profile ships as a bundled package inside the MarkSpec
binary (e.g., `packages/markspec-profile-default/markspec.yaml`). On startup it
is registered in the loader as if the consumer had declared it at the bottom of
their `profiles:` chain.

**Opt-out.** A consumer may disable the default profile by setting
`default-profile: false` in `.markspec.yaml`:

```yaml
default-profile: false
profiles:
  - npm:@markspec/profile-aspice-4@^1.2
```

Opting out yields core-only mode plus whatever compliance profiles are declared.
Opting out is appropriate when a compliance profile supplies its own baseline
types (most do); the default profile exists for users who do not load a
compliance profile.

**Compatibility with compliance profiles.** When a compliance profile is
declared, it normally extends the default profile via ADR-008 `extends:`.
Compliance profiles that already cover the generic vocabulary may shadow or
replace the default profile's types; the `extends:` merge rules (additive for
vocabulary, tightening for constraints, see ADR-008 §5) apply.

### 2. Type vocabulary — minimal and generic

The default profile declares four types across the two core shapes. The
vocabulary covers what every structured technical document needs and nothing
more.

**Identified entries:**

| Type          | Purpose                                       | Typical authoring pattern                              |
| ------------- | --------------------------------------------- | ------------------------------------------------------ |
| `requirement` | A normative statement using RFC 2119 keywords | "The system MUST …" / "The agent SHALL …"              |
| `note`        | Informational callout that needs a stable ID  | Warnings, rationales, implementation notes             |
| `term`        | Glossary term definition                      | A term and its definition, cross-referenced from prose |

**Referenced entries:**

| Type        | Purpose                                        | Typical identity             |
| ----------- | ---------------------------------------------- | ---------------------------- |
| `reference` | External citation (standard, paper, RFC, book) | URN / DOI / HTTPS URL / ISBN |

The `type:` attribute value is `requirement`, `note`, `term`, or `reference`.
Profiles may extend the type catalog but may not shadow these names.

**Intentionally excluded from the default profile:**

- Test, element, dependency, SOUP, risk, hazard — all compliance-flavored; they
  belong in compliance profiles, not the default baseline.
- Section, subsection, appendix — Markdown headings already carry structure;
  promoting them to typed entries is duplication.
- Title, description, author — document-level metadata covered by front matter
  (ADR-007).

### 3. Normative language — RFC 2119 / BCP 14

The default profile names RFC 2119 / BCP 14 as the recommended normative
vocabulary for `requirement` entries. It is a recommendation, not an
enforcement:

```yaml
profile:
  types:
    requirement:
      normative-language: rfc2119
```

The `normative-language:` hint is carried by the profile and available to
tooling. The default profile's linter raises an **informational** diagnostic
(not a warning, not an error) when a `requirement` entry's body contains no RFC
2119 keyword. Authors override the convention by setting
`normative-language: none` on the type in their own profile, or by ignoring the
diagnostic.

The canonical keywords (per RFC 2119 and RFC 8174 clarification):

```text
MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT,
SHOULD, SHOULD NOT, RECOMMENDED, NOT RECOMMENDED,
MAY, OPTIONAL
```

Case sensitivity follows RFC 8174: uppercase is normative, lowercase is not.
Tooling recognizes both but only uppercase triggers the informational diagnostic
as "present".

### 4. Hygiene rules

The default profile ships the universal rules that any structured document set
benefits from, regardless of domain:

| Rule                                             | Scope                  | Severity |
| ------------------------------------------------ | ---------------------- | -------- |
| Unique identity values                           | All entries            | error    |
| Unique display IDs                               | All entries            | error    |
| All cross-references resolve                     | All typed edges        | error    |
| Referenced-entry `Id:` is a scheme-qualified URI | Referenced entries     | error    |
| Identified-entry `Id:` is a well-formed ULID     | Identified entries     | error    |
| `requirement` body contains an RFC 2119 keyword  | `type: requirement`    | info     |
| `term` entries referenced from prose are defined | Prose mentions         | warning  |
| Display ID matches type's declared pattern       | Entries with a `type:` | warning  |

The first five are core hygiene restated at the profile layer so the default
profile can surface them as user-facing diagnostics with explanatory messages.
They are not duplicated enforcement — core enforces them structurally; the
default profile names them for the diagnostic surface.

### 5. Display-ID patterns — permissive by default

The default profile declares templates that are **recognized** but not
**enforced**. A display ID matching the template is understood; a display ID not
matching is accepted with a warning (not an error) because the default profile
is opinion-light:

```yaml
profile:
  types:
    requirement:
      display-id-pattern: "REQ-{n:03d}" # suggested, not enforced
      display-id-pattern-enforcement: warn
    note:
      display-id-pattern: "NOTE-{n:03d}"
      display-id-pattern-enforcement: warn
    term:
      display-id-pattern-enforcement: off # free-form slugs
    reference:
      display-id-pattern-enforcement: off # free-form slugs
```

Enforcement modes:

- `error` — non-matching display ID is a validation error. Compliance profiles
  typically pick this.
- `warn` — non-matching display ID raises a warning; the entry still validates.
  The default profile picks this for typed identified entries.
- `off` — no check; any valid core display ID is accepted. The default profile
  picks this for slug-based referenced entries and for glossary terms.

The pattern template grammar is defined in ADR-009 §5 (literal prefix + `{n}`
placeholder with optional padding).

### 6. Glossary support

`term` entries form a lightweight glossary. The default profile declares:

- `type: term` entries have a free-form slug display ID and no required external
  `Id:` (they are identified entries with a ULID).
- A prose mention of a term (via `{{term.<slug>}}` inline reference or a
  `[[term-slug]]` wiki-link, subject to ADR-001 reference syntax) resolves to
  the defining entry.
- A prose mention of a term not defined anywhere raises a warning.

Glossary entries do not carry compliance attributes. Profiles that need a richer
glossary model (acronyms, cross-lingual terms, see-also relationships) extend
`term` or replace it.

### 7. Front-matter additions

The default profile does not add required front-matter keys. It declares two
optional keys for consumer convenience:

```yaml
profile:
  documents:
    frontMatter:
      - name: normative-language
        type: enum
        values: [rfc2119, none]
        description: |
          Overrides the default RFC 2119 normative-language hint for all
          requirement entries in this document.
      - name: glossary-scope
        type: enum
        values: [local, project]
        description: |
          Whether term entries defined in this document scope to the
          document only or to the whole project.
```

Neither is required. Both are absent from documents by default.

### 8. No hooks

The default profile is pure declarative YAML. It ships no `hooks/` directory.
Profile hooks (when specified by the future ADR-012) remain an extension point
available to other profiles, not a mechanism the default uses.

## Consequences

### What this ADR enables

- MarkSpec ships with a usable out-of-box experience for a tech-writer persona
  without dragging in compliance vocabulary.
- A single, well-known reference point (RFC 2119 / BCP 14) anchors the default's
  normative semantics. Authors across industries recognize it.
- Compliance profiles stack cleanly on top via `extends:`, treating the default
  as the generic baseline they tighten.
- The opt-out mechanism keeps core-only mode reachable for users who want it.

### What shifts for existing assumptions

- The current core-attribute catalog — with family-specific attributes — loses
  its family-specific members to the compliance-profile layer and retains only
  the universal subset. The default profile picks up the generic types
  (`requirement`, `note`, `term`, `reference`) but does not introduce compliance
  vocabulary (`Derived-from`, `Verifies`, `Allocated-to`, etc.), which move to
  compliance profiles.
- Documents written under a compliance profile (ASPICE, ISO 26262, …) are
  unaffected — the compliance profile supplies its own richer types that extend
  or replace the defaults.
- Documents written without any profile (core-only mode) remain valid; they
  simply do not get type-level diagnostics.

## Dependencies

- ✅ [ADR-008 — Profile System](./adr-008-profile-system.md) — manifest format,
  distribution, extends-chain, CLI surface.
- ✅ [ADR-009 — Core / Profile Boundary](./adr-009-core-profile-boundary.md) —
  two-shape core, single `Id:` attribute, generic attribute machinery.
- 🔗 ADR-011 — Language Pack and Dependency Ingestion (follow-up): the default
  profile composes with the default language pack when source-code extraction is
  active.
- 🔗 ADR-012 — Profile Hooks (future): hook extension points; not used by the
  default profile.

## Acceptance criteria

- [ ] Default profile is bundled into the MarkSpec binary and loaded
      automatically.
- [ ] `default-profile: false` in `.markspec.yaml` disables it without error.
- [ ] Four types (`requirement`, `note`, `term`, `reference`) are declared with
      their specified shapes and display-ID rules.
- [ ] RFC 2119 / 8174 keyword detection runs on `type: requirement` entries and
      emits an informational diagnostic when none is present.
- [ ] The eight hygiene rules from §4 emit diagnostics with the specified
      severities and explanatory messages.
- [ ] Display-ID pattern enforcement honors the three-mode configuration
      (`error`, `warn`, `off`).
- [ ] `term` cross-resolution works via `{{term.<slug>}}` inline references.
- [ ] A compliance profile extending the default via `extends:` merges correctly
      per ADR-008 §5 merge rules.

## Out of scope (future work)

- **Domain-specific default types** — test, element, dependency. These belong in
  compliance profiles, not the generic default.
- **Rich glossary semantics** — acronym expansion, see-also relationships,
  cross-lingual variants. Profile extensions or a dedicated glossary profile.
- **Natural-language heuristics beyond RFC 2119** — tone, voice, readability
  scoring. Not a core or default-profile concern.
- **Default-profile localization** — diagnostic messages and RFC 2119
  equivalents in other languages. Deferred until an internationalization story
  is scoped for MarkSpec as a whole.
