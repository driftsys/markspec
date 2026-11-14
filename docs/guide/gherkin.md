# Gherkin scenarios

A fenced `gherkin` or `feature` block in an entry holds Gherkin scenarios.
MarkSpec reads each block with a Gherkin parser. What a block means depends on
the type of its entry: acceptance criteria in a Requirement or Contract, a test
procedure in a Test, an example in any other typed entry. This chapter explains
how to write the scenarios, the procedure steps of a Test and the role of a
block. To trace a scenario from another entry, see
[Scenario locators](scenario-locators.md).

## Write the scenarios

Put each scenario in a fenced block of the language `feature` (or `gherkin`) in
the body of a Requirement or Contract entry. Each scenario line starts with
`Scenario:` (`Scenario Outline:`, `Scenario Template:` and `Example:` also
work). MarkSpec reads each block with a Gherkin parser, so the keywords can be
in any language that Gherkin supports. Start the block with a language line, for
example `# language: fr`, and write `Scénario: Freinage à 20 m`. Free text
between a scenario line and its first step is the description of the scenario,
not an error.

If a block does not parse, `markspec check` reports `MSL-B062` for it. The
scenarios of that block are then read by a simple line scanner that knows only
the English keywords, so a block in another language gives no scenarios until
you fix the syntax.

## Procedure steps in a Test entry

A Test entry can hold a scenario that reads as a manual test procedure. Each
step of the procedure has actions and an expected result, although a step may
have no actions or no expected result. MarkSpec derives the steps from the
keywords of the scenario:

- `Given` is a precondition, `When` is an action, and `Then` is an outcome. A
  `*` step is always an action.
- `And` and `But` take the role of the step before them. A first `And` or `But`
  is an action.
- Only the leading steps that are preconditions are preconditions of the whole
  scenario, after any `Background` steps. A leading `Then` is not one: it is the
  expected result of step 1.
- An action that follows an outcome opens a new numbered step. A precondition
  that follows an action or an outcome also opens a new step.

`markspec check` reports `MSL-B063` only for a numbered step that has actions
and no outcome. A step with no actions is not reported by `MSL-B063`; if it has
an expected result, `MSL-B065` reports it (see below). The warning is placed at
the line of the last action of the step. The check applies to entries whose type
is, or extends, `Test`, so the project needs a profile that types the entry. A
`Type: Test` trailer in a project with no profile is not checked, which is also
true of locators. A block that does not parse is skipped, because `MSL-B062`
reports it.

In this entry the second step has an action and no `Then` step:

````markdown
- [TST_BRK_0010] Braking procedure

  Verify that the vehicle stops and that the brake can be released.

  ```feature
  Scenario: Stop and release
    Given a vehicle at 50 km/h
    When the driver presses the brake pedal
    Then the vehicle stops within 20 m
    When the driver releases the brake pedal
  ```
````

After `markspec fmt` adds the missing `Id:` line, `markspec check` reports:

```text
warning[MSL-B063]: docs/braking.md:10 TST_BRK_0010: step 2 of scenario "Stop and release" has no expected result (no Then step); add a Then step after the last action
```

To fix it, add a `Then` step after the last action, for example
`Then the brake pedal returns to its rest position`.

## Role of a Gherkin block

The type of the entry decides what a feature block means. MarkSpec derives the
role from the type each time it checks; it stores nothing on the entry.

| Entry type                                 | Role of the block | Meaning                                   |
| ------------------------------------------ | ----------------- | ----------------------------------------- |
| Requirement, Contract, or a type extending | criteria          | Each scenario is an acceptance criterion. |
| Test, or a type extending it               | procedure         | The block is a test procedure.            |
| Any other typed entry                      | illustration      | The block is an example and has no rule.  |
| An entry with no type after classification | none              | No role check runs for the block.         |

