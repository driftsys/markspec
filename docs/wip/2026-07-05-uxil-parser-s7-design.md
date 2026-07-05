# S7 — uxil parser (design)

- **Story:** #725 —
  `story(uxil): parser — ux: URI reference grammar + declaration forms`
- **Epic:** #717 §B (uxil branch), milestone v0.11.0
- **Depends on (merged):** S2 #720 (shared declaration machinery, `core/decl/`),
  S4 #722 (base-resolution engine, `core/decl/resolve.ts`)
- **Feeds:** S8 #726 (uxil compiler + uxRegistry), S9 #727 (diagnostics)
- **Date:** 2026-07-05
- **Status:** approved (design), pre-implementation

## 1. Goal

Add a **parse-only** uxil layer under `packages/markspec/core/uxil/` that turns
uxil declaration and reference source strings into a typed declaration AST plus
structured parse errors. It mirrors the _parse_ half of the sibling typl DSL
(`lexer → grammar → ast + diagnostics`) and stops exactly where typl's
`assemble.ts` / `validator.ts` begin — those map to S8/S9.

Every uxil reference is a valid RFC 3986 URI under the `ux` scheme; the
scheme-less form is the deployed wire format and MUST parse identically.

## 2. Scope

### In scope (S7)

- `core/uxil/ast.ts` — declaration + ref AST nodes, `Position`.
- `core/uxil/lexer.ts` — `tokenize(source) → { tokens, diagnostics }`.
- `core/uxil/grammar.ts` — recursive-descent parsers → AST + `UxilDiagnostic[]`.
- `core/uxil/recognize.ts` — pure form-classification predicates.
- `core/uxil/diagnostics.ts` — `UXIL_CODES` table + `uxilDiagnostic(...)`.
- `core/uxil/mod.ts` — module barrel.
- Colocated `*_test.ts` for each module.

### Out of scope (deferred)

