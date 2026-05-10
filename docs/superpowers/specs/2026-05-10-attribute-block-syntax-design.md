# Attribute Block Syntax — Design

**Status:** Draft **Date:** 2026-05-10 **Topic:** Switch the entry attribute
block from a hard-line-break paragraph (`Key: Value\` per line) to an indented
code block (4-space relative indent, plain `Key: Value` per line). Single
canonical form; no compact variant.

---

## 1. Problem

The current attribute block syntax is a paragraph at body-indent level whose
lines are joined by trailing `\` (CommonMark hard line breaks):

```markdown
- [SRS_BRK_0001] Sensor debouncing

  Sensor driver shall debounce raw inputs.

  Id: 01HGW2Q8MNP3RSTVWXYZABCDE\
  Satisfies: SYS_BRK_0042\
  Labels: ASIL-B
```

Recurring friction:

- The trailing `\` is silently easy to forget. When forgotten, CommonMark
  collapses the lines into a single paragraph; downstream parsing degrades or
  fails depending on tooling.
- Adding or removing an attribute line requires fixing up the trailing `\` on
  the preceding line. Diffs are noisier than they need to be.
- Authoring the block by hand is fiddly: the cursor lands on the `\`-required
  line transitions and the writer must remember to maintain them.
- The syntax exists primarily to make the rendered Markdown show each attribute
  on its own line in plain Markdown viewers. The cost (the `\` on every line)
  outweighs the benefit.

A minor secondary friction: the `Key: Value\` paragraph form does not visually
distinguish attributes from prose. A reader scanning a heavy-metadata entry
(8–12 attributes) sees a wall of identifier-shaped text in body-prose font; the
actual requirement statement is dwarfed by the metadata footer.

## 2. Goals

- **Authoring:** remove the trailing-`\` requirement. Each attribute is authored
  as a plain `Key: Value` line.
- **Readability:** in heavy-metadata entries (10+ attributes, common under
  ASPICE / ISO 26262 profiles), the metadata block must read as a single visual
  unit distinct from the body prose. The body sentence — the actual requirement
  — must hold its weight.
- **Diffs:** per-attribute line-level diffs. Adding, removing, or modifying one
  attribute touches one line.
- **Plain Markdown rendering:** GitHub / GitLab readers must see something
  legible. Run-on paragraphs and undifferentiated walls of text are not
  acceptable.
- **Doc-comment context:** the syntax must work cleanly inside source-file doc
  comments (Rust, Kotlin, Java, C, C++) where MarkSpec entries are embedded for
  V-model SRS/SWT/SIT colocation. Indent depth in doc comments matters.
- **Single canonical form:** one syntax for all attribute blocks. No conditional
  compact variant; the formatter has one rule, not a heuristic.
- **Parser simplicity:** the rule for identifying the attribute block must be
  unambiguous and trivial to express.

## 3. Decision

The attribute block is an **indented code block** at the end of the entry,
4-space indented relative to the entry body. Each line is a single `Key: Value`
pair. No trailing `\`.

```markdown
- [SRS_BRK_0001] Sensor debouncing

  Sensor driver shall debounce raw inputs over a 50 ms window.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDE
      Satisfies: SYS_BRK_0042
      Labels: ASIL-B
```

**No compact variant.** Body-less entries (citations, drafts) use the same form:

```markdown
- [iso-26262-6] ISO 26262-6:2018 — Software unit verification

      Id: urn:iso:std:iso:26262:-6:ed-2
```

### 3.1 Disambiguation rule

Within an entry block, the **trailing indented code block** — if every one of
its lines matches `Key: Value` shape — is the attribute block. Anything else
remains a regular code block.

This means the body can still embed code listings via fenced code blocks without
any conflict:

````markdown
- [SRS_BRK_0099] Threshold function

  The threshold function is defined as follows:

  ```rust
  fn threshold(input: f32) -> bool {
      input.abs() > THRESHOLD
  }
  ```

  Implementation must match this reference.

      Id: 01HGW9Z9ABCDEFGHJKLMNPQRST
      Satisfies: SYS_BRK_0099
      Labels: ASIL-B
````

The fenced code block (`rust`) is body content; the trailing indented code block
(4-space indent, all `Key: Value`) is the attribute block. Different syntactic
shapes, no ambiguity.

If an entry's trailing code block contains a non-`Key: Value` line, the parser
does not treat it as an attribute block — it remains a regular code block, and
the entry is treated as having no attribute block.

"Trailing" means _the last block of the entry_. If body prose appears after an
indented `Key: Value` block, that block is not trailing and is treated as a
regular code block (with no attribute meaning). Authors who want attributes must
place them at the very end of the entry.

### 3.2 Indent rule, precisely

- Inside a Markdown list item: entry body lives at 2-space indent (CommonMark
  list-item content alignment). Attribute block adds 4 more spaces ⇒ **6
  absolute columns** before the `Key`.
- Inside a source-file doc comment (no enclosing list): entry body lives at the
  doc-comment content column. Attribute block adds 4 spaces ⇒ doc-comment
  prefix + 4 columns before the `Key`. Example, Rust `///`: `///` + space + 4
  spaces = 8 columns before `Key`.

### 3.3 Line shape inside the attribute block

Each line is `Key: Value` where:

- `Key` matches `^[A-Z][A-Za-z-]*$` (Title-Case-Word, optionally hyphenated).
- A single colon and one or more spaces separate `Key` from `Value`.
- `Value` is the rest of the line, trimmed of trailing whitespace.
- Values containing commas (e.g., `Labels: ASIL-B, debounce`) are parsed by the
  attribute reader, not by the block-level rule.

No line continuations within the attribute block. One attribute per line.

### 3.4 No interleaving with prose

Attributes appear only as the trailing block of the entry. They cannot be
interleaved with body paragraphs. This keeps the visual model simple:
"requirement statement on top, metadata footer at bottom."

## 4. Alternatives considered

### 4.1 Sub-bullets

```markdown
- Id: 01HGW2Q8MNP3RSTVWXYZABCDE
- Satisfies: SYS_BRK_0042
- Labels: ASIL-B
```

**Rejected** for the canonical form. Strong contender on authoring ergonomics
and plain-Markdown rendering. Loses on whole-entry readability under
heavy-metadata loads: each `-` marker demands attention, so 10 bullets create 10
visual peers competing with the (single) body sentence. The metadata visually
outweighs the substance — the opposite of what we want for a requirements
document.

### 4.2 Soft-break paragraph (drop `\`)

```markdown
Id: 01HGW2Q8MNP3RSTVWXYZABCDE Satisfies: SYS_BRK_0042 Labels: ASIL-B
```

**Rejected.** Source is per-line and clean, but CommonMark soft-breaks collapse
to spaces in HTML rendering. GH/GL readers see a run-on paragraph:

> Id: 01HGW2Q8MNP3RSTVWXYZABCDE Satisfies: SYS_BRK_0042 Labels: ASIL-B

Unscannable. Also imposes a "values cannot start with `Capital-Word:`"
constraint on the parser, which is fragile against future profile-declared
free-form attributes.

### 4.3 Fenced `meta` code block

````markdown
```meta
Id: 01HGW2Q8MNP3RSTVWXYZABCDE
Satisfies: SYS_BRK_0042
Labels: ASIL-B
```
````

**Rejected.** Three triple-backticks plus an info string is heavy visual weight
for what is fundamentally a metadata footer. Nesting fenced code blocks inside
list items is also fragile across Markdown implementations.

### 4.4 `@`-prefix (Javadoc / JSDoc / Rustdoc style)

```markdown
@Id 01HGW2Q8MNP3RSTVWXYZABCDE @Satisfies SYS_BRK_0042 @Labels ASIL-B
```

**Rejected.** Familiar from doc-comment cultures, but `@` is novel in Markdown
context (no other Markdown construct uses it as a line marker). Plain readers do
a double-take. Conflicts with `@` in values (`Authors: alice@example.com`).
Semantic mismatch: Javadoc's `@param` is an _annotation of code_; MarkSpec
attributes are _structured fields of an entry record_. Git trailers (bare
`Key: Value`) match the latter mental model better.

### 4.5 Italic-wrapped lines

```markdown
_Id: 01HGW2Q8MNP3RSTVWXYZABCDE_\
_Satisfies: SYS_BRK_0042_\
_Labels: ASIL-B_
```

**Rejected.** The current spec already excludes emphasis from entry blocks
([language.md:298]). Even if lifted, italic does not solve the line-break
problem (still needs `\`). It only adds visual differentiation, which the
indented code block achieves with a different mechanism (monospace).

### 4.6 Compact one-line variants

`Id: ...; Satisfies: ...; Labels: ...` (semicolon), `Id: ... | Satisfies: ...`
(pipe), `{Id: ...; Satisfies: ...}` (curly trailer), or
`Id: ... - Satisfies: ...` (dash) on the title line or as the attribute
paragraph.

**Rejected.** Two syntaxes invite drift: the same entry can be written one way
today and another tomorrow; the formatter has to pick a heuristic ("compact when
short, block when long?") and authors will fight it. Single-line forms are also
fragile against long URIs and create whole-line-changed diffs that hide which
attribute actually changed.

The conservative read on the compact form: it solves the citation case
(body-less entries) at the cost of a parser/formatter/spec doubling. If
compactness for citations matters enough later, it should be addressed by a
**different mechanism** entirely (e.g., allowing the URI directly in the entry
header for referenced entries: `- [iso-26262-6](urn:...) Title`), which is a
separate design.

### 4.7 Status quo (paragraph + `\`)

**Rejected.** The friction is real and documented above.

## 5. Spec changes

### 5.1 `docs/spec/language/language.md` §2

Replace the attribute-block subsection. The new text covers:

- Block shape: indented code block at the end of the entry, 4 spaces relative to
  body indent.
- Line shape: `Key: Value`, one attribute per line, no continuations.
- Disambiguation: trailing indented code block whose every line matches
  `Key: Value` is the attribute block; otherwise it is a regular code block and
  the entry has no attribute block.
- Examples covering: light entry (3 attrs), heavy-metadata entry (10 attrs),
  referenced entry (citation), entry with code in body and trailing attribute
  block.
- Note: emphasis and italic remain forbidden in entry blocks (unchanged).

### 5.2 `docs/spec/language/ast.md`

Update the AST description for `Entry.rawAttributes`: source representation is
now the lines of an mdast `code` node at the entry tail, not the hard-broken
paragraph children.

### 5.3 ADR

No new ADR. This is a syntax refinement of the entry-block format defined in
ADR-001 (Markdown format) and detailed by language.md §2. Reference this design
doc from the spec change.

## 6. Implementation scope

### 6.1 Parser (`packages/markspec/core/parser/markdown.ts`)

Replace the attribute-block detector. Current detector consumes the trailing
paragraph node whose children include hard line breaks; new detector consumes
the trailing `code` node when its content lines all match `Key: Value` shape.

**Backward compatibility:** the parser must continue to accept the old
paragraph-with-`\` shape for one release cycle, so existing files keep parsing
while the formatter migrates them. Old shape produces a `MS-DEPRECATED-ATTR-001`
warning diagnostic; new shape is silent.

### 6.2 Formatter (`packages/markspec/core/formatter/mod.ts`)

The formatter:

- Reads either old or new shape.
- Emits the new shape unconditionally.
- Running `markspec format` on a file with old-shape attribute blocks rewrites
  them to the new shape. This is the migration path: one pass over the project
  converts everything.

### 6.3 Validator (`packages/markspec/core/validator/`)

No semantic changes. The validator operates on the parsed `Entry` structure,
which is unchanged. The deprecation warning emitted by the parser flows through
unchanged.

### 6.4 Tests

Test fixtures throughout the workspace use the old syntax. Affected:

- `tests/fixtures/*.md`
- `packages/markspec/core/**/*_test.ts` — many tests assemble inline test
  documents via template literals.
- `tests/e2e/*.ts` — end-to-end fixtures.

Strategy:

1. **Add new-shape tests first.** Cover the parser, formatter, and round-trip
   cases for the indented code block form.
2. **Keep old-shape tests** as-is during the transition; they verify the
   parser's backward-compatibility path. Each old-shape test additionally
   asserts the `MS-DEPRECATED-ATTR-001` warning is emitted.
3. **Migrate fixture files.** Run `markspec format` over `docs/`,
   `tests/fixtures/`, and any project source files to convert attribute blocks.
   Visually inspect the diff.
4. **Snapshot updates.** E2E snapshot files (`*.snap`) referencing the old shape
   need refresh. Run `deno test --allow-run --allow-read -- --update`, review,
   and commit.

### 6.5 LSP server (`packages/markspec/lsp/`)

- `completions.ts` — block-scaffold completion (`buildBlockScaffoldItems`) emits
  the new shape. Snippet template changes from
  `Id: \${ULID} \\\\\n  ${3:Satisfies: }` to indented-code-block form.
- `diagnostics.ts` — surfaces the deprecation warning naturally; no change.

### 6.6 Renderer (`packages/markspec/render/`)

- `render/typst/template.ts` — entry-block splicing operates on parsed `Entry`
  structure; no change.
- `render/styles/mod.ts` (`styleRequirementBlocks`) — Markdown-level transformer
  that recognizes the trailing paragraph; update to recognize the indented code
  block instead.
- `book/site/mod.ts` — book renderer same path; verify.

### 6.7 Documentation

Files with example entry blocks that need to be updated for consistency:

- `docs/spec/language/language.md` — already covered by §5.1.
- `docs/guide/*.md` — any worked examples.
- `docs/examples/entry-rendering.md` — showcase document; manual review.
- `docs/product/stakeholder-requirements.md`,
  `docs/product/software-architecture.md` — project's own STK and SAD entries;
  migrate via formatter pass.
- `AGENTS.md` — the V-model code samples in this file use the old syntax; update
  them.

### 6.8 Migration sequence

1. Implement parser dual-mode (accept both shapes; emit deprecation warning on
   old shape).
2. Implement formatter (read both, emit new). Add tests for migration
   round-trip.
3. Update the spec (language.md §2).
4. Run `markspec format` over the entire workspace. Commit the auto-migrated
   files in a single commit, separate from the implementation commit, so the
   diff is reviewable.
5. Update LSP completion snippet.
6. Update render/styles transformer.
7. Update AGENTS.md and any other manually-authored examples.
8. Set a deprecation removal target (e.g., next major release): parser drops
   old-shape support; deprecation warning becomes an error.

## 7. Risk

- **Dual-mode parser surface area.** Two acceptance paths is a footgun.
  Mitigation: the dual mode is bounded by a single feature flag, well-tested,
  and time-limited (deprecate by next minor, remove by next major).
- **Snapshot churn.** Many tests will flip. Mitigation: do the snapshot refresh
  in its own commit, after the parser/formatter changes land, with clear review
  of the diff.
- **Existing source-file doc comments in user codebases.** If users have
  embedded entries in `.rs` / `.kt` doc comments using the old syntax, they need
  migration too. The `markspec format` migration path covers `.md` files; it
  should also cover supported source-file doc comments. Confirm the formatter's
  source-file path is updated.
- **Plain-text rendering surprise.** Users browsing the repo on GH/GL will see
  attribute blocks switch from prose-shaped paragraphs to monospace indented
  blocks. The visual change is intentional but worth flagging in the changelog.

## 8. Out of scope

- A compact (single-line) attribute form. Considered and rejected (§4.6).
- Putting the URI directly in the entry header for referenced entries
  (`- [iso-26262-6](urn:...) Title`). Plausible separate design for citation
  ergonomics; not part of this change.
- Replacing emphasis-block restrictions, definition lists, or any other
  syntax-level changes to entry blocks beyond the attribute footer.

## 9. Acceptance

This design is accepted when:

1. The author and reviewer agree this trade-off is correct given the heavy
   weight placed on whole-entry readability under ASPICE / ISO 26262 metadata
   loads.
2. The migration path (`markspec format` rewrites; one-cycle deprecation) is
   judged low-risk for downstream users.
3. The spec wording in language.md §2 (drafted in §5.1 of this document) is
   approved.
