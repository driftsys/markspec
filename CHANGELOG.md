# Changelog

## [0.5.3] (2026-05-23)

### Features

- **repo:** register MarkSpec inline AI completion provider ([bff70fa])
- **repo:** inline completion provider with model injection ([7bb705c])
- **repo:** add prompt builder for inline AI completion ([165a8a7])
- **repo:** add inline-completion cursor context classifier ([907c594])
- **repo:** add inline-completion configuration entries ([b45754a])
- **lsp:** suggest trailer attribute keys in entry trailer region ([0afc920])
- **lsp:** resolve scaffold completions with monotonic next-id ([15938a9])
- **lsp:** stamp real ULID in block-scaffold completions ([abb6347])
- **repo:** VS Code source-view entry rendering ([e0caa81])
- **repo:** native Windows support across CLI, LSP, and installer ([4d5df8c]),
  closes 403. Follow-up #406 tracks refactoring the Windows-skipped
unit
  tests.

Delivers the seven stories from `docs/product/windows-support.md`:

-
  **STK-WIN-0002 — File URIs round-trip on Windows.** `pathToUri` /

  `uriToPath` use `@std/path`'s platform-aware `toFileUrl` /
  `fromFileUrl`.
  Same fix in `cli/commands/doc.ts`, every e2e helper
  that built `file://`
  URIs by string concatenation, and 11 test
  files that built `CLI_ENTRY` via
  `new URL(...).pathname`.
- **STK-WIN-0003 — Path construction is
  platform-aware.**
  `walkDirectory`, `walkFs`, `book.ts`, `render/includes`,
  `mcp/tools/validate`, and `mcp/path.relativeToRoot` use `@std/path`
  `join` /
  `isAbsolute` / `SEPARATOR` rather than `${dir}/${name}`.

  `core/parser/mod.isReferencesDocument` uses `basename` plus a

  separator-agnostic regex. `render/mod.longestCommonDirectory`
  delegates to
  `@std/path`'s `common`.
- **STK-WIN-0004 — CRLF normalisation at the parse
  boundary.** Line
  endings normalise to LF in `parseFile`, `parse`,
  `buildBodyAst`, and the formatter detects the source's convention and restores
  it
  on write-back. AST-fidelity matrix stays at surface 0/58.
-
  **STK-WIN-0001 / STK-WIN-0007 — Windows CI matrix.** `ci.yaml`'s
  `test`
  job runs on `ubuntu`, `windows`, and `macos`
  (`fail-fast: false`).
-
  **STK-WIN-0006 — PowerShell installer.** `install.ps1` mirrors

  `install.sh`: GitHub release fetch, SHA-256 verification, `tar`
  extraction
  to `$HOME\.local\bin` (override via
  `MARKSPEC_INSTALL_DIR`). A
  `windows-latest` CI job parses the
  script via the PowerShell parser.
-
  **STK-WIN-0005 — VSCode end-to-end checklist.** New

  `editors/vscode/README.md` with a 13-row manual smoke-test
  checklist plus
  CRLF and path-handling spot checks.
- **STK-WIN-0008 — Windows install path
  documented.**
  `docs/guide/installation.md` documents the Windows PowerShell

   install path with the SmartScreen / signing caveat. `README.md`
  links to
  it. `bootstrap` keeps WSL guidance for contributors and
  points end users at
  `install.ps1`.
- **core:** support named {scope} segments in display-id patterns ([30d5170])
- **core:** accept grouped enum and label value lists ([6b6938d])

### Bug Fixes

- **release:** exclude compiled tests from VSIX, document bin/ omission
  ([1646cff])
- **repo:** un-skip Windows tests and support cross-drive doc build ([15cddea]),
  closes 406. Replaces synthetic POSIX path fixtures ("/proj/foo.md") in 54
unit
  tests with platform-native paths built via @std/path's resolve() +
join(),
  removing the corresponding { ignore: Deno.build.os === "windows" }
skips
  introduced by PR #405.

Also fixes markspec doc build on Windows when the
  source document lives on
