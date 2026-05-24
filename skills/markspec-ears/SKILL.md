---
schema: 1
name: markspec-ears
description: |
  Use when writing EARS-style requirements — all five patterns (ubiquitous, event-driven, state-driven, optional, unwanted) with do/don't examples in MarkSpec entry format.
---

## Overview

EARS (Easy Approach to Requirements Syntax) produces unambiguous,
single-sentence requirements by forcing authors to make the trigger and
condition explicit. Every EARS sentence begins with a structural keyword that
signals the pattern.

## The five patterns

### 1. Ubiquitous — always active, no trigger

Use for properties that hold in all system states.

**Template:** _"The `<subject>` shall `<action>`."_

**Do:**

```markdown
- [SWE_0010] Log every sensor reading

  The data logger shall record each sensor sample with a UTC timestamp accurate
  to within 1 ms.

      Id:
      Type: requirement
      Satisfies: SYS_0003
```

**Don't:**

```markdown
- [SWE_0010] Log sensor readings

  Sensor data should be logged.
```

Why bad: "should" is ambiguous (RFC 2119 recommendation, not obligation); body
lacks timestamp precision.

---

### 2. Event-driven — triggered by a discrete event

Use when the system must react to something that happens.

**Template:** _"When `<event>`, the `<subject>` shall `<action>`."_

**Do:**

```markdown
- [SWE_0020] React to ignition-off event

  When the ignition signal transitions from HIGH to LOW, the power management
  module shall initiate a controlled shutdown sequence within 500 ms.

      Id:
      Type: requirement
      Satisfies: SYS_0008
```

**Don't:**

```markdown
- [SWE_0020] Shutdown on ignition off

  The system should handle ignition off and shut down.
```

Why bad: no measurable time bound; "should" is not mandatory.

---

### 3. State-driven — active only while in a particular state

Use when the system must behave differently in a persistent mode.

**Template:** _"While `<state>`, the `<subject>` shall `<action>`."_

**Do:**

```markdown
- [SWE_0030] Limit torque in degraded mode

  While the torque sensor reports a fault, the drive controller shall limit
  output torque to no more than 50 % of nominal.

      Id:
      Type: requirement
      Satisfies: SYS_0015
      Labels: ASIL-B
```

**Don't:**

```markdown
- [SWE_0030] Degraded mode torque

  In degraded mode the system limits torque appropriately.
```

Why bad: "appropriately" is unmeasurable; no percentage or absolute limit given.

---

### 4. Optional — conditional on a feature or configuration

Use when a capability is not universally present.

**Template:** _"Where `<feature or condition>` is enabled, the `<subject>` shall
`<action>`."_

**Do:**

```markdown
- [SWE_0040] Display speed in mph when locale is US

  Where the user's locale setting is "en-US", the instrument cluster shall
  display vehicle speed in miles per hour rounded to the nearest integer.

      Id:
      Type: requirement
      Satisfies: STK_0002
```

**Don't:**

```markdown
- [SWE_0040] MPH display

  US users see mph.
```

Why bad: not a requirement sentence; "US users" is ambiguous (locale vs.
nationality); rounding convention absent.

---

### 5. Unwanted behaviour — fault or error response

Use when the system must detect and respond to an abnormal condition.

**Template:** _"If `<unwanted condition>`, the `<subject>` shall `<response>`
within `<time>`."_

**Do:**

```markdown
- [SWE_0050] Handle CAN bus timeout

  If no valid CAN frame is received on the safety bus within 100 ms, the safety
  monitor shall assert the brake request signal and set diagnostic code 0x4A
  within 10 ms of timeout detection.

      Id:
      Type: requirement
      Satisfies: SYS_0022
      Labels: ASIL-D
```

**Don't:**

```markdown
- [SWE_0050] CAN timeout

  The system handles CAN timeouts gracefully.
```

Why bad: "gracefully" is not measurable; no time bound on detection or response;
no diagnostic output specified.

---

## Pattern selection cheat sheet

| Trigger            | Pattern            | Opening keyword              |
| ------------------ | ------------------ | ---------------------------- |
| Always true        | Ubiquitous         | _(none — starts with "The")_ |
| Event occurs       | Event-driven       | **When**                     |
| System is in state | State-driven       | **While**                    |
| Feature is present | Optional           | **Where**                    |
| Fault / error      | Unwanted behaviour | **If**                       |

## Combining patterns

State + event is allowed:

_"While braking, when the ABS module signals wheel lock, the brake controller
shall reduce hydraulic pressure by 30 % within 20 ms."_

Do not combine more than two patterns in one sentence. If a third condition is
needed, split into two entries.

## Toolchain support

The parser emits one `ears-trigger` token for each `When` / `While` / `If` /
`Where` keyword that opens a clause in entry body prose. Tokens are sorted by
source position and exposed on `Entry.bodyTokens` (ADR-016); the LSP highlights
them as keywords, and profile or project rules can scan them without re-parsing.

Scanning is suppressed inside fenced code blocks (`` ``` `` / `~~~`), inside
display- and inline-math (`$$`), inside inline `` `code` `` spans, and inside
`` ```gherkin `` / `` ```feature `` fences — there, `When` is recognised as a
Gherkin step instead. Plain prose outside any fence is the canonical place to
write EARS sentences.
