# uxil — UX Interaction Language

> **Status:** diagnostics catalogue (S9,
> [#727](https://github.com/driftsys/markspec/issues/727)). The full chapter —
> reference grammar, declaration forms, base resolution, registry, and machine
> projection — lands with the uxil ADR (S12,
> [#730](https://github.com/driftsys/markspec/issues/730)).

uxil is a declaration DSL for typed UI/HMI surfaces and interactions: `ux:` URI
references, one root surface per contract entry, element and child-surface
bullets, and a corpus-wide surface registry. It is the sibling of the
[typl DSL](typl.md) on the shared declaration-surface machinery.

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
`codeDescription` targeting `https://markspec.dev/spec/uxil#uxil-0xx` anchors in
this chapter.