a different drive than the bundled markspec-typst
  package (typical CI
- **repo:** thread document URI through inline completion provider ([8ab87f7])
- **repo:** tighten inline classifier (full-line title match, trailer skip)
  ([63320db])
- **lsp:** address formal-review findings (resolve format, snippet escaping)
  ([a94aef4])
- **mcp:** case-insensitive root prefix match on Windows ([21c7b19])
- **repo:** use Test-Checksum verb in install.ps1 ([90803ae])
- **core:** split multi-value locator-bearing links (Derived-from) ([d22c94e])
- **core:** apply profile attribute scope in compiler and LSP validation
  ([bb40072])
- **core:** resolve profile types to their core parent in type resolution
  ([80a9703])

### Refactoring

- **repo:** hoist provider imports and tighten return contract ([bf90957])
- **repo:** correct prompt indentation and tighten exhaustiveness ([b5e12ae])
- **lsp:** clarify trailer-key trigger docs and tighten tests ([976ebc6])
- **lsp:** type the scaffold resolve data payload ([cdadbff])
- **lsp:** document ulidProvider param and tighten tests ([cad2a36])

### Documentation

- **repo:** park homeless spec files and surface template directory ([f188904])

[0.5.3]: https://github.com/driftsys/markspec/compare/v0.5.2...v0.5.3
[bff70fa]: https://github.com/driftsys/markspec/commit/bff70fa
[7bb705c]: https://github.com/driftsys/markspec/commit/7bb705c
[165a8a7]: https://github.com/driftsys/markspec/commit/165a8a7
[907c594]: https://github.com/driftsys/markspec/commit/907c594
[b45754a]: https://github.com/driftsys/markspec/commit/b45754a
[0afc920]: https://github.com/driftsys/markspec/commit/0afc920
[15938a9]: https://github.com/driftsys/markspec/commit/15938a9
[abb6347]: https://github.com/driftsys/markspec/commit/abb6347
[e0caa81]: https://github.com/driftsys/markspec/commit/e0caa81
[4d5df8c]: https://github.com/driftsys/markspec/commit/4d5df8c
[30d5170]: https://github.com/driftsys/markspec/commit/30d5170
[6b6938d]: https://github.com/driftsys/markspec/commit/6b6938d
[1646cff]: https://github.com/driftsys/markspec/commit/1646cff
[15cddea]: https://github.com/driftsys/markspec/commit/15cddea
[8ab87f7]: https://github.com/driftsys/markspec/commit/8ab87f7
[63320db]: https://github.com/driftsys/markspec/commit/63320db
[a94aef4]: https://github.com/driftsys/markspec/commit/a94aef4
[21c7b19]: https://github.com/driftsys/markspec/commit/21c7b19
[90803ae]: https://github.com/driftsys/markspec/commit/90803ae
[d22c94e]: https://github.com/driftsys/markspec/commit/d22c94e
[bb40072]: https://github.com/driftsys/markspec/commit/bb40072
[80a9703]: https://github.com/driftsys/markspec/commit/80a9703
[bf90957]: https://github.com/driftsys/markspec/commit/bf90957
[b5e12ae]: https://github.com/driftsys/markspec/commit/b5e12ae
[976ebc6]: https://github.com/driftsys/markspec/commit/976ebc6
[cdadbff]: https://github.com/driftsys/markspec/commit/cdadbff
[cad2a36]: https://github.com/driftsys/markspec/commit/cad2a36
[f188904]: https://github.com/driftsys/markspec/commit/f188904

## [0.5.2] (2026-05-19)

### Documentation

- **book:** fix upskill install command and document global flag ([ce442da])

[0.5.2]: https://github.com/driftsys/markspec/compare/v0.5.1...v0.5.2
[ce442da]: https://github.com/driftsys/markspec/commit/ce442da

## [0.5.1] (2026-05-19)

### Bug Fixes

- **mcp:** validate tool labels the leaf profile, not the bundled default
  ([ac5d389])
- **mcp:** present leaf profile as active; reconcile suite for bundled default
  ([c10b374])
- **cli:** profile show/doctor headline the leaf tier, list the chain
  ([39bf6bf])
- **spec:** correct Id: code example and qualify MSL-Q020 as planned ([ff530f3])

### Documentation

- **docs:** note bundled-default mechanism shipped; §7.1 deferred ([95955af])
- **docs:** implementation plan for bundled default profile ([693dada])
- **docs:** design for bundled default profile auto-registration ([3d1e2ed])
- **spec:** add Model Reference book, overhaul guide, retire compile-output spec
  ([da59107])
- **repo:** escape CLI argument placeholders in CHANGELOG to fix MD033
  ([8d5ceb0])

### Performance

- **lsp:** incremental workspace index update ([904f673])
- **core:** pre-split parser lines, eliminate double-parse, bound compiler reads
  ([5171d0d])

### Features

- **core:** populate git.* properties on compiled entries ([d79bcfb])
- **core:** activate bundled default profile in loadProfileForCommand
  ([8885e20])
- **core:** parse default-profile opt-out key in .markspec.yaml ([2f0fe9d])
- **core:** splice bundled default as implicit chain root in loadChain
  ([9604e57])
- **core:** add embedded default-profile manifest and builtin specifier
  ([db4466b])
- **core:** open LinkKind for profile extension ([fa90cc1])

### Refactoring

- **core:** brand DisplayId and Ulid types ([764e598])
- **core:** type ast/build.ts mdast nodes ([5f941f8])
- **cli:** extract per-command files from main.ts ([bbb997d])
- **core:** consolidate duplicated constants and helpers ([01269a4])

[0.5.1]: https://github.com/driftsys/markspec/compare/v0.5.0...v0.5.1
[ac5d389]: https://github.com/driftsys/markspec/commit/ac5d389
[c10b374]: https://github.com/driftsys/markspec/commit/c10b374
[39bf6bf]: https://github.com/driftsys/markspec/commit/39bf6bf
[ff530f3]: https://github.com/driftsys/markspec/commit/ff530f3
[95955af]: https://github.com/driftsys/markspec/commit/95955af
[693dada]: https://github.com/driftsys/markspec/commit/693dada
[3d1e2ed]: https://github.com/driftsys/markspec/commit/3d1e2ed
[da59107]: https://github.com/driftsys/markspec/commit/da59107
[8d5ceb0]: https://github.com/driftsys/markspec/commit/8d5ceb0
[904f673]: https://github.com/driftsys/markspec/commit/904f673
[5171d0d]: https://github.com/driftsys/markspec/commit/5171d0d
[d79bcfb]: https://github.com/driftsys/markspec/commit/d79bcfb
[8885e20]: https://github.com/driftsys/markspec/commit/8885e20
[2f0fe9d]: https://github.com/driftsys/markspec/commit/2f0fe9d
[9604e57]: https://github.com/driftsys/markspec/commit/9604e57
[db4466b]: https://github.com/driftsys/markspec/commit/db4466b
[fa90cc1]: https://github.com/driftsys/markspec/commit/fa90cc1
[764e598]: https://github.com/driftsys/markspec/commit/764e598
[5f941f8]: https://github.com/driftsys/markspec/commit/5f941f8
[bbb997d]: https://github.com/driftsys/markspec/commit/bbb997d
[01269a4]: https://github.com/driftsys/markspec/commit/01269a4

## [0.5.0] (2026-05-19)

### Bug Fixes

- **core:** export source helpers for formatter, fix attribute regex edge cases
  ([bd7c1f9]), closes [#367], #378. Part of #366.
- **lsp:** serialize file parse, fix URI encoding, add close/open handlers
  ([c55f871]), closes [#368], [#369], [#372], #373. Part of #366.
- **core:** remove duplicate Q302 term; fix profile barrel exports ([c010f0c]),
  closes [#377], #379. Part of #366.
- **core:** SerializedEntry type, all edges in streaming, hyphen-aware scope
  filter ([c5e124c]), closes [#370], [#371], #376. Part of #366.
- **mcp:** forceRefresh always recompiles, async handler errors logged
  ([428673d]), closes [#374], #375. Part of #366.
- **mcp:** add SHA256 content-hash gate to project staleness check ([c1494dd])
- **core:** surface caption-conventions config errors; correct ADR-014; pin Path
  A invariants ([a2cdd14])
- **core:** track multi-line $$ math blocks; name C071 Listing/Feature ambiguity
  ([461337a])
- **core:** MSL-T021 over-fire + MSL-B043 message/code mismatch ([c3b8a6e])
- **repo:** teach git-std bump about non-root version files ([0f629ce])

### Refactoring

- **core:** rename EntryShape identified|referenced -> Authored|Reference
  ([#352]) ([1202d94])
- **core:** finish FENCE_RE dedup via shared walkProseLines/FENCE_RE ([4344a51])
- **core:** tighten Caused-by + empty-Type diagnostic quality ([2f2c1eb])
- **core:** consolidate ATTRIBUTE_CATALOG + dedupe URL regex ([5d13903])
- **core:** extract walkProseLines helper, dedupe FENCE_RE copies ([c094644])
- **core:** share type-resolution between trace and per-type passes ([b95b605])

### Documentation

- **docs:** restructure guide/ to 8-chapter layout per markspec-user-docs.md
  spec ([1bd8ae2])
- **spec:** compile output, lockfile, indexing & external sync (Prompt 7)
  ([ecd65af])
- **spec:** prose analysis & requirement-quality lint (Prompt 5) ([6868191])
- **spec:** Stage-1 user documentation spec (Prompt 4) ([22a9aaf])
- **spec:** toolchain distribution & e2e test strategy (Prompt 3) ([f7ac9b4])
- **spec:** profile schema & listing directives (Prompt 2) ([b7cbe30])
- **repo:** design — Formatting Fidelity epic (honor spec §5 via the AST)
  ([3322cb6])
- **repo:** ADR-014 canonical body-AST + ADR-012 amendment (Path A PR 7)
  ([53a4747])
- **repo:** canonical body-AST implementation plan (Prompt-1 Path A) ([1b26768])
- **repo:** design spec for canonical body-AST (Prompt-1 review Path A)
  ([9179d31])
- **repo:** ADR-013 — document directive is a formatter concern, not step 7
  ([87e2197])
- **repo:** ADR-012 phased adoption of nextgen diagnostic-code scheme
  ([fd19103])
- **repo:** sync AGENTS.md LSP section with current modules ([7195338])
- **spec:** land Prompt 1 — markspec core data model ([d48d65e])
- **docs:** rewrite cheatsheet for two-shape entry model (ADR-009) ([cf893f0])
- **repo:** escape inline-HTML-looking CSS class names in v0.4.0 changelog
  ([9cd2c9e])

### Features

- **core:** populate file.* properties on compiled entries ([d986786])
- **core:** profile descriptions & progressive discovery ([#390]) ([d3f20be])
- **skills:** add markspec-core upskill bundle ([#365]) ([f090255])
- **core:** toolchain Tier 2 — lsp/mcp install --print-only, adapter registry
  ([#364]) ([8f076ce])
- **core:** prose-analysis PA-1 — lint subcommand, MSL-Q
  lexicon/struct/suppression rules ([#362]) ([b97779a])
- **core:** toolchain Tier 1 — CORE_SCHEMA_VERSION, LSP serverInfo,
  completions ([#363]) ([42cb5c9])
- **core:** compile-output Tier 2 — NDJSON streams, entries.idx, split
  threshold ([b5a09a9])
- **core:** compile-output Tier 1 — manifest.json writer, --output flag,
  sync.* strip guard ([#359]) ([4b679e9])
- **core:** profile-schema Tier 2 — extends replaces shape, remove
  identified/referenced scope ([6b05f8c])
- **core:** listing-directives — glossary, Id schemes, validation
  (MSL-L010-050) ([#357]) ([0249d49])
- **core:** profile-schema Tier 1 — markspec-schema pin, PROFILE-TYPE-005,
  Authored-only pattern guard ([#356]) ([5b46d74])
- **core:** implement spec section 4.1/4.2 parser and identity diagnostics
  (MSL-P0xx/I0xx) ([#354]) ([a095e5a])
- **core:** SP3 AST-equivalence formatting contract — RESIDUAL=0/58 ([#353])
  ([4b5dac5])
- **core:** faithful body-AST builder — preserve §5.1 inline prose (SP2)
  ([#351]) ([3501b1c])
- **repo:** SP1 — AST fidelity-matrix harness, catalogue, and staleness gate
  ([a69448f])
- **core:** MSL-B044 + MSL-C072 on the body AST (Path A PR 6) ([6c5042e])
- **core:** migrate body-consuming validators to entry.bodyAst (PR 5)
  ([f54e844])
- **core:** route formatter body emission through the AST (Path A PR 4)
  ([ebb74d5])
- **core:** body-AST renderer + byte-identical equivalence gate (Path A PR 3)
  ([71da900])
- **core:** mdast → BodyBlock[] builder; additive Entry.bodyAst (Path A PR 2)
  ([7b4f35b])
- **core:** canonical body-AST node type contract (Path A PR 1) ([5baac00])
- **core:** MSL-T024 — type-specific attr on an unresolved-type entry
  ([9125a00])
- **lsp:** code action quick fix for MSL-A012 ([9fce224])
- **lsp:** code action quick fix for MSL-A011 ([8c6872d])
- **lsp:** code action quick fix for MSL-A013 ([5255341])
- **lsp:** code action quick fix for MSL-T020 ([5124ef5])
- **lsp:** code action quick fix for MSL-A030 ([77f2c49])
- **lsp:** code action quick fix for MSL-M060 ([957a53c])
- **lsp:** document highlights for display IDs ([98e591c])
- **lsp:** folding ranges for entry blocks ([37d98fb])
- **lsp:** prepareRename for tighter rename UX ([eaa1dd1])
- **cli:** markspec export csv ([47f8008])
- **cli:** implement markspec insert `<type>` `<file>` ([26a5110])
- **cli:** implement markspec export `<format>` for json + yaml ([a025ada])
- **cli:** implement markspec create `<type>` `<paths...>` ([9d8ad2f])
- **cli:** implement markspec hook `[...files]` for pre-commit use ([6246855])
- **lsp:** workspace rename for display IDs ([1659983])
- **lsp:** workspace symbol search ([0233bbd])
- **lsp:** document symbols for outline view ([a5b9991])
- **lsp:** find-references for display IDs ([17ea64b])
- **lsp:** go-to-definition for display IDs ([fce0576])
- **lsp:** hover support for display IDs ([561a6fb])
- **lsp:** completion for Type: attribute values ([f38849e])
- **core:** MSL-A050 — validate enum-typed core attributes (Origin)
  ([5120487])
- **cli:** implement markspec next-id `<type>` `<paths...>` ([0a6fe73])
- **core:** MSL-P010 — entry title is empty after trimming (spec §4.2)
  ([5503de4])
- **core:** MSL-A040 — profile must not redefine reserved core keys/types
  ([175759a])
- **core:** MSL-A011 — citation attribute used CSV form (spec §2.3.2)
  ([684a595])
- **core:** MSL-A012 — empty repeatable attribute value list (spec §1.8)
  ([552cf9b])
- **core:** MSL-M061 — Requirement entry without modal keyword (info)
  ([325a5fc])
- **core:** MSL-M060 — uppercase modal keyword warning (spec §3.4.1)
  ([c459f55])
- **core:** MSL-A013 — single-cardinality attribute used more than once
  ([167d2fe])
- **core:** deterministic synthesized-ULID derivation (spec §3.5) ([ab00c0b])
- **core:** broaden MSL-T021 to fire at steps 5/6 (spec §1.3.2) ([152264b])
- **core:** discriminating-attribute inference (spec §1.3.1 step 6) ([4cad7a5])
- **core:** Source: introspection (spec §1.3.1 step 3) ([274bc3a])
- **core:** blank-line collapse in body (spec §3.4.3 / §5.2) ([c29ce05])
- **core:** canonicalise trailer keys to TitleCase-Hyphenated (spec §3.3.4)
  ([459cbe2])
- **core:** canonical bullet character on entry title lines (spec §3.2)
  ([04a0aa5])
- **core:** display-ID prefix → core type inference (spec §1.3.1 step 4)
  ([af6f01d])
- **core:** MSL-C071 for caption / block-type mismatch ([4e6e974])
- **core:** full ADR-003 §Part 3 inverse list in catalog ([fcbf755])
- **core:** per-subtype attribute exclusions in CORE_TYPE_HIERARCHY ([88e848f])
- **core:** body block exclusions (MSL-B040-B043) ([701347f])
- **core:** MSL-A050 for non-http(s) Reference-url values ([a727f60])
- **core:** MSL-R085 for References targeting a non-Reference entry ([3fa79d1])
- **core:** MSL-I006 for Reference-shape display-ID slug grammar ([661afb0])
- **core:** URI scheme → core type inference (ADR-003 §Part 6) ([528f6c9])
- **core:** MSL-R081 / MSL-R082 for retired and DRAFT link targets ([b8aa8ee])
- **core:** MSL-R084 for Supersedes crossing the Authored↔Reference boundary
  ([05eb671])
- **core:** cross-file trace target-type compatibility with MSL-R083 ([49059f9])
- **core:** per-type attribute compatibility check with MSL-T022 ([4309224])
- **core:** caption-adjacency validation with MSL-C070 ([84c68b3])
- **core:** parse $Identifier entity refs in entry body prose ([8c590ce])
- **core:** lowercase EARS keywords mid-sentence per spec §3.4.1 ([9ad54e9])
- **core:** lowercase RFC 2119 modal keywords in body prose ([684434c])
- **core:** MSL-T021 late-stage Type inference from display-ID shape ([5e2faa9])
- **core:** MSL-T023 for profile-shaped Type: in core-only mode ([75cc7ab])
- **core:** reject generated-origin attributes in source with MSL-A030
  ([15acf22])
- **core:** canonical trailer ordering follows spec §3.3.2 six-group rule
  ([b783c39])
- **core:** recognize 16-type core taxonomy in Type: validation ([0453858])
- **mcp:** teach agents discovery via server instructions and tool annotations
  ([ca57148])
- **mcp:** register MCP server in VS Code extension alongside LSP ([7965397]),
  closes [#268]

[0.5.0]: https://github.com/driftsys/markspec/compare/v0.4.0...v0.5.0
[bd7c1f9]: https://github.com/driftsys/markspec/commit/bd7c1f9
[#367]: https://github.com/driftsys/markspec/issues/367
[c55f871]: https://github.com/driftsys/markspec/commit/c55f871
[#368]: https://github.com/driftsys/markspec/issues/368
[#369]: https://github.com/driftsys/markspec/issues/369
[#372]: https://github.com/driftsys/markspec/issues/372
[c010f0c]: https://github.com/driftsys/markspec/commit/c010f0c
[#377]: https://github.com/driftsys/markspec/issues/377
[c5e124c]: https://github.com/driftsys/markspec/commit/c5e124c
[#370]: https://github.com/driftsys/markspec/issues/370
[#371]: https://github.com/driftsys/markspec/issues/371
[428673d]: https://github.com/driftsys/markspec/commit/428673d
[#374]: https://github.com/driftsys/markspec/issues/374
[c1494dd]: https://github.com/driftsys/markspec/commit/c1494dd
[a2cdd14]: https://github.com/driftsys/markspec/commit/a2cdd14
[461337a]: https://github.com/driftsys/markspec/commit/461337a
[c3b8a6e]: https://github.com/driftsys/markspec/commit/c3b8a6e
[0f629ce]: https://github.com/driftsys/markspec/commit/0f629ce
[1202d94]: https://github.com/driftsys/markspec/commit/1202d94
[#352]: https://github.com/driftsys/markspec/issues/352
[4344a51]: https://github.com/driftsys/markspec/commit/4344a51
[2f2c1eb]: https://github.com/driftsys/markspec/commit/2f2c1eb
[5d13903]: https://github.com/driftsys/markspec/commit/5d13903
[c094644]: https://github.com/driftsys/markspec/commit/c094644
[b95b605]: https://github.com/driftsys/markspec/commit/b95b605
[1bd8ae2]: https://github.com/driftsys/markspec/commit/1bd8ae2
[ecd65af]: https://github.com/driftsys/markspec/commit/ecd65af
[6868191]: https://github.com/driftsys/markspec/commit/6868191
[22a9aaf]: https://github.com/driftsys/markspec/commit/22a9aaf
[f7ac9b4]: https://github.com/driftsys/markspec/commit/f7ac9b4
[b7cbe30]: https://github.com/driftsys/markspec/commit/b7cbe30
[3322cb6]: https://github.com/driftsys/markspec/commit/3322cb6
[53a4747]: https://github.com/driftsys/markspec/commit/53a4747
[1b26768]: https://github.com/driftsys/markspec/commit/1b26768
[9179d31]: https://github.com/driftsys/markspec/commit/9179d31
[87e2197]: https://github.com/driftsys/markspec/commit/87e2197
[fd19103]: https://github.com/driftsys/markspec/commit/fd19103
[7195338]: https://github.com/driftsys/markspec/commit/7195338
[d48d65e]: https://github.com/driftsys/markspec/commit/d48d65e
[cf893f0]: https://github.com/driftsys/markspec/commit/cf893f0
[9cd2c9e]: https://github.com/driftsys/markspec/commit/9cd2c9e
[d986786]: https://github.com/driftsys/markspec/commit/d986786
[d3f20be]: https://github.com/driftsys/markspec/commit/d3f20be
[#390]: https://github.com/driftsys/markspec/issues/390
[f090255]: https://github.com/driftsys/markspec/commit/f090255
[#365]: https://github.com/driftsys/markspec/issues/365
[8f076ce]: https://github.com/driftsys/markspec/commit/8f076ce
[#364]: https://github.com/driftsys/markspec/issues/364
[b97779a]: https://github.com/driftsys/markspec/commit/b97779a
[#362]: https://github.com/driftsys/markspec/issues/362
[42cb5c9]: https://github.com/driftsys/markspec/commit/42cb5c9
[#363]: https://github.com/driftsys/markspec/issues/363
[b5a09a9]: https://github.com/driftsys/markspec/commit/b5a09a9
[4b679e9]: https://github.com/driftsys/markspec/commit/4b679e9
[#359]: https://github.com/driftsys/markspec/issues/359
[6b05f8c]: https://github.com/driftsys/markspec/commit/6b05f8c
[0249d49]: https://github.com/driftsys/markspec/commit/0249d49
[#357]: https://github.com/driftsys/markspec/issues/357
[5b46d74]: https://github.com/driftsys/markspec/commit/5b46d74
[#356]: https://github.com/driftsys/markspec/issues/356
[a095e5a]: https://github.com/driftsys/markspec/commit/a095e5a
[#354]: https://github.com/driftsys/markspec/issues/354
[4b5dac5]: https://github.com/driftsys/markspec/commit/4b5dac5
[#353]: https://github.com/driftsys/markspec/issues/353
[3501b1c]: https://github.com/driftsys/markspec/commit/3501b1c
[#351]: https://github.com/driftsys/markspec/issues/351
[a69448f]: https://github.com/driftsys/markspec/commit/a69448f
[6c5042e]: https://github.com/driftsys/markspec/commit/6c5042e
[f54e844]: https://github.com/driftsys/markspec/commit/f54e844
[ebb74d5]: https://github.com/driftsys/markspec/commit/ebb74d5
[71da900]: https://github.com/driftsys/markspec/commit/71da900
[7b4f35b]: https://github.com/driftsys/markspec/commit/7b4f35b
[5baac00]: https://github.com/driftsys/markspec/commit/5baac00
[9125a00]: https://github.com/driftsys/markspec/commit/9125a00
[9fce224]: https://github.com/driftsys/markspec/commit/9fce224
[8c6872d]: https://github.com/driftsys/markspec/commit/8c6872d
[5255341]: https://github.com/driftsys/markspec/commit/5255341
[5124ef5]: https://github.com/driftsys/markspec/commit/5124ef5
[77f2c49]: https://github.com/driftsys/markspec/commit/77f2c49
[957a53c]: https://github.com/driftsys/markspec/commit/957a53c
[98e591c]: https://github.com/driftsys/markspec/commit/98e591c
[37d98fb]: https://github.com/driftsys/markspec/commit/37d98fb
[eaa1dd1]: https://github.com/driftsys/markspec/commit/eaa1dd1
[47f8008]: https://github.com/driftsys/markspec/commit/47f8008
[26a5110]: https://github.com/driftsys/markspec/commit/26a5110
[a025ada]: https://github.com/driftsys/markspec/commit/a025ada
[9d8ad2f]: https://github.com/driftsys/markspec/commit/9d8ad2f
[6246855]: https://github.com/driftsys/markspec/commit/6246855
[1659983]: https://github.com/driftsys/markspec/commit/1659983
[0233bbd]: https://github.com/driftsys/markspec/commit/0233bbd
[a5b9991]: https://github.com/driftsys/markspec/commit/a5b9991
[17ea64b]: https://github.com/driftsys/markspec/commit/17ea64b
[fce0576]: https://github.com/driftsys/markspec/commit/fce0576
[561a6fb]: https://github.com/driftsys/markspec/commit/561a6fb
[f38849e]: https://github.com/driftsys/markspec/commit/f38849e
[5120487]: https://github.com/driftsys/markspec/commit/5120487
[0a6fe73]: https://github.com/driftsys/markspec/commit/0a6fe73
[5503de4]: https://github.com/driftsys/markspec/commit/5503de4
[175759a]: https://github.com/driftsys/markspec/commit/175759a
[684a595]: https://github.com/driftsys/markspec/commit/684a595
[552cf9b]: https://github.com/driftsys/markspec/commit/552cf9b
[325a5fc]: https://github.com/driftsys/markspec/commit/325a5fc
[c459f55]: https://github.com/driftsys/markspec/commit/c459f55
[167d2fe]: https://github.com/driftsys/markspec/commit/167d2fe
[ab00c0b]: https://github.com/driftsys/markspec/commit/ab00c0b
[152264b]: https://github.com/driftsys/markspec/commit/152264b
[4cad7a5]: https://github.com/driftsys/markspec/commit/4cad7a5
[274bc3a]: https://github.com/driftsys/markspec/commit/274bc3a
[c29ce05]: https://github.com/driftsys/markspec/commit/c29ce05
[459cbe2]: https://github.com/driftsys/markspec/commit/459cbe2
[04a0aa5]: https://github.com/driftsys/markspec/commit/04a0aa5
[af6f01d]: https://github.com/driftsys/markspec/commit/af6f01d
[4e6e974]: https://github.com/driftsys/markspec/commit/4e6e974
[fcbf755]: https://github.com/driftsys/markspec/commit/fcbf755
[88e848f]: https://github.com/driftsys/markspec/commit/88e848f
[701347f]: https://github.com/driftsys/markspec/commit/701347f
[a727f60]: https://github.com/driftsys/markspec/commit/a727f60
[3fa79d1]: https://github.com/driftsys/markspec/commit/3fa79d1
[661afb0]: https://github.com/driftsys/markspec/commit/661afb0
[528f6c9]: https://github.com/driftsys/markspec/commit/528f6c9
[b8aa8ee]: https://github.com/driftsys/markspec/commit/b8aa8ee
[05eb671]: https://github.com/driftsys/markspec/commit/05eb671
[49059f9]: https://github.com/driftsys/markspec/commit/49059f9
[4309224]: https://github.com/driftsys/markspec/commit/4309224
[84c68b3]: https://github.com/driftsys/markspec/commit/84c68b3
[8c590ce]: https://github.com/driftsys/markspec/commit/8c590ce
[9ad54e9]: https://github.com/driftsys/markspec/commit/9ad54e9
[684434c]: https://github.com/driftsys/markspec/commit/684434c
[5e2faa9]: https://github.com/driftsys/markspec/commit/5e2faa9
[75cc7ab]: https://github.com/driftsys/markspec/commit/75cc7ab
[15acf22]: https://github.com/driftsys/markspec/commit/15acf22
[b783c39]: https://github.com/driftsys/markspec/commit/b783c39
[0453858]: https://github.com/driftsys/markspec/commit/0453858
[ca57148]: https://github.com/driftsys/markspec/commit/ca57148
[7965397]: https://github.com/driftsys/markspec/commit/7965397
[#268]: https://github.com/driftsys/markspec/issues/268

## [0.4.0] (2026-05-10)

### Bug Fixes

- **mcp:** render entry and diagnostic locations relative to projectRoot
  ([4452666])
- **mcp:** resolve concurrent-compile race and stuck-error state in project
  cache ([057d2cf])

### Documentation

- **docs:** document markspec mcp subcommand and client setup ([da48d1f])
- **docs:** add v1 MCP server implementation plan ([423117f])
- **spec:** document MCP client compatibility for Claude/Copilot/OpenCode
  ([aa081a7])
- **spec:** redesign v1 MCP server around resources and Markdown content
  ([6051097])
- **spec:** add v1 MCP server design (read-only tools, mtime cache) ([937daa4])
- **repo:** complete attribute-block syntax migration across docs and tests
  ([13d116d])
- **book:** update renderChapterHtml JSDoc for new hue-class output ([c896452])
- **docs:** regenerate full changelog via git-std ([f6aa687])

### Features

- **mcp:** wire markspec mcp subcommand to mcp/server.ts ([0249872])
- **mcp:** bootstrap MCP server over stdio with resource notifications
  ([4addd3b])
- **mcp:** register tools/list and tools/call dispatch ([abef2d5])
- **mcp:** add markspec_refresh tool ([f09718e])
- **mcp:** add validate tool with Markdown diagnostics report ([0c172ee])
- **mcp:** add entry_context tool with chain-walk renderer ([3c9199e])
- **mcp:** add entry_search tool with ranking and Markdown render ([b4a7878])
- **mcp:** register resources/list and resources/read handlers ([8b13a61])
- **mcp:** render markspec://entries index as Markdown ([1551fdd])
- **mcp:** render markspec://entry/{id} as Markdown ([6bf8978])
- **mcp:** render markspec://profile as Markdown distillation ([92c3aab])
- **mcp:** add project context with compile cache and mtime invalidation
  ([1c02324])
- **mcp:** add MCP SDK dependency and markspec:// URI helpers ([5e8c4a2])
- **core:** switch attribute block syntax to indented code block ([7c92a7d])
- **book:** wire profile-driven entry colors and add merge integration tests
  ([a675081]), closes [#260], #261.

Relocates resolveEntryColor from
  render/typst/colors.ts into core/profile/colors.ts so both rendering layers
  (Typst PDF and HTML book) can call it through the library boundary defined in
  AGENTS.md. The render-side file becomes obsolete and is removed; its tests
  move to core/profile/colors_test.ts where they remain the canonical resolver
  coverage.

BuildBookOptions and RenderChapterOptions gain an optional profile
  field; the book CLI threads bookChain.effective into both compile and
  buildBook. _entryToHtml drops the V-model prefix heuristic (_entryCategory)
  and emits `class="req-block hue-<name>"` for identified entries with a
  resolved color, or `class="req-block uncolored"` for referenced-shape
  entries. The matching `.hue-<name>` and `.uncolored` CSS rules were already
  shipped with PR #257; the book pipeline now opts in.

Adds three integration tests (issue
  #260) covering parseManifest -> mergeChain -> resolveEntryColor end-to-end:
  declared hue resolves correctly, type-without-color falls back to blue, and a
  referenced-shape type with color authored stays uncolored at render time
  despite the manifest emitting MSL-PROFILE-COLOR-001.

Existing e2e book tests
  are updated to assert the new class-based output. The 'data-entry-type=spec
  for ARC entries' test is repurposed as a regression check that the prefix
  heuristic is gone.

[0.4.0]: https://github.com/driftsys/markspec/compare/v0.3.0...v0.4.0
[4452666]: https://github.com/driftsys/markspec/commit/4452666
[057d2cf]: https://github.com/driftsys/markspec/commit/057d2cf
[da48d1f]: https://github.com/driftsys/markspec/commit/da48d1f
[423117f]: https://github.com/driftsys/markspec/commit/423117f
[aa081a7]: https://github.com/driftsys/markspec/commit/aa081a7
[6051097]: https://github.com/driftsys/markspec/commit/6051097
[937daa4]: https://github.com/driftsys/markspec/commit/937daa4
[13d116d]: https://github.com/driftsys/markspec/commit/13d116d
[c896452]: https://github.com/driftsys/markspec/commit/c896452
[f6aa687]: https://github.com/driftsys/markspec/commit/f6aa687
[0249872]: https://github.com/driftsys/markspec/commit/0249872
[4addd3b]: https://github.com/driftsys/markspec/commit/4addd3b
[abef2d5]: https://github.com/driftsys/markspec/commit/abef2d5
[f09718e]: https://github.com/driftsys/markspec/commit/f09718e
[0c172ee]: https://github.com/driftsys/markspec/commit/0c172ee
[3c9199e]: https://github.com/driftsys/markspec/commit/3c9199e
[b4a7878]: https://github.com/driftsys/markspec/commit/b4a7878
[8b13a61]: https://github.com/driftsys/markspec/commit/8b13a61
[1551fdd]: https://github.com/driftsys/markspec/commit/1551fdd
[6bf8978]: https://github.com/driftsys/markspec/commit/6bf8978
[92c3aab]: https://github.com/driftsys/markspec/commit/92c3aab
[1c02324]: https://github.com/driftsys/markspec/commit/1c02324
[5e8c4a2]: https://github.com/driftsys/markspec/commit/5e8c4a2
[7c92a7d]: https://github.com/driftsys/markspec/commit/7c92a7d
[a675081]: https://github.com/driftsys/markspec/commit/a675081
[#260]: https://github.com/driftsys/markspec/issues/260

## [0.3.0] (2026-05-10)

### Documentation

- **docs:** correct default-profile role-to-hue table in typography spec
  ([5112353])
- **docs:** describe profile-driven entry colors in typography spec ([51267d7])
- **docs:** add profile-driven entry colors implementation plan ([3ebfff8])
- **docs:** add profile-driven entry colors design spec ([46340fe])
- **docs:** document VS Code dev-mode LSP workflow ([56c8d9d])
- **docs:** switch jsonc fence to json5 so deno fmt and dprint both accept it
  ([f9e29e0])
- **docs:** drop trailing commas in spec jsonc example to satisfy deno fmt
  ([b31a185])
- **docs:** land LSP install/spawn spec and plan ([a6048a6])
- **docs:** add entry model type-safety cleanup design spec ([85f113b])
- **docs:** add local default profile for strawman testing ([f78bbfe])
- **repo:** fix stale build commands, layout gaps, and CI flags in AGENTS.md
  ([7e2e5d1])
- **docs:** fix stale terminology, add draft banners, and write user guide pages
  ([2bb28c6])
- **spec:** ADR-008 profile system v1 Phase 7 implementation plan ([cbd6a62])
- **spec:** ADR-008 profile system v1 Phase 6 implementation plan ([6df9fde])
- **spec:** ADR-008 profile system v1 Phase 5 implementation plan ([1a2a99a])
- **spec:** ADR-008 profile system v1 Phase 4 implementation plan ([8b1a769])
- **core:** document cycle-detection symlink caveat and scope-layering TODO
  ([23e1a3f])
- **spec:** ADR-008 profile system v1 Phase 3 implementation plan ([ac0f8ad])
- **spec:** ADR-008 profile system v1 Phase 2 implementation plan ([3ab6e1a])
- **spec:** ADR-008 profile system v1 implementation plan ([651773c])
- **spec:** ADR-008 profile system v1 implementation design ([ee94acf])
- **docs:** make type optional (inferred), drop migrate, self-contain specs
  ([74f0354])
- **docs:** status notes on spec docs + cheatsheet identity fixes ([9c1d4d9])
- **docs:** align README, AGENTS, examples to two-shape entry model ([b5763f6])
- **docs:** ADR-009 core/profile boundary + ADR-010/011 follow-ups ([2929ebb])
- **docs:** ADR-008 profile system + retirement model rewrite ([271141e])

### Refactoring

- **lsp:** extract vscode serverOptions resolver into testable module
  ([5a02131])
- **core:** rename Entry.attributes to rawAttributes ([c77b741])
- **core:** make CompileResult.documents required ([64b6748])
- **core:** make Entry.typedAttributes required ([dd4cbb4])
- **core:** update formatter front-matter order for retirement model (status →
  deprecated) ([df43f76])
- **core:** cross-platform path in profile loader ([35b88af])
- **core:** remove duplicate EntryShape declaration ([c745a7c])
- **core:** collapse four-family entry model to two shapes ([1a9f7b8])
- **cli:** remove markspec migrate (no backward compat needed) ([44e688d])

### Features

- **spec:** assign colors to aspice-swe-mini types ([7f6e361])
- **spec:** default profile ships seven semantic color roles ([989c4bf])
- **cli:** thread active profile into render pipeline ([7b68c0c])
- **render:** resolve entry color via profile in Typst template ([59ef77f])
- **render:** replace req-block type: with color: parameter ([178f935])
- **render:** add profile-driven entry color resolver ([843a80d])
- **core:** merge profile.colors and validate per-type color refs ([faacd6b])
- **core:** parse profile.colors and per-type color in manifest ([048fd85])
- **core:** add color fields to profile model types ([3ab4508])
- **lsp:** wire vscode LSP status bar item and showOutput command ([3152866])
- **lsp:** vscode status bar item module showing LSP health ([6e152e9])
- **lsp:** emit markspec/indexed notification after initial diagnostics pass
  ([7a1c177])
- **lsp:** wire debug log into server lifecycle and uncaught error handlers
  ([f68ed59])
- **lsp:** MARKSPEC_LSP_DEBUG_LOG env-var-gated lifecycle logging ([2bb2686])
- **lsp:** add markspec.trace.debugLog setting to vscode extension ([e915afb])
- **core:** MSL-T013 tiered link-target severity (draft/retired) ([3501754])
- **core:** add deprecated attribute, remove status, add MSL-D002 transitional
  diagnostic ([588e663])
- **cli:** add profile new, publish, and add commands ([80d9b96])
- **core:** addProfileSpecifier for .markspec.yaml mutation ([6bbbb4c])
- **core:** npm specifier resolver with XDG cache ([edb7f83])
- **core:** XDG cache directory helper for profile storage ([1ffd424])
- **core:** parse npm: specifiers in .markspec.yaml ([886be4e])
- **core:** add npm variant to ProfileSpecifier type ([c507688])
- **lsp:** wire markspec lsp subcommand, add VSCode extension and editor
  integration guide ([18b7a34])
- **lsp:** implement LSP server with diagnostics and completions ([#55]-[#59])
  ([df53543])
- **core:** generated inverses + profile show + doctor (Phases 8 & 9)
  ([12708ec])
- **core:** synthesize id-list attribute for trace rule link names ([ac2984c])
- **core:** wire Stage 4 traceability + Stage 2.5 normalization into pipeline
  ([389a521])
- **core:** traceability stage — required, cardinality, target match
  ([7748229])
- **core:** target matcher evaluation for trace rules ([a8dc165])
- **core:** effective trace rules helper ([3b37cfa])
- **core:** normalize profile-declared list-attribute values (CSV split)
  ([aa3358e])
- **core:** wire Stage 3 typed attributes into pipeline ([33ba6e6])
- **core:** path / list / citation value-type validators ([aa26297])
- **core:** ID/URI value-type validators (id, id-list, uri, url, external-id)
  ([7892121])
- **core:** simple value-type validators (text, integer, boolean, date, enum)
  ([87492f9])
- **core:** attribute structural checks (required, cardinality, unknown)
  ([fe1d972])
- **core:** effective attribute scope helper ([a53d16a])
- **cli:** use runPipeline in validate command ([781ccb4])
- **core:** validator pipeline runner (Stages 1 + 2) ([707eb1c])
- **core:** classification stage with pattern enforcement ([fab85d1])
- **core:** classify single entry against profile types ([512bb3a])
- **core:** display-ID pattern compiler ([9cc8e83])
- **core:** export git specifier resolver + cache API ([0860e19])
- **core:** route git specifiers through resolveGitSpecifier ([34e6789])
- **core:** gitignore cache dir on first fetch ([b9b9d18])
- **core:** resolveGitSpecifier clones on cache miss ([0b7bb2d])
- **core:** resolveGitSpecifier scaffold with cache-hit path ([f0467e0])
- **core:** RunGit abstraction + Deno.Command default ([8d6b39a])
- **core:** git-cache key + path derivation ([10b29f8])
- **core:** wire merge into loadChain + e2e coverage ([c190b0a])
- **core:** traceability target subset rule + rule-level tightening ([c209486])
- **core:** type-level merge tightening (pattern + enforcement) ([8256840])
- **core:** attribute tightening (cardinality, enum, required) ([89d5cb7])
- **core:** additive merge rules (union lists, types, attributes) ([bed51cc])
- **core:** mergeChain scaffold — single-tier identity merge ([c600d98])
- **core:** walk extends: chain with cycle + depth detection ([184e5bc])
- **core:** EffectiveProfile + provenance types ([d138179])
- **cli:** load active profile in profile-aware commands ([b6d43d1])
- **core:** export profile loader from public barrel ([26b7ae5])
- **core:** loadProfileForCommand orchestrator ([c96d028])
- **core:** single-profile chain loader ([2f830ac])
- **core:** local profile specifier resolver ([d852272])
- **core:** .markspec.yaml parse + schema validation ([1e09411])
- **core:** .markspec.yaml discovery ([7d753e1])
- **core:** LoadedProfile and ProfileChain runtime types ([31ec592])
- **core:** reject unknown keys on attribute, inverse, and trace-rule mappings
  ([5a05b2f])
- **core:** reject empty inverse name or category ([b5a013c])
- **core:** reject whitespace-only required string fields ([3ab0e08])
- **core:** reject empty enum values list ([7ae074a])
- **core:** profile module barrel ([cab5ce0])
- **core:** parse inverse declarations on link attributes ([5e9e61c])
- **core:** parse extends specifier (local + git) ([d037767])
- **core:** parse documents scope ([7c5a334])
- **core:** parse profile.types map ([b89b6e5])
- **core:** parse traceability rules in identified scope ([cc1fff0])
- **core:** parse identified/referenced shape scopes ([607daf0])
- **core:** parse universal scope (required, attributes, labels) ([d50140a])
- **core:** validate 'profile' section key whitelist ([f1edf45])
- **core:** reject unknown top-level manifest keys ([9461ff6])
- **core:** manifest parser — minimal happy path ([e0aaaee])
- **core:** profile data model types ([ba7bc47])

### Bug Fixes

- **repo:** rewrite generated CSS entry-block rules around the seven-hue palette
  ([fb65923])
- **render:** guard PaletteHue cast in resolveEntryColor against unvalidated
  input ([a509f03])
- **core:** validate per-type colors only after full chain merge ([6445918])
- **render:** drop entry-category from Typst document import preamble
  ([fe1af02])
- **ci:** pin deno --config when bundling binary in package-vsix job ([13575d6])
- **ci:** use sha256sum on linux/windows, fall back to shasum on macos
  ([c456661])
- **ci:** use bash shell on windows runners in release build matrix ([1cc1b31])
- **ci:** release binaries embed tree-sitter grammars and Typst plugin
  ([d2fb33b])
- **repo:** make just compile work with bundled WASM grammars and Typst plugin
  ([2bb434a])
- **lsp:** bind stdio transport explicitly and accept --stdio on lsp subcommand
  ([855862c])
- **ci:** use git init -b main for portability across git versions ([3a4160e])
- **core:** suppress MSL-R010 for profile-declared attributes ([5c2c7a2])
- **core:** exempt Type classification trailer from MSL-R010 ([5cdf13c])
- **core:** accept file:// in specifier error messages + tests ([ef3bed8])
- **render:** resolve relative image paths against source doc ([ad78f24])

[0.3.0]: https://github.com/driftsys/markspec/compare/v0.2.1...v0.3.0
[5112353]: https://github.com/driftsys/markspec/commit/5112353
[51267d7]: https://github.com/driftsys/markspec/commit/51267d7
[3ebfff8]: https://github.com/driftsys/markspec/commit/3ebfff8
[46340fe]: https://github.com/driftsys/markspec/commit/46340fe
[56c8d9d]: https://github.com/driftsys/markspec/commit/56c8d9d
[f9e29e0]: https://github.com/driftsys/markspec/commit/f9e29e0
[b31a185]: https://github.com/driftsys/markspec/commit/b31a185
[a6048a6]: https://github.com/driftsys/markspec/commit/a6048a6
[85f113b]: https://github.com/driftsys/markspec/commit/85f113b
[f78bbfe]: https://github.com/driftsys/markspec/commit/f78bbfe
[7e2e5d1]: https://github.com/driftsys/markspec/commit/7e2e5d1
[2bb28c6]: https://github.com/driftsys/markspec/commit/2bb28c6
[cbd6a62]: https://github.com/driftsys/markspec/commit/cbd6a62
[6df9fde]: https://github.com/driftsys/markspec/commit/6df9fde
[1a2a99a]: https://github.com/driftsys/markspec/commit/1a2a99a
[8b1a769]: https://github.com/driftsys/markspec/commit/8b1a769
[23e1a3f]: https://github.com/driftsys/markspec/commit/23e1a3f
[ac0f8ad]: https://github.com/driftsys/markspec/commit/ac0f8ad
[3ab6e1a]: https://github.com/driftsys/markspec/commit/3ab6e1a
[651773c]: https://github.com/driftsys/markspec/commit/651773c
[ee94acf]: https://github.com/driftsys/markspec/commit/ee94acf
[74f0354]: https://github.com/driftsys/markspec/commit/74f0354
[9c1d4d9]: https://github.com/driftsys/markspec/commit/9c1d4d9
[b5763f6]: https://github.com/driftsys/markspec/commit/b5763f6
[2929ebb]: https://github.com/driftsys/markspec/commit/2929ebb
[271141e]: https://github.com/driftsys/markspec/commit/271141e
[5a02131]: https://github.com/driftsys/markspec/commit/5a02131
[c77b741]: https://github.com/driftsys/markspec/commit/c77b741
[64b6748]: https://github.com/driftsys/markspec/commit/64b6748
[dd4cbb4]: https://github.com/driftsys/markspec/commit/dd4cbb4
[df43f76]: https://github.com/driftsys/markspec/commit/df43f76
[35b88af]: https://github.com/driftsys/markspec/commit/35b88af
[c745a7c]: https://github.com/driftsys/markspec/commit/c745a7c
[1a9f7b8]: https://github.com/driftsys/markspec/commit/1a9f7b8
[44e688d]: https://github.com/driftsys/markspec/commit/44e688d
[7f6e361]: https://github.com/driftsys/markspec/commit/7f6e361
[989c4bf]: https://github.com/driftsys/markspec/commit/989c4bf
[7b68c0c]: https://github.com/driftsys/markspec/commit/7b68c0c
[59ef77f]: https://github.com/driftsys/markspec/commit/59ef77f
[178f935]: https://github.com/driftsys/markspec/commit/178f935
[843a80d]: https://github.com/driftsys/markspec/commit/843a80d
[faacd6b]: https://github.com/driftsys/markspec/commit/faacd6b
[048fd85]: https://github.com/driftsys/markspec/commit/048fd85
[3ab4508]: https://github.com/driftsys/markspec/commit/3ab4508
[3152866]: https://github.com/driftsys/markspec/commit/3152866
[6e152e9]: https://github.com/driftsys/markspec/commit/6e152e9
[7a1c177]: https://github.com/driftsys/markspec/commit/7a1c177
[f68ed59]: https://github.com/driftsys/markspec/commit/f68ed59
[2bb2686]: https://github.com/driftsys/markspec/commit/2bb2686
[e915afb]: https://github.com/driftsys/markspec/commit/e915afb
[3501754]: https://github.com/driftsys/markspec/commit/3501754
[588e663]: https://github.com/driftsys/markspec/commit/588e663
[80d9b96]: https://github.com/driftsys/markspec/commit/80d9b96
[6bbbb4c]: https://github.com/driftsys/markspec/commit/6bbbb4c
[edb7f83]: https://github.com/driftsys/markspec/commit/edb7f83
[1ffd424]: https://github.com/driftsys/markspec/commit/1ffd424
[886be4e]: https://github.com/driftsys/markspec/commit/886be4e
[c507688]: https://github.com/driftsys/markspec/commit/c507688
[18b7a34]: https://github.com/driftsys/markspec/commit/18b7a34
[df53543]: https://github.com/driftsys/markspec/commit/df53543
[#55]: https://github.com/driftsys/markspec/issues/55
[#59]: https://github.com/driftsys/markspec/issues/59
[12708ec]: https://github.com/driftsys/markspec/commit/12708ec
[ac2984c]: https://github.com/driftsys/markspec/commit/ac2984c
[389a521]: https://github.com/driftsys/markspec/commit/389a521
[7748229]: https://github.com/driftsys/markspec/commit/7748229
[a8dc165]: https://github.com/driftsys/markspec/commit/a8dc165
[3b37cfa]: https://github.com/driftsys/markspec/commit/3b37cfa
[aa3358e]: https://github.com/driftsys/markspec/commit/aa3358e
[33ba6e6]: https://github.com/driftsys/markspec/commit/33ba6e6
[aa26297]: https://github.com/driftsys/markspec/commit/aa26297
[7892121]: https://github.com/driftsys/markspec/commit/7892121
[87492f9]: https://github.com/driftsys/markspec/commit/87492f9
[fe1d972]: https://github.com/driftsys/markspec/commit/fe1d972
[a53d16a]: https://github.com/driftsys/markspec/commit/a53d16a
[781ccb4]: https://github.com/driftsys/markspec/commit/781ccb4
[707eb1c]: https://github.com/driftsys/markspec/commit/707eb1c
[fab85d1]: https://github.com/driftsys/markspec/commit/fab85d1
[512bb3a]: https://github.com/driftsys/markspec/commit/512bb3a
[9cc8e83]: https://github.com/driftsys/markspec/commit/9cc8e83
[0860e19]: https://github.com/driftsys/markspec/commit/0860e19
[34e6789]: https://github.com/driftsys/markspec/commit/34e6789
[b9b9d18]: https://github.com/driftsys/markspec/commit/b9b9d18
[0b7bb2d]: https://github.com/driftsys/markspec/commit/0b7bb2d
[f0467e0]: https://github.com/driftsys/markspec/commit/f0467e0
[8d6b39a]: https://github.com/driftsys/markspec/commit/8d6b39a
[10b29f8]: https://github.com/driftsys/markspec/commit/10b29f8
[c190b0a]: https://github.com/driftsys/markspec/commit/c190b0a
[c209486]: https://github.com/driftsys/markspec/commit/c209486
[8256840]: https://github.com/driftsys/markspec/commit/8256840
[89d5cb7]: https://github.com/driftsys/markspec/commit/89d5cb7
[bed51cc]: https://github.com/driftsys/markspec/commit/bed51cc
[c600d98]: https://github.com/driftsys/markspec/commit/c600d98
[184e5bc]: https://github.com/driftsys/markspec/commit/184e5bc
[d138179]: https://github.com/driftsys/markspec/commit/d138179
[b6d43d1]: https://github.com/driftsys/markspec/commit/b6d43d1
[26b7ae5]: https://github.com/driftsys/markspec/commit/26b7ae5
[c96d028]: https://github.com/driftsys/markspec/commit/c96d028
[2f830ac]: https://github.com/driftsys/markspec/commit/2f830ac
[d852272]: https://github.com/driftsys/markspec/commit/d852272
[1e09411]: https://github.com/driftsys/markspec/commit/1e09411
[7d753e1]: https://github.com/driftsys/markspec/commit/7d753e1
[31ec592]: https://github.com/driftsys/markspec/commit/31ec592
[5a05b2f]: https://github.com/driftsys/markspec/commit/5a05b2f
[b5a013c]: https://github.com/driftsys/markspec/commit/b5a013c
[3ab0e08]: https://github.com/driftsys/markspec/commit/3ab0e08
[7ae074a]: https://github.com/driftsys/markspec/commit/7ae074a
[cab5ce0]: https://github.com/driftsys/markspec/commit/cab5ce0
[5e9e61c]: https://github.com/driftsys/markspec/commit/5e9e61c
[d037767]: https://github.com/driftsys/markspec/commit/d037767
[7c5a334]: https://github.com/driftsys/markspec/commit/7c5a334
[b89b6e5]: https://github.com/driftsys/markspec/commit/b89b6e5
[cc1fff0]: https://github.com/driftsys/markspec/commit/cc1fff0
[607daf0]: https://github.com/driftsys/markspec/commit/607daf0
[d50140a]: https://github.com/driftsys/markspec/commit/d50140a
[f1edf45]: https://github.com/driftsys/markspec/commit/f1edf45
[9461ff6]: https://github.com/driftsys/markspec/commit/9461ff6
[e0aaaee]: https://github.com/driftsys/markspec/commit/e0aaaee
[ba7bc47]: https://github.com/driftsys/markspec/commit/ba7bc47
[fb65923]: https://github.com/driftsys/markspec/commit/fb65923
[a509f03]: https://github.com/driftsys/markspec/commit/a509f03
[6445918]: https://github.com/driftsys/markspec/commit/6445918
[fe1af02]: https://github.com/driftsys/markspec/commit/fe1af02
[13575d6]: https://github.com/driftsys/markspec/commit/13575d6
[c456661]: https://github.com/driftsys/markspec/commit/c456661
[1cc1b31]: https://github.com/driftsys/markspec/commit/1cc1b31
[d2fb33b]: https://github.com/driftsys/markspec/commit/d2fb33b
[2bb434a]: https://github.com/driftsys/markspec/commit/2bb434a
[855862c]: https://github.com/driftsys/markspec/commit/855862c
[3a4160e]: https://github.com/driftsys/markspec/commit/3a4160e
[5c2c7a2]: https://github.com/driftsys/markspec/commit/5c2c7a2
[5cdf13c]: https://github.com/driftsys/markspec/commit/5cdf13c
[ef3bed8]: https://github.com/driftsys/markspec/commit/ef3bed8
[ad78f24]: https://github.com/driftsys/markspec/commit/ad78f24

## [0.2.1] (2026-04-18)

### Bug Fixes

- **ci:** update .githooks for git-std 0.11.1 API ([02cfeea])
- **ci:** fix deno fmt line length in gen_theme.ts ([dfe26a7])
- **ci:** update deno fmt excludes and regenerate theme headers after theme/
  move ([d4b90ae])
- **ci:** pin git-std to v0.10.2 to fix broken conventional commits check
  ([72fab14])
- **ci:** exclude docs/examples/ from dprint markdown formatter ([81205af])
- **render:** fix single-element Typst array, deferred cross-ref links, label
  line wrap ([98e25bd])
- **ci:** add --allow-env --allow-ffi to test step for typst napi addon
  ([b1b1858])

### Refactoring

- **core:** phase 5c — remove dead standalone-annotation link plumbing
  ([7aa0bd1]), refs [#198]
- **core:** phase 2b-i — drop standalone Verifies/Implements annotation path
  ([0439e6b]), refs [#198]
- **docs:** consolidate ADRs and reorganize documentation structure ([9845e70])
- **docs:** restructure spec books, consolidate theme/, move cheatsheet
  ([9eab514])

### Documentation

- **docs:** migrate user-facing entry examples to four-family model ([e69036e]),
  refs [#215]
- **spec:** phase 6b — align §8.3 MSL-T table with implementation, fix ULID
  examples ([18a9fa3]), refs [#198]
- **spec:** fix stale front-matter normalization rule (ADR-007) ([5244136])
- **docs:** make MSL-D008 (non-relative image paths) an error ([5c14e70])
- **docs:** restructure diagrams by use case, add PNG support ([342c31f])
- **docs:** tighten diagram conventions (relative paths, preferred formats)
  ([2c74384])
- **spec:** align language spec with ADR-007 (front matter) ([ff3ce51])
- **docs:** add ADR-007 for document structure and front matter ([b1c7013])
- **spec:** replace warning admonition with a table in entry-block example
  ([d576f0e])
- **docs:** add universal attributes, value types, Status, properties
  ([40d312e])
- **docs:** rewrite ADR-002 and language spec for four-family model ([2770a47])
- **docs:** add Test and Element entry families to ADR-002 ([154151c])
- **docs:** mark old ADR-002 requirement authoring as superseded ([b8cf971])
- **spec:** update language.md for ADR-002 entry model ([227bf6d])
- **docs:** document entry rendering, color tokens, and reorder typography spec
  ([43e05c8])

### Features

- **cli:** add markspec migrate — legacy Id: → Spec-id: rewrite ([c4fbc09]),
  refs [#215]
- **core:** phase 6a — end-to-end four-family fixture + citation slug fix
  ([910282d]), refs [#198]
- **core:** phase 5b — integrate front matter into parseFile and compile
  ([7d2ddff]), refs [#198]
- **core:** phase 5a — compiler extracts new traceability link kinds
  ([60a5c04]), refs [#198]
- **core:** phase 4c — front-matter canonical form ([fc232f8]), refs [#198]
- **core:** phase 4b — multi-line trailer canonicalization ([393fffc]), refs
  [#198]
- **core:** phase 4a — formatter identity assignment and canonical orders
  ([becafec]), refs [#198]
- **core:** phase 3c — family-aware traceability checks (MSL-T001..T013)
  ([2137fd8]), refs [#198]
- **core:** phase 3b — validate enum attribute values (MSL-R014) ([331e2f1]),
  refs [#198]
- **core:** phase 3a — validator rules for new identity attributes
  ([89d83c9]), refs [#198]
- **core:** phase 2b-iii — collate repeatable attributes into typed map
  ([cdfacdb]), refs [#198]
- **core:** phase 2b-ii — identity-attribute family discrimination in parser
  ([63ec936]), refs [#198]
- **core:** phase 2a — front-matter parser and additive parser changes
  ([74fd645]), refs [#198]
- **core:** add four-family entry model types and attribute catalog ([eb33cd8]),
  refs [#198]
- **core:** implement ADR-002 entry model with family discrimination ([23a38b4])
- **book:** implement markspec book build CLI command ([#182]) ([ad7b7f2]),
  closes [#182]
- **book:** implement book/ library module with SUMMARY.md parser and HTML
  renderer ([b29301d]), closes [#47]
- **render:** admonition-style entry block rendering ([ca82915]), closes [#175],
  [#177], [#178], #179.
Relates to #176.
- **render:** add requirement block styling ([#46]) ([6c0be2c])
- **repo:** commit WASM grammars via Git LFS ([4f361a7])
- **repo:** fetch grammars during bootstrap ([61aa15f])
- **render:** add mustache preprocessing ([#172]) ([2901636])
- **render:** add caption numbering ([#45]) ([#170]) ([4971997])
- **render:** add include directive processing ([#44]) ([#169]) ([98956f3])
- **core:** add grammar lockfile and auto-update workflow ([adb7c51])
- **render:** add render module with Typst PDF compilation ([#42]) ([3f3afb7])
- **core:** enable Kotlin grammar fetching via GitHub Release ([30e7767])
- **core:** display ID assignment and source file formatting ([476149a]), closes
  [#19], [#18], [#10]
- **core:** extract Verifies/Implements annotations from source doc comments
  ([#11]) ([7e2efa3])

[0.2.1]: https://github.com/driftsys/markspec/compare/v0.2.0...v0.2.1
[02cfeea]: https://github.com/driftsys/markspec/commit/02cfeea
[dfe26a7]: https://github.com/driftsys/markspec/commit/dfe26a7
[d4b90ae]: https://github.com/driftsys/markspec/commit/d4b90ae
[72fab14]: https://github.com/driftsys/markspec/commit/72fab14
[81205af]: https://github.com/driftsys/markspec/commit/81205af
[98e25bd]: https://github.com/driftsys/markspec/commit/98e25bd
[b1b1858]: https://github.com/driftsys/markspec/commit/b1b1858
[7aa0bd1]: https://github.com/driftsys/markspec/commit/7aa0bd1
[#198]: https://github.com/driftsys/markspec/issues/198
[0439e6b]: https://github.com/driftsys/markspec/commit/0439e6b
[9845e70]: https://github.com/driftsys/markspec/commit/9845e70
[9eab514]: https://github.com/driftsys/markspec/commit/9eab514
[e69036e]: https://github.com/driftsys/markspec/commit/e69036e
[#215]: https://github.com/driftsys/markspec/issues/215
[18a9fa3]: https://github.com/driftsys/markspec/commit/18a9fa3
[5244136]: https://github.com/driftsys/markspec/commit/5244136
[5c14e70]: https://github.com/driftsys/markspec/commit/5c14e70
[342c31f]: https://github.com/driftsys/markspec/commit/342c31f
[2c74384]: https://github.com/driftsys/markspec/commit/2c74384
[ff3ce51]: https://github.com/driftsys/markspec/commit/ff3ce51
[b1c7013]: https://github.com/driftsys/markspec/commit/b1c7013
[d576f0e]: https://github.com/driftsys/markspec/commit/d576f0e
[40d312e]: https://github.com/driftsys/markspec/commit/40d312e
[2770a47]: https://github.com/driftsys/markspec/commit/2770a47
[154151c]: https://github.com/driftsys/markspec/commit/154151c
[b8cf971]: https://github.com/driftsys/markspec/commit/b8cf971
[227bf6d]: https://github.com/driftsys/markspec/commit/227bf6d
[43e05c8]: https://github.com/driftsys/markspec/commit/43e05c8
[c4fbc09]: https://github.com/driftsys/markspec/commit/c4fbc09
[910282d]: https://github.com/driftsys/markspec/commit/910282d
[7d2ddff]: https://github.com/driftsys/markspec/commit/7d2ddff
[60a5c04]: https://github.com/driftsys/markspec/commit/60a5c04
[fc232f8]: https://github.com/driftsys/markspec/commit/fc232f8
[393fffc]: https://github.com/driftsys/markspec/commit/393fffc
[becafec]: https://github.com/driftsys/markspec/commit/becafec
[2137fd8]: https://github.com/driftsys/markspec/commit/2137fd8
[331e2f1]: https://github.com/driftsys/markspec/commit/331e2f1
[89d83c9]: https://github.com/driftsys/markspec/commit/89d83c9
[cdfacdb]: https://github.com/driftsys/markspec/commit/cdfacdb
[63ec936]: https://github.com/driftsys/markspec/commit/63ec936
[74fd645]: https://github.com/driftsys/markspec/commit/74fd645
[eb33cd8]: https://github.com/driftsys/markspec/commit/eb33cd8
[23a38b4]: https://github.com/driftsys/markspec/commit/23a38b4
[ad7b7f2]: https://github.com/driftsys/markspec/commit/ad7b7f2
[#182]: https://github.com/driftsys/markspec/issues/182
[b29301d]: https://github.com/driftsys/markspec/commit/b29301d
[#47]: https://github.com/driftsys/markspec/issues/47
[ca82915]: https://github.com/driftsys/markspec/commit/ca82915
[#175]: https://github.com/driftsys/markspec/issues/175
[#177]: https://github.com/driftsys/markspec/issues/177
[#178]: https://github.com/driftsys/markspec/issues/178
[6c0be2c]: https://github.com/driftsys/markspec/commit/6c0be2c
[#46]: https://github.com/driftsys/markspec/issues/46
[4f361a7]: https://github.com/driftsys/markspec/commit/4f361a7
[61aa15f]: https://github.com/driftsys/markspec/commit/61aa15f
[2901636]: https://github.com/driftsys/markspec/commit/2901636
[#172]: https://github.com/driftsys/markspec/issues/172
[4971997]: https://github.com/driftsys/markspec/commit/4971997
[#45]: https://github.com/driftsys/markspec/issues/45
[#170]: https://github.com/driftsys/markspec/issues/170
[98956f3]: https://github.com/driftsys/markspec/commit/98956f3
[#44]: https://github.com/driftsys/markspec/issues/44
[#169]: https://github.com/driftsys/markspec/issues/169
[adb7c51]: https://github.com/driftsys/markspec/commit/adb7c51
[3f3afb7]: https://github.com/driftsys/markspec/commit/3f3afb7
[#42]: https://github.com/driftsys/markspec/issues/42
[30e7767]: https://github.com/driftsys/markspec/commit/30e7767
[476149a]: https://github.com/driftsys/markspec/commit/476149a
[#19]: https://github.com/driftsys/markspec/issues/19
[#18]: https://github.com/driftsys/markspec/issues/18
[#10]: https://github.com/driftsys/markspec/issues/10
[7e2efa3]: https://github.com/driftsys/markspec/commit/7e2efa3
[#11]: https://github.com/driftsys/markspec/issues/11

## [0.2.0] (2026-03-30)

### Documentation

- **spec:** update dependency model — process, dependencies, references
  ([21ce65b])
- **spec:** replace inline JSON schemas with driftsys/schemas reference ([#137])
  ([d31af1e])
- **spec:** add traceability strategy, lock sidecar, and site-schema spec
  ([8440030])
- **spec:** add AST extensions spec, widen display ID pattern ([89e0f23])

### Features

- **core:** wire parseSource into compiler and CLI validate ([#148]) ([#152])
  ([c25d12c])
- **core:** tree-sitter source parser for doc comment extraction ([#129])
  ([1c28c90])
- **cli:** report subcommand with filters ([#122]) ([31a0238]), closes [#37]
- **core:** traceability matrix and coverage reports ([#120]) ([9af3ea9]),
  closes [#35], closes #36
- **core:** JSON export schema and serialization helper ([#31]) ([9ec0a03])
- **cli:** show, context, and dependents query commands ([#32], [#33], [#34])
  ([4c66c3c])
- **core:** compiler with traceability graph ([#30], [#95]) ([#114])
  ([a497dfb]), closes [#30], closes #95
- **cli:** validate subcommand with exit codes and --strict ([#24]) ([#109])
  ([71b7a34]), closes [#24]
- **core:** structural and reference validation ([#20], [#21]) ([#107])
  ([d27df54]), closes [#20], closes #21
- **cli:** format subcommand with file args and --check mode ([#17]) ([#106])
  ([58acd8b]), closes [#17]
- **core:** ULID assignment for entries missing Id ([#15]) ([#105]) ([c7af3e1]),
  closes [#15]
- **core:** attribute block normalization ([#16]) ([#102]) ([f751bce])
- **core:** inline reference detection ([#101]) ([2ad1b1d])
- **core:** directive extraction from HTML comments ([#99]) ([a9a3398])
- **core:** caption detection for tables and figures ([#14]) ([#100])
  ([a2a8103])
- **core:** entry exclusion checks from AST spec §1 ([#98]) ([7a7555f])
- **core:** implement markdown entry extraction and attribute parsing
  ([0f813f9])
- **core:** add project discovery and config schema validation ([#88])
  ([d67a0ee]), closes [#6], [#7]
- **cli:** add subcommand routing with Cliffy ([#87]) ([df08c76]), closes [#5],
  [#4]
- **core:** add library module, model types, and public exports ([#86])
  ([e46d7a2]), closes [#5]

### Bug Fixes

- **core:** debt cleanup — regex escape, version warning, help cmd ([#91],
  [#90], [#89]) ([d5b4745])
- **core:** CI grammar cache, concurrent-safe loadGrammar, validate E2E ([#149],
  [#150], [#151]) ([#153]) ([0e97943]), closes [#149], closes #150, closes #151
- **core:** validate Allocates targets and Between party count ([#110])
  ([b1df78b]), closes [#110]
- **core:** wire Verifies and Implements attribute links ([#117]) ([65347f3]),
  closes [#117]
- **core:** debt quickwins — REF_ID_RE, CLI options, exports, diagnostics,
  schema ([#111], [#112], [#113], [#118], [#119]) ([#124]) ([8177909])
- **core:** phase 1 review fixes — types, portability, data integrity ([#123])
  ([53b5397])
- **core:** format long line in validator test for CI ([71a37bd])
- **core:** format long lines for CI compatibility ([b610845])
- **core:** ULID regex accepts real 26-char ULIDs, extract shared findItemEnd
  ([253093f])
- **cli:** format main.ts for CI deno fmt compatibility ([0faa129])
- **core:** share ATTR_LINE_RE, handle file-not-found in format CLI ([ebd35d6])
- **core:** sortAttributes duplication bugs with unknown and duplicate keys
  ([83e3770])
- **core:** task list exclusion, display ID regex, dynamic indent ([#96])
  ([a106c8a])
- **ci:** add write and run permissions for e2e tests ([e9d4319])
- **repo:** exclude generated SVG diagrams from deno fmt ([551bc3b])
- **docs:** remove Typst/Touying features from cheat sheet ([07d52cb])

[0.2.0]: https://github.com/driftsys/markspec/compare/v0.1.0...v0.2.0
[21ce65b]: https://github.com/driftsys/markspec/commit/21ce65b
[d31af1e]: https://github.com/driftsys/markspec/commit/d31af1e
[#137]: https://github.com/driftsys/markspec/issues/137
[8440030]: https://github.com/driftsys/markspec/commit/8440030
[89e0f23]: https://github.com/driftsys/markspec/commit/89e0f23
[c25d12c]: https://github.com/driftsys/markspec/commit/c25d12c
[#148]: https://github.com/driftsys/markspec/issues/148
[#152]: https://github.com/driftsys/markspec/issues/152
[1c28c90]: https://github.com/driftsys/markspec/commit/1c28c90
[#129]: https://github.com/driftsys/markspec/issues/129
[31a0238]: https://github.com/driftsys/markspec/commit/31a0238
[#122]: https://github.com/driftsys/markspec/issues/122
[#37]: https://github.com/driftsys/markspec/issues/37
[9af3ea9]: https://github.com/driftsys/markspec/commit/9af3ea9
[#120]: https://github.com/driftsys/markspec/issues/120
[#35]: https://github.com/driftsys/markspec/issues/35
[9ec0a03]: https://github.com/driftsys/markspec/commit/9ec0a03
[#31]: https://github.com/driftsys/markspec/issues/31
[4c66c3c]: https://github.com/driftsys/markspec/commit/4c66c3c
[#32]: https://github.com/driftsys/markspec/issues/32
[#33]: https://github.com/driftsys/markspec/issues/33
[#34]: https://github.com/driftsys/markspec/issues/34
[a497dfb]: https://github.com/driftsys/markspec/commit/a497dfb
[#30]: https://github.com/driftsys/markspec/issues/30
[#95]: https://github.com/driftsys/markspec/issues/95
[#114]: https://github.com/driftsys/markspec/issues/114
[71b7a34]: https://github.com/driftsys/markspec/commit/71b7a34
[#24]: https://github.com/driftsys/markspec/issues/24
[#109]: https://github.com/driftsys/markspec/issues/109
[d27df54]: https://github.com/driftsys/markspec/commit/d27df54
[#20]: https://github.com/driftsys/markspec/issues/20
[#21]: https://github.com/driftsys/markspec/issues/21
[#107]: https://github.com/driftsys/markspec/issues/107
[58acd8b]: https://github.com/driftsys/markspec/commit/58acd8b
[#17]: https://github.com/driftsys/markspec/issues/17
[#106]: https://github.com/driftsys/markspec/issues/106
[c7af3e1]: https://github.com/driftsys/markspec/commit/c7af3e1
[#15]: https://github.com/driftsys/markspec/issues/15
[#105]: https://github.com/driftsys/markspec/issues/105
[f751bce]: https://github.com/driftsys/markspec/commit/f751bce
[#16]: https://github.com/driftsys/markspec/issues/16
[#102]: https://github.com/driftsys/markspec/issues/102
[2ad1b1d]: https://github.com/driftsys/markspec/commit/2ad1b1d
[#101]: https://github.com/driftsys/markspec/issues/101
[a9a3398]: https://github.com/driftsys/markspec/commit/a9a3398
[#99]: https://github.com/driftsys/markspec/issues/99
[a2a8103]: https://github.com/driftsys/markspec/commit/a2a8103
[#14]: https://github.com/driftsys/markspec/issues/14
[#100]: https://github.com/driftsys/markspec/issues/100
[7a7555f]: https://github.com/driftsys/markspec/commit/7a7555f
[#98]: https://github.com/driftsys/markspec/issues/98
[0f813f9]: https://github.com/driftsys/markspec/commit/0f813f9
[d67a0ee]: https://github.com/driftsys/markspec/commit/d67a0ee
[#88]: https://github.com/driftsys/markspec/issues/88
[#6]: https://github.com/driftsys/markspec/issues/6
[#7]: https://github.com/driftsys/markspec/issues/7
[df08c76]: https://github.com/driftsys/markspec/commit/df08c76
[#87]: https://github.com/driftsys/markspec/issues/87
[#5]: https://github.com/driftsys/markspec/issues/5
[#4]: https://github.com/driftsys/markspec/issues/4
[e46d7a2]: https://github.com/driftsys/markspec/commit/e46d7a2
[#86]: https://github.com/driftsys/markspec/issues/86
[d5b4745]: https://github.com/driftsys/markspec/commit/d5b4745
[#91]: https://github.com/driftsys/markspec/issues/91
[#90]: https://github.com/driftsys/markspec/issues/90
[#89]: https://github.com/driftsys/markspec/issues/89
[0e97943]: https://github.com/driftsys/markspec/commit/0e97943
[#149]: https://github.com/driftsys/markspec/issues/149
[#150]: https://github.com/driftsys/markspec/issues/150
[#151]: https://github.com/driftsys/markspec/issues/151
[#153]: https://github.com/driftsys/markspec/issues/153
[b1df78b]: https://github.com/driftsys/markspec/commit/b1df78b
[#110]: https://github.com/driftsys/markspec/issues/110
[65347f3]: https://github.com/driftsys/markspec/commit/65347f3
[#117]: https://github.com/driftsys/markspec/issues/117
[8177909]: https://github.com/driftsys/markspec/commit/8177909
[#111]: https://github.com/driftsys/markspec/issues/111
[#112]: https://github.com/driftsys/markspec/issues/112
[#113]: https://github.com/driftsys/markspec/issues/113
[#118]: https://github.com/driftsys/markspec/issues/118
[#119]: https://github.com/driftsys/markspec/issues/119
[#124]: https://github.com/driftsys/markspec/issues/124
[53b5397]: https://github.com/driftsys/markspec/commit/53b5397
[#123]: https://github.com/driftsys/markspec/issues/123
[71a37bd]: https://github.com/driftsys/markspec/commit/71a37bd
[b610845]: https://github.com/driftsys/markspec/commit/b610845
[253093f]: https://github.com/driftsys/markspec/commit/253093f
[0faa129]: https://github.com/driftsys/markspec/commit/0faa129
[ebd35d6]: https://github.com/driftsys/markspec/commit/ebd35d6
[83e3770]: https://github.com/driftsys/markspec/commit/83e3770
[a106c8a]: https://github.com/driftsys/markspec/commit/a106c8a
[#96]: https://github.com/driftsys/markspec/issues/96
[e9d4319]: https://github.com/driftsys/markspec/commit/e9d4319
[551bc3b]: https://github.com/driftsys/markspec/commit/551bc3b
[07d52cb]: https://github.com/driftsys/markspec/commit/07d52cb

## [0.1.0] (2026-03-23)

### Bug Fixes

- **repo:** use import map for script deps, remove unused ptToRem ([5f10e26])
- **spec:** namespace CSS tokens, add Google Fonts import ([966ea89])
- **repo:** move tokens guard to hook, keep script unconditional ([d4c629b])
- **repo:** only check tokens when tokens.yaml is staged ([7af6d15])

### Features

- **spec:** shared design tokens with Typst + CSS generation ([c82ac5e])
- **typst:** integrate Touying for slide decks, polish package ([8ee097a])
- **typst:** scaffold markspec-typst package with doc and deck templates
  ([3b8a647])

### Documentation

- **spec:** write typography specification with visual examples ([c251103])
- **repo:** add ADR/SAD templates and MarkSpec cheat sheet ([ab4a698])

[0.1.0]: https://github.com/driftsys/markspec/compare/v0.0.3...v0.1.0
[5f10e26]: https://github.com/driftsys/markspec/commit/5f10e26
[966ea89]: https://github.com/driftsys/markspec/commit/966ea89
[d4c629b]: https://github.com/driftsys/markspec/commit/d4c629b
[7af6d15]: https://github.com/driftsys/markspec/commit/7af6d15
[c82ac5e]: https://github.com/driftsys/markspec/commit/c82ac5e
[8ee097a]: https://github.com/driftsys/markspec/commit/8ee097a
[3b8a647]: https://github.com/driftsys/markspec/commit/3b8a647
[c251103]: https://github.com/driftsys/markspec/commit/c251103
[ab4a698]: https://github.com/driftsys/markspec/commit/ab4a698

## [0.0.3] (2026-03-23)

### Bug Fixes

- **ci:** skip type check and tests in dnt build, use package import map
  ([0c2062a])

[0.0.3]: https://github.com/driftsys/markspec/compare/v0.0.2...v0.0.3
[0c2062a]: https://github.com/driftsys/markspec/commit/0c2062a

## [0.0.2] (2026-03-23)

### Bug Fixes

- **ci:** use npm provenance for trusted publishing ([4873a20])

### Documentation

- **repo:** add JSR and docs badges to README ([b7c042c])
- **repo:** add Node.js compatibility rule to AGENTS.md ([06ccb1d])

[0.0.2]: https://github.com/driftsys/markspec/compare/v0.0.1...v0.0.2
[4873a20]: https://github.com/driftsys/markspec/commit/4873a20
[b7c042c]: https://github.com/driftsys/markspec/commit/b7c042c
[06ccb1d]: https://github.com/driftsys/markspec/commit/06ccb1d

## 0.0.1 (2026-03-23)

### Documentation

- **repo:** add PR review rule to AGENTS.md ([dd0f0f1])
- **repo:** add CI and license badges to README ([f1f0101])
- **repo:** wrap bare URLs in CODE_OF_CONDUCT.md ([0d30ef6])

### Bug Fixes

- **docs:** add viewport meta tag, parameterize book-dev task ([f8e6375])
- **ci:** exclude docs/index.html from deno fmt ([d8e26df])
- **ci:** work around git-std install.sh cleanup bug ([39be50d])

[dd0f0f1]: https://github.com/driftsys/markspec/commit/dd0f0f1
[f1f0101]: https://github.com/driftsys/markspec/commit/f1f0101
[0d30ef6]: https://github.com/driftsys/markspec/commit/0d30ef6
[f8e6375]: https://github.com/driftsys/markspec/commit/f8e6375
[d8e26df]: https://github.com/driftsys/markspec/commit/d8e26df
[39be50d]: https://github.com/driftsys/markspec/commit/39be50d
