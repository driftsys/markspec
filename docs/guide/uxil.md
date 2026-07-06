# Using uxil to declare interaction surfaces

uxil is the MarkSpec UX Interaction DSL. It gives meaning to the `ux:`
references that appear in your entry bodies — one root surface per contract
entry, its interactive elements, and any nested child surfaces — so specs,
tests, journeys, and telemetry can be validated against what the UI surface
actually affords.

---

## When do I use uxil?

Use uxil when an entry documents a UI/HMI surface — a screen, a panel, an
always-on agent — and you want:

- **Cross-artifact validation** — specs, tests, journeys, and telemetry
  reference the surface by its `ux:` path; the compiler catches a reference to
  an element, state, or verb the surface doesn't actually declare.
- **Tooling support** — LSP hover shows a surface's or element's declaration
  card; completion after `ux:` offers known surface paths; go-to-declaration
  jumps straight to the authoring entry.
- **One corpus registry** — every declared surface, element, and state is
  indexed once, corpus-wide, instead of relying on a screenId/elementId
  convention nobody enforces.

Contrast with typl: typl types `$Name` data identifiers — signals, commands,
events. uxil types UI surfaces and their interactions — screens, panels, agents,
and the verbs (`activate`, `select`, `navigate`, …) an element affords.

You do not need uxil if your entries describe UI behavior only in prose, with no
`ux:` path that other entries, tests, or telemetry need to reference by a stable
name.

---

## Activation

uxil is **profile-gated**. Until a profile designates a contract entry type with
`declares: ux-surface`, uxil-looking content stays inert — opaque prose, no
diagnostics:

```yaml
profile:
  types:
    ux-contract:
      extends: Contract
      display-id-pattern: "UXI_{n:4d}"
      declares: ux-surface
```

With the designation active, entries of that type are compiled and validated in
full, and `ux:` citations are checked from every entry in the project, whatever
its own type. See the [language reference](../spec/language/uxil.md) for the
full activation rules, including how a declaration outside the declaring type is
handled.

---

## Declaring a root surface

A contract entry — the type your profile designated with `declares: ux-surface`
— declares exactly one root surface: an inline code span naming the surface's
dotted path, its kind, and its states.

```markdown
- [UXI_0001] Media home surface

  The media home screen (`ux:media.home : screen @loading, ready`) offers
  playback control to the driver.

      Id: 01JZEXAMPLEULID000000000001
```

`media.home` is the surface's corpus-wide path; `screen` is its kind — one of
the three closed kinds (`screen`, `panel`, `agent`); `loading` and `ready` are
its declared states. A contract entry with no root surface is UXIL-011; a second
root declared in the same entry is UXIL-012 — the first one wins.

---

## Declaring elements

Elements are a surface's interactive parts, declared as bullets nested under the
entry that carries the root (or under a child surface — next section). Each
bullet opens with a code span — the element name and its verb set — and closes
with trailing prose: the **event dictionary**, free text describing what the
interaction does. Every element bullet must have one (UXIL-006).

### A plain verb

```markdown
- `/play : activate` — starts or pauses playback.
```

### A verb with a key template

An element that stands for a family of instances — one per track, one per row —
declares a `{name}` key template instead of a single fixed identity. A citation
against a templated element must repeat the `{name}` template form; supplying a
concrete key where a template is declared is UXIL-022.

```markdown
- `/track : select : {track_id}` — selects a track from the queue by its id.
```

### An element with states

`@state, state, …` after the verb set scopes when the element's affordance
applies.

```markdown
- `/play : activate @enabled, disabled` — enabled once buffering completes;
  disabled while buffering.
```

### A navigate element with a target

`navigate` is the one verb that requires a `-> target`; a missing target is
UXIL-026, and a target that doesn't resolve to another declared `screen` surface
is UXIL-017.

```markdown
- `/settings : navigate -> ux:media.settings` — opens the settings screen.
```

---

## Declaring child surfaces

A child surface nests under its parent with a leading-dot bullet; its own nested
bullets are its elements. It inherits its kind from the root and resolves to a
corpus-wide path by joining onto its nearest enclosing surface.

