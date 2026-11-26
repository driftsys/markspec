# MarkSpec — Gherkin Model: Criteria and Procedures

Status: Draft\
Date: 2026-11-13\
Scope: MarkSpec core — reading Gherkin, the Gherkin AST, and lowering it into
the entry model\
Tracks: epic #915 (Gherkin AST, Case A, Case B), story #914 (git-style trailer)\
Builds on: `markspec-core-data-model.md` (§1.3.1 type resolution, §4.5 MSL-B044,
annex C compile output) and, from `docs/architecture/`: ADR-009 (core / profile
boundary), ADR-012 (diagnostic codes), ADR-013 (document directive), ADR-014 /
ADR-015 (canonical body AST and equivalence), ADR-016 (body tokens), ADR-026
(display-ID trace resolution), ADR-030 (`Entry` additions without a schema bump)

> **ADR numbering.** `markspec-core-data-model.md` cites "ADR-003 (information
> and traceability model)" and "ADR-005 (entry content model)". Those belong to
> the next-gen ADR set, which is not stored in this repository. In
> `docs/architecture/`, ADR-003 is diagram authoring and ADR-005 is the CLI
> architecture. This spec cites only `docs/architecture/` ADRs and reaches the
> next-gen model through `markspec-core-data-model.md`.

This is the Gherkin support spec for MarkSpec. It defines how authors write
Gherkin (inside an entry, and in `.feature` files), how MarkSpec parses it, and
what MarkSpec records in the model. It introduces two derived entry facets:
`criteria` on Requirement and Contract entries, and `procedure` on Test entries.
Both are computed from the entry content. Authors write no new syntax for them.

Nothing in this spec is implemented yet, except the items that §1 lists as
current behaviour.

---

## 1. Problem

Current behaviour:

- A fenced `gherkin` or `feature` block is a `FeatureNode` that holds the block
  text verbatim (`core/ast/build.ts`, `core/ast/nodes.ts`). The text is not
  parsed.
- The model has no notion of acceptance criteria. MSL-B044 detects an
  "Acceptance criteria" list with a loose text match
  (`core/validator/feature_ac.ts`).
- A locator such as `Satisfies: STK_SAFETY_0001 [acceptance-criterion-3]`
  (`docs/spec/model/relations.md`) is not supported by the compiler. Only
  `Derived-from` and `References` drop a locator; for every other relation the
  whole value, locator included, becomes the target ID (`core/compiler/mod.ts`,
  `LOCATOR_BEARING_ATTRS`).
- Coverage is counted per entry. A test cannot claim to verify one criterion of
  a requirement.
- `.feature` files are not read.

## 2. Decisions

| #   | Decision                                                                                                                                         | Section |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| D1  | Two derived facets: `criteria` (Requirement, Contract) and `procedure` (Test). The core ancestor type selects the facet.                         | §9      |
| D2  | Pickles are not used. A `Scenario Outline` stays one scenario.                                                                                   | §6, §7  |
| D3  | Step convention: a run of actions followed by a run of outcomes is one procedure step. `*` is always an action. `# Step N` is an optional label. | §7      |
| D4  | The parser is `@cucumber/gherkin`, loaded on first use.                                                                                          | §6.1    |
| D5  | A block with no `Feature:` line is valid. MarkSpec wraps it in a synthetic Feature before parsing.                                               | §6.2    |
| D6  | The address of a criterion is its scenario name. Tags and ordinals are not addresses.                                                            | §10     |
| D7  | `Verifies` and `Satisfies` accept a bracket locator, resolved against the target's `criteria`.                                                   | §10     |
| D8  | Case B: a `Feature`, `Rule` or `Scenario` with a comment header is an entry. A headed node is never a criterion or procedure of another entry.   | §5      |
| D9  | Case B: nesting is structural. It creates no relation. `Part-of` is not used.                                                                    | §5.4    |
| D10 | Case B: Gherkin `@tags` are not mapped to `Labels`.                                                                                              | §5.3    |
| D11 | Coverage is strict by default. A profile flag enables lightweight coverage.                                                                      | §12     |
| D12 | Facets are stored on `Entry` as optional fields. `CORE_SCHEMA_VERSION` does not change.                                                          | §8      |
| D13 | A duplicate scenario name in one entry is a warning, and that name is not addressable.                                                           | §10.3   |

D7 and D8 change two defaults that epic #915 lists under "Open decisions"
(scenarios in a Case A block are not addressable; a Feature-level header does
not create an entry). The epic text must be updated when this spec is accepted.

## 3. Two cases

| Case  | Where the Gherkin is                                 | What it produces                                  |
| ----- | ---------------------------------------------------- | ------------------------------------------------- |
| **A** | A fenced `feature` / `gherkin` block inside an entry | A facet of that entry (`criteria` or `procedure`) |
| **B** | A `.feature` file                                    | New entries, one per comment-headed Gherkin node  |

Both cases share the parser (§6), the normalized AST (§7) and the facets (§9).
They differ in how the result is attached to entries (§4, §5).

## 4. Gherkin inside an entry (Case A)

### 4.1 Authoring rules

1. **Fence.** The block is a fenced code block whose info string is `feature` or
   `gherkin`. The two are equivalent. `markspec fmt` does not rewrite the info
   string or the block content.
2. **Placement.** The block is part of the entry body. It is indented like the
   body (2 spaces in a Markdown list item) and stands before the attribute
   block. Prose may stand before, between and after blocks.
3. **Number of blocks.** An entry may hold several blocks. All of them lower
   into the same facet, in document order. Each block is parsed alone: a
   `Background` applies only to the scenarios of its own block.
4. **Feature line.** The `Feature:` line is optional. A block may start with
   `Background:`, `Rule:`, `Scenario:` or a tag line (§6.2). When a `Feature:`
   line is present, its name and description are kept in the AST and have no
   effect on the facet.
5. **Scenario names.** Give each scenario a name that is unique in the entry.
   The name is the address used by locators (§10).
6. **Language.** A `# language: xx` comment on the first line of the block
   selects a Gherkin spoken language.
7. **Role.** The type of the host entry decides what the block means (§9.1):
   acceptance criteria in a Requirement or Contract, a test procedure in a Test.
   In an entry of any other type the block is an illustration.
