# ADR-038 — Gherkin AST for feature blocks

Status: Accepted, implemented (epic #915, Gherkin AST, procedure-view, Case A
and Case B slices)\
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
     awaits it only when the text holds a `gherkin` or `feature` fence, or when
     the file is a `.feature` file (Case B amendment).
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
   synchronous parse, only when the text holds a `gherkin` or `feature` fence (a
   `.feature` file always loads it; see the Case B amendment). The fence may
   follow spaces, blockquote markers, doc-comment prefixes and list markers
   (`-`, `*`, `+`, `1.`, `1)`) on its own line, and the info word must end at
   whitespace or the end of the line, so `gherkin-json` does not load the
   parser. When the import fails for a Markdown or source file, `parseFile`
   continues without the AST (Decision 4 applies); a `.feature` file then gives
   no entries (Case B decision 8). The failure is not cached, so a later file
   tries again. The synchronous `parse()` fills the AST only when the parser is
   already loaded. `loadGherkin` is exported from `core/mod.ts` so a caller of
   `parse()` can preload. A project with no such fence and no `.feature` file
   never loads the parser, and its output is unchanged.
3. **Parse gate.** When the parser is loaded, each `FeatureNode` has exactly one
   of `feature` (the normalized `FeatureAst`) and `parseError`. When it is not
   loaded, it has neither. `FeatureNode.source` always holds the authored text.
   In a Markdown or source file, both new fields are pure functions of `source`,
   so the equivalence gate does not compare them. The `feature` of a `.feature`
   entry is not: its inherited `Background` steps come from the whole-file AST
   (Case B decision 4), and the formatter never rewrites a `.feature` file's
   Gherkin text, so the gate does not compare it either (see the ADR-015
   amendment). No `CORE_SCHEMA_VERSION` change: the field is optional.
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
- `.feature` entries build on `FeatureAst` and are not part of this decision.
  The procedure view, the block-role diagnostics and the `.feature` entries are
  delivered by the amendments below.

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

## Amendment 2026-11-14 — Case B `.feature` entries

