# uxil — UX Interaction Language

uxil is a declaration DSL for typed UI/HMI surfaces and interactions: `ux:` URI
references, one root surface per contract entry, element and child-surface
bullets, and a corpus-wide surface registry. It is the sibling of the
[typl DSL](typl.md) on the shared declaration-surface machinery.

---

## Reference grammar

### Lexical tokens

A `ux:` reference or declaration is tokenized on a single line; whitespace
(space, tab) between tokens is insignificant.

| Token               | Matches                       |
| ------------------- | ----------------------------- |
| `IDENT`             | one or more of `[A-Za-z0-9_]` |
| `DOT`               | `.`                           |
| `AT`                | `@`                           |
| `SLASH`             | `/`                           |
| `COLON`             | `:`                           |
| `BANG`              | `!`                           |
| `COMMA`             | `,`                           |
| `ARROW`             | `->`                          |
| `LBRACE` / `RBRACE` | `{` / `}`                     |

`?` and `#` are reserved and never valid anywhere in a reference or declaration;
either fires UXIL-002 and stops structural parsing of that span (the lexer drops
the character, so no downstream token is trustworthy). Unrecognised characters
outside this reserved pair are skipped silently by the lexer — the parser, not
the lexer, is responsible for turning the resulting gap into a diagnostic.

### Reference (citation / nav-target) form

```ebnf
ux-ref  ::= [ "ux:" ] surface [ "@" state ] [ "/" element [ ":" key ] [ "!" verb ] ]
surface ::= IDENT ( "." IDENT )*
key     ::= IDENT | "{" IDENT "}"
```

`state`, `element`, and `verb` are each a single `IDENT`. The `ux:` scheme is
optional: a bare wire form parses identically to its scheme-prefixed
counterpart, differing only in the `hasScheme` flag captured on the parsed
`UxRef`.

```
ux:media.home/play
media.home/play
```

Both references resolve to the same surface (`media.home`) and element (`play`)
— only `hasScheme` differs (`true` for the first, `false` for the second).

- **surface** — one or more dot-separated path segments (`media.home`).
- **@state** — an optional single state name. A reference cites at most one
  state; a declaration (below) allows a comma-separated state set.
- **/element** — an optional element name on that surface.
- **:key** — an optional key, valid only after an element: a concrete value
  (`:track42`) or a `{name}` template placeholder (`:{track_id}`).
- **!verb** — an optional verb, valid only after an element (and after any key).

```
ux:media.home@loading
ux:media.list/item:{id}
ux:media.home/play!activate
```

### Declaration forms (grammar summary)

The three declaration forms below are documented with worked examples in
[Declaration forms](#declaration-forms); their grammar, for reference:

```ebnf
root-decl    ::= [ "ux:" ] surface ":" kind [ "@" state ( "," state )* ]
element-decl ::= "/" element ":" verb ( "," verb )* [ ":" key-template ]
                 [ "@" state ( "," state )* ] [ "->" ux-ref ]
child-decl   ::= "." surface [ "@" state ( "," state )* ]
key-template ::= "{" IDENT "}"
kind         ::= IDENT   (* one of the three closed kinds — see Closed vocabularies *)
verb         ::= IDENT   (* one of the eleven closed verbs — see Closed vocabularies *)
```

A `root-decl`'s `:` introduces its `kind`, not a reference key — the two `:`
productions never collide because a reference's `key` only appears after a
`/element`, while a root declaration's surface is never followed by `/`. An
`element-decl`'s key clause is a `key-template` only (a concrete key is a
citation-only form); its `-> ux-ref` nav target is itself a full reference,
scheme-optional, most often relative (`-> media.settings`).

---

## Declaration forms

uxil declarations are written as inline code spans (the root form) or as the
leading code span of a bullet paragraph (element and child-surface forms) inside
a declaring entry's body.

### Root

```
ux:surface : kind @state, state, …
```

Exactly one root declaration is required per declaring entry — none is UXIL-011,
more than one is UXIL-012 for every declaration past the first. The scheme is
optional here too: `media.home : screen @ ready` classifies as a root
declaration exactly like `` `ux:media.home : screen @ ready` ``.

```markdown
- [UXI_0012] Media home screen contract

  The media home screen (`ux:media.home : screen @ loading, ready`) offers
  playback control.

      Id: 01JZEXAMPLEULID000000000010
```

### Element bullet

```
/element : verb[, verb…] [: {key}] [@state, …] [-> nav-ref]
```

The leading code span declares the element's verb set (one or more verbs), an
optional key template for a repeated element, an optional state set, and an
optional navigation target. A navigation target is itself a `ux:` reference and
may likewise omit the scheme, e.g. `` `/queue : navigate -> media.queue` ``. The
prose that follows the code span — with a leading em dash separator stripped —
is the element's **event dictionary**; it is mandatory (UXIL-006 when absent).

