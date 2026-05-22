---
schema: 1
name: markspec-requirement-style
description: |
  Use when choosing how to write requirement body text — overview of EARS vs Gherkin vs plain prose, selection criteria, and pointers to the `markspec-ears` and `markspec-gherkin` deep-dive skills.
---

## Overview

A MarkSpec entry body can be written in plain prose, EARS syntax, or Gherkin
scenario format. The choice depends on the nature of the requirement and who
will verify it. Consistency within a document section matters more than
following a single style across all entries.

## Selection guide

```text
Is the requirement testable by running a scenario (UI, API, integration)?
  YES → Gherkin (Given/When/Then)  →  markspec-gherkin

Is it a functional rule with a clear trigger or condition?
  YES → EARS pattern               →  markspec-ears

Is it a hardware spec, safety goal, or non-functional property?
  → Plain prose with RFC 2119 modal (shall/should/may)
```

## At a glance

| Style       | Best for                                                               | Verified by               |
| ----------- | ---------------------------------------------------------------------- | ------------------------- |
| EARS        | System-level functional rules with triggers and states                 | Integration or unit test  |
| Gherkin     | Acceptance criteria that a tester can run step by step                 | Acceptance or system test |
| Plain prose | Non-functional requirements, safety goals, hardware specs, STK entries | Review, analysis, or V&V  |

## EARS patterns

EARS (Easy Approach to Requirements Syntax) produces unambiguous,
single-sentence requirements with a defined trigger. Five patterns cover most
cases:

- **Ubiquitous** — always true, no trigger: _"The system shall…"_
- **Event-driven** — triggered by an event: _"When X, the system shall Y."_
- **State-driven** — active while in a state: _"While P, the system shall Q."_
- **Optional** — gated by a feature: _"Where feature F is enabled, the system
  shall…"_
- **Unwanted behaviour** — fault response: _"If E occurs, the system shall W
  within T."_

See `markspec-ears` for do/don't examples of each pattern.

## Gherkin scenarios

Gherkin expresses acceptance criteria as executable examples:

```gherkin
Given <context>
When <action>
Then <expected outcome>
```

Each scenario maps to a MarkSpec entry. The `Verified-by:` trailer links the
requirement entry to the test entry that implements the scenario.

See `markspec-gherkin` for do/don't examples, Scenario Outline, and Background.

## Plain prose rules

Plain prose entries must still satisfy the prose-quality invariants from
`markspec-core-rules`:

- **Single responsibility** — one entry, one requirement.
- **Active voice** — "The system shall…", not "…shall be done by the system".
- **Measurable** — units, thresholds, tolerances. No bare adjectives.
- **Unambiguous** — no pronoun references, no undefined abbreviations.
- **Independently verifiable** — a tester can pass or fail it without the
  author.

## Mixing styles

EARS and Gherkin are not mutually exclusive across a document. A common split:

- STK entries → plain prose (stakeholder language)
- SYS / SWE entries → EARS (precise functional rules)
- Acceptance entries → Gherkin (executable scenarios)

Do not mix styles within a single entry body.
