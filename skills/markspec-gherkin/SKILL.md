---
schema: 1
name: markspec-gherkin
description: |
  Use when writing Gherkin acceptance criteria — Given/When/Then structure, Scenario Outline, Background, do/don't examples in MarkSpec entry format, and how scenarios map to the `Verified-by:` attribute.
---

## Overview

Gherkin encodes acceptance criteria as concrete examples. A MarkSpec entry body
can contain one or more Gherkin scenarios in a fenced code block. The entry's
`Verified-by:` trailer links the requirement to the test entry that implements
the scenario.

## Basic structure

An entry with Gherkin scenarios looks like this (outer block shows the full
MarkSpec entry; the inner `gherkin` block holds the scenarios):

```text
- [SWE_0060] Speed display rounds to nearest integer

  The instrument cluster shall display vehicle speed rounded to the nearest
  integer value in the configured unit.

  ` ` `gherkin
  Scenario: Round half-up
    Given vehicle speed is 42.5 km/h
    When the cluster updates the display
    Then the displayed value is 43 km/h

  Scenario: Exact integer
    Given vehicle speed is 100.0 km/h
    When the cluster updates the display
    Then the displayed value is 100 km/h
  ` ` `

      Id:
      Type: requirement
      Satisfies: STK_0002
      Verified-by: SWT_0060
```

_(Remove the spaces in `` ` above — they are present only to prevent nesting
issues in documentation.)_

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

## Common mistakes

| Mistake                                 | Fix                                                     |
| --------------------------------------- | ------------------------------------------------------- |
| Multiple `When` steps                   | Split into separate scenarios — one action per scenario |
| "it", "this", "the thing" in steps      | Name the subject explicitly in each step                |
| Implementation detail in `Given`        | Describe observable state, not code internals           |
| Missing `Verified-by:` on requirement   | Add the link so the traceability report shows coverage  |
| Duplicate scenario name within an entry | Names must be unique — the validator flags duplicates   |