```markdown
- [UXI_0012] Media home screen contract

  The media home screen (`ux:media.home : screen @ loading, ready`) offers
  playback control.

  - `/play : activate` — starts playback of the currently highlighted track.
  - `/favorite_toggle : toggle : {track_id}` — marks a track favourite.

    Id: 01JZEXAMPLEULID000000000010
```

### Child-surface bullet

```
.path @state, state, …
```

A child-surface bullet declares a nested surface. Its own nested bullets are its
elements; kind is never re-declared on a child surface — every descendant
surface inherits the root's kind (see [Base resolution](#base-resolution) for
how `.path` resolves).

```markdown
- [UXI_0012] Media home screen contract

  The media home screen (`ux:media.home : screen @ loading, ready`) offers
  playback control.

  - `/play : activate` — starts playback of the currently highlighted track.
  - `.confirm_dialog @ default` — delete confirmation dialog.
    - `/confirm : activate` — confirms the deletion.

      Id: 01JZEXAMPLEULID000000000010
```

---

## Closed vocabularies

Two vocabularies are closed and core-owned — extension is a markspec release
decision, not a profile concern (ADR-009).

### Kinds

| Kind     | Navigable | Stateful | Visual |
| -------- | --------- | -------- | ------ |
| `screen` | yes       | yes      | yes    |
| `panel`  | no        | no       | yes    |
| `agent`  | no        | yes      | no     |

- **Navigable** — a valid `navigate ->` target. Only `screen`.
- **Stateful** — may declare `@` states (UXIL-013 otherwise). `screen` and
  `agent`.
- **Visual** — subject to visibility assertions and `observe` anchors (UXIL-025
  otherwise). `screen` and `panel`.

### Verbs

| Verb       | Requires nav target | Exclusive |
| ---------- | ------------------- | --------- |
| `activate` | no                  | no        |
| `toggle`   | no                  | no        |
| `select`   | no                  | no        |
| `adjust`   | no                  | no        |
| `input`    | no                  | no        |
| `scroll`   | no                  | no        |
| `drag`     | no                  | no        |
| `navigate` | yes                 | no        |
| `dismiss`  | no                  | no        |
| `ask`      | no                  | no        |
| `observe`  | no                  | yes       |

- **Requires nav target** — the element must carry a `-> target` clause
  (UXIL-026 otherwise). Only `navigate`.
- **Exclusive** — cannot combine with any other verb on the same element
  (UXIL-014 otherwise). Only `observe`.

---

## Base resolution

A child-surface bullet's path is always a relative reference. It resolves
against the base of the nearest enclosing ancestor surface — innermost wins —
through the same DSL-agnostic engine typl's published tier uses: `resolveRef` in
`core/decl/resolve.ts`. uxil supplies its own reference operations (`UX_REF_OPS`
in `assemble.ts`): joining a base with a relative path is dot-concatenation, and
there is no absolute internal path form. Unlike typl, which parses a genuinely
absolute `$a.b.c` form, every uxil internal join is relative — `UX_REF_OPS`'s
`isAbsolute` is kept only for API symmetry with the shared engine and never
fires on a real child-surface path.

The nearest ancestor is the closest enclosing child-surface bullet; an element
bullet never establishes a base. With no child-surface ancestor in scope, the
base is the entry's root surface. A child-surface bullet nested under a broken
(diagnostic-producing) ancestor is never silently reparented to a grandparent or
the root — its descendants are dropped rather than resolved against the wrong
base.

---

## Corpus registry

`UxRegistry` (built by `buildUxRegistry` in `registry.ts`) is the corpus-wide
index of every declared surface, keyed by absolute surface path. A path's
declarations are not collapsed: every declaration found across the corpus is
kept, in source order. A surface declared more than once is not an error at the
registry layer — the validator surfaces the collision as UXIL-015.

Each declaration is a `SurfaceRecord`:

| Field                  | Type                   | Description                                                      |
| ---------------------- | ---------------------- | ---------------------------------------------------------------- |
| `path`                 | `string`               | Absolute, dot-joined surface path (`media.home.confirm_dialog`). |
| `kind`                 | `string`               | The surface kind — one of the three closed kinds.                |
| `states`               | `readonly string[]`    | The declared state set, in declaration order.                    |
| `owningEntryDisplayId` | `string`               | Display ID of the entry that declared this surface.              |
| `owningEntryFile`      | `string`               | File path of the owning entry.                                   |
| `elements`             | `readonly UxElement[]` | The surface's declared interaction elements.                     |
| `location`             | `SourceLocation`       | Source position of the declaration.                              |

---

## Machine projection

`projectUxRegistry` (in `projection.ts`) turns a `UxRegistry` into a
`UxProjection`: a deterministic, JSON-serialisable manifest for downstream
codegen and other tooling. `projectUxRegistry(registry)` is byte-identical
across repeated calls on the same registry:

- surfaces are sorted by `id` (the surface path);
- elements within a surface are sorted by `name`;
- states are sorted;
- verbs are kept in **declaration order** — order is load-bearing for compound
  controls, so it is not sorted.

