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
work). Keywords are English only.

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

The locator has these properties:

- The `[` must follow whitespace after the ID.
- Case and spelling must match the scenario name. Runs of whitespace count as
  one space.
- A name can contain commas. A literal `]` is written `\]`.
- `Verifies:` and `Satisfies:` accept scenario locators. `References:` and
  `Derived-from:` accept free-text locators such as `[§4.3]` that are not
  checked. Other relations do not accept a locator.
- A `Verifies:` value without a locator verifies every scenario of the
  requirement.
- A locator never changes the link: the link goes to the requirement whether the
  locator resolves or not.

See [Locators](../spec/model/relations.md#locators) for the full grammar.

## Diagnostics

| Code       | Severity | Cause                                                                                    |
| ---------- | -------- | ---------------------------------------------------------------------------------------- |
| `MSL-L007` | warning  | The locator names no addressable scenario of its target.                                 |
| `MSL-L008` | warning  | The relation does not accept a locator. The link to the target is kept.                  |
| `MSL-L009` | warning  | A value has a `[` that no `]` closes. Commas after the `[` do not separate values.       |
| `MSL-B060` | warning  | A scenario name is used more than once in one entry. A locator cannot address that name. |
| `MSL-B061` | info     | A scenario has an empty name. A locator cannot address it.                               |

If a second test in the example verifies `[Brake at 30 m]`, a scenario that does
not exist, `markspec check` reports:

```text
warning[MSL-L007]: docs/braking.md:32 TST_BRK_0013: locator 'Brake at 30 m' matches no scenario of REQ_BRK_0010
```

## Coverage

`markspec report coverage` adds a criteria section for each requirement that has
scenarios. With the example above, it shows:

```text
## Criteria

REQ_BRK_0010  Emergency braking for close obstacles  1/2 criteria verified
  ✓ Brake at 20 m           ← TST_BRK_0012
  ✗ No braking beyond 40 m  ← no verifier
```

A scenario with no verifier is a gap in the report. It does not raise a
diagnostic. Only `Verifies:` counts; a `Satisfies:` locator does not. The `json`
and `csv` formats carry the same data. See the [CLI reference](cli.md#report)
for the counting rules.
