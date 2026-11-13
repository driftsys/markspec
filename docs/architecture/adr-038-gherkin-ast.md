# ADR-038 — Gherkin AST for feature blocks

Status: Accepted, implemented (epic #915, Gherkin AST, procedure-view and Case A
slices)\
Amends: [ADR-016](adr-016-body-token-ast.md) (token source for Gherkin tokens),
[ADR-015](adr-015-ast-equivalence-formatting-contract.md) (equivalence gate),
[ADR-037](adr-037-scenario-locators.md) (source of criteria)\
Related: [ADR-012](adr-012-diagnostic-code-scheme.md),
[ADR-030](adr-030-profile-delivered-documents.md), #915

## Context

Fenced `gherkin` and `feature` blocks were read by regular expressions (body
tokens) and by a line scanner (criteria). Both knew English keywords only, and
neither understood tags or `# language:` lines. The body-token regular
expressions also matched keywords inside doc strings; the scanner already
skipped doc strings (ADR-037 Decision 4). The epic needs a real Gherkin AST as
the base for later slices (procedure view, roles, `.feature` entries). The
parser must not slow down projects that have no Gherkin, and `parse()` must stay
synchronous.

## Options considered

1. **How the parser is loaded.**
   - (a) A cached `loadGherkin()` built on dynamic `import()`. `parseFile`
     awaits it only when the text holds a `gherkin` or `feature` fence.
   - (b) A static import in `core/gherkin/`. Rejected: every command (`check`,
     `lsp`, `mcp`) would load about 1.2 MB of extra JavaScript.
   - (c) An asynchronous post-pass that rewrites `bodyAst` and `bodyTokens`
     after the build. Rejected: it repeats the body-token walk and the source
     `LineMap` translation.
2. **Criteria for a block that does not parse.**
   - (a) Use the existing scanner for that block only.
   - (b) Give no criteria from that block. Rejected: one typo in a step would
     make every locator fail with `MSL-L007`, a second and misleading error.
3. **Version pins.** (a) `@cucumber/gherkin@42.0.1` with
   `@cucumber/messages@34.2.1`, both published 2026-08-05. (b) The 43.0.0 /
   35.0.0 releases. Rejected: they were under two weeks old.
4. **Code for the parse error.** (a) `MSL-B062`, warning, body family. (b) A
   P-family code. Rejected: the P family is for entry structure, not body
   content.

## Decision

1. **Dependency.** The Gherkin parser is `@cucumber/gherkin`, pinned to exactly
   `42.0.1`, with `@cucumber/messages` pinned to exactly `34.2.1`, as for
   `@dprint/*`. A later chore moves the pins.
2. **Lazy loading.** `parseFile` awaits the cached `loadGherkin()` before the
   synchronous parse, only when the text holds a `gherkin` or `feature` fence.
   The fence may follow spaces, blockquote markers, doc-comment prefixes and
   list markers (`-`, `*`, `+`, `1.`, `1)`) on its own line, and the info word
   must end at whitespace or the end of the line, so `gherkin-json` does not
   load the parser. When the import fails, `parseFile` continues without the AST
   (Decision 4 applies) and the failure is not cached, so a later file tries
   again. The synchronous `parse()` fills the AST only when the parser is
   already loaded. `loadGherkin` is exported from `core/mod.ts` so a caller of
   `parse()` can preload. A project with no such fence never loads the parser,
   and its output is unchanged.
3. **Parse gate.** When the parser is loaded, each `FeatureNode` has exactly one
   of `feature` (the normalized `FeatureAst`) and `parseError`. When it is not
   loaded, it has neither. `FeatureNode.source` always holds the authored text.
   Both new fields are pure functions of `source`, so the equivalence gate does
   not compare them (see the ADR-015 amendment). No `CORE_SCHEMA_VERSION`
   change: the field is optional.
4. **Scanner fallback.** For a block with a `parseError`, and for a block built
   while the parser is not loaded, criteria come from the line scanner of
   ADR-037, which reads English keywords only.
5. **Diagnostic.** `MSL-B062` (warning, body family) reports a block that does
   not parse, on any entry type, at the file line of the first parser error. It
   checks a feature block in a top-level block or in a list item at any depth.
   Criteria are still read from top-level blocks only (ADR-037), so a nested
   block gets the warning but gives no criteria.