A surface declared more than once corpus-wide (UXIL-015) projects using only its
first-declared record; the duplicate itself stays a validator concern.

A `ProjectedSurface` carries `id`, `kind`, `states`, `parent` (the dot-truncated
parent path, when it is itself a registered surface — else `null`), and
`elements`. A `ProjectedElement` carries `name`, `verbs`, `keyTemplate` (the
template name, or `null`), `nav` (the resolved navigation target path, or
`null`), and `states`.

The `media.home` screen declared in [Declaration forms](#declaration-forms)
projects to:

```json
{
  "surfaces": [
    {
      "id": "media.home",
      "kind": "screen",
      "states": ["loading", "ready"],
      "parent": null,
      "elements": [
        {
          "name": "favorite_toggle",
          "verbs": ["toggle"],
          "keyTemplate": "track_id",
          "nav": null,
          "states": []
        },
        {
          "name": "play",
          "verbs": ["activate"],
          "keyTemplate": null,
          "nav": null,
          "states": []
        }
      ]
    }
  ]
}
```

---

## Activation — the declaring entry type

uxil validation is **profile-gated**. A profile designates the contract entry
type by setting `declares: ux-surface` on a type:

```yaml
profile:
  types:
    ux-contract:
      extends: Contract
      display-id-pattern: "UXI_{n:4d}"
      declares: ux-surface
```

With no designation anywhere in the active profile chain, uxil content is inert:
uxil-looking code spans stay opaque and draw no diagnostics.

With a designation:

- entries of a declaring type are compiled and validated in full;
- `ux:` citations are validated from **every** entry, whatever its type;
- a root declaration (`` `ux:… : kind` `` span) in a non-declaring entry is
  UXIL-023. Element (`/`-led) and child-surface (`.`-led) bullets outside a
  declaring entry stay opaque — they are ambiguous with ordinary prose code
  spans.
- cross-entry resolution codes (UXIL-016, UXIL-017, UXIL-018) are reported on
  project scope (bare check, the editor); a file-local check of an explicit
  subset suppresses them — a subset registry cannot tell a dangling reference
  from an unchecked file.

---

## Diagnostic catalogue

| Code     | Severity | Description                                                                                                                                                      |
| -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UXIL-001 | error    | Malformed uxil reference.                                                                                                                                        |
| UXIL-002 | error    | Reserved character in a uxil reference.                                                                                                                          |
| UXIL-003 | error    | `ux://authority` form is reserved; use a scheme-relative reference.                                                                                              |
| UXIL-004 | error    | Root declaration missing its kind.                                                                                                                               |
| UXIL-005 | error    | Element declaration with an empty verb set.                                                                                                                      |
| UXIL-006 | error    | Element declaration missing its trailing event dictionary.                                                                                                       |
| UXIL-007 | error    | Malformed key template.                                                                                                                                          |
| UXIL-008 | error    | Malformed surface.                                                                                                                                               |
| UXIL-009 | error    | Unknown surface kind (expected `screen`, `panel`, or `agent`).                                                                                                   |
| UXIL-010 | error    | Unknown interaction verb.                                                                                                                                        |
| UXIL-011 | error    | Contract entry declares no root surface.                                                                                                                         |
| UXIL-012 | error    | More than one root surface declared in a contract entry.                                                                                                         |
| UXIL-013 | error    | `@` states declared on a stateless kind.                                                                                                                         |
| UXIL-014 | error    | `observe` combined with other verbs (it is exclusive).                                                                                                           |
| UXIL-015 | error    | Surface declared more than once corpus-wide.                                                                                                                     |
| UXIL-016 | error    | Dangling namespace parent — a nested surface whose dotted ancestor is declared nowhere.                                                                          |
| UXIL-017 | error    | `navigate ->` target does not resolve to a navigable (`screen`) surface.                                                                                         |
| UXIL-018 | error    | Citation of an undeclared surface.                                                                                                                               |
| UXIL-019 | error    | Citation of an undeclared element.                                                                                                                               |
| UXIL-020 | error    | Cited verb not in the element's declared verb set.                                                                                                               |
| UXIL-021 | error    | Cited state not declared on the surface.                                                                                                                         |
| UXIL-022 | error    | Concrete key cited where the element declares a key template.                                                                                                    |
| UXIL-023 | error    | uxil declaration outside the declaring entry type.                                                                                                               |
| UXIL-024 | error    | Relative reference with no base in scope. _Reserved — reachable once the uxil table surface lands ([#717](https://github.com/driftsys/markspec/issues/717) §A)._ |
| UXIL-025 | error    | `observe` declared on a surface whose kind is not visual.                                                                                                        |
| UXIL-026 | error    | `navigate` declared without a `-> target` clause.                                                                                                                |

Editor integrations receive each code's documentation link as an LSP
`codeDescription` targeting `https://markspec.dev/extensions/uxil#uxil-0xx`
anchors in this chapter.