The Case B slice (epic #915) reads entries from `.feature` files. Decisions 1 to
6 of the base ADR and the amendments above are unchanged. The tag-based proposal
of #584 is superseded by this amendment.

1. **Header.** A header is a run of comment lines whose first line is
   `# [ID] Title`, directly above a `Feature`, `Rule` or `Scenario`. The `ID`
   must match `[A-Z][A-Z0-9]*[_-][A-Za-z0-9_.-]*[A-Za-z0-9]`: an uppercase
   start, at least one `_` or `-` separator, and a letter or digit at the end.
   This is a subset of the core display-ID grammar (`DISPLAY_ID_RE`) without
   `/`. Other bracketed comments (`# [TODO] fix later`, `# [x] done`, `# [WIP]`)
   are plain comments: no entry, no `MSL-B069` or `MSL-B062`, and `fmt` leaves
   them alone. Tag lines and plain comment lines may stand between the run and
   the node. A blank line breaks the link. A comment line that starts with
   `[ID]` starts a new run, so two stacked headers are two runs: only the lower
   one is directly above the node, and the upper one has no node and gets
   `MSL-B069`. The runs come from `GherkinDocument.comments`, not from a line
   scanner (`findHeaders` in `core/parser/feature_file.ts`).
2. **Header to entry.** The first header line loses the `#` and every space
   after it; each later line loses the `#` and at most one space, so extra
   indent stays part of the body. The lines are wrapped as a list item with
   `wrapAsListItem`, and are read by `parseMarkdown` with a `LineMap`. The
   trailer rule (#914), the P-family diagnostics and the body tokens therefore
   apply unchanged, with file positions. `MSL-P023` is not reported, because
   git-style trailers are canonical in a header.
3. **Ownership.** A headed `Scenario` is its own entry. An unheaded scenario
   belongs to the nearest headed `Rule`, else the headed `Feature`. A scenario
   with no headed ancestor is not in the model. Nesting creates no `Part-of`,
   and tags are not labels.
4. **Body and node.** The body is the header prose, then the Gherkin description
   of the node. `bodyAst` ends with one `FeatureNode`. `FeatureNode.source` is
   the authored text of the owning node, from its first tag or keyword line to
   its last line, with nested entries blanked. Its `feature` is built by
   `projectFeature` (`core/gherkin/project.ts`): the owned scenarios, the
   applicable `Background` steps, and ranges rebased so that line 1 is the first
   line of the span. `FeatureNode.range` is set so `featureFileLine` returns
   file lines. Case A checks (`MSL-B063` to `MSL-B068`) and `Entry.criteria`
   therefore work on the node without change.
5. **Entry source.** `EntrySource` gains
   `{ kind: "feature-file", node: "feature" | "rule" | "scenario" }`. The change
   is additive and does not bump `CORE_SCHEMA_VERSION`.
6. **Type step 6a.** In the type resolution chain, step 6a follows step 6:
   `feature` and `rule` give `Requirement`, `scenario` gives `Test`. It is
   silent, so it gives no `MSL-T021`. Profile classification (`classifyEntry`)
   applies it too: a `.feature` entry that no `display-id-pattern` matches gets
   the step-6a type and no `MSL-T003`. Without a profile, the checks that
   classify an entry on demand (`MSL-B063` to `MSL-B068`, locators) use the
   step-6a type.
7. **Diagnostics.** `MSL-B069` (warning, body family) reports a header above a
   `Background`, an `Examples` table or a step, or not directly above a node, at
   the first line of the header. `MSL-P030` applies to an entry with no header
   prose, no description and no content, at the `#` of its header line. The
   content of a `Scenario` entry is a step in its scenario; the content of a
   `Feature` or `Rule` entry is an owned scenario, with or without steps.
   `MSL-B062` reports a `.feature` file that does not parse, or whose parser
   fails to load, with no entries; it is reported only when the file has a
   `# [ID]` header line, so a plain Cucumber file never gets a new diagnostic.
8. **Loading.** `parseFile` always loads the parser for the `.feature`
   extension. A load failure gives no entries and never throws.
9. **Discovery and `fmt`.** `FEATURE_EXTENSIONS` adds `.feature` to the files
   that `check`, `lint`, `fmt` and `lock` find. `compile` does no discovery; it
   reads the `.feature` files named in its paths. `fmt` inserts a missing
   `# Id:` line into a header (`core/formatter/feature_file.ts`) and changes
   nothing else; a file that does not parse is unchanged. `MSL-F010` for a
   `.feature` file means only a missing `Id:`.
10. **Existing Cucumber projects.** A `.feature` file with no header gives no
    entries, no diagnostics, no lockfile drift and the same `compile` and
    `check` output as before. The scope line of a bare `check` or `fmt` counts
    the file, which is an accepted wording change.
11. **Tools.** The LSP walk skips `.feature` files until a later slice adds
    support. Until then, a rename of a display ID in the editor does not update
    `.feature` files: a trailer in a `.feature` header keeps the old ID, and the
    project-wide `check` reports it as unresolved. The MCP staleness list tracks
    `.feature` files.

### Alternatives considered (Case B `.feature` entries)

1. **Where header comments come from.**
   - (a) `GherkinDocument.comments`. Chosen: the parser already separates
     comments from doc strings.
   - (b) A regex line scan. Rejected: it duplicates the parser and miscounts
     comment-like lines inside doc strings.
2. **How a header becomes an entry.**
   - (a) Wrap it as a list item and call `parseMarkdown` with a `LineMap`.
     Chosen: one trailer implementation.
   - (b) A dedicated header parser. Rejected: a second trailer implementation.
3. **Position of the `FeatureNode`.**
   - (a) The owning node span, with rebased ranges. Chosen: an entry carries
     only its own text.
   - (b) The whole file as `source`. Rejected: every entry would carry the text
     of all other entries.
4. **Entry source kind.**
   - (a) A new `feature-file` kind. Chosen: additive, and it appears only on
     entries from `.feature` files.
   - (b) Reuse `doc-comment` with a new language. Rejected: its language union
     lists tree-sitter languages.
5. **Type default.**
   - (a) Step 6a now. Chosen: a headed scenario with an unrecognized prefix
     keeps its role.
   - (b) Defer it. Rejected: such an entry would stay untyped.
6. **`fmt` for `.feature` files.**
   - (a) Stamp `# Id:` in this slice. Chosen: a hand-written ULID is forbidden,
     so an entry with no Id could never become valid.
   - (b) Wait for the source-file stamping of #925. Rejected for the same
     reason. #925 uses tree-sitter doc comments and stays a separate path.
   - (c) Reformat Gherkin in `fmt`. Rejected: `fmt` stays limited to `Id:`.
7. **Header on a node that cannot be an entry.**
   - (a) `MSL-B069` warning. Chosen: the author expects an entry.
   - (b) Silent. Rejected: the header would be dropped without a message.
8. **Parse error and load failure.**
   - (a) No entries and one `MSL-B062`. Chosen: a failed load is not fatal
     (decision 2 of the base ADR), and a partial entry set would be wrong.
   - (b) A line scanner fallback, or throwing. Rejected: Case B has no fenced
     block to fall back on, and a throw stops the command.
9. **Tags carry ID and type (#584).** Rejected: tags such as `@wip` fail label
   validation, and a tag cannot hold a title, a body or a trailer.
10. **Every scenario is an entry.** Rejected: entries need stable IDs, so an
    unheaded scenario is a criterion of the nearest headed node.
11. **Generate `Part-of` from nesting.** Rejected: `Part-of` is declared only on
    Component and Unit.
12. **Treat `.feature` as a tree-sitter source language.** Rejected: there is no
    pinned grammar, and the Cucumber parser already gives the AST.
13. **Scope line.**
    - (a) Count `.feature` files in the bare `check` and `fmt` scope line.
      Chosen: the line states the files that the command reads.
    - (b) Hide them from the count. Rejected: the number would not match the
      discovered files.

## Trace

Satisfies: epic #915 decision 1 of the Gherkin AST slice (loading), 2 (parse
failure), 3 (pins) and 4 (code), and decisions 1 to 6 of the procedure-view
amendment, and decisions 1 to 5 of the Case A block-role amendment, and
decisions 1 to 11 of the Case B `.feature` amendment. Supersedes #584.\
Specified in:
[Language — Body (MSL-B)](../spec/language/language.md#812-body-msl-b),
[core data model](../spec/internal/markspec-core-data-model.md).\
Documented in: [Scenario locators](../guide/scenario-locators.md),
[Entries in `.feature` files](../guide/feature-files.md).\
Code: `packages/markspec/core/gherkin/`,
`packages/markspec/core/validator/procedure.ts`,
`packages/markspec/core/validator/block_role.ts`,
`packages/markspec/core/validator/feature_parse.ts`,
`packages/markspec/core/criteria/scenarios.ts`,
`packages/markspec/core/parser/feature_file.ts`,
`packages/markspec/core/formatter/feature_file.ts`.