6. **Consumers.** Body tokens (ADR-016 amendment) and `Entry.criteria` (ADR-037
   amendment) read the AST. Ranges in the AST are relative to the block: line 1
   is the first line of `FeatureNode.source`. `featureFileLine` maps a block
   line to a file line, including through the `LineMap` of source doc comments,
   and the body-token builder emits file positions. A block with no `Feature:`
   line is read with a synthetic line placed after the `# language:` line, and
   that line is not counted in any position.

## Consequences

- Feature blocks in any language that Gherkin supports give criteria and body
  tokens.
- A project with Gherkin loads the parser once per process. Code that builds
  entries with the synchronous `parse()` gets the AST only when the parser is
  already loaded in the process; otherwise it gets the scanner.
- Later slices (`.feature` entries) build on `FeatureAst` and are not part of
  this decision. The procedure view and the block-role diagnostics are delivered
  by the amendments below.

## Amendment 2026-11-14 — procedure view

The procedure-view slice (epic #915) builds on `FeatureAst`. Decisions 1 to 6
above are unchanged.

1. **Pure view.** The procedure view is an on-demand function over `FeatureAst`
   (`stepRoles` and `scenarioProcedure` in `core/gherkin/procedure.ts`). It
   stores no new field on the AST or on `Entry`.
2. **Roles.** `Given` is a precondition, `When` and `*` are actions, `Then` is
   an outcome. `And` and `But` take the role of the previous step; a first `And`
   or `But` is an action.
3. **Diagnostic.** `MSL-B063` (warning, body family) reports a numbered step
   that has actions and no outcome. It is a check diagnostic, not a prose lint.
4. **Scope.** The check applies to entries whose type is or extends core `Test`,
   in a feature block at any depth, as for `MSL-B062`. A block with a
   `parseError`, and an upstream entry, is skipped. The entry must be typed, so
   a profile that types it is required; a `Type: Test` trailer with no profile
   is not checked.
5. **Position.** The warning is reported at the file line of the last action of
   the step, in column 1.
6. **Where it runs.** The check runs in `markspec check` and in the LSP
   cross-file validation.

### Alternatives considered (procedure view)

1. **Where the step rule lives.**
   - (a) A check diagnostic, `MSL-B063`. Chosen: the rule is structural, needs
     the entry type, and belongs with `MSL-B062` in the body family.
   - (b) An `MSL-Q` prose lint. Rejected: prose lints analyse wording and are
     advisory, and they do not see the entry type or the AST.
2. **How the view is exposed.**
   - (a) A pure function over `FeatureAst`. Chosen: no schema change and no
     duplicated state.
   - (b) A stored field on `FeatureAst` or `Entry`. Rejected: it would add a
     second copy of data derived from the AST, which must then be kept in step
     with the AST.
3. **Which entries are checked.**
   - (a) Entries whose type is or extends `Test`. Chosen: only a test reads as a
     procedure with expected results.
   - (b) All entries. Rejected: a requirement scenario may end in an action
     without being a procedure, so the warning would be noise.
4. **`# Step N` labels.** Deferred to the Case A slice, together with the two
   info diagnostics. This slice only needs the role rule. (Done in the Case A
   amendment below.)

## Amendment 2026-11-14 — Case A block role

The Case A slice (epic #915) gives a feature block a role. Decisions 1 to 6 of
the base ADR and 1 to 6 of the procedure-view amendment are unchanged.

1. **Derived role.** `blockRole(entry, profile)` in `core/gherkin/role.ts`
   returns `criteria` for an entry whose type is or extends Requirement or
   Contract, `procedure` for Test, `illustration` for any other typed entry, and
   `undefined` for an entry with no type. It stores nothing on `Entry` or in the
   compiled JSON. It reuses `isCriteriaBearing` and `isTestEntry`.
2. **Codes.** `MSL-B064` (warning): a criteria scenario has no outcome step, so
   it has no `Then` step or no step at all; `Given` and `Then` without an action
   is valid. `MSL-B065` (info): in a procedure block, a step has an expected
   result and no action. `MSL-B066` (info): a scenario of a criteria or
   procedure block starts with `And` or `But`. `MSL-B067` (info): a `# Step`
   label labels no step (see decision 4 for the position rule). `MSL-B068`
   (info): a feature block in a typed entry whose type has no role. All are in
   the body family and are reported in column 1; `MSL-B064` at the `Scenario`
   line, `MSL-B065` and `MSL-B066` at the step, `MSL-B067` at the comment,
   `MSL-B068` at the first line of the block. `MSL-B065` and `MSL-B066` are the
   two info diagnostics deferred by the procedure-view amendment; `MSL-B067`
   belongs to the label feature.
3. **Typed entries only.** `MSL-B068` applies only to an entry that has a type
   after classification. The entry must be typed, so a profile is required, as
   for `MSL-B063`.
4. **Comments and labels.** `FeatureAst.comments` keeps every comment line.
   `scenarioProcedure(scenario, comments)` attaches a `# Step` comment (`#`,
   optional spaces, `Step`, then whitespace or the end of the line;
   `# Step-by-step` is not one) to the procedure step that starts at the next
   step line as `ProcedureStep.label`, only when comments and blank lines alone
   lie between them (a scenario description line makes the label unplaced; the
   parser records `ScenarioAst.descriptionEndLine` for this). A bare `# Step` is
   a label. Compiled JSON for a project with a gherkin fence gains
   `feature.comments`, and `descriptionEndLine` on a scenario with a
   description, on every feature node, including one nested in a list item
   (`bodyAst[].items[].blocks[].feature`). `unplacedStepLabels(feature)` lists
   the labels that label no step. The parser does not resolve labels. A label
   never changes the step number. Only a procedure block reports `MSL-B067`.
5. **Where it runs.** `checkBlockRoles` runs in `markspec check` and in the LSP
   cross-file validation. A project without a feature fence gives the same
   output as before.

### Alternatives considered (Case A block role)

1. **Where the role lives.**
   - (a) Derived on demand from the entry type. Chosen: no schema change and no
     second copy of data that the type already fixes.
   - (b) A role stored on `Entry`. Rejected for this slice: no consumer yet, and
     it adds compile-output keys and a schema-file change.
   - (c) A shared role helper over facets. Not added: the two existing
     predicates give the same answer, so a helper has no caller yet.
   - (d) A role set by a profile setting. Rejected: the role follows from the
     core type, so a profile setting would be a second source of the same fact.
2. **Which entries get `MSL-B064`.**
   - (a) Criteria blocks only. Chosen: a Test scenario is a procedure, which
     `MSL-B063` covers, and an illustration states no rule.
   - (b) Every entry type. Rejected: it would warn on examples.
3. **Number of info codes for a procedure.**
   - (a) Separate codes `MSL-B065`, `MSL-B066`, `MSL-B067`. Chosen: a project
     can silence one case, and each case has a different fix.
   - (b) One code. Rejected: it cannot be silenced per case.
4. **`MSL-B068` scope.**
   - (a) Typed entries only. Chosen: an untyped entry may only lack a profile,
     so the block is not known to be an example.
   - (b) Every entry. Rejected: it would report in every project with no
     profile.
5. **Label resolution.**
   - (a) `scenarioProcedure` attaches labels from `FeatureAst.comments`. Chosen:
     the parser stays a plain normalization of the Gherkin AST.
   - (b) The parser attaches labels. Rejected: the position rules depend on the
     procedure steps, which the parser does not compute.
6. **The word `Step`.**
   - (a) Fixed English word for every language. Chosen: no keyword table outside
     `@cucumber/gherkin`.
   - (b) A localized word. Rejected: it needs such a table.
7. **When `MSL-B064` warns.**
   - (a) Only a scenario with no outcome step. Chosen: it keeps `Given` plus
     `Then` valid.
   - (b) Also a scenario with no action. Rejected: a criterion can be a state
     check.

## Trace

Satisfies: epic #915 decision 1 of the Gherkin AST slice (loading), 2 (parse
failure), 3 (pins) and 4 (code), and decisions 1 to 6 of the procedure-view
amendment, and decisions 1 to 5 of the Case A block-role amendment.\
Specified in:
[Language — Body (MSL-B)](../spec/language/language.md#812-body-msl-b),
[core data model](../spec/internal/markspec-core-data-model.md).\
Documented in: [Scenario locators](../guide/scenario-locators.md).\
Code: `packages/markspec/core/gherkin/`,
`packages/markspec/core/validator/procedure.ts`,
`packages/markspec/core/validator/block_role.ts`,
`packages/markspec/core/validator/feature_parse.ts`,
`packages/markspec/core/criteria/scenarios.ts`.
