# Design — Bundled default profile: auto-registration + opt-out

**Date:** 2026-05-19 **Status:** Approved (brainstorming); pending
implementation plan **Scope:** Mechanism only — bundle + auto-register the
default profile as the implicit bottom of the `extends:` chain, with a
`default-profile: false` opt-out. Identity/minimal manifest contents.

---

## 1. Problem

In-repo profiles such as
[docs/examples/profiles/aspice-swe-mini/markspec.yaml](../../examples/profiles/aspice-swe-mini/markspec.yaml)
declare `extends: "npm:@markspec/profile-default@^1.0"`. That is wrong: the
default profile is specified to be **bundled in the binary** and loaded
automatically, so a consumer should never name it explicitly.

Today nothing is bundled:

- No bundled default-profile package or embedded constant exists.
- `loadChain`
  ([packages/markspec/core/profile/chain.ts](../../../packages/markspec/core/profile/chain.ts))
  only walks explicit `extends:` pointers — it never injects a default tier.
- `.markspec.yaml` parsing
  ([packages/markspec/core/config/markspec.ts](../../../packages/markspec/core/config/markspec.ts))
  rejects every key except `profiles` (`ALLOWED_MARKSPEC_YAML_KEYS`), so
  `default-profile: false` is currently a parse error.
- `@markspec/profile-default` exists only as a **test fixture**;
  `strawman_test.ts` rewrites `extends: npm:@markspec/profile-default@^1.0` →
  `extends: "../default"` because nothing is bundled.

This work is recognized and deliberately deferred: the profile-schema Tier 2
handoff records _"Bundled default profile auto-activation: DEFERRED to a
follow-up slice."_

## 2. Authoritative design (ADR-010 is partially superseded)