8. **No identity.** A scenario in a block is not an entry. It has no display ID,
   no `Id:` and no trailer.

### 4.2 Example — criteria of a Requirement

In the examples of this spec the `Id:` line is omitted. `markspec fmt` stamps
it.

````markdown
- [REQ_BRK_0010] Emergency braking for close obstacles

  The braking controller shall start braking when an obstacle is detected
  closer than 40 m at speeds of 60 km/h or less.

  ```feature
  Background:
    Given the vehicle drives at 60 km/h

  Scenario: Brake at 20 m
    When an obstacle appears at 20 m
    Then braking starts within 200 ms

  Scenario: No braking beyond 40 m
    When an obstacle appears at 50 m
    Then the controller does not brake
  ```

      Satisfies: STK_BRK_0001
````

`REQ_BRK_0010` resolves to Requirement, so the block lowers to two criteria,
named `Brake at 20 m` and `No braking beyond 40 m`. Each has the precondition
`the vehicle drives at 60 km/h`.

### 4.3 Example — procedure of a Test

````markdown
- [TST_BRK_0012] Brake reaction on the test bench

  ```feature
  Feature: Brake reaction

    Scenario: Brake at 20 m on the test bench
      Given the bench simulates 60 km/h
      # Step 1
      * place the target at 20 m
      Then the brake command is sent within 200 ms
      # Step 2
      * remove the target
      Then the brake command is released within 500 ms
  ```

      Verifies: REQ_BRK_0010 [Brake at 20 m]
````

`TST_BRK_0012` resolves to Test, so the block lowers to one procedure with one
precondition and two steps. The `Verifies` value carries a locator: the test
verifies the criterion `Brake at 20 m` of `REQ_BRK_0010`, and not the whole
requirement (§10, §12).

### 4.4 Example — item form

A Requirement or Contract may state its criteria as a list instead of a block
(§9.3):

```markdown
- [REQ_BRK_0020] Brake light activation

  The lighting controller shall switch on the brake lights when braking starts.

  Acceptance criteria:

  - Brake lights switch on within 100 ms of the brake command.
  - Brake lights stay on while the brake command is active.

      Satisfies: STK_BRK_0002
```

## 5. `.feature` files that describe entries (Case B)

A `.feature` file is a source file. MarkSpec reads entries from its comments, as
it does for doc comments in other source files. The file stays valid Gherkin,
because MarkSpec adds only comments.

### 5.1 The comment header

A Gherkin node is an entry when a **header comment block** stands directly above
it. The header comment block is a run of consecutive comment lines such that:

