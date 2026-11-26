---
schema: 1
name: markspec-prose-review
description: |
  Use when reviewing MarkSpec entry bodies for prose quality — checks single-responsibility, active voice, measurability, ambiguity, EARS pattern correctness, and Gherkin scenario completeness.
---

## Overview

Apply this checklist to each entry body under review. Work entry-by-entry.
Report each finding with the entry's display ID, the violated criterion, and a
concrete rewrite suggestion.

## Checklist

### 1. Single responsibility

- [ ] The body expresses exactly one requirement.
- [ ] No "and", "as well as", or semicolons joining two distinct obligations.

**Flag:** "The system shall compute X and log Y." → split into two entries.

---

### 2. Active voice

- [ ] Subject performs the action: "The `<module>` shall `<verb>`…"
- [ ] No passive constructions: "shall be computed by", "is handled", "will be
      provided".

**Flag:** "The brake pressure shall be monitored by the safety module." → "The
safety module shall monitor the brake pressure."

---

### 3. Measurability

- [ ] Every performance claim has a unit and a numeric threshold or tolerance.
- [ ] No bare adjectives: "fast", "reliable", "accurate", "sufficient",
      "appropriate", "user-friendly".
- [ ] Time bounds use SI units or ms/s: "within 200 ms", not "quickly".
- [ ] Percentages are explicit: "≥ 99.9 %", not "high availability".

**Flag:** "The system shall respond rapidly." → "The system shall respond within
200 ms of receiving the request."

---

### 4. Unambiguity

- [ ] No pronoun references without clear antecedents: "it", "this", "they",
      "the aforementioned".
- [ ] All abbreviations are defined in a glossary or expanded on first use.
- [ ] No vague quantifiers: "several", "a number of", "some", "many".
- [ ] Modal keywords follow the project's `modal-keywords.casing` (lowercase by
      default, uppercase `shall`/`must` under `rfc8174`); RFC 2119 words:
      `shall` (mandatory), `should` (recommended), `may` (optional). No bare
      "will"; no bare "must" unless `must` is the project's mandatory word
      (under `rfc8174`, `fmt` writes it as `MUST`).
- [ ] No emphasis around modal verbs (`_shall_`, `**must**`). Underscore
      emphasis hides a modal keyword: `_SHALL_` gets no MSL-M060 warning and no
      `fmt` rewrite, and under `rfc8174` `fmt` does not uppercase `_must_`.
      Asterisk emphasis (`*SHALL*`, `**SHALL**`) does not hide it. Double
      underscores do not hide it either: the first `fmt` pass rewrites `__x__`
      to `**x**`, and a second pass then rewrites the keyword (`__SHALL__`
      becomes `**SHALL**`, then `**shall**`; under `rfc8174`, `__must__` becomes
      `**must**`, then `**MUST**`). Only single-underscore emphasis (`_x_`)
      hides a keyword. Under the default casing, a visible uppercase `SHALL` or
      `MUST` gets MSL-M060 and the `fmt` lowercase rewrite. Under `rfc8174`,
      `fmt` uppercases a visible lowercase `shall` or `must` in the body of
      every Markdown entry, while the MSL-M062 info reports it only in a
      `Requirement` entry.

**Flag:** "It shall process them within the defined timeout." → name the subject
and define both referents explicitly.

---

### 5. Independent verifiability

- [ ] A tester unfamiliar with the author can write a pass/fail test from this
      entry alone.
- [ ] No implicit context required ("as described in the design doc", "per
      §3.2").
- [ ] The acceptance condition is observable, not internal: "the system shall
      assert the fault flag on CAN bus 0x1A0" not "the system shall detect the
      fault internally".

---

### 6. EARS correctness (if EARS style is used)

- [ ] Exactly one EARS keyword opens the sentence: When / While / Where / If /
      _(none for ubiquitous)_.
- [ ] Event-driven: "When `<single discrete event>`, the `<subject>` shall…" —
      trigger is a single observable event, not a state.
- [ ] State-driven: "While `<persistent state>`, the `<subject>` shall…" —
      condition is a mode or state, not an event.
- [ ] Optional: "Where `<feature>` is enabled, the `<subject>` shall…" — gated
      on a configuration flag or variant, not a runtime event.
- [ ] Unwanted: "If `<fault/condition>`, the `<subject>` shall `<response>`
      within `<time>`." — response time is mandatory.
- [ ] No more than two patterns combined in one sentence.

---

### 7. Gherkin correctness (if Gherkin style is used)

- [ ] Each scenario has exactly one `When` step (one triggering action).
- [ ] `Given` describes observable pre-conditions, not implementation setup.
- [ ] `Then` assertions are independently verifiable outcomes, not internal
      state.
- [ ] No pronoun references across steps ("it", "the result").
- [ ] `Verifies:` trailer on the test entry links to the requirement these
      scenarios verify. A hand-written `Verified-by:` is an error (MSL-A030).

---

## Reporting format

For each finding:

```text
[DISPLAY_ID] <criterion violated>
  Found:   "<verbatim offending text>"
  Issue:   <one-sentence explanation>
  Suggest: "<concrete rewrite>"
```

Summarise at the end: total entries reviewed, findings by criterion, entries
with no findings.