```markdown
- [UXI_0001] Media home surface

  The media home screen (`ux:media.home : screen @loading, ready`) offers
  playback control to the driver.

  - `/play : activate` — starts or pauses playback.
  - `.confirm @default` — delete-confirmation dialog nested under the home
    screen.
    - `/confirm : activate` — confirms the deletion.
    - `/cancel : activate` — dismisses the dialog without deleting.

      Id: 01JZEXAMPLEULID000000000002
```

`.confirm` registers as `media.home.confirm` in the corpus registry — its own
states and elements, `screen`'s kind inherited from the root.

---

## Editor support

The MarkSpec LSP provides three uxil affordances when you open a Markdown file:

- **Hover** — hovering a `ux:` reference (declaration or citation) shows a
  declaration card: the surface's kind, its declared states, and the owning
  entry. Hovering an element reference shows its verb set, states, and event
  dictionary instead.
- **Completion** — typing `ux:` offers the corpus's known surface paths,
  filtered by whatever you've typed so far.
- **Go-to-declaration** — jumping from a `ux:` citation lands on the declaring
  bullet, wherever in the project it lives.

All three require the `markspec lsp` server to be running, and a profile that
designates a declaring type (see Activation above). In VS Code, install the
MarkSpec extension — it starts the server automatically.

---

## Common diagnostics and fixes

### UXIL-010 — unknown interaction verb

```
UXIL-010: Unknown interaction verb 'tap'.
```

**Cause:** An element's verb set uses a verb outside the eleven closed verbs
(`activate`, `toggle`, `select`, `adjust`, `input`, `scroll`, `drag`,
`navigate`, `dismiss`, `ask`, `observe`).

**Fix:** Replace it with one of the eleven declared verbs.

### UXIL-011 — no root surface declared

```
UXIL-011: A ux-contract entry must declare exactly one root surface; none was found.
```

**Cause:** The entry has element or child-surface bullets, but never declares a
root (`` `ux:surface : kind` ``) span anywhere in its body.

**Fix:** Add the root declaration the elements are meant to hang off.

### UXIL-014 — observe combined with other verbs

```
UXIL-014: 'observe' is exclusive and cannot be combined with other verbs on element 'status'.
```

**Cause:** An element's verb set lists `observe` alongside another verb.
`observe` marks a passive visibility anchor, never an interactive affordance, so
it cannot share an element with `activate`, `select`, and the rest.

**Fix:** Split into two elements — one `observe`-only, one for the interactive
verbs.

### UXIL-018 — citation of an undeclared surface

```
UXIL-018: Unknown surface 'media.settings'.
```

**Cause:** A `ux:` citation elsewhere in the project references a surface path
that no contract entry ever declares.

**Fix:** Declare the surface, or fix the typo'd path in the citation.

### UXIL-023 — declaration outside the declaring entry type

```
UXIL-023: uxil declaration outside a declaring entry type: 'REQ_0001' (type 'requirement') may not declare surfaces (requires 'declares: ux-surface').
```

**Cause:** A root, element, or child-surface span was written inside an entry
whose type is not the one the profile designated with `declares: ux-surface`.

**Fix:** Move the declaration into a contract entry of the declaring type, or
replace it with a `ux:` citation if the intent was only to reference an existing
surface.

---

## uxil and typl together

uxil and typl are siblings on the same shared declaration-surface machinery
(`core/decl/`) — the same base-resolution engine, the same bullet/inline
extraction pattern. An entry can freely mix a uxil surface declaration with typl
bindings; nothing about one DSL's grammar constrains the other.

There is no formal link today between an element's event and a typed value it
carries. If an element's event carries data worth typing — a track id, a
gesture's velocity — declare it as its own typl binding in the same entry and
reference it by name from the event dictionary prose:

```markdown
- [UXI_0001] Media home surface

  The media home screen (`ux:media.home : screen @loading, ready`) offers
  playback control to the driver.

  - `/track : select : {track_id}` — selects a track, carrying its
    `$TrackId : signal int[0..999]` identifier.

    Id: 01JZEXAMPLEULID000000000003
```

This is a naming convention today, not a checked cross-reference — the compiler
does not tie the element's key template to the typl binding. See
[ADR-034's "Deferred" section](../architecture/adr-034-uxil-interaction-dsl.md#deferred)
for why that link isn't built yet.

---

## See also

- [ADR-034 — uxil: UX Interaction DSL](../architecture/adr-034-uxil-interaction-dsl.md)
- [Language reference: uxil](../spec/language/uxil.md)