1. Its first line is `# [DISPLAY_ID] Title`.
2. Optional body paragraphs follow, separated by empty comment lines (`#`).
3. Its last paragraph may be a git-style trailer (#914): it follows an empty
   comment line, and every line in it has the form `# Key: value`. A line that
   starts with whitespace after the `#` continues the value of the line before
   it.
4. No blank line stands between the block and the node. Only the tag lines of
   the node may stand between them.

The rules of #914 apply without change: only the last paragraph can be a
trailer, and a paragraph with one line that is not `Key: value` is body text.

#### Trailer detection rule

One rule decides whether the last paragraph of an entry is a git-style trailer.
It is the same in Markdown, in source doc comments and in `.feature` comments.
The last paragraph is a trailer when all of the following hold:

1. It is a paragraph of its own, with an empty line before it. In Markdown it is
   a direct child paragraph of the entry's list item in the CommonMark AST.
2. Every line has the form `Key: Value`, or is a continuation line that starts
   with whitespace.
3. It contains an `Id:` line, or every key is in the core set of recognized
   trailer keys (`RECOGNIZED_TRAILER_KEYS`, `core/parser/markdown.ts`).

Any other final paragraph is body text. The parser has no profile at parse time,
so a key that only a profile declares qualifies only through the `Id:`
condition.

| Format              | Git-style trailer                         | `check`                | `fmt`                                  |
| ------------------- | ----------------------------------------- | ---------------------- | -------------------------------------- |
| Markdown            | accepted as a migration form              | warning (MSL-P family) | rewrites to the 6-space indented block |
| Source doc comments | canonical form; indented form stays valid | no diagnostic          | keeps the author's style, stamps `Id:` |
| `.feature` comments | canonical form                            | no diagnostic          | keeps the trailer, stamps `# Id:`      |

This rule is stricter than the parser on `main`. Today `splitBodyAndAttributes`
(`core/parser/attributes.ts`) takes every trailing `Key: value` line as an
attribute, with any capitalised key and with no empty line required. A body that
ends with a line such as `Note: …` or `Status: draft` loses that line to the
trailer without a parse diagnostic. The rule above makes such a paragraph body
text again.

A `# language: xx` line, when present, is the first line of the file and stands
above the header of the `Feature`.

### 5.2 Which nodes can be entries

| Node                                                           | Can be an entry | Default type |
| -------------------------------------------------------------- | --------------- | ------------ |
| `Feature`                                                      | yes             | Requirement  |
| `Rule`                                                         | yes             | Requirement  |
| `Scenario`, `Example`, `Scenario Outline`, `Scenario Template` | yes             | Test         |
| `Background`, `Examples`, a step                               | no              | —            |

- A header above a `Background`, an `Examples` table or a step is not an entry.
  `check` reports a warning (§13).
- A `Scenario Outline` with a header is one entry. Its `Examples` rows are data
  of that entry.
- A scenario can have a header when its `Feature` has none. The `Feature` is
  then only a container.

**Type resolution.** The default type is a new step in the resolution chain of
`markspec-core-data-model.md` §1.3.1. It stands after step 6 and before step 8:

```text
1. Explicit `Type:` attribute
2. Profile-declared display-id-pattern
3. `Source:` introspection
4. Display-ID prefix                     (REQ → Requirement, TST → Test, …)
5. URI scheme map
6. Discriminating attribute presence     (Verifies → Test, …)
6a. Gherkin node kind (Case B only)      Feature, Rule → Requirement; Scenario → Test
7. Document directive                    (deferred, ADR-013)
8. Display-ID shape, then fallback
```

The default therefore applies only when neither the display ID nor the trailer
gives a type. A scenario with a requirement prefix (for example `SRS_`, through
the profile) is a Requirement. A `Feature` with `Verifies:` is a Test.

### 5.3 What the entry holds

| Source element                   | Entry field                                           |
| -------------------------------- | ----------------------------------------------------- |
| `# [ID] Title` line              | `displayId`, `title`, `location` (the header line)    |
| `# Key: value` trailer           | `rawAttributes` (`Id`, `Type`, `Satisfies`, …)        |
| comment paragraphs of the header | `body` prose, first                                   |
| Gherkin description of the node  | `body` prose, after the comment paragraphs            |
| the node itself                  | one `FeatureNode` in `bodyAst` (§8.1), lowered per §9 |
| `@tags`                          | kept in the AST only; not mapped to `Labels`          |

Labels are written in the trailer (`# Labels: ASIL-B`). Tags are not mapped,
because test-runner tags such as `@wip` or `@slow` are not classification labels
and would fail label validation.

### 5.4 Nesting

One rule decides ownership: **a scenario belongs to the nearest enclosing headed
node, unless the scenario has its own header.**

1. A headed node is an entry.
2. A scenario without a header is content of the nearest enclosing headed node
   (`Rule` first, then `Feature`). It becomes one criterion or one procedure of
   that entry, by the entry's type.
3. A scenario with a header is its own entry. It is not a criterion and not a
   procedure of any enclosing entry.
4. A headed `Rule` inside a headed `Feature` is its own entry. The scenarios
   under the `Rule` belong to the `Rule`, not to the `Feature`.
5. A scenario without a header and with no enclosing headed node is not in the
   model.
6. Nesting creates no relation. An entry is linked to another entry only by an
   explicit trailer line, for example `# Verifies: REQ_BRK_0011`. `Part-of` is
   not generated: it is declared only on Component and Unit, and its target must
   be a Component (`core/model/type_hierarchy.ts`, `core/model/relations.ts`).
7. A `Background` applies to every scenario in its scope, headed or not, as in
   Gherkin. Its steps are preconditions of each of those scenarios (§7.2).

A headed scenario lowers its own scenario into its own facet. With type Test it
has one procedure. With type Requirement it has one criterion, named by the
scenario name.

### 5.5 `Id:` stamping and `fmt`

`markspec fmt` formats Markdown only today. It passes other files through the
entry formatter without the Markdown prose pass (`cli/commands/fmt.ts`). For a
`.feature` file, `fmt` does exactly one thing: it stamps a missing `Id:`.

- When the header has a trailer, `fmt` inserts `# Id: <ULID>` as the first line
  of the trailer.
- When the header has no trailer, `fmt` appends an empty comment line (`#`) and
  the `# Id: <ULID>` line at the end of the header comment block.
- The inserted lines use the indentation of the header line.
- `fmt` changes nothing else in the file. It does not reformat Gherkin, and it
  keeps the git-style trailer (#914: source files keep the author's style).
- The MSL-F010 drift check covers only the missing `Id:` for `.feature` files.

Discovery adds `.feature` to the file kinds that `check`, `lint`, `compile` and
`fmt` find. `.gitignore` and `exclude:` apply as for other files.

### 5.6 Worked example

```feature
# language: en
# [REQ_BRK_0011] Emergency braking for close obstacles
#
# The braking controller shall start braking when an obstacle is detected
# closer than 40 m.
#
# Satisfies: STK_BRK_0001
# Labels: ASIL-B
Feature: Emergency braking

  Background:
    Given the vehicle speed is 60 km/h

  Scenario: Brake at 20 m
    When an obstacle appears at 20 m
    Then braking starts within 200 ms

  Scenario: No braking beyond 40 m
    When an obstacle appears at 50 m
    Then the controller does not brake

  # [TST_BRK_0013] Brake command timing on the test bench
  #
  # Verifies: REQ_BRK_0011 [Brake at 20 m]
  Scenario: Brake command timing
    # Step 1
    * place the target at 20 m
    Then the brake command is sent within 200 ms
    # Step 2
    * remove the target
    Then the brake command is released within 500 ms
```

The file lowers to two entries:

```text
Entry REQ_BRK_0011  "Emergency braking for close obstacles"
  type      Requirement              (chain step 4, prefix REQ)
  location  line 2
  body      "The braking controller shall start braking when an obstacle is
             detected closer than 40 m."
  rawAttributes
    Satisfies: STK_BRK_0001
    Labels: ASIL-B
  criteria
    1. "Brake at 20 m"
         preconditions  the vehicle speed is 60 km/h        (background)
         step 1         actions   an obstacle appears at 20 m
                        expected  braking starts within 200 ms
    2. "No braking beyond 40 m"
         preconditions  the vehicle speed is 60 km/h        (background)
         step 1         actions   an obstacle appears at 50 m
                        expected  the controller does not brake

Entry TST_BRK_0013  "Brake command timing on the test bench"
  type      Test                     (chain step 4, prefix TST)
  location  line 22
  rawAttributes
    Verifies: REQ_BRK_0011 [Brake at 20 m]
  procedure
    1. "Brake command timing"
         preconditions  the vehicle speed is 60 km/h        (background)
         step 1 "Step 1"  actions   place the target at 20 m
                          expected  the brake command is sent within 200 ms
         step 2 "Step 2"  actions   remove the target
                          expected  the brake command is released within 500 ms
```

- The two scenarios without a header are the criteria of `REQ_BRK_0011`.
- The scenario `Brake command timing` has a header. It is the entry
  `TST_BRK_0013` and is not a criterion of `REQ_BRK_0011`.
- The only link between the two entries is the `Verifies` line. It addresses the
  criterion `Brake at 20 m`. The criterion `No braking beyond 40 m` has no
  verifier (§12).
- After `markspec fmt`, each trailer starts with a `# Id: <ULID>` line.

## 6. Parsing

### 6.1 Parser dependency

MarkSpec uses the official parser, `npm:@cucumber/gherkin`, with
`npm:@cucumber/messages` for the result types.

- **Reason.** It defines the language, it supports every Gherkin spoken
  language, and it reports comments and locations. An in-house parser would have
  to follow the Gherkin grammar by hand.
- **Lazy loading.** The parser is loaded with a dynamic `import()` the first
  time a `FeatureNode` or a `.feature` file is parsed. A project with no Gherkin
  never loads it (single binary, lazy loading: `AGENTS.md`). The synchronous AST
  build (`core/ast/build.ts`) is unchanged; the Gherkin parse is an asynchronous
  step of `parseFile` that runs after it (§8.2).
- **Node.js compatibility.** Both packages are plain JavaScript with no native
  code and run on Node.js and Deno.
- **LSP cost.** The LSP parses a file again after each edit (50 ms debounce).
  The parse result of a block depends only on the block text, so an
  implementation may cache it by block text.

### 6.2 Blocks without a `Feature:` line

The official parser rejects text whose first keyword line is not `Feature:`.
Existing documents use such blocks (`docs/examples/entry-rendering.md`).
MarkSpec therefore wraps them (Case A only):

1. Find the first line that is not empty, not a comment and not a tag line.
2. When that line is not a `Feature` keyword line of the block's language,
   insert a synthetic line that holds only the `Feature` keyword and a colon.
   The line is inserted after the `# language:` line when there is one, else as
   line 1.
3. Parse the wrapped text. Subtract 1 from the line number of every node and
   comment that stands after the synthetic line.
4. The resulting `FeatureAst` has `synthetic: true` and an empty `name`.

`FeatureNode.source` always holds the authored text, never the wrapped text.

### 6.3 The parser result

The parser returns a `GherkinDocument`:

```text
GherkinDocument
├─ uri
├─ comments[]            { location { line, column }, text }
│                        text keeps the leading whitespace; not attached to nodes;
│                        the "# language:" line is not in this list
└─ feature
   ├─ location, language, keyword, name, description, tags[]
   └─ children[]         each one of:
      ├─ background { id, keyword, name, description, steps[] }
      ├─ scenario   { id, keyword, name, description, tags[], steps[], examples[] }
      └─ rule       { id, keyword, name, description, tags[], children[] }
                    rule children: background | scenario

Step     { id, location, keyword, keywordType, text, docString?, dataTable? }
         keyword keeps its trailing space ("Given ", "* ")
         keywordType: Context | Action | Outcome | Conjunction | Unknown
         docString:   { location, mediaType?, content, delimiter }
         dataTable:   { location, rows[] }
Examples { id, keyword, name, description, tags[], tableHeader?, tableBody[] }
Tag      { id, location, name }
```

- `keywordType` is lexical. `And` and `But` are `Conjunction`; `*` is `Unknown`.
  It is set for every spoken language, so role resolution (§7.1) does not depend
  on the language.
- Comments are a flat list. MarkSpec attaches them to nodes by line number.

**Pickles are not used.** A pickle is the parser's compiled, runnable form of a
scenario: the Background is prepended, each `Scenario Outline` row is expanded,
tags are merged, and keywords are dropped. Pickles serve test runners. MarkSpec
keeps the scenario as authored, so that one scenario has one address and one
source location.

### 6.4 Positions

Parser locations are relative to the parsed text. MarkSpec converts them:

- **Case A, Markdown.** Ranges in `bodyAst` are relative to the entry. Content
  line `n` of a block is at entry-relative line
  `FeatureNode.range.start.line +
  n`, because the opening fence is on the
  start line. Columns are relative to the block content, which Markdown strips
  of the fence indentation. A diagnostic adds `entry.location.line`, as
  `core/validator/feature_ac.ts` does today.
- **Case A, source doc comments.** The existing `LineMap` translates ranges to
  file positions. `LineMap` is used only on this path (`core/parser/source.ts`,
  `core/parser/markdown.ts`).
- **Case B.** The whole file is parsed, so parser locations are file positions.

## 7. Normalized feature AST

The normalize stage converts a `GherkinDocument` into a `FeatureAst`:

```ts
interface FeatureAst {
  readonly name: string; // "" when synthetic
  readonly synthetic: boolean; // true when MarkSpec added the Feature line
  readonly language: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly scenarios: readonly ScenarioAst[]; // Rules flattened, document order
}

interface ScenarioAst {
  readonly name: string; // normalized (§10.3); may be ""
  readonly keyword: string;
  readonly tags: readonly string[]; // own tags only, not inherited
  readonly ruleName?: string;
  readonly description: string;
  readonly preconditions: readonly StepAst[];
  readonly steps: readonly ProcedureStep[];
  readonly examples: readonly ExamplesAst[]; // not expanded; [] when none
  readonly range: SourceRange;
}

interface ExamplesAst {
  readonly name: string;
  readonly tags: readonly string[];
  readonly header: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly range: SourceRange;
}

interface ProcedureStep {
  readonly n: number; // 1-based position in the scenario
  readonly label?: string; // from a "# Step …" comment
  readonly setup: readonly StepAst[]; // Given steps after the first action
  readonly actions: readonly StepAst[];
  readonly expected: readonly StepAst[];
}

interface StepAst {
  readonly role: "precondition" | "action" | "outcome";
  readonly origin: "background" | "scenario";
  readonly keyword: string; // as authored, trailing space removed
  readonly text: string;
  readonly docString?: { mediaType?: string; content: string };
  readonly dataTable?: readonly (readonly string[])[];
  readonly range: SourceRange;
}
```

### 7.1 Role resolution

| Step                            | Role                              |
| ------------------------------- | --------------------------------- |
| any step of a `Background`      | `precondition`                    |
| `Context` (`Given`)             | `precondition`                    |
| `Action` (`When`)               | `action`                          |
| `Outcome` (`Then`)              | `outcome`                         |
| `Unknown` (`*`)                 | `action`, in every position       |
| `Conjunction` (`And`, `But`)    | the role of the step before it    |
| `Conjunction` as the first step | `action`, with an info diagnostic |

`*` does not take the role of the step before it. In the step convention a `*`
after a `Then` starts the next action, so `*` must always be an action. An
author who wants to continue a run of `Given` or `Then` steps uses `And`.

### 7.2 Preconditions

`preconditions` holds, in this order: the steps of the Feature `Background`, the
steps of the Rule `Background`, and the precondition steps of the scenario that
stand before its first action or outcome. Background steps have
`origin: "background"`. In Case B their ranges lie outside the range of a
scenario entry.

### 7.3 Step pairing

The remaining steps of the scenario are read in order. One `ProcedureStep` is
open at a time:

1. A `precondition` step: when the open step has actions or expected results,
   close it and open a new one. Add the step to `setup`.
2. An `action` step: when the open step has expected results, close it and open
   a new one. Add the step to `actions`.
3. An `outcome` step: add it to `expected`.
4. At the end of the scenario, close the open step when it is not empty.

Results:

- A run of actions followed by a run of outcomes is one step.
- A scenario with `Given` and `Then` and no action has one step with empty
  `actions`. This is valid for a criterion (a state that must hold). In a
  procedure it raises an info diagnostic.
- A step with actions and empty `expected` is valid Gherkin. In a procedure it
  raises a warning.
- A `Given` after the first action keeps its position: it opens a new step and
  is that step's `setup`.

### 7.4 Step labels

A comment whose text, after trimming, matches `# Step <text>` is a step label.
The word `Step` is fixed for every spoken language. The label applies to the
`ProcedureStep` whose first step line is the next step line after the comment.
Only comments and empty lines may stand between them.

- `label` holds the comment text without the `#`, for example `Step 1`.
- A label does not change pairing. Step numbers (`n`) always come from the
  order.
- A label comment in any other position (before a leading `Given`, before a step
  that does not start a `ProcedureStep`, or in a `Background`) is ignored and
  raises an info diagnostic.

The convention is valid Gherkin. The official keyword list has no `Step`
keyword; `*` fills that role:

```feature
Scenario: Radar calibration
  Given the radar is mounted on the bench
  # Step 1
  * place the target at 10 m
  Then the measured range is 10 m ± 0.1 m
  # Step 2
  * move the target to 50 m
  Then the measured range is 50 m ± 0.3 m
```

### 7.5 Other shapes

- **Outlines stay whole.** A `Scenario Outline` is one `ScenarioAst`. Each
  `Examples` table is one `ExamplesAst` with its name and tags. Rows are not
  expanded.
- **Rules are flattened.** Each scenario keeps its `ruleName`. The rule name is
  not part of the scenario address (§10.3), so a scenario can move between rules
  without breaking locators.
- **Tags** are kept as authored on the node that carries them. They are not
  inherited in the AST.

## 8. AST placement and pipeline

### 8.1 `FeatureNode`

`FeatureNode` gains one optional field:

```ts
export interface FeatureNode {
  readonly kind: "feature";
  readonly source: string;
  readonly range: SourceRange;
  readonly feature?: FeatureAst; // absent when the text does not parse
}
```

- **Case A.** `source` is the block content. `feature` is a pure function of
  `source`.
- **Case B.** `source` is the exact text of the node in the file, from its first
  tag or keyword line to its last line. For a `Scenario` or `Rule` entry this
  text is not a complete Gherkin document, and the `Background` lies outside it.
  `feature` is therefore built from the parse of the whole file, never from
  `source`. `feature.scenarios` holds only the scenarios that the entry owns
  (§5.4). For a `Feature` entry, `source` includes the text of nested headed
  nodes, and `feature.scenarios` does not include them.
- Text that does not parse keeps `feature` absent and raises one warning at the
  first parser error. In Case B a file that does not parse still yields its
  headed entries, without facets.

**`fmt` and the equivalence gate (ADR-015).** `fmt` never changes the content of
a feature block, so `source` is equal before and after formatting.
`astEquivalent` removes every `range` key at any depth before it compares
(`core/ast/equivalence.ts`). Because `feature` is a pure function of `source`
apart from ranges, the gate result does not change. The gate does not apply to
`.feature` files: `fmt` only inserts an `Id:` line there (§5.5).

### 8.2 Stages

| Stage       | Input                      | Output                              | Needs the type |
| ----------- | -------------------------- | ----------------------------------- | -------------- |
| 1. Build    | Markdown or comment text   | `FeatureNode` without `feature`     | no             |
| 2. Gherkin  | `FeatureNode.source`, file | `FeatureNode.feature`               | no             |
| 3. Lowering | entry, resolved type       | `Entry.criteria`, `Entry.procedure` | yes            |

- Stages 1 and 2 run in `parseFile`. Stage 2 is asynchronous (§6.1).
- Stage 3 is one pure core function, `lowerFacets(entry, type, profile)`. It
  needs the resolved type, so it runs after classification.
- **Compile, `check`.** Stage 3 runs after type resolution (pipeline Stage 2).
  The result is stored on the entry.
- **LSP.** The workspace index holds entries that are not classified. The LSP
  calls `lowerFacets` on demand with
  `entry.type ?? classifyEntry(entry,
  profile).type`, as
  `WorkspaceIndex.getUxRegistry` does for uxil. It does not store the result in
  the index.

### 8.3 Storage and schema version

`Entry` gains two optional fields:

```ts
readonly criteria?: readonly Criterion[];
readonly procedure?: readonly Procedure[];
```

A field is absent when the type has no such facet. It is an empty list when the
type has the facet and the entry has no content for it.

`CORE_SCHEMA_VERSION` does not change. It is the profile-schema compatibility
pin, and optional additions to `Entry` do not move it (ADR-030 D2). In the
compile output the two fields are new keys of the entry record. That is an
additive change, which `markspecSchemaVersion` allows within one version
(`markspec-core-data-model.md` §C.6). `markspec-compile-schema.json` must
declare the new keys.

### 8.4 Body tokens

`Entry.bodyTokens` (ADR-016) gets its Gherkin tokens from `FeatureAst` in place
of the regular expressions in `core/parser/body_tokens.ts`. This changes the
token output:

- A `gherkin-step` token is emitted for `*`. Today `*` gives no token.
- Keywords of other spoken languages give tokens. Today only English words
  match.
- A keyword word inside step text, a description or a doc string gives no token.
  Today every whole-word match gives one, for example `Then` inside a step text.
- A block that does not parse gives no Gherkin tokens.

Snapshot tests and semantic-token tests that depend on the current output must
be updated in the same change.

## 9. Facets

### 9.1 Eligibility by core type

`CoreTypeDef` has only `parent`, `ownAttrs` and `excludedAttrs`, so attribute
inheritance cannot carry a facet. `CoreTypeDef` gains one optional field:

```ts
readonly facet?: "criteria" | "procedure";
```

It is set on three core types: `Requirement: criteria`, `Contract: criteria`,
`Test: procedure`. A new function `facetForType(type, profile)` walks from the
type to its ancestors (through the profile `extends` chain, then
`CORE_TYPE_HIERARCHY`) and returns the first `facet` it finds.

```text
Specification             —
├─ Requirement            criteria   — what must hold
├─ Contract               criteria   — the behaviour the interface promises
│  └─ SoftwareInterface, HardwareInterface    (through Contract)
├─ Test                   procedure  — what to do and what to observe
├─ Record                 —
└─ Risk                   —
Component, Unit           —
```

| Entry's facet | Feature content lowers to | Meaning                        |
| ------------- | ------------------------- | ------------------------------ |
| `criteria`    | `criteria: Criterion[]`   | what has to hold               |
| `procedure`   | `procedure: Procedure[]`  | what to do and what to observe |
| none          | nothing                   | the block is an illustration   |

An entry whose type resolves only to `Specification` or `Item` has no facet.

The core type decides the facet. A profile cannot give a facet a different
meaning or move it to another type (ADR-009). A later profile setting may make a
facet required or forbidden for one profile type (§15).

`criteria` and `procedure` are the two sides of the V-model. `Verifies` connects
them.

### 9.2 Criterion

```ts
interface Criterion {
  readonly form: "scenario" | "item";
  readonly name: string; // scenario name; "" for item form
  readonly addressable: boolean; // false: "" name, duplicate name, item form
  readonly scenario?: ScenarioAst; // form = "scenario"
  readonly text?: string; // form = "item"
  readonly range: SourceRange;
}
```

- **Scenario form** (canonical). Each scenario of each feature block of the
  entry is one criterion, in document order.
- **Item form.** Each top-level item of an acceptance-criteria list is one
  criterion (§9.3). Item-form criteria count toward coverage. They are not
  addressable, because a list item has no stable name.

### 9.3 Item form and MSL-B044

Today MSL-B044 accepts any paragraph or first list item that contains the words
"acceptance criteria", before or after the list. That match is too loose to
define model content. The facet uses a stricter rule:

- The label is a paragraph that stands directly before a list, with no block
  between them.
- The whole text of the paragraph, after removing emphasis markers, surrounding
  whitespace and one optional trailing colon, is `Acceptance criteria`. The
  comparison ignores case.
- Each top-level item of that list is one criterion. `text` is the item's plain
  text. Nested lists are part of the item.

MSL-B044 is then defined on the facet: it is raised when the criteria of one
entry come from both forms. A paragraph that only mentions acceptance criteria
no longer raises it.

### 9.4 Procedure

`procedure` holds one `Procedure` per scenario of the entry, in document order:

```ts
interface Procedure {
  readonly name: string;
  readonly scenario: ScenarioAst;
  readonly range: SourceRange;
}
```

A Test has no `criteria`. Its pass condition is the set of `expected` results of
its procedures.

## 10. Scenario locators

### 10.1 Syntax

A trace value may address one criterion:

```text
Verifies: REQ_BRK_0010 [Brake at 20 m]
```

```text
value        = target [ 1*WSP locator ]
target       = display-id / ulid / uri
locator      = "[" 1*locator-char "]"
locator-char = "\]" / "\\" / any character except "]" and "\"
```

- The locator starts at the first `[` after the target and ends at the first `]`
  that is not escaped. Brackets do not nest.
- A name that contains `]` is written with `\]`. A name that contains `\` is
  written with `\\`. A comma needs no escape.
- **Bracket-aware split.** A repeatable value is split at a comma only when the
  comma is outside a locator. One shared core function does this split. It
  replaces the plain `split(",")` in `core/compiler/mod.ts`, the
  `split(/[\s,]+/)` in `core/lock/resolve.ts` and the token split in
  `core/refs/mod.ts`.
- The canonical form is one value per line. `fmt` rewrites a CSV value to
  several lines, as it does today, and applies the bracket-aware split when it
  does so.

### 10.2 Relations that accept a locator

| Relation                     | Locator  | Meaning                                  |
| ---------------------------- | -------- | ---------------------------------------- |
| `References`, `Derived-from` | accepted | free text; never resolved (as today)     |
| `Verifies`, `Satisfies`      | accepted | resolved against the target's `criteria` |
| every other relation         | rejected | warning; the value is not a valid target |

`LOCATOR_BEARING_ATTRS` becomes a facet of `RelationDef` in
`core/model/relations.ts` (`locator?: "free" | "criterion"`), so the compiler,
the validator, the lockfile and `fmt` read the same list.

For `Verifies` and `Satisfies`, the locator is resolved only when the target
resolves and its type has the `criteria` facet. For any other target (for
example a Reference entry such as `ISO-26262-6 [§4.3]`) the locator stays free
text and raises no diagnostic.

### 10.3 Resolution

- **Normalization.** A scenario name and a locator are compared after the same
  normalization: remove the escapes (locator only), apply Unicode NFC, trim, and
  replace each run of whitespace with one space. The comparison is exact and
  case-sensitive.
- **Scope.** The names of all scenario-form criteria of one entry form one
  scope: all feature blocks and all rules of the entry. In Case B the scope is
  the scenarios that the entry owns (§5.4).
- **Duplicate names.** Two criteria with the same normalized name in one scope
  raise a warning on the second one. Both stay in `criteria` with
  `addressable: false`.
- **Empty names.** A scenario with no name is a criterion with `name: ""` and
  `addressable: false`. It raises an info diagnostic.
- **Unresolved locator.** A locator that matches no addressable criterion raises
  a warning. The edge to the target entry is kept.
- A value without a locator addresses the whole entry.

Ordinal locators (`#2`) are not supported: inserting a scenario would change
every later address.

The LSP rename of a scenario name rewrites the locators that address it, in the
project that owns the entry. `fmt` cannot heal a renamed scenario, because a
scenario has no stable identifier (§15).

### 10.4 Effect on ADR-026

- **MSL-L006.** The existence check applies to the target only. The locator has
  its own diagnostic (§13), raised only when the target resolves.
- **Graph edges.** `Link` gains two optional fields: `locator?: string` (the
  normalized text) and `locatorResolved?: boolean`. `to` is the target only.
- **Lockfile `[[edge]]` ledger.** `authored-target` holds the target only.
  `LockEdge` gains an optional `locator` field (TOML key `locator`). The sort
  key becomes `(sourceUlid, relation, authoredTarget, locator)`. The change is
  additive: an old lockfile parses without change. Of the two resolved-locator
  relations only `Satisfies` is in the ledger today; `Verifies` is not a
  `lockEdge` relation. Because `core/lock/resolve.ts` now splits with the shared
  function, an existing `Derived-from` value with a locator no longer adds its
  locator words to the edge quads. The `edges-hash` of such a project changes
  once.
- **`fmt` canonicalisation.** Rules 1–4 of ADR-026 apply to the target only.
  `fmt` writes one space between the target and the locator and keeps the
  locator text as authored.

## 11. Captured model

The entry record (`markspec-core-data-model.md` §C.3) keeps `rawAttributes` as
authored and gains `criteria` or `procedure`. It has no `relations` object.
Example records, abridged (`id`, `shape`, `body`, `properties` and step ranges
are omitted; each step is shown by its text):

```json
[
  {
    "displayId": "REQ_BRK_0010",
    "type": "Requirement",
    "title": "Emergency braking for close obstacles",
    "rawAttributes": [{ "key": "Satisfies", "value": "STK_BRK_0001" }],
    "location": { "file": "docs/brk.md", "line": 1, "column": 1 },
    "criteria": [
      {
        "form": "scenario",
        "name": "Brake at 20 m",
        "addressable": true,
        "preconditions": ["the vehicle drives at 60 km/h"],
        "steps": [
          {
            "n": 1,
            "actions": ["an obstacle appears at 20 m"],
            "expected": ["braking starts within 200 ms"]
          }
        ],
        "location": { "file": "docs/brk.md", "line": 10, "column": 3 }
      },
      {
        "form": "scenario",
        "name": "No braking beyond 40 m",
        "addressable": true,
        "preconditions": ["the vehicle drives at 60 km/h"],
        "steps": [
          {
            "n": 1,
            "actions": ["an obstacle appears at 50 m"],
            "expected": ["the controller does not brake"]
          }
        ],
        "location": { "file": "docs/brk.md", "line": 14, "column": 3 }
      }
    ]
  },
  {
    "displayId": "TST_BRK_0012",
    "type": "Test",
    "title": "Brake reaction on the test bench",
    "rawAttributes": [
      { "key": "Verifies", "value": "REQ_BRK_0010 [Brake at 20 m]" }
    ],
    "location": { "file": "docs/brk.md", "line": 21, "column": 1 },
    "procedure": [
      {
        "name": "Brake at 20 m on the test bench",
        "preconditions": ["the bench simulates 60 km/h"],
        "steps": [
          {
            "n": 1,
            "label": "Step 1",
            "actions": ["place the target at 20 m"],
            "expected": ["the brake command is sent within 200 ms"]
          },
          {
            "n": 2,
            "label": "Step 2",
            "actions": ["remove the target"],
            "expected": ["the brake command is released within 500 ms"]
          }
        ],
        "location": { "file": "docs/brk.md", "line": 26, "column": 5 }
      }
    ]
  },
  {
    "displayId": "REQ_BRK_0020",
    "type": "Requirement",
    "title": "Brake light activation",
    "rawAttributes": [{ "key": "Satisfies", "value": "STK_BRK_0002" }],
    "location": { "file": "docs/brk.md", "line": 38, "column": 1 },
    "criteria": [
      {
        "form": "item",
        "name": "",
        "addressable": false,
        "text": "Brake lights switch on within 100 ms of the brake command."
      },
      {
        "form": "item",
        "name": "",
        "addressable": false,
        "text": "Brake lights stay on while the brake command is active."
      }
    ]
  }
]
```

Edges are not part of the entry record. The edge that the `Verifies` line
produces has the `Link` shape with the two new fields. The generated inverse
edge in `edges.ndjson` carries the same two fields:

```json
{
  "from": "TST_BRK_0012",
  "to": "REQ_BRK_0010",
  "kind": "verifies",
  "locator": "Brake at 20 m",
  "locatorResolved": true
}
```

The Gherkin text stays in the source as authored. `criteria` and `procedure` are
derived views; they are never written back.

## 12. Verification semantics and coverage

### 12.1 Definitions

Let `R` be an entry with the `criteria` facet and `T` an entry of type Test.

- **Whole-entry verification.** `T` has `Verifies: R` with no locator. It
  verifies `R` and every criterion of `R`, in both forms.
- **Criterion verification.** `T` has `Verifies: R [name]` and the locator
  resolves. It verifies that one criterion only.
- A `Verifies` value whose locator does not resolve verifies no criterion.
- A **criterion is verified** when at least one whole-entry verification of `R`
  or one criterion verification of that criterion exists.

| State of `R`       | Condition                                                                              |
| ------------------ | -------------------------------------------------------------------------------------- |
| fully verified     | every criterion is verified; or `R` has no criteria and has a whole-entry verification |
| partially verified | at least one criterion is verified and at least one is not                             |
| not verified       | no criterion is verified and no whole-entry verification exists                        |

The existing entry-level coverage report does not change: it counts `R` as
covered when at least one `Verifies` edge targets it. The criterion-level states
are a new, additional report.

A locator on `Satisfies` records which criterion a lower-level entry refines. It
has no effect on verification coverage.

### 12.2 Strict and lightweight

**Default: strict.** The criteria of a requirement are never their own evidence.
A criterion is verified only by a Test entry. This keeps the independence
between specification and verification that ISO 26262 and ASPICE require.

**Opt-in: lightweight.** A profile setting (working name
`criteria-verify-self: true`) makes each scenario-form criterion count as
verified by its own scenario. Item-form criteria are not affected, because they
are not executable. This suits BDD teams. Case B gives the same result under
strict mode when each scenario is a headed Test entry.

A criterion with no verifier is a warning by default. `check --strict` or a
compliance profile promotes it to an error.

```text
REQ_BRK_0010  Emergency braking for close obstacles      1/2 criteria verified
  ✓ Brake at 20 m              ← TST_BRK_0012
  ✗ No braking beyond 40 m     ← no verifier                       (warning)

REQ_BRK_0020  Brake light activation                      0/2 criteria verified
  ✗ Brake lights switch on within 100 ms…                           (warning)
  ✗ Brake lights stay on while the brake command is active.         (warning)
  note: item-form criteria are not addressable; verify the whole entry
        or convert them to scenarios
```

## 13. Validation

Severities are `error`, `warning` and `info`. There is no other level.

| Check                                                           | Severity |
| --------------------------------------------------------------- | -------- |
| Gherkin text does not parse                                     | warning  |
| Locator on `Verifies` / `Satisfies` does not resolve            | warning  |
| Locator on a relation that does not accept one                  | warning  |
| Two criteria with the same name in one entry                    | warning  |
| Scenario with no name                                           | info     |
| Criterion scenario with no outcome step                         | warning  |
| Procedure step with actions and no expected result              | warning  |
| Procedure step with expected results and no action              | info     |
| `And` / `But` as the first step of a scenario                   | info     |
| `# Step` label in a position where it labels nothing            | info     |
| Feature block in an entry whose type has no facet               | info     |
| Criteria in both scenario and item form (MSL-B044)              | warning  |
| Criterion with no verifier (strict mode)                        | warning  |
| Case B: header comment above a `Background`, `Examples` or step | warning  |
| Markdown: git-style trailer is not indented (#914)              | warning  |

Diagnostic codes are assigned when each slice is implemented, following ADR-012.

## 14. Alternatives considered

- **`AcceptanceCriterion` as a core entry type.** Rejected. Every criterion
  would need its own display ID and ULID, and authors would write small entries
  that repeat their parent. A criterion that needs an ID can be written as a
  Requirement, or as a headed scenario in Case B.
- **`Acceptance-criteria:` trailer attribute.** Rejected. Trailers hold metadata
  and links, not structured prose of several lines.
- **Pickles as the model.** Rejected. Expanding outlines multiplies addresses
  and breaks the mapping of one scenario to one address and one location (§6.3).
- **Ordinal scenario locators, or tag addresses (`@ac-1`).** Rejected. Ordinals
  change when a scenario is inserted. Tags are stable but add markup to every
  scenario and are shared with test runners. The name is readable and is already
  required by Gherkin practice. The cost is that a rename breaks locators; LSP
  rename and the unresolved-locator warning limit that cost.
- **Lightweight verification as the default.** Rejected. That default would
  report coverage that a compliance team does not have, with no warning (§12).
- **An in-house, English-only Gherkin parser.** Rejected. It removes one
  dependency but must follow the Gherkin grammar by hand and drops the spoken
  languages that epic #915 requires (§6.1).
- **Rejecting blocks without a `Feature:` line.** Rejected. Existing documents
  and the epic examples use such blocks. The synthetic Feature costs one line
  offset (§6.2).
- **`*` takes the role of the step before it.** Rejected. A `*` after `Then`
  would become an outcome, and the step convention of D3 would not work (§7.1).
- **Implicit `Part-of` from Case B nesting.** Rejected. `Part-of` is valid only
  on Component and Unit, with a Component target. A new containment relation was
  also rejected for now: no consumer needs it, and explicit `Verifies` /
  `Satisfies` lines already state the meaning (§5.4).
- **A headed scenario is also a criterion of its parent.** Rejected. One
  scenario would be both specification and its own verification, which is the
  lightweight mode without the opt-in (§5.4, §12.2).
- **Mapping `@tags` to `Labels`.** Rejected for now (§5.3).
- **Free-text locators only (no resolution).** Rejected. Criterion-level
  coverage needs a resolved address.
- **Storing facets in a side table and not on `Entry`.** Rejected. `Entry`
  already carries optional derived fields, and consumers read one record.

## 15. Open questions

1. A stable identifier for a scenario, so that `fmt` can heal locators after a
   rename when the LSP was not used.
2. A label syntax that makes item-form criteria addressable.
3. The profile syntax that makes a facet required or forbidden for a type, and
   the final name of `criteria-verify-self`.
4. Whether Case B needs an opt-in mapping from tags to labels.
5. Whether the compile output should record the enclosing entry of a nested Case
   B entry as an observed `source.*` property (no relation).
6. Whether `Verifies` should join the lockfile `[[edge]]` ledger now that it
   carries locators.
7. Pickles for counting executable cases or for mapping Cucumber run results
   back to entries.

## 16. Trace links

- Epic #915 — Gherkin AST, Case A, Case B. Slices: Gherkin AST (§6–§8),
  procedure view (§7), Case A (§4, §9), Case B (§5).
- Story #914 — git-style trailer; prerequisite of §5.1 and §5.5.
- Issue #584 — tag-based `.feature` approach, superseded by §5.
- `markspec-core-data-model.md` — §1.3.1 (type resolution, extended in §5.2),
  §4.5 (MSL-B044, redefined in §9.3), annex C (compile output, extended in §11).
- `docs/spec/model/relations.md` — "Reference-target locators" must be updated
  for §10.
- ADR-026 — `MSL-L006`, `[[edge]]` ledger and `fmt` canonicalisation, amended by
  §10.4.
- ADR-015, ADR-016 — equivalence gate (§8.1) and body tokens (§8.4).
- ADR-009, ADR-030 — core / profile boundary (§9.1) and schema version (§8.3).
- Code: `core/ast/nodes.ts`, `core/ast/build.ts`, `core/parser/body_tokens.ts`,
  `core/validator/feature_ac.ts`, `core/compiler/mod.ts`,
  `core/model/relations.ts`, `core/model/type_hierarchy.ts`,
  `core/lock/resolve.ts`, `core/refs/mod.ts`, `cli/commands/fmt.ts`,
  `lsp/workspace.ts`.
