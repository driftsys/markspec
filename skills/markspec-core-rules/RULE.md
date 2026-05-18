---
schema: 1
name: markspec-core-rules
description: Always-on MarkSpec authoring invariants for any project using MarkSpec entry blocks
---

## Id integrity

Never hand-write an `Id:` value or forge a ULID. The `Id:` trailer attribute is
stamped automatically by `markspec format` and `markspec insert`. A hand-written
ULID is invalid — it will not have the correct timestamp prefix and will fail
validation.

**Never do this:**

```markdown
Id: 01HANDWRITTENULID000000000
```

**Do this instead:** leave `Id:` absent; run `markspec format <file>` to stamp
it.

## Format before commit

Run `markspec format <file>` (or `markspec hook <file>`) before committing any
Markdown file that contains MarkSpec entry blocks. The formatter:

- stamps missing `Id:` ULIDs
- normalises trailer indentation to 6 spaces
- adds missing trailing backslashes on multi-line attribute values

Committing unformatted files causes the pre-commit hook to fail and creates
noisy format-only diff commits.

## Prose quality

Every requirement body must satisfy all of the following. Violating any one
makes the requirement unverifiable and untraceable.

- **Single responsibility** — one entry expresses one requirement. Never join
  two requirements with "and", "as well as", or a semicolon.
- **Active voice** — "The system shall compute X", not "X shall be computed by
  the system".
- **Measurable** — include units, thresholds, and tolerances. "within 200 ms",
  "less than 12 kN", "≥ 99.9 %". Bare adjectives ("fast", "reliable",
  "user-friendly") are forbidden.
- **Unambiguous** — no pronoun references ("it", "this"), no undefined
  abbreviations, no vague quantifiers ("several", "appropriate", "sufficient").
- **Independently verifiable** — a tester must be able to pass or fail the
  requirement without consulting the author.
