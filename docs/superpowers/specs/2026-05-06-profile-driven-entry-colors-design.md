# Profile-Driven Entry Colors

**Date:** 2026-05-06\
**Scope:** Replace the hardcoded display-ID prefix → color-bucket heuristic in
the renderer with a profile-declared semantic-name → palette-color resolution.
Drop the V-model assumption (`req` / `spec` / `test`) from core.

## Context

Today the entry-block renderer maps a display-ID prefix to one of three fixed
color buckets:

- [packages/markspec/render/typst/template.ts:194-200](packages/markspec/render/typst/template.ts#L194-L200)
  — `displayIdCategory()`: hardcoded prefix → `req | spec | test`.
- [packages/markspec-typst/entry.typ:20-24](packages/markspec-typst/entry.typ#L20-L24)
  — `entry-category()`: same logic in Typst.
- [theme/tokens.yaml](theme/tokens.yaml) — `entries: { req, spec, test }`: a
  curated 3-pick of the Paul Tol palette already present under `diagram:`.

Two problems:

1. **V-model assumptions in core.** ADR-009 anchors the core/profile boundary:
   core has no type vocabulary. Yet the renderer encodes `STK / SAD / SRS / SWT`
   prefix knowledge and a `req / spec / test` bucket vocabulary that any
   non-V-model profile (hardware schematics, business rules, regulatory clauses)
   has no use for.
2. **No way for profiles to declare colors.** A profile can declare a type with
   any display-ID pattern — but the renderer cannot honor that type's intended
   color because there is no schema field for it.

## Goals

- Profiles drive entry color through a declared vocabulary they own.
- Core ships a palette (the seven Paul Tol hues already in `diagram:` tokens)
  and resolution rules — nothing else.
- Default profile ships an opinionated, role-based vocabulary that any profile
  extending it inherits.
- Referenced-shape entries are always uncolored — the visual distinction between
  identified and referenced is preserved without a color knob.
- Removing the prefix heuristic must not break any currently-rendering document.
  Existing showcase docs get explicit color assignments via their active
  profile.

## Design

### Schema additions

**`profile.colors:` map (optional, inheritable, peer of `profile.types:`):**

```yaml
# bundled @markspec/profile-default
profile:
  colors:
    primary:   blue
    secondary: teal
    tertiary:  cyan
    accent:    purple
    muted:     grey
    warning:   orange
    danger:    red

  types: { ... }
```

- Keys are profile-author-chosen semantic names. Allowed character set:
  lowercase alphanumeric plus hyphen, must start with a letter (regex
  `^[a-z][a-z0-9-]*$`).
- Values are palette hue names. The allowed set is the seven hues declared under
  `diagram:` in `theme/tokens.yaml`: `blue`, `cyan`, `teal`, `orange`, `red`,
  `purple`, `grey`.
- Inherited through the `extends:` chain. Merge semantics: keys from child and
  parent are unioned; on key collision the child's binding wins. Same model as
  `profile.attributes:` merging today (ADR-008 §4).

**Per-type `color:` field (optional):**

```yaml
types:
  software-requirement:
    shape: identified
    color: primary           # → resolves to 'blue' via merged colors map
  software-element:
    shape: identified
    color: secondary
  unit-test:
    shape: identified
    color: danger
  standard:
    shape: referenced        # color is meaningless and forbidden here
```

- Value must reference a key present in the merged `colors:` map.
- Setting `color:` on a `referenced`-shape type is a manifest **warning**
  (`MSL-PROFILE-COLOR-001`) — the value is silently ignored at render time.

### Validation

Three new manifest diagnostics, emitted at `parseManifest()` time:

| Code                    | Severity | Triggered when                                                        |
| ----------------------- | -------- | --------------------------------------------------------------------- |
| `MSL-PROFILE-COLOR-001` | warning  | `color:` set on a `referenced`-shape type                             |
| `MSL-PROFILE-COLOR-002` | error    | `colors:` value is not one of the seven palette hues                  |
| `MSL-PROFILE-COLOR-003` | error    | type-level `color:` references a name not in the merged `colors:` map |

`MSL-PROFILE-COLOR-002` and `MSL-PROFILE-COLOR-003` block manifest loading;
`-001` does not.

### Render-time resolution

A pure function `resolveEntryColor(entry, profile)` returns a palette hue name
or `null`:

| Entry shape | Profile loaded | Type known | `type.color` set | Result               |
| ----------- | -------------- | ---------- | ---------------- | -------------------- |
| referenced  | (any)          | (any)      | (any)            | `null` (uncolored)   |
| identified  | yes            | yes        | yes              | resolved palette hue |
| identified  | yes            | yes        | no               | `"blue"` (fallback)  |
| identified  | yes            | no         | —                | `"blue"` (fallback)  |
| identified  | no             | —          | —                | `"blue"` (fallback)  |

The fallback is **palette `blue` directly**, not the `primary` semantic name.
This decouples the renderer from any assumption about the active profile's
vocabulary — `markspec doc build` works on a single file with no profile loaded.

### Renderer changes

**TypeScript
([render/typst/template.ts](packages/markspec/render/typst/template.ts))**

- Delete `displayIdCategory(displayId, shape)`.
- Add `resolveEntryColor(entry, profile): string | null` per the table above.
- `renderEntryTypst()` accepts the active profile (already plumbed via
  `RenderContext`) and emits the resolved hue name or `none` to Typst:

  ```typescript
  const color = resolveEntryColor(entry, profile);  // e.g. "blue" or null
  return `#req-block(\n  color: ${color === null ? "none" : `"${color}"`},\n  ...`;
  ```

**Typst
([packages/markspec-typst/entry.typ](packages/markspec-typst/entry.typ))**

- `req-block(color: none | <hue-name>, ...)` — replace the `type:` parameter.
- Internal palette lookup: `entry-color(color, theme)` resolves `"blue"` →
  `theme.entry-blue`, etc. Returns `none` when input is `none`, which the
  block-rendering code interprets as "no left border, default text color for the
  display ID".
- Delete `entry-category(prefix)` (dead code — TS pre-computes).

**Theme tokens ([theme/tokens.yaml](theme/tokens.yaml))**

- Drop the `entries: { req, spec, test }` group entirely.
- The `diagram:` palette becomes the single source of truth for entry colors.
- Regenerate `packages/markspec-typst/tokens.typ`,
  `packages/markspec-typst/themes/light.typ`, `dark.typ` so each palette hue is
  exposed as `theme.entry-blue`, `theme.entry-cyan`, etc.
- `just tokens` regenerates these from `tokens.yaml`; CI gate
  (`scripts/check_tokens.sh`) catches stale output.

### Default profile vocabulary

The bundled `@markspec/profile-default` ships the role-based vocabulary above
(`primary | secondary | tertiary | accent | muted | warning | danger`). It does
**not** pre-assign colors to specific type names — core ships no types, so there
is nothing to bind. Downstream profiles bind their types to roles.

The role names map 1:1 to palette hues for clarity. Authors who prefer
domain-flavored names (e.g. `requirement`, `test`) declare them in their own
profile's `colors:` block — the schema does not enforce role-based naming.

### Migration impact

| File / artifact                                              | Change                                                                                                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/markspec/core/model/profile.ts`                    | Add `color?: string` to `TypeDefinition`; add `colors: ProvenancedValue<Map<string, PaletteHue>>` to `EffectiveProfile`                            |
| `packages/markspec/core/profile/manifest.ts`                 | Parse `colors:` block + per-type `color:`                                                                                                          |
| `packages/markspec/core/profile/chain.ts`                    | Merge `colors:` across the extends chain                                                                                                           |
| `packages/markspec/core/profile/manifest_test.ts`            | Add coverage for the three new diagnostics                                                                                                         |
| `packages/markspec/core/profile/chain_test.ts`               | Add coverage for `colors:` merging                                                                                                                 |
| `packages/markspec/core/profile/default-profile.ts`          | Embed the seven role bindings in the default profile manifest                                                                                      |
| `packages/markspec/render/typst/template.ts`                 | Delete `displayIdCategory()`; add `resolveEntryColor()`; thread profile through                                                                    |
| `packages/markspec/render/typst/template_test.ts`            | Update fixtures to assert color resolution                                                                                                         |
| `packages/markspec-typst/entry.typ`                          | New `color:` parameter; drop `entry-category()`                                                                                                    |
| `packages/markspec-typst/lib.typ`                            | Drop `entry-category` re-export                                                                                                                    |
| `theme/tokens.yaml`                                          | Drop `entries:` group                                                                                                                              |
| `packages/markspec-typst/tokens.typ` (generated)             | Regenerate via `just tokens`                                                                                                                       |
| `packages/markspec-typst/themes/light.typ`, `dark.typ` (gen) | Regenerate via `just tokens`                                                                                                                       |
| `theme/markspec.css` (generated)                             | Regenerate via `just tokens`                                                                                                                       |
| `docs/examples/profiles/aspice-swe-mini/markspec.yaml`       | Add `color:` to each identified type                                                                                                               |
| `docs/examples/profiles/default/markspec.yaml`               | Local default fixture: mirror bundled defaults                                                                                                     |
| Project profile (this repo's STK/SAD types)                  | Add `color: primary` (STK), `color: secondary` (SAD) — exact location depends on where this project's profile lives once the loader is fully wired |
| Strawman e2e test (`core/profile/strawman_test.ts`)          | Extend to assert color resolution end-to-end                                                                                                       |
| Documentation (`docs/spec/typography/typography.md`)         | Update the entry-color section: explain the role-based default, the palette, and the resolution rules                                              |

### Backwards compatibility

None. MarkSpec has not shipped 1.0 — the language is pre-stable, and the V-model
prefix heuristic has no public API contract. Existing rendered PDFs will look
identical for any document whose active profile assigns the V-model-equivalent
colors (the strawman migration does this).

## Non-goals

- **Adding palette hues.** The seven Paul Tol hues are sufficient. Adding more
  is a tokens-side change, not a profile-system change, and is not in scope.
- **HTML book color application.** The book renderer currently renders entry
  blocks via the same Markdown→Typst pipeline (PDF) and a separate Markdown→HTML
  path. The HTML path's color application is out of scope for this change — it
  will follow once the `book` module reads the same `resolveEntryColor()`
  helper. Tracked as follow-up debt.
- **Per-document or per-block color overrides.** A given entry's color comes
  from its type, period. No `color:` attribute on individual entries.
- **Color-bucket inheritance from `shape:` defaults.** A profile cannot say "all
  identified types in this profile default to `accent`." Only per-type bindings
  are honored. Add this later if real demand surfaces.

## Testing

- **Manifest parser unit tests** for the three new diagnostics
  (`MSL-PROFILE-COLOR-001/002/003`) and for `colors:` merging across `extends`.
- **Renderer unit tests** for `resolveEntryColor()` covering all five rows of
  the resolution table.
- **Typst template snapshot tests** asserting the emitted Typst source carries
  the right `color:` argument for representative entries.
- **Strawman end-to-end test** (`strawman_test.ts`) extended to assert that
  `aspice-swe-mini` types resolve to their declared palette hues.
- **Visual sanity check** (manual, single round): regenerate one of the showcase
  PDFs and confirm the colors match the prior output for V-model-style
  documents.
