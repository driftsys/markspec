# Changelog

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
