# Entries in `.feature` files

A Gherkin `.feature` file can hold MarkSpec entries. A comment block that starts
with `# [ID] Title` directly above a `Feature`, `Rule` or `Scenario` turns that
node into an entry. The entry joins the traceability graph like an entry from a
Markdown file or a source doc comment. The Gherkin text stays as it is, so your
test runner still reads the file. MarkSpec reads the file with the same Gherkin
parser as [Scenario locators](scenario-locators.md), so the keywords can be in
any language that Gherkin supports.

A `.feature` file with no `# [ID]` header changes nothing. A project that uses
Cucumber files for other purposes gets no entries, no new diagnostics, and the
same `compile` and `check` output as before. The one difference is the scope
line of a bare `markspec check` or `markspec fmt`, which counts the file (see
[Discovery](#discovery)).

## Write a header

The header is a run of comment lines. Its first line is `# [ID] Title`. The
lines after it are the body prose, then the trailer. The trailer uses the git
style of a source doc comment (no indent):

```text
# [REQ_BRK_0011] Emergency braking for close obstacles
#
# The braking controller shall start braking when the radar detects an
# obstacle between 0 m and 40 m ahead.
#
# Satisfies: STK_BRK_0001
@safety
Feature: Emergency braking
```

The rules:

- The run must end on the line directly above the node keyword (`Feature:`,
  `Rule:`, `Scenario:`, `Scenario Outline:`, or the keyword of another
  language). Tag lines (`@safety`) and plain comment lines may stand between the
  run and the keyword.
- A blank line between the run and the node breaks the link. The header is then
  not an entry, and `check` reports `MSL-B069`.
- A comment line whose text starts with `[ID]` starts a new header, so two
  headers can stand one above the other. Each header belongs to the first node
  after its own run.
- A `# language:` line is never part of a header.
- A header above a `Background`, an `Examples` table or a step is not an entry.
  `check` reports `MSL-B069` for it.
- Tags are not labels. `@safety` stays in the Gherkin AST and does not become
  `Labels: safety`.

## What an entry contains

- **Type.** A `Feature` or `Rule` entry is a `Requirement`, and a `Scenario`
  entry is a `Test`. This is the last step (6a) of the
  [type resolution chain](../spec/internal/markspec-core-data-model.md#131-resolution-chain).
  An explicit `Type:` trailer, a profile `display-id-pattern`, or a display-ID
  prefix wins, because those steps come first. Step 6a gives no `MSL-T021`
  warning.
- **Body.** The header prose, then the Gherkin description of the node (the free
  text between the keyword line and the first step), then the node itself as a
  `Feature` body node. Prose and description are both optional. `check` reports
  `MSL-P030` when an entry has neither, and no steps either (a `Feature` or
  `Rule` counts as having content when it owns a scenario).
- **Source.** `source` in the compiled JSON is
  `{"kind": "feature-file", "node": "feature" | "rule" | "scenario"}`.
- **Position.** The location of an entry is its `# [ID]` line. Every position in
  a diagnostic or body token is a line and column of the `.feature` file.

## Which scenarios an entry owns

A scenario belongs to at most one entry:

1. A headed `Scenario` is its own entry.
2. A scenario with no header belongs to the nearest enclosing headed `Rule`,
   else to the headed `Feature`. A `Rule` with no header does not stop the
   search.
3. A scenario with no headed ancestor is not in the model.

The `Feature` body node of an entry holds the scenarios the entry owns, with the
`Background` steps that apply to them. The text of a nested entry is left out of
the text of the entry above it. Nesting creates no relation: MarkSpec does not
generate `Part-of`, so a link between two entries is a trailer that you write.

An entry that owns scenarios has criteria, as a fenced `feature` block does. In
the example below, the test `TST_BRK_0013` verifies the scenario `Brake at 20 m`
of `REQ_BRK_0011`.

## Stamp the Id

An entry needs an `Id:`, and you never write it by hand. `markspec fmt` inserts
a missing `# Id: <ULID>` line into the header, in front of the first trailer
line. This file has two headers without an Id:

```text
# language: en
# [REQ_BRK_0011] Emergency braking for close obstacles
#
# The braking controller shall start braking when the radar detects an
# obstacle between 0 m and 40 m ahead.
#
# Satisfies: STK_BRK_0001
@safety
Feature: Emergency braking

  Background:
    Given the vehicle speed is 60 km/h

  Scenario: Brake at 20 m
    When an obstacle appears at 20 m
    Then braking starts within 200 ms

  # [TST_BRK_0013] Brake command timing on the test bench
  #
  # The test bench measures the delay between the radar track and the brake
  # command.
  #
  # Verifies: REQ_BRK_0011 [Brake at 20 m]
  Scenario: Brake command timing
    When the target is placed at 20 m
    Then the brake command is sent within 200 ms
```

After `markspec fmt`, both headers have an Id:

```text
# language: en
# [REQ_BRK_0011] Emergency braking for close obstacles
#
# The braking controller shall start braking when the radar detects an
# obstacle between 0 m and 40 m ahead.
#
# Id: 01M7B7Q2T7K9E6YEAWYNBN1HZX
# Satisfies: STK_BRK_0001
@safety
Feature: Emergency braking

  Background:
    Given the vehicle speed is 60 km/h

  Scenario: Brake at 20 m
    When an obstacle appears at 20 m
    Then braking starts within 200 ms

  # [TST_BRK_0013] Brake command timing on the test bench
  #
  # The test bench measures the delay between the radar track and the brake
  # command.
  #
  # Id: 01M7B7Q2T7M3JY1JGM5QXKQ0VG
  # Verifies: REQ_BRK_0011 [Brake at 20 m]
  Scenario: Brake command timing
    When the target is placed at 20 m
    Then the brake command is sent within 200 ms
```

`fmt` changes nothing else in a `.feature` file. It does not reformat Gherkin,
and the other comments and the line endings (LF or CRLF) stay as they are. A
file that does not parse, and a file with no header, are left unchanged. The
project-wide `markspec check` reports `MSL-F010` for a `.feature` file that has
a header without an `Id:`. Nothing else counts as format drift in such a file.

## Discovery

`check`, `lint`, `compile`, `fmt` and `lock` include `.feature` files in the
files they find under the project root, with the same `.gitignore` and
`exclude:` rules as other files. The scope line of a bare `markspec check` or
`markspec fmt` counts a `.feature` file, so a project that has such files shows
a larger `N` in `checking N file(s)` than before, even if no file has a header.

The language server does not index `.feature` files yet, so an editor shows no
diagnostics, hover or completion for them. The MCP server tracks them, so
`markspec_refresh` sees a changed `.feature` file.

## Example

The scratch project of this example has a profile with three types, a
stakeholder requirement `STK_BRK_0001` in `docs/stk.md`, the file
`features/brake.feature` above, and a Cucumber file `features/legacy.feature`
with no header. Paths in the output are relative to the project root.

Before `fmt`, `check` reports the missing Ids:

```text
$ markspec check
checking 3 file(s) under <root>
error[MSL-R003]: features/brake.feature:2 REQ_BRK_0011: missing Id: attribute
error[MSL-I003]: features/brake.feature:2 REQ_BRK_0011: Authored-shape entry without Id: run fmt to mint a ULID (spec section 4.2)
error[MSL-R003]: features/brake.feature:18 TST_BRK_0013: missing Id: attribute
error[MSL-I003]: features/brake.feature:18 TST_BRK_0013: Authored-shape entry without Id: run fmt to mint a ULID (spec section 4.2)
error[MSL-F010]: features/brake.feature:1 file is not formatted (run `markspec fmt`)
```

`fmt` stamps the Ids and leaves the legacy file alone. Then `check` is clean:

```text
$ markspec fmt
formatting 3 file(s) under <root>
1 file(s) formatted, 2 unchanged (3 total)
$ markspec check
checking 3 file(s) under <root>
```

`markspec compile --format json features/brake.feature docs/stk.md` lists the
two entries of the `.feature` file next to the Markdown entry. This excerpt
shows the fields that differ from a Markdown entry:

```json
{
  "REQ_BRK_0011": {
    "type": "requirement",
    "source": { "kind": "feature-file", "node": "feature" },
    "location": { "file": "features/brake.feature", "line": 2, "column": 1 },
    "criteria": [
      {
        "form": "scenario",
        "name": "Brake at 20 m",
        "addressable": true,
        "location": { "file": "features/brake.feature", "line": 15, "column": 1 }
      }
    ]
  },
  "TST_BRK_0013": {
    "type": "test",
    "source": { "kind": "feature-file", "node": "scenario" },
    "location": { "file": "features/brake.feature", "line": 19, "column": 3 }
  }
}
```

The link from the test to the requirement keeps the locator:

```json
{
  "from": "TST_BRK_0013",
  "to": "REQ_BRK_0011",
  "kind": "verifies",
  "location": { "file": "features/brake.feature", "line": 19, "column": 3 },
  "locator": "Brake at 20 m",
  "locatorResolved": true
}
```

## Diagnostics

| Code       | Severity | Cause                                                                                                                     |
| ---------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `MSL-B062` | warning  | A `.feature` file with a `# [ID]` header does not parse, so it gives no entries. A file with no header is never reported. |
| `MSL-B069` | warning  | A `# [ID]` header stands above a `Background`, an `Examples` table or a step, or is not directly above a node.            |
| `MSL-P030` | error    | An entry has no header prose, no node description and no content (no owned scenario, or a scenario with no step).         |
| `MSL-F010` | error    | A `.feature` header has no `# Id:` line (project-wide `check` only).                                                      |

A header above a `Background`, and a file that does not parse, give these
messages:

```text
warning[MSL-B062]: features/broken.feature:2 Gherkin file does not parse: expected: #EOF, #Language, #TagLine, #FeatureLine, #Comment, #Empty, got 'Feature Broken'
warning[MSL-B069]: features/odd.feature:3 [TST_BRK_0020]: a # [ID] header is not directly above a Feature, Rule or Scenario, so it is not an entry; remove the blank line or other text between the header and the node
```

The block-role checks (`MSL-B063` to `MSL-B068`) read the `Feature` body node of
an entry. A `Requirement` entry from a `.feature` file is therefore checked as a
set of criteria, and a `Test` entry as a procedure.
