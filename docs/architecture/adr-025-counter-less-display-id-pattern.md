# ADR-025: Counter-less (named) display-id-pattern

## Status

Accepted (2026-06-05). Refines [ADR-009 §5](adr-009-core-profile-boundary.md)
"Minimum pattern grammar". Addresses issue #594.

## Context

A profile classifies an Authored entry's type two ways: an explicit `Type:`
trailer, or a `display-id-pattern` match (`core/validator/types.ts`
`classifyEntry`, step 2). ADR-009 §5 set the minimum pattern grammar as "literal
prefix + one numeric placeholder `{n}`", and `compileDisplayIdPattern`
(`core/validator/pattern.ts`) enforced it: a pattern with zero `{n}` counters
threw `missing {n} placeholder`.

That excludes a whole class of types whose IDs are **named, not numbered** —
components such as `SWC_LIGHT_CTRL`, `HWC_PIU`. They cannot declare a pattern,
so `classifyEntry`'s pattern loop never matches them and every such entry must
hand-write `Type:`. Worse, a profile that _did_ declare a counter-less pattern
(e.g. `SWC_{name}`) crashed `markspec check` with an uncaught exception the
moment classification reached that type.

Late-stage inference (`types.ts` steps 5/6/8) only resolves the abstract _core_
type and emits an `MSL-T021` advisory telling the author to declare `Type:`
anyway — it does not assign the profile type.

## Decision

**Allow a counter-less `display-id-pattern` for classification.** A pattern is
now one of two kinds, selected by the presence of the `{n}` counter:

- **Numbered** (contains `{n}`) — unchanged. Exactly one counter; single-
  segment `{scope}`-style placeholders; mintable and classifying. Because every
  pre-existing pattern contains `{n}`, this guarantees zero behaviour change to
  any pattern in the wild.
- **Named** (no `{n}`) — new. Requires a non-empty literal anchor plus at least
  one named placeholder. The trailing named placeholder captures the **rest of
  the display ID** (character class `[A-Za-z0-9._/-]`, underscores included), so
  `SWC_{name}` classifies `SWC_LIGHT_CTRL`. Classification only — not mintable.

A bare `{name}` (no literal anchor) is rejected: it would match every ID and
collide with every type. An all-literal template (no placeholder of any kind)
keeps the historical `missing {n} placeholder` rejection.

```yaml
profile:
  types:
    sw-component:
      extends: SoftwareComponent
      display-id-pattern: "SWC_{name}" # ^SWC_(?<name>[A-Za-z0-9._/-]+)$
      display-id-pattern-enforcement: off
    hw-component:
      extends: HardwareComponent
      display-id-pattern: "HWC_{name}"
      display-id-pattern-enforcement: off
```

`classifyEntry`'s single-match / `MSL-T002` ambiguous logic consumes the relaxed
recognizer unchanged — overlapping named prefixes still emit `MSL-T002`.

## Consequences

- Named component / element types classify by prefix with no explicit `Type:`,
  preserving the named-entity model (no forced `SWC_HMI_0001` numbering).
- Pair named patterns with `display-id-pattern-enforcement: off`: there is no
  counter to enforce, and the pattern exists purely for classification.
- The minting path is untouched and already decoupled: `parseDisplayIdPattern`
  (`core/profile/display_id.ts`, keyed on `{n:Nd}`) returns `undefined` for
  counter-less patterns, so `markspec next-id` / `create` / `insert` and the LSP
  scaffold skip named types and fall back to author-typed IDs.
- `markspec.lock` references and other consumers are unaffected — the change is
  confined to `compileDisplayIdPattern`.

## Alternatives considered

- **Overload `{name}` semantics by position in every pattern** (terminal named
  placeholder is always rest-of-ID). Rejected: it risks changing behaviour of
  existing numbered patterns that happen to end in a named placeholder. Gating
  the rest-of-ID broadening on "no `{n}` present" keeps numbered patterns
  provably unchanged.
- **Keep the single-segment `[A-Za-z0-9]+` class for named placeholders.**
  Rejected: `SWC_LIGHT_CTRL` (the headline example) would not match, since the
  underscore between `LIGHT` and `CTRL` breaks a single-segment capture.
- **Validate patterns at profile-load time** and emit a `PROFILE-*` diagnostic
  for a malformed pattern instead of throwing during classification. Deferred:
  invalid patterns still throw, as they did before; moving validation to
  load-time is a larger, separable change.
