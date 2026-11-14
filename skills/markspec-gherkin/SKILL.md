---
schema: 1
name: markspec-gherkin
description: |
  Use when writing Gherkin acceptance criteria or test procedures — Given/When/Then structure, Scenario Outline, Background, scenario locators (`ID [Scenario name]`) on `Satisfies:` / `Verifies:`, block role by entry type (MSL-B064), procedure steps and `# Step` labels in Test entries, `.feature` files with `# [ID]` headers, and how scenarios map to the `Verified-by:` attribute.
---

## Overview

Gherkin encodes acceptance criteria as concrete examples. A MarkSpec entry body
can contain one or more Gherkin scenarios in a fenced code block. The entry's
`Verified-by:` trailer links the requirement to the test entry that implements
the scenario.

## Basic structure

An entry with Gherkin scenarios looks like this (outer fence shows the full
MarkSpec entry; the inner `gherkin` fence holds the scenarios):

````text
- [SWE_0060] Speed display rounds to nearest integer

  The instrument cluster shall display vehicle speed rounded to the nearest
  integer value in the configured unit.

  ```gherkin
  Scenario: Round half-up
    Given vehicle speed is 42.5 km/h
    When the cluster updates the display
    Then the displayed value is 43 km/h

  Scenario: Exact integer
    Given vehicle speed is 100.0 km/h
    When the cluster updates the display
    Then the displayed value is 100 km/h
  ```

      Type: requirement
      Satisfies: STK_0002
      Verified-by: SWT_0060
````

The fence language must be `gherkin` or `feature` — see _Toolchain support_
below.

### Rules

- The `Given` clause sets pre-conditions — system state before the action.
- The `When` clause describes one triggering action.
- The `Then` clause states the expected observable outcome.
- Each `And` / `But` line extends the nearest `Given`, `When`, or `Then`.
- Keep each step to one observable fact. Multiple assertions → multiple `Then`
  lines, not a compound sentence.

---

## Do / Don't examples

**Do — concrete values, one action, one outcome:**

```gherkin
Scenario: Reject out-of-range input
  Given the brake pressure sensor reads 250 bar
  When the safety monitor evaluates the reading
  Then the safety monitor shall assert the sensor-fault flag
  And the safety monitor shall set DTC 0x4A within 10 ms
```

**Don't — vague state, compound action, unmeasurable outcome:**

```gherkin
Scenario: Bad sensor
  Given the sensor is broken
  When something happens
  Then the system handles it appropriately
```

Why bad: "broken" is undefined; "something happens" is not a single trigger;
"handles it appropriately" is not verifiable.

---

## Scenario Outline — parameterised examples

Use when the same flow applies to multiple input/output pairs.

```gherkin
Scenario Outline: Convert speed to locale unit
  Given vehicle speed is <speed_kmh> km/h
  And the active locale is <locale>
  When the cluster updates the display
  Then the displayed value is <display_value> <unit>

  Examples:
    | speed_kmh | locale | display_value | unit |
    | 100       | en-US  | 62            | mph  |
    | 100       | en-GB  | 62            | mph  |
    | 100       | fr-FR  | 100           | km/h |
```

---

## Background — shared pre-conditions

Use `Background` when every scenario in a feature shares the same setup.

```gherkin
Background:
  Given the vehicle ignition is ON
  And the CAN bus is operational

Scenario: Normal speed display
  When vehicle speed is 80 km/h
  Then the cluster displays 80 km/h
```

Keep `Background` short (≤ 3 steps). Complex shared state signals that the
scenarios belong in separate entries.

---

## Linking requirements to tests via `Verified-by:`

A requirement entry carries `Verified-by: <test-entry-display-ID>`. The test
entry is a separate MarkSpec entry that implements the scenario.

**Requirement entry:**

```markdown
- [SWE_0060] Speed display rounds to nearest integer

  …gherkin scenarios…

      Id: 01JEMX9GZXYZ0000000000000A
      Type: requirement
      Satisfies: STK_0002
      Verified-by: SWT_0060
```

**Test entry (colocated in source or test file):**

```markdown
- [SWT_0060] Verify speed rounding

  Integration test exercising the cluster display module against the scenarios
  in SWE_0060.

      Id: 01JEMXBHZXYZ0000000000000B
      Type: test
      Tests: SWE_0060
```

The `Tests:` attribute on the test entry is the reverse link;
`markspec report traceability` uses both to compute coverage.

---

## Scenario locators

A `Verifies:` or `Satisfies:` value can name one scenario of its target by
adding the scenario name in square brackets after the display ID:

```markdown
Verifies: SWE_0060 [Round half-up]
```