| Concern                                                          | Owner                                            |
| ---------------------------------------------------------------- | ------------------------------------------------ |
| Walking an entry body / surface extraction wiring                | S8 (uses `core/decl` walkers + S7's recognizers) |
| Base resolution (`resolveRef`), single-root, duplicate detection | S8                                               |
| Kind-inheritance, the uxRegistry, cross-ref validation           | S8                                               |
| Bridging `UxilDiagnostic` → file-anchored core `Diagnostic`      | S9                                               |
| Wiring into `compile` / `check` / `lint` / LSP                   | S9+                                              |

`core/uxil/` is **not** exported from `core/mod.ts` in S7. It is
built-and-tested but otherwise unreferenced — the same state typl's parse pieces
were in before their `assemble` landed. This keeps the slice boundary clean and
the module independently testable.

## 3. Reference grammar (the `ux-ref`)

```abnf
ux-ref  = ["ux:"] surface ["@" state] ["/" element [":" key] ["!" verb]]
surface = segment *("." segment)          ; dots = containment
segment = lower *(lower / digit / "_")
state   = segment
element = segment
verb    = segment
key     = concrete-value / "{" name "}"   ; concrete value or template
```

- The leading `ux:` scheme is **optional** in the parser. `media.home/play` and
  `ux:media.home/play` yield byte-identical AST except for `hasScheme`. This is
  the wire-compatibility contract (hard constraint).
- `?` and `#` are **reserved** — encountering either is a structured parse
  error, not silently consumed.
- The `ux://app/…` authority form is **reserved** for a future owning-app
  qualifier — `//` after the scheme is a structured parse error in S7.

## 4. Declaration forms

All four live inside the profile-designated contract entry type (a gating
concern S8 owns; S7 only parses the syntax).

### 4.1 Root declaration — inline span, exactly one

```
`ux:media.home : screen @ loading, error, ready`
```

- `ux:media.home` — surface (absolute; scheme optional).
- `: screen` — the **kind** keyword (captured raw; validated in S8).
- `@ loading, error, ready` — a **state set** (comma list; may be empty).

**Declaration vs citation disambiguation (decision A3):** a `:` that appears
_immediately after the surface, before any `/element`_ introduces a kind and
marks a root **declaration**. A `:` that appears _after_ `/element` is a ref
**key**. So `ux:media.home : screen` is a declaration; `ux:media.home/play` (and
`ux:media.home/play:{id}`) is a citation.

### 4.2 Element bullet

```
- `/play : activate` — Pressing play resumes playback from the paused position.
```

- Leading `/` → element name (`play`).
- Optional key template (`{id}`) on the element.
- `: activate[, …]` → **verb set** (one or more verbs; comma list).
- Optional `@state[, …]` → state set.
- Optional `-> <ux-ref>` → **nav target**, parsed as a `UxRef` (may be
  scheme-less / relative).
- **Mandatory trailing prose = the event dictionary.**

**Decision A1:** the machine-readable tail (verb set, key template, `@state`,
`-> nav`) lives **inside** the code span. The event dictionary is the bullet
paragraph prose **after** the span. `parseElementBullet` therefore takes the
whole bullet paragraph, splits the leading code span from the trailing prose,
parses the span, and captures the prose.

**Decision A2:** the event dictionary is captured **raw** (a string). Its
presence is **mandatory** — an element bullet with no trailing prose is a
structured parse error. Structuring the dictionary into event→payload entries is
a later slice.

### 4.3 Child-surface bullet

```
- `.confirm_dialog @ default`
  - `/yes : activate` — Confirms and dismisses.
  - `/no : activate` — Cancels and dismisses.
```

- Leading `.` → child surface (containment; `path` = segments after the dot).
- Optional `@state[, …]` → state set.
- Nested bullets are its elements (a **structural** relationship stitched by
  S8's surface walk via `NestedBlockDeclaration.parent`; S7 parses only the
  child-surface bullet's own text). Kind is **inherited** from the parent
  surface — an S8 concern.

### 4.4 Table rows

Table rows are equivalent to bullets (§A caption base). S8's assemble routes a
table row through the same element / child-surface parsers via `core/decl`'s
`extractTableDeclarations`. S7 supplies the row-level parsers; it does not read
tables.

## 5. AST

```ts
export interface Position { readonly line: number; readonly column: number }

/** A ux: reference — citation, nav target, or the surface head of a decl. */
export interface UxRef {
  readonly hasScheme: boolean;          // "ux:" present (false = wire form)
  readonly surface: readonly string[];  // ["media","home"]
  readonly state?: string;              // "@" state (single, per ref grammar)
  readonly element?: string;            // "/" element
  readonly key?: UxKey;                 // ":" key (only after element)
  readonly verb?: string;               // "!" verb
  readonly position: Position;
}

export type UxKey =
  | { readonly kind: "concrete"; readonly value: string }
  | { readonly kind: "template"; readonly name: string };   // "{id}"

export interface RootDecl {
  readonly form: "root";
  readonly surface: readonly string[];
  readonly kind: string;                // captured raw; validated in S8
  readonly states: readonly string[];   // @-set; may be empty
  readonly position: Position;
}

export interface ElementDecl {
  readonly form: "element";
  readonly element: string;
  readonly keyTemplate?: UxKey;
  readonly verbs: readonly string[];    // ": verb set" (>= 1)
  readonly states?: readonly string[];
  readonly nav?: UxRef;                 // "-> target"
  readonly eventDictionary: string;     // raw trailing prose (mandatory)
  readonly position: Position;
}

export interface ChildSurfaceDecl {
  readonly form: "child";
  readonly path: readonly string[];     // segments after the leading dot
  readonly states?: readonly string[];
  readonly position: Position;
}

export type UxilDecl = RootDecl | ElementDecl | ChildSurfaceDecl;
```

Kind, verb, and state values are captured as raw strings — vocabulary validation
is S8, matching how typl's grammar accepts any identifier and its validator
checks against `KINDS`.

## 6. Parser architecture

- **Lexer + recursive-descent grammar**, the same split as typl. Token kinds:
  `SCHEME` (`ux:`), `IDENT`, `DOT`, `AT`, `SLASH`, `COLON`, `BANG`, `COMMA`,
  `ARROW` (`->`), `LBRACE`, `RBRACE`, `EOF`. The lexer is lenient
  (position-tracked, unknown chars skipped); the grammar surfaces structured
  errors — mirroring typl's lexer/grammar responsibility split.
- **Entry points**, each `→ { ast, diagnostics }`:
  - `parseUxRef(source)` — a bare reference (citations, nav targets).
  - `parseRootDecl(spanSource)` — the root inline span.
  - `parseElementBullet(paragraph)` — splits leading span + trailing prose.
  - `parseChildSurfaceDecl(spanSource)` — a child-surface bullet's span.
- **`recognize.ts`** —
  `classifyUxilForm(spanText) → "root" | "element" |
  "child" | undefined` plus
  the individual predicates, so S8's surface walk can route a code span to the
  right parser. Recognizers operate on the code-span-inner text (the caller
  unwraps backticks, as S5 established for typl bullets).

## 7. Diagnostics / error model

`UxilDiagnostic` has the identical shape to `TyplDiagnostic`:

```ts
export interface UxilDiagnostic {
  readonly code: UxilCode;      // "UXIL-001" | …
  readonly severity: Severity;
  readonly message: string;
  readonly position: Position;  // 1-based, source-local (no file yet)
}
```

built by `uxilDiagnostic(code, params, position)` with `${var}` template
substitution, exactly like `typlDiagnostic`. Source-local positions only — S9's
bridge attaches the file path and offset, mirroring `bridgeTyplDiagnostic`.

Draft code catalogue (finalised during implementation):

| Code       | When                                                   |
| ---------- | ------------------------------------------------------ |
| `UXIL-001` | Malformed reference (unexpected token / char).         |
| `UXIL-002` | Reserved `?` or `#` present.                           |
| `UXIL-003` | Reserved `ux://` authority form.                       |
| `UXIL-004` | Root declaration missing its kind.                     |
| `UXIL-005` | Element bullet with an empty verb set.                 |
| `UXIL-006` | Element bullet missing the mandatory event dictionary. |
| `UXIL-007` | Malformed key template (`{…}`).                        |
| `UXIL-008` | Empty / malformed surface segment.                     |

## 8. Testing

Colocated `*_test.ts` per module (Deno unit-test convention):

- **Round-trip:** each of the four forms + a representative ref parse into the
  expected AST (the acceptance "parses/round-trips all four forms + refs").
- **Wire-compat:** `parseUxRef("media.home/play")` and
  `parseUxRef("ux:media.home/play")` produce identical AST modulo `hasScheme`.
- **Structured errors:** one focused case per `UXIL-0xx` code.
- **Classification:** `classifyUxilForm` routes each form and rejects a bare
  citation / non-uxil text.

No e2e — nothing is CLI-wired in S7.

## 9. Handoff contract (what S8/S9 consume)

- S8 imports `core/uxil`'s recognizers + parsers, walks the entry body with the
  existing `core/decl` surface functions, builds `BaseScope` chains from the
  `parent` links, resolves via `resolveRef`, enforces one-root / duplicates /
  kind-inheritance, and assembles the uxRegistry.
- S9 bridges `UxilDiagnostic` to file-anchored core `Diagnostic`s and wires them
  into the CLI/LSP surfaces.

## 10. Alternatives considered

- **Parse boundary (A/B/C).** Chose **A — raw AST + structured parse errors**
  over B (also build the `BaseScope` chain) and C (also run
  `resolveRef`/`checkSingleRoot`). "First uxil slice — parse only" is literal,
  and S8 is explicitly the semantic heart; B/C pull S8's weight forward and blur
  the boundary. The typl precedent (parse layer vs `assemble`/`validator`)
  confirms the split.
- **Single-pass scanner vs lexer+grammar.** Chose **lexer+grammar** for position
  precision and house consistency with typl; a scanner would be marginally
  shorter but diverges from the established pattern.
- **Structured event dictionary vs raw capture.** Chose **raw capture** (A2): a
  parse-only slice should not impose payload semantics the compiler owns.