ADR-010 ("the core has no types; the default profile supplies
`requirement`/`note`/`term`/`reference`") is obsolete: the nextgen refactor
froze a 19-name core taxonomy (4 abstract + 15 concrete) directly in core
(`CORE_ABSTRACT_TYPES` / `CORE_CONCRETE_TYPES` in
[packages/markspec/core/model/mod.ts](../../../packages/markspec/core/model/mod.ts)).

The authoritative current design is
[markspec-profile-schema.md §7 + §2.2](../../specs/markspec-profile-schema.md):

- §2.2 — the default profile is **bundled in the binary and registered as the
  implicit bottom of the chain unless `default-profile: false`** is set in
  `.markspec.yaml`. Core-only mode = `default-profile: false` **and** empty
  `profiles:`.
- §7 — under the 19-name core taxonomy the default profile is **thin**: it
  declares **no new types**. Its intended contents (display-ID pattern bindings,
  RFC 2119 hygiene, `{{def.<slug>}}` glossary, hygiene-rule restatement, two
  front-matter keys) are **out of scope here** — see §8.

## 3. Scope decision

**Mechanism only**, with an **identity/minimal manifest**. Rationale:

- The mechanism (bundle + auto-register + opt-out) is the actual fix for the
  stated problem and is fully implementable today.
- §7.1's display-ID pattern bindings are **not expressible** in the current
  profile schema: §3.1 R3.1-d (implemented as `MSL-A040`,
  [load.ts](../../../packages/markspec/core/profile/load.ts)) makes a profile
  type named identically to a core type a hard error, and every profile type
  must `extends:` a parent as a **new** type — there is no "bind a pattern to an
  existing core type" construct. The five prefixes `REQ/TST/ICD/REC/RSK` are
  already core-reserved and inferred unconditionally
  ([core-data-model §1.7](../../specs/markspec-core-data-model.md)). Adding a
  binding construct is a separate schema slice.
- RFC 2119 `MSL-M061` and `{{def.}}` glossary were already deferred for the same
  blocker; §7.1 bindings join them.

## 4. Approach (chosen: synthetic bottom tier from an embedded constant)

A new embedded constant holds the §7-minimal manifest as a **string**. A new
`ProfileSpecifier` variant `{ kind: "builtin" }` represents it. The default
becomes the **implicit root of the `extends:` chain**. Injection happens at the
loader boundary, never in the user's `.markspec.yaml`.

```text
.markspec.yaml ─▶ loadProfileForCommand
                     │  parse config (now also reads `default-profile:`)
                     │  decide leaf specifier + whether builtin is enabled
                     ▼
                  loadChain(leaf)
                     │  walk extends: leaf → … → root
                     │  when a tier declares no `extends:` AND builtin enabled
                     │     AND tier is not itself builtin → cursor = {kind:"builtin"}
                     │  resolver: kind==="builtin" → embedded constant (no I/O)
                     ▼
                  mergeChain  →  tiers[0] = @markspec/profile-default
```

Rejected alternatives: a bundled `.yaml` file (deno-compile + Node-compat
fragility; needs an embed step anyway) and config-level injection (couples
"declared" vs "injected", pollutes `markspec profile add` round-tripping and the
audit trail).

## 5. Bundled manifest contents

Minimal identity profile, embedded as a string constant:

```yaml
id: "@markspec/profile-default"
version: 1.0.0
markspec-schema: "1"        # avoids PROFILE-SCHEMA-002
description: Baseline MarkSpec profile
license: MIT
profile:
  attributes: []
  labels: []
  colors:
    primary: blue
    secondary: teal
    tertiary: cyan
    accent: purple
    muted: grey
    warning: orange
    danger: red
  types: {}
  documents:
    types: []
    frontMatter: []
```

No new types, no rules. It contributes a stable identity to extend and the
default color buckets. (`markspec-schema: "1"` is included so the bundled
manifest does not itself trip `PROFILE-SCHEMA-002`.)

## 6. Behaviour matrix (intended behaviour change)

| `.markspec.yaml` state                                        | Before                    | After                                                                  |
| ------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| absent                                                        | core-only (`chain: null`) | **default-only chain** (`tiers=[builtin]`)                             |
| present, empty `profiles:`                                    | core-only                 | **default-only chain**                                                 |
| `profiles: [P]`, `P` has no `extends:`                        | `chain=[P]`               | `chain=[builtin, P]`                                                   |
| `profiles: [P]`, `P extends Q`, `Q` has no `extends:`         | `chain=[Q,P]`             | `chain=[builtin, Q, P]` (builtin spliced as the root, below `Q`)       |
| `profiles: [P]`, `P extends Q`, `Q extends` an npm/git parent | `chain=[…,Q,P]`           | `chain=[…,Q,P]` (unchanged — explicit root already present, no splice) |
| `default-profile: false`                                      | core-only                 | **core-only (unchanged)**                                              |
| `profiles: [A,B]`                                             | `PROFILE-LOAD-006`        | `PROFILE-LOAD-006` (unchanged)                                         |

"Core-only mode" now requires explicit `default-profile: false` — exactly per
profile-schema §2.2. This behaviour change is intended and spec-mandated.

## 7. Components changed

- **`packages/markspec/core/profile/default_profile.ts`** (new) — the manifest
  string constant + a `BUILTIN_DEFAULT_SOURCE_PATH` sentinel for diagnostics.
- **`packages/markspec/core/model/profile.ts`** — add `{ kind: "builtin" }` to
  the `ProfileSpecifier` union (currently line ~149).
- **`packages/markspec/core/profile/chain.ts`** —
  - resolver branch for `kind: "builtin"` returning the embedded constant (no
    `Deno.*`, Node-safe);
  - `specifierKey` / `stringifySpec` branches for `builtin`;
  - in the cursor walk, splice the builtin specifier as the implicit root when
    the current tier declares no `extends:`, builtin is enabled, and the current
    tier is not itself the builtin (guards against double injection and
    builtin-extends-builtin).
- **`packages/markspec/core/config/markspec.ts`** — add `"default-profile"` to
  `ALLOWED_MARKSPEC_YAML_KEYS`; add `defaultProfile?: boolean` to
  `MarkspecYaml`; parse it (non-boolean → `.markspec.yaml` diagnostic);
  `addProfileSpecifier` must preserve the key on round-trip.
- **`packages/markspec/core/profile/load.ts`** — `loadProfileForCommand` threads
  `defaultProfile` (default **true**) into the chain decision. The
  `rawYaml === null` and empty-`profiles:` paths now return the builtin chain
  instead of `null` unless opted out. MSL-A040 is unaffected (builtin declares
  nothing reserved).
- **`packages/markspec/core/mod.ts`** — export only what main.ts / LSP need
  (expected: nothing beyond existing types; confirm during implementation).

## 8. Out of scope (explicit — separate later slices)

- §7.1 display-ID pattern bindings (`REQ-`/`TST-`/`ICD-`/`REC-`/`RSK-`,
  `enforcement: warn`) — blocked on a core-type-binding schema construct.
- RFC 2119 / RFC 8174 hygiene diagnostic `MSL-M061`.
- Glossary `{{def.<slug>}}` prose resolution bound to core `Definition`.
- Hygiene-rule restatement at the profile layer.
- Optional front-matter keys `normative-language` / `glossary-scope`.

## 9. Error handling & edge cases

- The builtin resolver performs no I/O and cannot fail at runtime. A malformed
  embedded constant is caught by **its own unit test**, never a user path.
- `default-profile:` non-boolean → a `.markspec.yaml` diagnostic on the same
  channel as a malformed `profiles:`, `chain: null`, non-zero exit. Fail loud;
  no silent fallback.
- `loadChain` cycle/depth guards already cover the spliced root; the builtin has
  no `extends:` so the walk always terminates.
- A user profile that _explicitly_ `extends:` an npm `@markspec/profile-default`
  still resolves via the existing npm path — we do not hijack that specifier; we
  only **splice** the builtin when there is no explicit parent.

## 10. Testing

- **Unit** —
  - `default_profile_test.ts`: the embedded constant parses with zero error
    diagnostics and no `PROFILE-SCHEMA-002`.
  - `chain_test.ts`: builtin splice for the six §6 matrix rows (including
    builtin-only, builtin+leaf, builtin spliced under a multi-tier chain,
    opt-out suppresses splice, no double-injection when leaf already extends a
    real parent that itself has no parent).
  - `markspec_test.ts`: `default-profile:` parsing — `true`, `false`, absent
    (defaults true), non-boolean (diagnostic).
- **E2E** — `validate` / `profile show` / `doctor` with no `.markspec.yaml` show
  the default tier; with `default-profile: false` they are core-only; a
  `profile show` snapshot includes `@markspec/profile-default` as tier 0.
- **Fixture / snapshot churn (expected, called out)** —
  - `strawman_test.ts` drops its local-default rewrite scaffold; the chain
    auto-includes the builtin. Assertions adjust (chain still resolves,
    `tiers[0].id === "@markspec/profile-default"`, two tiers).
  - Any `profile show` / `doctor` snapshot gains the default tier.

## 11. Breaking changes & policy

Per `project_no_migration_until_1_0` (no back-compat shims pre-1.0): in-repo
manifests are changed, not given a compatibility resolver.

- **`docs/examples/profiles/aspice-swe-mini/markspec.yaml`** — remove
  `extends: "npm:@markspec/profile-default@^1.0"`. The builtin is now the
  implicit root; the strawman still forms a two-tier chain (builtin →
  aspice-swe-mini). This is the demonstration of the fix.
- `packages/markspec/core/config/markspec_test.ts` npm-specifier-**parsing**
  tests stay (npm specifier syntax remains valid; they assert parsing, not the
  default mechanism).
- Documentation follow-ups (out of code scope, noted here): ADR-008,
  profile-schema prose, and `skills/markspec-*profile-bundle*` still show
  `extends: npm:@markspec/profile-default` as the idiom — flag for a later docs
  pass.
- Add a one-line status note to ADR-010 / profile-schema §7 recording that the
  mechanism shipped and that §7.1 bindings / RFC 2119 / glossary remain
  deferred.

## 12. Acceptance criteria

- [ ] No `.markspec.yaml` → active chain is `[@markspec/profile-default]` (not
      core-only).
- [ ] `default-profile: false` (+ empty/absent `profiles:`) → core-only, no
      synthetic tier, behaviour identical to today.
- [ ] `profiles: [P]` with no `extends:` in `P` → chain
      `[@markspec/profile-default, P]`.
- [ ] `default-profile:` accepts only a boolean; any other value emits a
      `.markspec.yaml` diagnostic and yields `chain: null`.
- [ ] `markspec profile add` preserves an existing `default-profile:` key on
      round-trip.
- [ ] The embedded manifest parses with zero error diagnostics and no
      `PROFILE-SCHEMA-002`.
- [ ] `aspice-swe-mini` strawman resolves with the explicit `extends:` removed;
      `strawman_test.ts` no longer needs the local-default rewrite.
- [ ] `just build` (lint + test + typecheck + compile) passes;
      `deno fmt --check` and `dprint check` pass.
- [ ] Production code added to `core/` uses no `Deno.*` APIs (Node-compat rule).
