# Scenario locators

A requirement can list its acceptance criteria as scenarios in a fenced
`feature` block. A test can then say which scenario it verifies, by adding the
scenario name in square brackets after the requirement ID. This is a locator.
`markspec check` tests that the locator names a real scenario, and
`markspec report coverage` shows which scenarios have a verifier.

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

## Address a scenario

Add the scenario name in brackets after the target of a `Verifies:` value. The
test below verifies the first scenario of the requirement. The requirement has
two scenarios.

````markdown
- [REQ_BRK_0010] Emergency braking for close obstacles

  The braking controller shall start braking when an obstacle is detected
  closer than 40 m at speeds of 60 km/h or less.

  ```feature
  Scenario: Brake at 20 m
    When an obstacle appears at 20 m
    Then braking starts within 200 ms

  Scenario: No braking beyond 40 m
    When an obstacle appears at 50 m
    Then the controller does not brake
  ```

- [TST_BRK_0012] Brake reaction at 20 m

  Place the target at 20 m and measure the brake reaction.

      Verifies: REQ_BRK_0010 [Brake at 20 m]
````

Run `markspec fmt` to stamp the `Id:` lines.

The profile must map the prefixes to core types: `REQ_` to Requirement and
`TST_` to Test. The test type must also declare the `Verifies` attribute, or
`markspec check` reports `MSL-A005`.

The locator has these properties:

- The `[` must follow whitespace after the ID.
- Case and spelling must match the scenario name. Runs of whitespace count as
  one space.
- A name can contain commas. A literal `]` is written `\]`.
- `Verifies:` and `Satisfies:` accept scenario locators. `References:` and
  `Derived-from:` accept free-text locators such as `[§4.3]` that are not
  checked. Other relations do not accept a locator.
- A `Verifies:` value without a locator verifies every scenario of the
  requirement. A value without a closed locator is read as it was before
  locators existed.
- Only scenarios in top-level `feature` blocks are indexed. A block nested in a
  list item or a block quote yields no scenarios.
- A locator never changes the link: the link goes to the requirement whether the
  locator resolves or not.

See [Locators](../spec/model/relations.md#locators) for the full grammar.

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
and no outcome. A step with no actions, or with no actions and no outcome, is
not reported. The warning is placed at the line of the last action of the step.
The check applies to entries whose type is, or extends, `Test`, so the project
needs a profile that types the entry. A `Type: Test` trailer in a project with
no profile is not checked, which is also true of locators. A block that does not
parse is skipped, because `MSL-B062` reports it.

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
steps. Upstream entries and blocks that do not parse are skipped.

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

In a procedure block, a comment of the form `# Step <text>` names a step of the
procedure, for example `# Step 1` or `# Step Brake`. The word `Step` is fixed
for every Gherkin language. Write the comment on its own line, directly above
the first line of the step: the first action, or the first precondition that
follows an action or an expected result. The label does not change the number of
the step. A label that does not match this position is reported by `MSL-B067`:
one above a leading precondition, one with no step after it, one before
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
info[MSL-B067]: braking.md:26 TST_BRK_0010: "# Step 2" labels no procedure step; place it directly above the first action of a step
info[MSL-B066]: braking.md:30 TST_BRK_0010: scenario "Release first" starts with "And"; the step is read as an action; start with Given, When or Then
info[MSL-B065]: braking.md:35 TST_BRK_0010: step 1 of scenario "Check only" has an expected result and no action; add a When step before the Then step
info[MSL-B067]: braking.md:36 TST_BRK_0010: "# Step 3" labels no procedure step; place it directly above the first action of a step
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

## Diagnostics

| Code       | Severity | Cause                                                                                    |
| ---------- | -------- | ---------------------------------------------------------------------------------------- |
| `MSL-L007` | warning  | The locator names no addressable scenario of its target.                                 |
| `MSL-L008` | warning  | The relation does not accept a locator. The link to the target is kept.                  |
| `MSL-L009` | warning  | A value has a `[` that no `]` closes. Commas after the `[` still separate values.        |
| `MSL-B060` | warning  | A scenario name is used more than once in one entry. A locator cannot address that name. |
| `MSL-B061` | info     | A scenario has an empty name. A locator cannot address it.                               |
| `MSL-B062` | warning  | A Gherkin block does not parse. The warning names the line of the first error.           |
| `MSL-B063` | warning  | A step of a procedure has actions and no expected result (Test entries).                 |
| `MSL-B064` | warning  | A scenario of a Requirement or Contract entry has no `Then` step.                        |
| `MSL-B065` | info     | A step of a procedure has an expected result and no action (Test entries).               |
| `MSL-B066` | info     | A scenario of a Requirement, Contract or Test entry starts with `And` or `But`.          |
| `MSL-B067` | info     | A `# Step` label in a Test entry labels no step.                                         |
| `MSL-B068` | info     | A feature block is in a typed entry that is not a Requirement, Contract or Test.         |

If a second test in the example verifies `[Brake at 30 m]`, a scenario that does
not exist, `markspec check` reports:

```text
warning[MSL-L007]: docs/braking.md:30 TST_BRK_0013: locator 'Brake at 30 m' matches no scenario of REQ_BRK_0010
```

## Coverage

`markspec report coverage` adds a criteria section for each requirement that has
scenarios. With the example above, it shows:

````markdown
## Criteria

```text
REQ_BRK_0010  Emergency braking for close obstacles  1/2 criteria verified
  ✓ Brake at 20 m           ← TST_BRK_0012
  ✗ No braking beyond 40 m  ← no verifier
```
````

A scenario with no verifier is a gap in the report. It does not raise a
diagnostic. Only `Verifies:` from a test counts (an entry whose type is, or
extends, Test); a `Satisfies:` locator does not, and an entry never verifies
itself. The `json` format carries the same data; `csv` carries only the
`Criteria total` and `Criteria verified` counts. See the
[CLI reference](cli.md#report) for the counting rules.
