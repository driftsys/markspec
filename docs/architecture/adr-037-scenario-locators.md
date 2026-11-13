# ADR-037 — Scenario locators and criterion-level coverage

Status: Accepted, implemented (epic #915, scenario-locator slice)\
Amends: [ADR-026](adr-026-display-id-trace-resolution.md) (the `[[edge]]` ledger
gains an optional `locator` key; see the amendment there)\
Related: [ADR-022](adr-022-lockfile-and-external-sync.md),
[ADR-009](adr-009-core-profile-boundary.md),
[ADR-012](adr-012-diagnostic-code-scheme.md), #915, #924

## Context

A test can verify one acceptance scenario of a requirement, not the whole
requirement. Before this slice a trace value was a target ID with optional free
text after it, and the compiler, validator, formatter and lockfile each split
values their own way. A locator such as `[Brake at 20 m]` therefore had no
defined meaning, a comma inside it split the value, and a `Satisfies` locator
leaked words into the lockfile `authored-target`.

The epic needs the compiled graph to keep which scenario a link addresses and
the coverage report to count scenarios. The full Gherkin model (AST, steps,
procedures, `.feature` entries) is a later slice, so this slice must work with a
small scenario index and leave room for it.

## Options considered

1. **Source of criteria.** (a) A minimal line scanner over fenced `gherkin` and
   `feature` blocks that collects scenario names. (b) Pull the
   `@cucumber/gherkin` AST forward into this slice. (c) Keep locators as free
   text until the AST slice.
2. **Where criteria live.** (a) `Entry.criteria` on the entry. (b) A private
   index inside the compiler.
3. **Which entries get criteria.** (a) Entries whose core ancestor is
   Requirement or Contract. (b) Every entry that has a block.
4. **Which relations accept a locator, and who declares it.** (a) A core-only
   `locator` facet on `RelationDef`. (b) A locator mode on profile-declared
   relations.
5. **Diagnostics for a criterion with no verifier.** (a) Report only. (b) A
   warning in `markspec check`.
6. **Lockfile.** (a) An optional `locator` key on `[[edge]]` now. (b) Defer the
   field.
7. **Report shape.** (a) A `criteria` section inside the existing `coverage`
   report. (b) A new report kind.

## Decision

1. **Locator grammar.** A value is a target, optionally followed by whitespace
   and a bracketed locator. `\]` and `\\` escape inside the locator only.
   Brackets do not nest. A comma inside a locator does not split the value. The
   shared splitter in `core/refs/split.ts` is used by the compiler, the
   validator, the formatter, the attribute parser, the lockfile resolver and the
   LSP reference scans. Four scanners keep their own copy of the grammar: the
   `core/refs` rename-heal token regex, the LSP rename span regex, the
   `MSL-A011` bracket-depth check in `core/validator/mod.ts`, and the `MSL-A011`
   quick fix in `lsp/code_actions.ts` (which opens a locator on any `[`); the
   lockfile resolver keeps its whitespace split for parts without a locator. An
   unclosed `[` never protects commas: `A [x], B [z, C` gives `A [x]`, `B [z`
   and `C`. A locator is normalized for comparison (Unicode NFC, trim, collapse
   whitespace runs) and compared exactly and case-sensitively. An empty locator
   (`A []`) is a locator with an empty name and names no scenario. A value
   without a closed locator after whitespace is read exactly as before locators
   existed, for every relation: `Derived-from` and `References` keep the leading
   token, every other relation keeps the whole value, and when no value on the
   line has a closed locator the line splits on every comma. A value with an
   unclosed `[` after whitespace has no locator; `MSL-L009` reports it. An ID
   inside a locator is not a reference: rename-heal, LSP rename, find
   references, the incoming count and code lenses skip it.
2. **Locator modes.** `RelationDef.locator` is `criterion` for `Satisfies` and
   `Verifies`, `free` for `References` and `Derived-from`, and absent for every
   other relation. The facet is core-only (option 4a): profiles cannot declare a
   locator mode, which keeps the core/profile boundary of ADR-009 intact. A
   locator on a relation without the facet raises `MSL-L008` and the link is
   kept.
3. **A locator never changes the link.** `Link.to` is the target only. The
   compiled `Link` gains `locator` (normalized, absent when none) and, for
   `criterion` mode on a Requirement or Contract target, `locatorResolved`. The
   target may be a display ID or a ULID. Generated inverse links copy both
   fields; two locators from one source give two inverse links.
4. **Criteria storage.** `Entry.criteria` holds
   `{ form: "scenario", name,
   addressable, location }` records. Only entries
   whose resolved core ancestor is Requirement or Contract get them; others keep
   none. Upstream (federated) entries get none, and the validator raises no
   `MSL-L007` for a locator on an upstream target. Only top-level fenced blocks
   are scanned; a fence nested in a list item or block quote is not. There is no
   `CORE_SCHEMA_VERSION` bump. The scanner (`core/criteria/scenarios.ts`) reads
   `Scenario:`, `Scenario Outline:`, `Scenario Template:` and `Example:` lines,
   English keywords only, and ignores lines inside doc strings and non-feature
   fences. The later Gherkin AST slice reads criteria from the AST and keeps
   this scanner as the fallback (see the amendment below). A scenario is
   addressable when its name is not empty and occurs once in the entry.
5. **Diagnostics** extend existing families (the current `language.md` code
   scheme stays authoritative, per ADR-012):

   | Code       | Severity | Meaning                                                     |
   | ---------- | -------- | ----------------------------------------------------------- |
   | `MSL-L007` | warning  | Locator names no addressable criterion of a resolved target |
   | `MSL-L008` | warning  | Relation does not accept a locator                          |
   | `MSL-L009` | warning  | Value has a `[` after whitespace that no `]` closes         |
   | `MSL-B060` | warning  | Duplicate normalized scenario name in one entry             |
   | `MSL-B061` | info     | Scenario with an empty name                                 |

   `MSL-L006` checks the target only. A locator on an unresolved target raises
   `MSL-L006` and never `MSL-L007`. A locator on a Reference entry, or on a
   target that is not a Requirement or Contract, is free text. "Criterion with
   no verifier" gets no diagnostic (option 5a).
6. **Lockfile.** `LockEdge` gains an optional `locator`, written as a `locator`
   key on `[[edge]]` only when the value has one. Edges sort by
   `(sourceUlid, relation, authoredTarget, locator, targetUlid)`, a missing
   locator sorting as the empty string. The edges hash covers the locator, so it
   changes for projects that write a closed bracket after a trace target: a
   scenario locator, and also an existing `References: X [§4.3]` value, which
   was two quads and is now one quad with a locator. Projects without such
   values keep their hash.
7. **Coverage.** `markspec report coverage` adds a `criteria` section in `md`
   and `json` (in `csv`, only `Criteria total` and `Criteria verified` rows),
   emitted only when a reported entry has criteria. Entry-level output is
   unchanged for projects without feature blocks. Per entry the state is `full`,
   `partial` or `none`. Only `Verifies` counts, and only when the verifier's
   type is, or extends, the core `Test` type (with the active profile's extends
   chain); an entry never verifies itself. Upstream entries are not reported and
   do not count in the totals. A whole-entry `Verifies` covers every scenario; a
   locator covers the scenario it names when it resolves to an addressable
   scenario; an unresolved locator covers nothing; a non-addressable scenario is
   covered only by a whole-entry `Verifies`. A `Satisfies` locator has no effect
   on coverage.

### Alternatives considered

- **Pull the Gherkin AST forward (1b).** Rejected for this slice: it adds a
  dependency and a parse model before the locator contract is proven. The
  scanner is small and the `Entry.criteria` record is the stable seam.
- **Locators as free text (1c).** Rejected: unresolved locators would never be
  detected and coverage could not be computed per scenario.
- **Private compiler index (2b).** Rejected: the reporter, LSP and JSON
  consumers need one shared record.
- **Criteria on every entry with a block (3b).** Rejected: a scenario block in a
  test or a free note is not an acceptance criterion of a requirement.
- **Locator mode on profile relations (4b).** Rejected for now: it would let
  profiles redefine a core grammar. It can be added without breaking this
  decision.
- **`MSL-T015` warning for a criterion with no verifier (5b).** Deferred: the
  strict versus lightweight profile flag is not designed, and a warning per
  criterion is noisy when a project adopts scenarios.
- **Defer the lockfile field (6b).** Rejected: without it a `Satisfies` locator
  would leak words into `authored-target`, and the edges hash would change later
  anyway.
- **A new `criteria` report kind (7b).** Rejected: a section in `coverage` keeps
  existing snapshots unchanged.

## Consequences

- One splitter defines how most surfaces read a trace value; a fix there applies
  to the validator, formatter, lockfile and compiler together. The rename
  regexes in `core/refs` and `lsp/rename.ts` must be kept in step with it.
- Compiled JSON, `fmt` output, the lockfile and the coverage report are
  unchanged for a project with no closed bracket locators and no feature blocks
  in Requirement or Contract entries. (Since the Gherkin AST slice, ADR-038, the
  `bodyTokens` and the `bodyAst` feature nodes, which now carry `feature` or
  `parseError`, also change in compiled JSON for a feature block in an entry of
  any type.)
- `Entry.criteria` and `Link.locatorResolved` are additive, so JSON consumers
  that ignore unknown keys keep working.
- Scenarios in non-English feature blocks yield no criteria until the AST slice,
  so a locator to them raises `MSL-L007`. (Superseded by the amendment below.)
- A project that adopts locators, or that already wrote `X [§4.3]` values, gets
  a new edges hash on its next `markspec lock`.

## Amendment 2026-11-14 — criteria come from the Gherkin AST

The Gherkin AST slice (epic #915) changed the source of criteria. The shape of
`Entry.criteria` and the rules for addressable scenarios are unchanged.

- When a feature block has a normalized AST (`FeatureNode.feature`), its
  scenarios give the criteria, in any language that Gherkin supports. A scenario
  in a block with `# language: fr` now gives a criterion, so a locator to it
  resolves.
- The line scanner described in Decision 4 is now the fallback. It runs for a
  block that does not parse (`FeatureNode.parseError`, reported as `MSL-B062`),
  and for a block built while the Gherkin parser is not loaded. It still reads
  English keywords only.
- `parseFile` loads the parser before it parses a text that holds a `gherkin` or
  `feature` fence, so every entry from the CLI, the validator and the LSP has
  either an AST or a `parseError`, unless the parser import failed. Code that
  builds entries with the synchronous `parse()` uses the AST when the parser is
  already loaded in the process, and the scanner otherwise.

The consequence above that says non-English scenarios yield no criteria no
longer holds for a block that parses.

## Trace

Satisfies: epic #915 decisions (scenario-locator slice); closes the locator half
of #924.\
Specified in: [Relations — Locators](../spec/model/relations.md#locators),
[lockfile specification](../spec/internal/markspec-lockfile.md).\
Documented in: [Scenario locators](../guide/scenario-locators.md),
[CLI reference — report](../guide/cli.md#report).\
Code: `packages/markspec/core/refs/split.ts`,
`packages/markspec/core/criteria/scenarios.ts`,
`packages/markspec/core/validator/locators.ts`,
`packages/markspec/core/reporter/mod.ts`.
