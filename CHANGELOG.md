# Changelog

> **Note on versioning.** Tags `v1.1.0`–`v1.1.3` from May 5 2026 were
> retracted — the project is still pre-stable and remains on the 0.x line.
> Their content (LSP server, multiplatform VSIX, CI release fixes) is
> incorporated into [0.3.0]. No external consumers were affected (zero
> downloads on the v1.1.3 binaries; JSR was never updated past 0.0.1).

## [0.3.0] (2026-05-07)

### Features

- **render:** profile-driven entry colors — `profile.colors:` semantic-name
  → palette-hue map and per-type `color:` field replace the prefix
  heuristic ([#257])
- **lsp:** vscode extension with diagnostics, completions, status bar item,
  debug logging, and per-platform VSIX builds
- **core:** profile system completion — npm specifier resolver, `profile
  new` / `profile add` / `profile publish` CLI commands ([#243])
- **core:** retirement model — `Deprecated:` attribute, MSL-T013 tiered
  link-target severity, drop `status:` front-matter key
- **render:** atomic-by-default rendering for entry blocks, tables, and
  code blocks; figure caption sticky-glue ([#226])

### Refactoring

- **core:** entry-model-v2 — two-shape model (`identified` / `referenced`)
  with single `Id:` attribute, ULID-or-URI format discrimination ([#225])
- **core:** rename `Entry.attributes` to `rawAttributes`; make
  `typedAttributes` and `CompileResult.documents` required

### Bug Fixes

- **render:** drop `entry-category` from Typst document import preamble
- **core:** validate per-type colors only after full chain merge
- **render:** guard `PaletteHue` cast against unvalidated input
- **ci:** pin deno --config when bundling binary in package-vsix job
- **ci:** use sha256sum on linux/windows, fall back to shasum on macos
- **ci:** use bash shell on windows runners in release build matrix
- **ci:** release binaries embed tree-sitter grammars and Typst plugin

### Architecture

- **adr-009:** anchoring core/profile boundary — core ships no type
  vocabulary; types and color roles come from profiles
- **adr-010:** bundled `@markspec/profile-default` baseline profile
- **adr-011:** language packs and SBOM-delegated dependency ingestion

### Notes

- Removes the prefix-heuristic auto-coloring (STK/SAD/SRS/SWT). Identified
  entries without a profile fall back to palette `blue`.
- Removes the `entries.req/spec/test` token group; downstream consumers of
  `--ms-entry-req` / `theme.entry-req` switch to `--ms-entry-blue` etc.
- HTML book color application is not yet wired (issue [#261]); the
  generated CSS gives every `.req-block` a blue border until book emits
  per-hue classes.

[0.3.0]: https://github.com/driftsys/markspec/compare/v0.2.1...v0.3.0
[#225]: https://github.com/driftsys/markspec/pull/225
[#226]: https://github.com/driftsys/markspec/pull/226
[#243]: https://github.com/driftsys/markspec/pull/243
[#257]: https://github.com/driftsys/markspec/pull/257
[#261]: https://github.com/driftsys/markspec/issues/261

## [1.1.0] (2026-05-05)

### Features

- **lsp:** wire vscode LSP status bar item and showOutput command ([3152866])
- **lsp:** vscode status bar item module showing LSP health ([6e152e9])
- **lsp:** emit markspec/indexed notification after initial diagnostics pass
  ([7a1c177])
- **lsp:** wire debug log into server lifecycle and uncaught error handlers
  ([f68ed59])
- **lsp:** MARKSPEC_LSP_DEBUG_LOG env-var-gated lifecycle logging ([2bb2686])
- **lsp:** add markspec.trace.debugLog setting to vscode extension ([e915afb])
- **lsp:** wire markspec lsp subcommand, add VSCode extension and editor
  integration guide ([18b7a34])

### Refactoring

- **lsp:** extract vscode serverOptions resolver into testable module
  ([5a02131])
- **core:** rename Entry.attributes to rawAttributes ([c77b741])
- **core:** make CompileResult.documents required ([64b6748])
- **core:** make Entry.typedAttributes required ([dd4cbb4])

### Bug Fixes

- **ci:** release binaries embed tree-sitter grammars and Typst plugin
  ([d2fb33b])
- **repo:** make just compile work with bundled WASM grammars and Typst plugin
  ([2bb434a])
- **lsp:** bind stdio transport explicitly and accept --stdio on lsp subcommand
  ([855862c])
- **ci:** use git init -b main for portability across git versions ([3a4160e])

### Documentation

- **docs:** document VS Code dev-mode LSP workflow ([56c8d9d])
- **docs:** switch jsonc fence to json5 so deno fmt and dprint both accept it
  ([f9e29e0])
- **docs:** drop trailing commas in spec jsonc example to satisfy deno fmt
  ([b31a185])
- **docs:** land LSP install/spawn spec and plan ([a6048a6])
- **docs:** add entry model type-safety cleanup design spec ([85f113b])
- **repo:** fix stale build commands, layout gaps, and CI flags in AGENTS.md
  ([7e2e5d1])
- **docs:** fix stale terminology, add draft banners, and write user guide pages
  ([2bb28c6])

[1.1.0]: https://github.com/driftsys/markspec/compare/v1.0.0...v1.1.0
[3152866]: https://github.com/driftsys/markspec/commit/3152866
[6e152e9]: https://github.com/driftsys/markspec/commit/6e152e9
[7a1c177]: https://github.com/driftsys/markspec/commit/7a1c177
[f68ed59]: https://github.com/driftsys/markspec/commit/f68ed59
[2bb2686]: https://github.com/driftsys/markspec/commit/2bb2686
[e915afb]: https://github.com/driftsys/markspec/commit/e915afb
[18b7a34]: https://github.com/driftsys/markspec/commit/18b7a34
[5a02131]: https://github.com/driftsys/markspec/commit/5a02131
[c77b741]: https://github.com/driftsys/markspec/commit/c77b741
[64b6748]: https://github.com/driftsys/markspec/commit/64b6748
[dd4cbb4]: https://github.com/driftsys/markspec/commit/dd4cbb4
[d2fb33b]: https://github.com/driftsys/markspec/commit/d2fb33b
[2bb434a]: https://github.com/driftsys/markspec/commit/2bb434a
[855862c]: https://github.com/driftsys/markspec/commit/855862c
[3a4160e]: https://github.com/driftsys/markspec/commit/3a4160e
[56c8d9d]: https://github.com/driftsys/markspec/commit/56c8d9d
[f9e29e0]: https://github.com/driftsys/markspec/commit/f9e29e0
[b31a185]: https://github.com/driftsys/markspec/commit/b31a185
[a6048a6]: https://github.com/driftsys/markspec/commit/a6048a6
[85f113b]: https://github.com/driftsys/markspec/commit/85f113b
[7e2e5d1]: https://github.com/driftsys/markspec/commit/7e2e5d1
[2bb28c6]: https://github.com/driftsys/markspec/commit/2bb28c6

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
- **core:** phase 3a — validator rules for new identity attributes ([89d83c9]),
  refs [#198]
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
  [#177], [#178], #179. Relates to #176.
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

[0.2.1]: https://github.com/driftsys/markspec/compare/v0.2.0...v0.2.1
[02cfeea]: https://github.com/driftsys/markspec/commit/02cfeea
[dfe26a7]: https://github.com/driftsys/markspec/commit/dfe26a7
[d4b90ae]: https://github.com/driftsys/markspec/commit/d4b90ae
[72fab14]: https://github.com/driftsys/markspec/commit/72fab14
[81205af]: https://github.com/driftsys/markspec/commit/81205af
[98e25bd]: https://github.com/driftsys/markspec/commit/98e25bd
[b1b1858]: https://github.com/driftsys/markspec/commit/b1b1858
[c4fbc09]: https://github.com/driftsys/markspec/commit/c4fbc09
[#215]: https://github.com/driftsys/markspec/issues/215
[910282d]: https://github.com/driftsys/markspec/commit/910282d
[#198]: https://github.com/driftsys/markspec/issues/198
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
[7aa0bd1]: https://github.com/driftsys/markspec/commit/7aa0bd1
[0439e6b]: https://github.com/driftsys/markspec/commit/0439e6b
[9845e70]: https://github.com/driftsys/markspec/commit/9845e70
[9eab514]: https://github.com/driftsys/markspec/commit/9eab514
[e69036e]: https://github.com/driftsys/markspec/commit/e69036e
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

## [0.2.0] (2026-03-29)

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

### Documentation

- **spec:** update dependency model — process, dependencies, references
  ([21ce65b])
- **spec:** replace inline JSON schemas with driftsys/schemas reference ([#137])
  ([d31af1e])
- **spec:** add traceability strategy, lock sidecar, and site-schema spec
  ([8440030])
- **spec:** add AST extensions spec, widen display ID pattern ([89e0f23])

[0.2.0]: https://github.com/driftsys/markspec/compare/v0.1.0...v0.2.0
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
[21ce65b]: https://github.com/driftsys/markspec/commit/21ce65b
[d31af1e]: https://github.com/driftsys/markspec/commit/d31af1e
[#137]: https://github.com/driftsys/markspec/issues/137
[8440030]: https://github.com/driftsys/markspec/commit/8440030
[89e0f23]: https://github.com/driftsys/markspec/commit/89e0f23

## [0.1.0] (2026-03-23)

### Features

- **spec:** shared design tokens with Typst + CSS generation ([c82ac5e])
- **typst:** integrate Touying for slide decks, polish package ([8ee097a])
- **typst:** scaffold markspec-typst package with doc and deck templates
  ([3b8a647])

### Documentation

- **spec:** write typography specification with visual examples ([c251103])
- **repo:** add ADR/SAD templates and MarkSpec cheat sheet ([ab4a698])

### Bug Fixes

- **repo:** use import map for script deps, remove unused ptToRem ([5f10e26])
- **spec:** namespace CSS tokens, add Google Fonts import ([966ea89])
- **repo:** move tokens guard to hook, keep script unconditional ([d4c629b])
- **repo:** only check tokens when tokens.yaml is staged ([7af6d15])

[0.1.0]: https://github.com/driftsys/markspec/compare/v0.0.3...v0.1.0
[c82ac5e]: https://github.com/driftsys/markspec/commit/c82ac5e
[8ee097a]: https://github.com/driftsys/markspec/commit/8ee097a
[3b8a647]: https://github.com/driftsys/markspec/commit/3b8a647
[c251103]: https://github.com/driftsys/markspec/commit/c251103
[ab4a698]: https://github.com/driftsys/markspec/commit/ab4a698
[5f10e26]: https://github.com/driftsys/markspec/commit/5f10e26
[966ea89]: https://github.com/driftsys/markspec/commit/966ea89
[d4c629b]: https://github.com/driftsys/markspec/commit/d4c629b
[7af6d15]: https://github.com/driftsys/markspec/commit/7af6d15
