# ADR-038 — Gherkin AST for feature blocks

Status: Accepted, implemented (epic #915, Gherkin AST slice)\
Amends: [ADR-016](adr-016-body-token-ast.md) (token source for Gherkin tokens),
[ADR-015](adr-015-ast-equivalence-formatting-contract.md) (equivalence gate),
[ADR-037](adr-037-scenario-locators.md) (source of criteria)\
Related: [ADR-012](adr-012-diagnostic-code-scheme.md),
[ADR-030](adr-030-profile-delivered-documents.md), #915

## Context

Fenced `gherkin` and `feature` blocks were read by regular expressions (body
tokens) and by a line scanner (criteria). Both knew English keywords only, and
neither understood doc strings, tags or `# language:` lines. The epic needs a
real Gherkin AST as the base for later slices (procedure view, roles, `.feature`
entries). The parser must not slow down projects that have no Gherkin, and
`parse()` must stay synchronous.

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
   The synchronous `parse()` fills the AST only when the parser is already
   loaded. `loadGherkin` is exported from `core/mod.ts` so a caller of `parse()`
   can preload. A project with no such fence never loads the parser, and its
   output is unchanged.
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
   not parse, on any entry type, at the file line of the first parser error.
6. **Consumers.** Body tokens (ADR-016 amendment) and `Entry.criteria` (ADR-037
   amendment) read the AST. Positions in the AST are file-relative, including
   through the `LineMap` of source doc comments. A block with no `Feature:` line
   is read with a synthetic line placed after the `# language:` line, and that
   line is not counted in any position.

## Consequences

- Feature blocks in any language that Gherkin supports give criteria and body
  tokens.
- A project with Gherkin loads the parser once per process. Code that builds
  entries with the synchronous `parse()` without preloading gets the scanner.
- Later slices (procedure view, role diagnostics, `.feature` entries, LSP) build
  on `FeatureAst` and are not part of this decision.

## Trace

Satisfies: epic #915 decision 1 of the Gherkin AST slice (loading), 2 (parse
failure), 3 (pins) and 4 (code).\
Specified in:
[Language — Body (MSL-B)](../spec/language/language.md#812-body-msl-b),
[core data model](../spec/internal/markspec-core-data-model.md).\
Documented in: [Scenario locators](../guide/scenario-locators.md).\
Code: `packages/markspec/core/gherkin/`,
`packages/markspec/core/validator/feature_parse.ts`,
`packages/markspec/core/criteria/scenarios.ts`.