The check needs a profile that types the entry, as for locators and procedure
steps. A headed `.feature` entry is typed without a profile (step 6a; see
[Entries in `.feature` files](feature-files.md) and
[ADR-038 Case B decision 6](../architecture/adr-038-gherkin-ast.md#amendment-2026-11-14--case-b-feature-entries)).
Upstream entries and blocks that do not parse are skipped.

Each check applies to a feature block that is top-level or nested in a list item
at any depth.

- `MSL-B064` (warning) applies to a criteria block. It reports a scenario that
  has no `Then` step, or no step at all. A scenario with `Given` and `Then` and
  no action is valid. `Scenario Outline` Examples are not considered.
- `MSL-B065` (info) applies to a procedure block. It reports a step that has an
  expected result and no action.
- `MSL-B066` (info) applies to a criteria block and a procedure block. It
  reports a scenario that starts with `And` or `But`, which is read as an
  action.
- `MSL-B067` (info) applies to a procedure block. It reports a step label that
  labels no step (see below).
- `MSL-B068` (info) applies to an illustration. It reports the block once, at
  its first line.

Each diagnostic is reported in column 1. `MSL-B064` is at the line of the
`Scenario` keyword. `MSL-B065` and `MSL-B066` are at the line of the step.
`MSL-B067` is at the line of the comment. `MSL-B068` is at the first line of the
block.

### Step labels

In a procedure block, a comment that starts with `#`, optional spaces, the word
`Step`, and then whitespace or the end of the line names a step of the
procedure, for example `# Step 1` or `# Step Brake`. The word `Step` is fixed
for every Gherkin language. `# Step-by-step`, `# Step: 1` and `# Steps 1` are
plain comments, not labels. Write the comment on its own line, above the first
line of the step: the first action, the first precondition that follows an
action or an expected result, or a leading `Then`. Only comments and blank lines
may lie between the label and that line; a description line makes the label
unplaced. A bare `# Step` with no text is also a label. The label does not
change the number of the step. A label that does not match this position is
reported by `MSL-B067`: one above a leading precondition, one above a step that
does not open a procedure step (for example an `And` or `But`), one with a
description line between it and the step, one with no step after it, one before
`Examples:`, one outside every scenario, or a second label above the same step.

This example has one entry for each role. `markspec fmt` added the missing `Id:`
lines. The formatter also writes the fence language as `gherkin`:

````markdown
# Braking

- [REQ_BRK_0010] Emergency stop

  The system shall stop the vehicle.

  ```gherkin
  Scenario: Stop
    Given a vehicle at 50 km/h
    When the driver presses the brake pedal
    And the pedal is pressed fully
  ```

      Id: 01M7AX4B5RCAVV23XVNF2VR1TN

- [TST_BRK_0010] Braking procedure

  Verify that the vehicle stops and that the brake can be released.

  ```gherkin
  Scenario: Stop and release
    Given a vehicle at 50 km/h
    # Step 1
    When the driver presses the brake pedal
    Then the vehicle stops within 20 m
    # Step 2
    Then the brake pedal is released

  Scenario: Release first
    And the brake pedal is released
    Then the vehicle moves

  Scenario: Check only
    Given a stopped vehicle
    Then the brake lights are off
    # Step 3
  ```

      Id: 01M7AX4B5RAS6F4BSBQ3NNMECW

- [CMP_BRK_0010] Brake controller

  The component converts pedal travel to a brake command.

  ```gherkin
  Scenario: Example
    Given a pedal travel of 40 mm
    Then the command is 40 %
  ```

      Id: 01M7AX4B5QPQ6N4AG1FXQV1EFY
````

`markspec check braking.md` reports:

```text
warning[MSL-B064]: braking.md:8 REQ_BRK_0010: scenario "Stop" has no outcome (no Then step); a criterion must state what has to hold; add a Then step
info[MSL-B067]: braking.md:26 TST_BRK_0010: "# Step 2" labels no procedure step; place it on the first line of a procedure step
info[MSL-B066]: braking.md:30 TST_BRK_0010: scenario "Release first" starts with "And"; the step is read as an action; start with Given, When or Then
info[MSL-B065]: braking.md:35 TST_BRK_0010: step 1 of scenario "Check only" has an expected result and no action; add a When step before the Then step
info[MSL-B067]: braking.md:36 TST_BRK_0010: "# Step 3" labels no procedure step; place it on the first line of a procedure step
info[MSL-B068]: braking.md:46 CMP_BRK_0010: Gherkin block in a component entry is an illustration; only Requirement, Contract and Test entries give it a meaning
```

To fix each diagnostic:

- `MSL-B064`: add a `Then` step to scenario "Stop", for example
  `Then the vehicle stops within 20 m`.
- `MSL-B067` at line 26: the `# Step 2` label sits above a `Then` step. Move it
  above a `When` step that opens the second step, or remove it.
- `MSL-B066`: start scenario "Release first" with `Given`, `When` or `Then`.
- `MSL-B065`: add a `When` step before `Then the brake lights are off`.
- `MSL-B067` at line 36: the `# Step 3` label has no step after it. Remove it.
- `MSL-B068`: no fix is needed. The entry is a component, so its block is an
  example. Use a Requirement, Contract or Test entry to give the block a
  meaning.

## Gherkin in `.feature` files

A Gherkin `.feature` file can declare entries of its own, with a `# [ID] Title`
comment above a `Feature`, `Rule` or `Scenario`. The rules for entries in
Markdown files and doc comments, and the block roles above, also apply to those
entries, which are typed without a profile. See
[Entries in `.feature` files](feature-files.md).