- The `[` must follow whitespace after the ID. Case and spelling must match the
  scenario name; runs of whitespace count as one space.
- Only scenarios of a Requirement or Contract entry can be addressed. A name
  used twice in one entry (`MSL-B060`) or an empty name (`MSL-B061`) cannot be
  addressed, and a locator that names it gives `MSL-L007`.
- A `Verifies:` value with no locator verifies every scenario of the
  requirement.
- `References:` and `Derived-from:` accept a free-text locator that is not
  checked. Other relations accept none (`MSL-L008`).
- `markspec report coverage` lists each scenario with its verifier.

See the guide chapter _Scenario locators_.

---

## Block role by entry type

The type of the entry decides what a `gherkin` / `feature` block means:

| Entry type                             | Role         | Meaning                                   |
| -------------------------------------- | ------------ | ----------------------------------------- |
| Requirement, Contract, or an extension | criteria     | Each scenario is an acceptance criterion. |
| Test, or an extension of it            | procedure    | The block is a test procedure.            |
| Any other typed entry                  | illustration | The block is an example (`MSL-B068`).     |

A scenario of a criteria block needs a `Then` step, or `MSL-B064` is reported.
The checks need a profile that types the entry. A scenario that starts with
`And` or `But` gives `MSL-B066`. A block that does not parse gives `MSL-B062`;
the scenario names are then read by a scanner that knows English keywords only.

---

## Procedure steps in a Test entry

In a Test entry, MarkSpec reads each scenario as a manual test procedure:

- `Given` is a precondition, `When` and `*` are actions, `Then` is an outcome.
  `And` and `But` take the role of the previous step.
- An action after an outcome, or a precondition after an action or outcome,
  opens a new numbered step.
- A step with actions and no outcome gives `MSL-B063`; a step with an outcome
  and no action gives `MSL-B065`.

Name a step with a comment on its own line above its first line: `# Step 1`. The
word `Step` is fixed for every Gherkin language; `# Step-by-step` is a plain
comment. A label never changes the step number. A label that labels no step
gives `MSL-B067`.

```gherkin
Scenario: Stop and release
  Given a vehicle at 50 km/h
  # Step 1
  When the driver presses the brake pedal
  Then the vehicle stops within 20 m
  # Step 2
  When the driver releases the brake pedal
  Then the brake pedal returns to its rest position
```

See the guide chapter _Gherkin scenarios_.

---

## `.feature` files

A Gherkin `.feature` file can declare entries. A comment block that starts with
`# [ID] Title`, directly above a `Feature`, `Rule` or `Scenario`, makes that
node an entry; the lines after the first one are body prose and trailers.

```gherkin
# [TST_BRK_0020] Brake release
#
# Verify that the brake releases.
#
# Verifies: REQ_BRK_0010 [Brake at 20 m]
Scenario: Release
  Given a braking vehicle
  When the driver releases the pedal
  Then the brake releases
```

Run `markspec fmt` to stamp the `# Id:` line. Without a profile, a headed
`Feature` or `Rule` is a Requirement and a headed `Scenario` is a Test. See the
guide chapter _Entries in `.feature` files_.

---

## Common mistakes

| Mistake                                 | Fix                                                     |
| --------------------------------------- | ------------------------------------------------------- |
| Multiple `When` steps                   | Split into separate scenarios — one action per scenario |
| "it", "this", "the thing" in steps      | Name the subject explicitly in each step                |
| Implementation detail in `Given`        | Describe observable state, not code internals           |
| Missing `Verified-by:` on requirement   | Add the link so the traceability report shows coverage  |
| Duplicate scenario name within an entry | Names must be unique — the validator flags duplicates   |
| Steps written in unfenced prose         | Wrap them in a `gherkin` or `feature` fence (see below) |

---

## Toolchain support

Gherkin steps must live inside a `` ```gherkin `` or `` ```feature `` fenced
code block to be recognised by the toolchain. The parser emits one
`gherkin-section` token per `Feature` / `Background` / `Rule` / `Scenario` /
`Examples` keyword and one `gherkin-step` token per `Given` / `When` / `Then` /
`And` / `But` keyword on `Entry.bodyTokens` (ADR-016). The LSP paints sections
as `class` and steps as `keyword`; profile and project rules can scan the same
stream.

Inside a `gherkin` / `feature` fence, modal (`shall`, `should`, …) and
EARS-trigger scans are suppressed. That is what makes `When` a Gherkin step here
even though the same word in plain body prose is an EARS trigger.

Steps written in unfenced prose are ignored: they will not appear on
`Entry.bodyTokens`, will not be highlighted, and will not be checked by
profile-driven rules. Always fence your scenarios.
