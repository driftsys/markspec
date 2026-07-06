# uxil parser (S7 #725) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a parse-only `core/uxil/` layer that turns uxil declaration and
`ux:` reference source strings into a typed declaration AST plus structured
parse diagnostics.

**Architecture:** Mirror the sibling typl DSL's _parse_ half — a single-line
lexer (`tokenize`) feeds a small recursive-descent grammar exposing four entry
points (`parseUxRef`, `parseRootDecl`, `parseChildSurfaceDecl`,
`parseElementBullet`). A `recognize` module classifies a code-span into one of
the three declaration forms so S8 can route. No entry-body walking, no base
resolution, no registry, no CLI/LSP wiring — those are S8/S9.

**Tech Stack:** Deno, TypeScript (strict). No new dependencies. Colocated
`*_test.ts` unit tests (`@std/assert`).

## Global Constraints

- TypeScript strict mode; **zero warnings** from `deno check`, `deno lint`,
  `deno test`.
- **Node-compatible library code:** no `Deno.*` APIs inside `core/uxil/` (pure
  string/data functions only); `jsr:`/`@std` imports resolved by both runtimes.
- `core/uxil/` is **not** exported from `core/mod.ts` in this story and imports
  nothing outside `core/uxil/` except `../model/mod.ts` (for the `Severity`
  type).
- `camelCase` functions/vars, `PascalCase` types.
- Doc comments (`/** */`) on every exported item; brief inline comments on
  tricky internals only.
- Frequent conventional commits during dev (`feat`, `test`) on the story branch;
  the PR squash-merges to one commit at the end.
- Format before every commit: `deno fmt packages/markspec/core/uxil/` (TS).

## File structure

All new, under `packages/markspec/core/uxil/`:

| File                  | Responsibility                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `ast.ts`              | `Position`, `UxRef`, `UxKey`, `RootDecl`, `ElementDecl`, `ChildSurfaceDecl`, `UxilDecl` — types only   |
| `diagnostics.ts`      | `UxilCode`, `UxilDiagnostic`, `UXIL_CODES`, `uxilDiagnostic()`                                         |
| `diagnostics_test.ts` | template substitution                                                                                  |
| `lexer.ts`            | `TokenKind`, `Token`, `tokenize()`                                                                     |
| `lexer_test.ts`       | tokenization + `->` + unknown-char handling                                                            |
| `grammar.ts`          | `parseUxRef`, `parseRootDecl`, `parseChildSurfaceDecl`, `parseElementBullet` + internal cursor/helpers |
| `grammar_test.ts`     | all four forms, wire-compat, structured errors                                                         |
| `recognize.ts`        | `UxilForm`, `classifyUxilForm()`                                                                       |
| `recognize_test.ts`   | routing per form; rejects citations/non-uxil                                                           |
| `mod.ts`              | barrel re-export                                                                                       |
| `mod_test.ts`         | acceptance criteria through the public surface                                                         |

---

### Task 1: AST types (`ast.ts`)

**Files:**

- Create: `packages/markspec/core/uxil/ast.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `Position`, `UxKey`, `UxRef`, `RootDecl`, `ElementDecl`,
  `ChildSurfaceDecl`, `UxilDecl`.

- [ ] **Step 1: Write the file**

```ts
/**
 * @module uxil/ast
 *
 * AST node types for the uxil DSL (parse-only, S7 #725). A `UxRef` is a
 * parsed `ux:` reference (citation, nav target, or the surface head of a
 * declaration); the three `*Decl` shapes are the authored declaration forms.
 * All values are captured raw — kind/verb/state vocabulary checks are S8.
 */

/** 1-based source position within a single uxil source string (line is always 1). */
export interface Position {
  readonly line: number;
  readonly column: number;
}

/** A ref key: a concrete value or a `{name}` template. */
export type UxKey =
  | { readonly kind: "concrete"; readonly value: string }
  | { readonly kind: "template"; readonly name: string };

/**
 * A parsed `ux:` reference. `hasScheme` records whether the literal `ux:`
 * scheme was present; the scheme-less wire form parses to an otherwise
 * identical node (wire-compatibility contract).
 */
export interface UxRef {
  readonly hasScheme: boolean;
  readonly surface: readonly string[];
  readonly state?: string;
  readonly element?: string;
  readonly key?: UxKey;
  readonly verb?: string;
  readonly position: Position;
}

/** Root declaration: `ux:surface : kind @ state, state, …` (exactly one per entry — enforced in S8). */
export interface RootDecl {
  readonly form: "root";
  readonly surface: readonly string[];
  readonly kind: string;
  readonly states: readonly string[];
  readonly position: Position;
}

/** Element declaration from a bullet: `` `/element{key} : verb, … @state -> nav` — event dictionary``. */
export interface ElementDecl {
  readonly form: "element";
  readonly element: string;
  readonly keyTemplate?: UxKey;
  readonly verbs: readonly string[];
  readonly states?: readonly string[];
  readonly nav?: UxRef;
  readonly eventDictionary: string;
  readonly position: Position;
}

/** Child-surface declaration from a bullet: `` `.path @state` `` (its nested bullets are its elements — stitched in S8). */
export interface ChildSurfaceDecl {
  readonly form: "child";
  readonly path: readonly string[];
  readonly states?: readonly string[];
  readonly position: Position;
}

export type UxilDecl = RootDecl | ElementDecl | ChildSurfaceDecl;
```

- [ ] **Step 2: Type-check**

Run:
`cd .worktrees/725-uxil-parser && deno check packages/markspec/core/uxil/ast.ts`
Expected: PASS (no output / `Check` line, exit 0).

- [ ] **Step 3: Commit**

```bash
deno fmt packages/markspec/core/uxil/ast.ts
git add packages/markspec/core/uxil/ast.ts
git commit -m "feat(core): uxil AST types (#725)"
```

---

### Task 2: Diagnostics (`diagnostics.ts`)

**Files:**

- Create: `packages/markspec/core/uxil/diagnostics.ts`,
  `packages/markspec/core/uxil/diagnostics_test.ts`

**Interfaces:**

- Consumes: `Position` (ast.ts), `Severity` (`../model/mod.ts`).
- Produces: `UxilCode`, `UxilDiagnostic`, `UXIL_CODES`,
  `uxilDiagnostic(code, params, position)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/markspec/core/uxil/diagnostics_test.ts
import { assertEquals } from "@std/assert";
import { uxilDiagnostic } from "./diagnostics.ts";

Deno.test("uxilDiagnostic: substitutes params into the template", () => {
  const d = uxilDiagnostic("UXIL-002", { char: "?" }, { line: 1, column: 5 });
  assertEquals(d.code, "UXIL-002");
  assertEquals(d.severity, "error");
  assertEquals(d.position, { line: 1, column: 5 });
  assertEquals(
    d.message,
    "Reserved character ? is not allowed in a uxil reference.",
  );
});

Deno.test("uxilDiagnostic: parameterless template passes through", () => {
  const d = uxilDiagnostic("UXIL-004", {}, { line: 1, column: 1 });
  assertEquals(
    d.message,
    "Root declaration is missing its kind (expected 'ux:surface : kind').",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test packages/markspec/core/uxil/diagnostics_test.ts` Expected: FAIL
— cannot resolve `./diagnostics.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/markspec/core/uxil/diagnostics.ts
/**
 * @module uxil/diagnostics
 *
 * Diagnostic codes emitted by the uxil parser (UXIL-001 through UXIL-008).
 * Source-local positions only — S9 bridges these to file-anchored core
 * `Diagnostic`s. Shape and helper mirror typl's `typlDiagnostic`.
 */
import type { Position } from "./ast.ts";
import type { Severity } from "../model/mod.ts";

/** Union of all uxil parser diagnostic codes. */
export type UxilCode =
  | "UXIL-001"
  | "UXIL-002"
  | "UXIL-003"
  | "UXIL-004"
  | "UXIL-005"
  | "UXIL-006"
  | "UXIL-007"
  | "UXIL-008";

/** Shape of each entry in {@linkcode UXIL_CODES}. */
export interface UxilCodeEntry {
  readonly severity: Severity;
  readonly template: string;
}

/** A diagnostic emitted by the uxil parser (source-local position). */
export interface UxilDiagnostic {
  readonly code: UxilCode;
  readonly severity: Severity;
  readonly message: string;
  readonly position: Position;
}

export const UXIL_CODES: Record<UxilCode, UxilCodeEntry> = {
  "UXIL-001": {
    severity: "error",
    template: "Malformed uxil reference: ${detail}.",
  },
  "UXIL-002": {
    severity: "error",
    template: "Reserved character ${char} is not allowed in a uxil reference.",
  },
  "UXIL-003": {
    severity: "error",
    template:
      "The ux://authority form is reserved; use a scheme-relative reference.",
  },
  "UXIL-004": {
    severity: "error",
    template: "Root declaration is missing its kind (expected 'ux:surface : kind').",
  },
  "UXIL-005": {
    severity: "error",
    template: "Element declaration has an empty verb set (expected '/element : verb').",
  },
  "UXIL-006": {
    severity: "error",
    template: "Element declaration is missing its trailing event dictionary.",
  },
  "UXIL-007": {
    severity: "error",
    template: "Malformed key template: ${detail}.",
  },
  "UXIL-008": {
    severity: "error",
    template: "Malformed surface: ${detail}.",
  },
};

/**
 * Construct a uxil diagnostic by substituting `${var}` placeholders in the
 * code's template. A missing key leaves a raw `${key}` in the message — test
 * message formatting per code.
 */
export function uxilDiagnostic(
  code: UxilCode,
  params: Record<string, string | number>,
  position: Position,
): UxilDiagnostic {
  const entry = UXIL_CODES[code];
  if (!entry) throw new Error(`Unknown UXIL code: ${code}`);
  let message: string = entry.template;
  for (const [k, v] of Object.entries(params)) {
    message = message.replaceAll(`\${${k}}`, String(v));
  }
  return { code, severity: entry.severity, message, position };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test packages/markspec/core/uxil/diagnostics_test.ts` Expected: PASS
(2 tests).

- [ ] **Step 5: Commit**

```bash
deno fmt packages/markspec/core/uxil/diagnostics.ts packages/markspec/core/uxil/diagnostics_test.ts
git add packages/markspec/core/uxil/diagnostics.ts packages/markspec/core/uxil/diagnostics_test.ts
git commit -m "feat(core): uxil diagnostic codes (#725)"
```

---

### Task 3: Lexer (`lexer.ts`)

**Files:**

- Create: `packages/markspec/core/uxil/lexer.ts`,
  `packages/markspec/core/uxil/lexer_test.ts`

**Interfaces:**

- Consumes: `Position` (ast.ts).
- Produces: `TokenKind`, `Token`, `tokenize(source: string): Token[]` — a
  single-line tokenizer; the stream always ends with one `EOF`. Whitespace is
  skipped; unknown characters are skipped (the parser surfaces the error).
  `line` is always 1; `column` is 1-based.

- [ ] **Step 1: Write the failing test**

```ts
// packages/markspec/core/uxil/lexer_test.ts
import { assertEquals } from "@std/assert";
import { tokenize } from "./lexer.ts";

Deno.test("tokenize: full reference tail", () => {
  const kinds = tokenize("media.home/play:{id}!activate").map((t) => t.kind);
  assertEquals(kinds, [
    "IDENT", "DOT", "IDENT", "SLASH", "IDENT", "COLON",
    "LBRACE", "IDENT", "RBRACE", "BANG", "IDENT", "EOF",
  ]);
});

Deno.test("tokenize: arrow is a single token, columns are 1-based", () => {
  const toks = tokenize("a -> b");
  assertEquals(toks.map((t) => t.kind), ["IDENT", "ARROW", "IDENT", "EOF"]);
  assertEquals(toks[1].value, "->");
  assertEquals(toks[0].position.column, 1);
  assertEquals(toks[1].position.column, 3);
});

Deno.test("tokenize: unknown characters are skipped", () => {
  const kinds = tokenize("a?b").map((t) => t.kind);
  assertEquals(kinds, ["IDENT", "IDENT", "EOF"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test packages/markspec/core/uxil/lexer_test.ts` Expected: FAIL —
cannot resolve `./lexer.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/markspec/core/uxil/lexer.ts
/**
 * @module uxil/lexer
 *
 * Single-line tokenizer for the uxil DSL. Converts a source string (a `ux:`
 * reference, or the machine-readable portion of a declaration) into a flat
 * `Token[]` ending in one `EOF`. Whitespace is skipped; unrecognised
 * characters are skipped silently — the parser surfaces the diagnostic,
 * keeping lexer/parser responsibilities separated (as in typl's lexer).
 */
import type { Position } from "./ast.ts";

export type TokenKind =
  | "IDENT"
  | "DOT"
  | "AT"
  | "SLASH"
  | "COLON"
  | "BANG"
  | "COMMA"
  | "ARROW"
  | "LBRACE"
  | "RBRACE"
  | "EOF";

export interface Token {
  readonly kind: TokenKind;
  /** Raw text (empty for EOF). */
  readonly value: string;
  /** 1-based position of the token's first character (line always 1). */
  readonly position: Position;
}

const IDENT_CHAR_RE = /[A-Za-z0-9_]/;

const SINGLE_CHAR: Readonly<Record<string, TokenKind>> = {
  ".": "DOT",
  "@": "AT",
  "/": "SLASH",
  ":": "COLON",
  "!": "BANG",
  ",": "COMMA",
  "{": "LBRACE",
  "}": "RBRACE",
};

/** Tokenize a single-line uxil source string. */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let column = 1;
  const push = (kind: TokenKind, value: string, startCol: number): void => {
    tokens.push({ kind, value, position: { line: 1, column: startCol } });
  };

  while (i < source.length) {
    const ch = source[i];

    if (ch === " " || ch === "\t") {
      i++;
      column++;
      continue;
    }

    // Arrow `->` before the single-char scan (it is not in SINGLE_CHAR).
    if (ch === "-" && source[i + 1] === ">") {
      push("ARROW", "->", column);
      i += 2;
      column += 2;
      continue;
    }

    const single = SINGLE_CHAR[ch];
    if (single !== undefined) {
      push(single, ch, column);
      i++;
      column++;
      continue;
    }

    if (IDENT_CHAR_RE.test(ch)) {
      const startCol = column;
      let value = "";
      while (i < source.length && IDENT_CHAR_RE.test(source[i])) {
        value += source[i];
        i++;
        column++;
      }
      push("IDENT", value, startCol);
      continue;
    }

    // Unrecognised character — skip; the parser surfaces the diagnostic.
    i++;
    column++;
  }

  push("EOF", "", column);
  return tokens;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test packages/markspec/core/uxil/lexer_test.ts` Expected: PASS (3
tests).

- [ ] **Step 5: Commit**

```bash
deno fmt packages/markspec/core/uxil/lexer.ts packages/markspec/core/uxil/lexer_test.ts
git add packages/markspec/core/uxil/lexer.ts packages/markspec/core/uxil/lexer_test.ts
git commit -m "feat(core): uxil lexer (#725)"
```

---

### Task 4: Grammar — `parseUxRef` + shared cursor/helpers (`grammar.ts`)

**Files:**

- Create: `packages/markspec/core/uxil/grammar.ts`,
  `packages/markspec/core/uxil/grammar_test.ts`

**Interfaces:**

- Consumes: `tokenize`, `Token` (lexer.ts); AST types (ast.ts);
  `UxilDiagnostic`, `uxilDiagnostic` (diagnostics.ts).
- Produces (this task):
  `parseUxRef(source: string): { ref?: UxRef; diagnostics: UxilDiagnostic[] }`,
  plus module-internal `Cursor`, `parseSurface`, `parseKey`, `expectIdent`,
  `scanReservedChars`, and the `Mut<T>` helper — all reused by Tasks 5 and 6.

- [ ] **Step 1: Write the failing test**

```ts
// packages/markspec/core/uxil/grammar_test.ts
import { assertEquals } from "@std/assert";
import { parseUxRef } from "./grammar.ts";

Deno.test("parseUxRef: full ref with scheme, state, element, key, verb", () => {
  const { ref, diagnostics } = parseUxRef("ux:media.home@ready/play:{id}!activate");
  assertEquals(diagnostics, []);
  assertEquals(ref?.hasScheme, true);
  assertEquals(ref?.surface, ["media", "home"]);
  assertEquals(ref?.state, "ready");
  assertEquals(ref?.element, "play");
  assertEquals(ref?.key, { kind: "template", name: "id" });
  assertEquals(ref?.verb, "activate");
});

Deno.test("parseUxRef: scheme-less wire form parses identically (wire-compat)", () => {
  const withScheme = parseUxRef("ux:media.home/play");
  const wire = parseUxRef("media.home/play");
  assertEquals(wire.diagnostics, []);
  assertEquals(withScheme.diagnostics, []);
  // Identical modulo hasScheme.
  assertEquals(wire.ref?.surface, withScheme.ref?.surface);
  assertEquals(wire.ref?.element, withScheme.ref?.element);
  assertEquals(withScheme.ref?.hasScheme, true);
  assertEquals(wire.ref?.hasScheme, false);
});

Deno.test("parseUxRef: reserved authority is UXIL-003", () => {
  const { diagnostics } = parseUxRef("ux://app/media.home");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-003"]);
});

Deno.test("parseUxRef: reserved query char is UXIL-002", () => {
  const { diagnostics } = parseUxRef("media.home?x");
  assertEquals(diagnostics.some((d) => d.code === "UXIL-002"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test packages/markspec/core/uxil/grammar_test.ts` Expected: FAIL —
cannot resolve `./grammar.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/markspec/core/uxil/grammar.ts
/**
 * @module uxil/grammar
 *
 * Recursive-descent parsers for the uxil DSL: one reference parser
 * ({@linkcode parseUxRef}) plus the three declaration-form parsers (added in
 * later tasks). Each returns a best-effort AST node and a list of
 * source-local {@linkcode UxilDiagnostic}s. Parse-only — no resolution.
 */
import type {
  ChildSurfaceDecl,
  ElementDecl,
  RootDecl,
  UxKey,
  UxRef,
} from "./ast.ts";
import { type Token, tokenize } from "./lexer.ts";
import { type UxilDiagnostic, uxilDiagnostic } from "./diagnostics.ts";

/** Strip `readonly` so a node can be built incrementally, then returned as its readonly type. */
type Mut<T> = { -readonly [K in keyof T]: T[K] };

/** A forward-only cursor over a `Token[]`. */
class Cursor {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}
  peek(): Token {
    return this.tokens[this.i];
  }
  peekAt(n: number): Token {
    return this.tokens[Math.min(this.i + n, this.tokens.length - 1)];
  }
  advance(): Token {
    const t = this.tokens[this.i];
    if (this.i < this.tokens.length - 1) this.i++;
    return t;
  }
  atEof(): boolean {
    return this.peek().kind === "EOF";
  }
}

/** Push UXIL-002 for a reserved `?`/`#` character anywhere in `source`. */
function scanReservedChars(source: string, diags: UxilDiagnostic[]): void {
  const idx = source.search(/[?#]/);
  if (idx >= 0) {
    diags.push(
      uxilDiagnostic("UXIL-002", { char: source[idx] }, {
        line: 1,
        column: idx + 1,
      }),
    );
  }
}

/** Consume `IDENT`, or push UXIL-001 describing what was expected. */
function expectIdent(
  c: Cursor,
  diags: UxilDiagnostic[],
  what: string,
): string | undefined {
  if (c.peek().kind === "IDENT") return c.advance().value;
  diags.push(
    uxilDiagnostic("UXIL-001", { detail: `expected ${what}` }, c.peek().position),
  );
  return undefined;
}

/** Parse `segment *("." segment)`; `undefined` when no leading segment. */
function parseSurface(
  c: Cursor,
  diags: UxilDiagnostic[],
): string[] | undefined {
  if (c.peek().kind !== "IDENT") return undefined;
  const segments: string[] = [c.advance().value];
  while (c.peek().kind === "DOT") {
    c.advance();
    if (c.peek().kind !== "IDENT") {
      diags.push(
        uxilDiagnostic("UXIL-008", { detail: "trailing '.' in surface" }, c.peek().position),
      );
      break;
    }
    segments.push(c.advance().value);
  }
  return segments;
}

/** Parse a ref key after `:` — a `{name}` template or a concrete value. */
function parseKey(c: Cursor, diags: UxilDiagnostic[]): UxKey | undefined {
  if (c.peek().kind === "LBRACE") {
    c.advance();
    if (c.peek().kind !== "IDENT") {
      diags.push(
        uxilDiagnostic("UXIL-007", { detail: "expected a name inside { }" }, c.peek().position),
      );
      return undefined;
    }
    const name = c.advance().value;
    if (c.peek().kind !== "RBRACE") {
      diags.push(
        uxilDiagnostic("UXIL-007", { detail: "missing closing '}'" }, c.peek().position),
      );
      return undefined;
    }
    c.advance();
    return { kind: "template", name };
  }
  if (c.peek().kind === "IDENT") return { kind: "concrete", value: c.advance().value };
  diags.push(
    uxilDiagnostic("UXIL-001", { detail: "expected a key after ':'" }, c.peek().position),
  );
  return undefined;
}

/** Consume a leading `ux:` scheme if present. Returns whether it was consumed. */
function consumeScheme(c: Cursor): boolean {
  if (
    c.peek().kind === "IDENT" && c.peek().value === "ux" &&
    c.peekAt(1).kind === "COLON"
  ) {
    c.advance();
    c.advance();
    return true;
  }
  return false;
}

/** Parse an optional `@state, state, …` set; empty array when absent. */
function parseStateSet(c: Cursor, diags: UxilDiagnostic[]): string[] {
  const states: string[] = [];
  if (c.peek().kind !== "AT") return states;
  c.advance();
  const first = expectIdent(c, diags, "state");
  if (first !== undefined) states.push(first);
  while (c.peek().kind === "COMMA") {
    c.advance();
    const s = expectIdent(c, diags, "state");
    if (s !== undefined) states.push(s);
  }
  return states;
}

/** Push UXIL-001 for any leftover tokens before EOF. */
function expectEof(c: Cursor, diags: UxilDiagnostic[]): void {
  if (!c.atEof()) {
    const t = c.peek();
    diags.push(
      uxilDiagnostic("UXIL-001", { detail: `unexpected '${t.value || t.kind}'` }, t.position),
    );
  }
}

/**
 * Parse a `ux:` reference (citation / nav target). The scheme is optional;
 * `media.home/play` and `ux:media.home/play` yield identical AST except for
 * `hasScheme`. Returns `ref` undefined only for a wholly malformed input
 * (reserved authority, no surface).
 */
export function parseUxRef(
  source: string,
): { ref?: UxRef; diagnostics: UxilDiagnostic[] } {
  const diagnostics: UxilDiagnostic[] = [];
  scanReservedChars(source, diagnostics);
  const c = new Cursor(tokenize(source));
  const hasScheme = consumeScheme(c);

  // Reserved authority: a `/` where a surface segment is required.
  if (c.peek().kind === "SLASH") {
    if (c.peekAt(1).kind === "SLASH") {
      diagnostics.push(uxilDiagnostic("UXIL-003", {}, c.peek().position));
    } else {
      diagnostics.push(
        uxilDiagnostic("UXIL-008", { detail: "missing surface" }, c.peek().position),
      );
    }
    return { diagnostics };
  }

  const surface = parseSurface(c, diagnostics);
  if (!surface) {
    diagnostics.push(
      uxilDiagnostic("UXIL-008", { detail: "expected a surface segment" }, c.peek().position),
    );
    return { diagnostics };
  }

  const ref: Mut<UxRef> = { hasScheme, surface, position: { line: 1, column: 1 } };
  if (c.peek().kind === "AT") {
    c.advance();
    const s = expectIdent(c, diagnostics, "state");
    if (s !== undefined) ref.state = s;
  }
  if (c.peek().kind === "SLASH") {
    c.advance();
    const el = expectIdent(c, diagnostics, "element");
    if (el !== undefined) ref.element = el;
    if (c.peek().kind === "COLON") {
      c.advance();
      const k = parseKey(c, diagnostics);
      if (k) ref.key = k;
    }
    if (c.peek().kind === "BANG") {
      c.advance();
      const v = expectIdent(c, diagnostics, "verb");
      if (v !== undefined) ref.verb = v;
    }
  }
  expectEof(c, diagnostics);
  return { ref, diagnostics };
}
```

> Note: `parseStateSet` (defined above) is unused until Tasks 5–6 add the
> declaration parsers, and `RootDecl` / `ChildSurfaceDecl` / `ElementDecl` are
> imported here but first used there. That is fine: the per-task gate runs
> `deno test <file>` (type-check only — Deno does not enable `noUnusedLocals`),
> and by the Task 9 `deno lint` gate every one is used. No placeholder re-export
> is needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test packages/markspec/core/uxil/grammar_test.ts` Expected: PASS (4
tests).

- [ ] **Step 5: Commit**

```bash
deno fmt packages/markspec/core/uxil/grammar.ts packages/markspec/core/uxil/grammar_test.ts
git add packages/markspec/core/uxil/grammar.ts packages/markspec/core/uxil/grammar_test.ts
git commit -m "feat(core): uxil ux: reference parser (#725)"
```

---

### Task 5: Grammar — `parseRootDecl` + `parseChildSurfaceDecl`

**Files:**

- Modify: `packages/markspec/core/uxil/grammar.ts` (add two exported functions;
  imports and `parseStateSet` are already in place from Task 4)
- Modify: `packages/markspec/core/uxil/grammar_test.ts` (add tests)

**Interfaces:**

- Consumes: `Cursor`, `parseSurface`, `parseStateSet`, `consumeScheme`,
  `expectIdent`, `expectEof`, `scanReservedChars`, `tokenize`, `Mut`,
  `uxilDiagnostic` (all already in grammar.ts from Task 4).
- Produces:
  `parseRootDecl(source): { decl?: RootDecl; diagnostics: UxilDiagnostic[] }`,
  `parseChildSurfaceDecl(source): { decl?: ChildSurfaceDecl; diagnostics: UxilDiagnostic[] }`.

- [ ] **Step 1: Write the failing tests (append to grammar_test.ts)**

```ts
import { parseChildSurfaceDecl, parseRootDecl } from "./grammar.ts";

Deno.test("parseRootDecl: surface, kind, state set", () => {
  const { decl, diagnostics } = parseRootDecl("ux:media.home : screen @ loading, error, ready");
  assertEquals(diagnostics, []);
  assertEquals(decl?.form, "root");
  assertEquals(decl?.surface, ["media", "home"]);
  assertEquals(decl?.kind, "screen");
  assertEquals(decl?.states, ["loading", "error", "ready"]);
});

Deno.test("parseRootDecl: missing kind is UXIL-004", () => {
  const { diagnostics } = parseRootDecl("ux:media.home");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-004"]);
});

Deno.test("parseChildSurfaceDecl: dotted leading path + state", () => {
  const { decl, diagnostics } = parseChildSurfaceDecl(".confirm_dialog @ default");
  assertEquals(diagnostics, []);
  assertEquals(decl?.form, "child");
  assertEquals(decl?.path, ["confirm_dialog"]);
  assertEquals(decl?.states, ["default"]);
});

Deno.test("parseChildSurfaceDecl: without a leading dot is UXIL-008", () => {
  const { diagnostics } = parseChildSurfaceDecl("confirm_dialog");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-008"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test packages/markspec/core/uxil/grammar_test.ts` Expected: FAIL —
`parseRootDecl` / `parseChildSurfaceDecl` not exported.

- [ ] **Step 3: Add the implementations to `grammar.ts`** (append both
      functions)

```ts
/**
 * Parse a root declaration: `[ux:]surface : kind [@state, …]`. The `:` here
 * introduces the kind (not a ref key). Returns `decl` undefined only when no
 * surface is present.
 */
export function parseRootDecl(
  source: string,
): { decl?: RootDecl; diagnostics: UxilDiagnostic[] } {
  const diagnostics: UxilDiagnostic[] = [];
  scanReservedChars(source, diagnostics);
  const c = new Cursor(tokenize(source));
  consumeScheme(c);
  const surface = parseSurface(c, diagnostics);
  if (!surface) {
    diagnostics.push(
      uxilDiagnostic("UXIL-008", { detail: "expected a surface segment" }, c.peek().position),
    );
    return { diagnostics };
  }
  if (c.peek().kind !== "COLON") {
    diagnostics.push(uxilDiagnostic("UXIL-004", {}, c.peek().position));
    return { diagnostics };
  }
  c.advance();
  const kind = expectIdent(c, diagnostics, "kind");
  const states = parseStateSet(c, diagnostics);
  expectEof(c, diagnostics);
  return {
    decl: {
      form: "root",
      surface,
      kind: kind ?? "",
      states,
      position: { line: 1, column: 1 },
    },
    diagnostics,
  };
}

/**
 * Parse a child-surface declaration: `.path[.seg…] [@state, …]`. The leading
 * dot marks containment; nested bullets (its elements) are stitched in S8.
 * There is no kind or verb set — kind is inherited (S8).
 */
export function parseChildSurfaceDecl(
  source: string,
): { decl?: ChildSurfaceDecl; diagnostics: UxilDiagnostic[] } {
  const diagnostics: UxilDiagnostic[] = [];
  scanReservedChars(source, diagnostics);
  const c = new Cursor(tokenize(source));
  if (c.peek().kind !== "DOT") {
    diagnostics.push(
      uxilDiagnostic("UXIL-008", { detail: "child surface must start with '.'" }, c.peek().position),
    );
    return { diagnostics };
  }
  c.advance();
  const path = parseSurface(c, diagnostics);
  if (!path) {
    diagnostics.push(
      uxilDiagnostic("UXIL-008", { detail: "expected a child surface name after '.'" }, c.peek().position),
    );
    return { diagnostics };
  }
  const states = parseStateSet(c, diagnostics);
  expectEof(c, diagnostics);
  const decl: Mut<ChildSurfaceDecl> = {
    form: "child",
    path,
    position: { line: 1, column: 1 },
  };
  if (states.length > 0) decl.states = states;
  return { decl, diagnostics };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `deno test packages/markspec/core/uxil/grammar_test.ts` Expected: PASS (8
tests).

- [ ] **Step 5: Commit**

```bash
deno fmt packages/markspec/core/uxil/grammar.ts packages/markspec/core/uxil/grammar_test.ts
git add packages/markspec/core/uxil/grammar.ts packages/markspec/core/uxil/grammar_test.ts
git commit -m "feat(core): uxil root + child-surface declaration parsers (#725)"
```

---

### Task 6: Grammar — `parseElementBullet`

**Files:**

- Modify: `packages/markspec/core/uxil/grammar.ts`
- Modify: `packages/markspec/core/uxil/grammar_test.ts`

**Interfaces:**

- Consumes: everything in grammar.ts, plus `parseUxRef` (for the nav target) and
  `parseKey` (for the key template).
- Produces:
  `parseElementBullet(paragraph: string): { decl?: ElementDecl; diagnostics: UxilDiagnostic[] }`.

**Grammar decision K1 (flag against the design doc):** the machine-readable
declaration is the _leading code span_ of the bullet paragraph; the event
dictionary is the prose after the span. Inside the span the shape is
`/element[{key}] : verb[, verb…] [@state, …] [-> nav-ref]`. The optional key
template sits **immediately after the element name in braces**
(`/track{id} :
activate`), NOT after a colon — the colon is reserved for the
verb set, so the ref-grammar's `/element:{key}` form cannot be reused here
without a double-colon clash.

> **Resolution (#786, PR #790):** checked against the epic's design doc, which
> uses a third form — the key template is its own `:` clause **after the verb
> set** (`/favorite_toggle : toggle : {track_id}`). The braces-after-name form
> described above was reversed; the shipped shape is
> `/element : verb[, verb…] [: {key}] [@state, …] [-> nav-ref]`.

- [ ] **Step 1: Write the failing tests (append to grammar_test.ts)**

```ts
import { parseElementBullet } from "./grammar.ts";

Deno.test("parseElementBullet: verb + event dictionary", () => {
  const { decl, diagnostics } = parseElementBullet(
    "`/play : activate` — Pressing play resumes playback.",
  );
  assertEquals(diagnostics, []);
  assertEquals(decl?.form, "element");
  assertEquals(decl?.element, "play");
  assertEquals(decl?.verbs, ["activate"]);
  assertEquals(decl?.eventDictionary, "Pressing play resumes playback.");
});

Deno.test("parseElementBullet: key template, state set, nav target", () => {
  const { decl, diagnostics } = parseElementBullet(
    "`/track{id} : activate, focus @enabled -> media.player` — Selects a track.",
  );
  assertEquals(diagnostics, []);
  assertEquals(decl?.keyTemplate, { kind: "template", name: "id" });
  assertEquals(decl?.verbs, ["activate", "focus"]);
  assertEquals(decl?.states, ["enabled"]);
  assertEquals(decl?.nav?.surface, ["media", "player"]);
  assertEquals(decl?.nav?.hasScheme, false);
});

Deno.test("parseElementBullet: missing event dictionary is UXIL-006", () => {
  const { diagnostics } = parseElementBullet("`/play : activate`");
  assertEquals(diagnostics.map((d) => d.code), ["UXIL-006"]);
});

Deno.test("parseElementBullet: empty verb set is UXIL-005", () => {
  const { diagnostics } = parseElementBullet("`/play :` — no verb.");
  assertEquals(diagnostics.some((d) => d.code === "UXIL-005"), true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test packages/markspec/core/uxil/grammar_test.ts` Expected: FAIL —
`parseElementBullet` not exported.

- [ ] **Step 3: Add the implementation to `grammar.ts`** (append the two
      functions below)

```ts
/**
 * Split the leading inline code span from the rest of a bullet paragraph.
 * Handles single- and double-backtick spans. Returns `span` undefined when
 * the paragraph does not begin with a code span.
 */
function splitLeadingCodeSpan(text: string): { span?: string; rest: string } {
  const t = text.replace(/^\s+/, "");
  if (t.startsWith("``")) {
    const end = t.indexOf("``", 2);
    if (end < 0) return { rest: text };
    return { span: t.slice(2, end), rest: t.slice(end + 2) };
  }
  if (t.startsWith("`")) {
    const end = t.indexOf("`", 1);
    if (end < 0) return { rest: text };
    return { span: t.slice(1, end), rest: t.slice(end + 1) };
  }
  return { rest: text };
}

/**
 * Parse an element bullet: a leading code span
 * `/element[{key}] : verb[, verb…] [@state, …] [-> nav]` followed by a
 * mandatory trailing prose event dictionary. See grammar decision K1.
 */
export function parseElementBullet(
  paragraph: string,
): { decl?: ElementDecl; diagnostics: UxilDiagnostic[] } {
  const diagnostics: UxilDiagnostic[] = [];
  const { span, rest } = splitLeadingCodeSpan(paragraph);
  if (span === undefined) {
    diagnostics.push(
      uxilDiagnostic("UXIL-001", { detail: "element bullet must begin with a code span" }, { line: 1, column: 1 }),
    );
    return { diagnostics };
  }
  scanReservedChars(span, diagnostics);

  // Peel off an optional `-> nav` tail before tokenizing the structured part.
  let structPart = span;
  let navSource: string | undefined;
  const arrow = span.indexOf("->");
  if (arrow >= 0) {
    structPart = span.slice(0, arrow);
    navSource = span.slice(arrow + 2).trim();
  }

  const c = new Cursor(tokenize(structPart));
  if (c.peek().kind !== "SLASH") {
    diagnostics.push(
      uxilDiagnostic("UXIL-001", { detail: "element must start with '/'" }, c.peek().position),
    );
    return { diagnostics };
  }
  c.advance();
  const element = expectIdent(c, diagnostics, "element name");
  if (element === undefined) return { diagnostics };

  const decl: Mut<ElementDecl> = {
    form: "element",
    element,
    verbs: [],
    eventDictionary: "",
    position: { line: 1, column: 1 },
  };

  // Optional key template, directly after the element name (K1).
  if (c.peek().kind === "LBRACE") {
    const k = parseKey(c, diagnostics);
    if (k) decl.keyTemplate = k;
  }

  // Verb set: `: verb[, verb…]` (>= 1).
  if (c.peek().kind !== "COLON") {
    diagnostics.push(uxilDiagnostic("UXIL-005", {}, c.peek().position));
  } else {
    c.advance();
    const verbs: string[] = [];
    const first = expectIdent(c, diagnostics, "verb");
    if (first !== undefined) verbs.push(first);
    while (c.peek().kind === "COMMA") {
      c.advance();
      const v = expectIdent(c, diagnostics, "verb");
      if (v !== undefined) verbs.push(v);
    }
    if (verbs.length === 0) {
      diagnostics.push(uxilDiagnostic("UXIL-005", {}, c.peek().position));
    }
    decl.verbs = verbs;
  }

  const states = parseStateSet(c, diagnostics);
  if (states.length > 0) decl.states = states;
  expectEof(c, diagnostics);

  // Nav target (parsed as a ux ref; may be scheme-less / relative).
  if (navSource !== undefined) {
    if (navSource.length === 0) {
      diagnostics.push(
        uxilDiagnostic("UXIL-001", { detail: "missing navigation target after '->'" }, { line: 1, column: 1 }),
      );
    } else {
      const nav = parseUxRef(navSource);
      diagnostics.push(...nav.diagnostics);
      if (nav.ref) decl.nav = nav.ref;
    }
  }

  // Event dictionary: trailing prose, minus a leading em-dash/hyphen separator.
  const eventDictionary = rest.replace(/^\s*[—-]\s*/, "").trim();
  if (eventDictionary.length === 0) {
    diagnostics.push(uxilDiagnostic("UXIL-006", {}, { line: 1, column: 1 }));
  }
  decl.eventDictionary = eventDictionary;

  return { decl, diagnostics };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `deno test packages/markspec/core/uxil/grammar_test.ts` Expected: PASS (12
tests).

- [ ] **Step 5: Commit**

```bash
deno fmt packages/markspec/core/uxil/grammar.ts packages/markspec/core/uxil/grammar_test.ts
git add packages/markspec/core/uxil/grammar.ts packages/markspec/core/uxil/grammar_test.ts
git commit -m "feat(core): uxil element-bullet declaration parser (#725)"
```

---

### Task 7: Form recognizer (`recognize.ts`)

**Files:**

- Create: `packages/markspec/core/uxil/recognize.ts`,
  `packages/markspec/core/uxil/recognize_test.ts`

**Interfaces:**

- Consumes: nothing (pure string predicate).
- Produces: `UxilForm` (`"root" | "element" | "child"`),
  `classifyUxilForm(spanText: string): UxilForm | undefined`. Operates on the
  code-span-inner text (caller unwraps backticks); returns `undefined` for a
  citation ref or non-uxil text.

- [ ] **Step 1: Write the failing test**

```ts
// packages/markspec/core/uxil/recognize_test.ts
import { assertEquals } from "@std/assert";
import { classifyUxilForm } from "./recognize.ts";

Deno.test("classifyUxilForm: routes each declaration form", () => {
  assertEquals(classifyUxilForm("ux:media.home : screen @ loading"), "root");
  assertEquals(classifyUxilForm("media.home : screen"), "root");
  assertEquals(classifyUxilForm("/play : activate"), "element");
  assertEquals(classifyUxilForm(".confirm_dialog @ default"), "child");
});

Deno.test("classifyUxilForm: a citation ref is not a declaration", () => {
  assertEquals(classifyUxilForm("ux:media.home/play"), undefined);
  assertEquals(classifyUxilForm("ux:media.home/play:{id}"), undefined);
  assertEquals(classifyUxilForm("just prose"), undefined);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test packages/markspec/core/uxil/recognize_test.ts` Expected: FAIL —
cannot resolve `./recognize.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/markspec/core/uxil/recognize.ts
/**
 * @module uxil/recognize
 *
 * Form-classification predicate — the DSL-specific routing S8's surface walk
 * uses to send a code span to the right parser. Pure string inspection on the
 * span-inner text (the caller strips backticks). A citation ref
 * (`ux:surface/element…`) or non-uxil text returns `undefined`.
 */

export type UxilForm = "root" | "element" | "child";

/**
 * Classify a uxil code span. `/`-led → element; `.`-led → child surface; a
 * surface followed by a `:` kind *before* any `/` → root declaration.
 * Everything else (a citation ref, plain prose) → `undefined`.
 */
export function classifyUxilForm(spanText: string): UxilForm | undefined {
  const t = spanText.trim();
  if (t.startsWith("/")) return "element";
  if (t.startsWith(".")) return "child";
  const body = t.startsWith("ux:") ? t.slice(3) : t;
  const slash = body.indexOf("/");
  const colon = body.indexOf(":");
  // A `:` before any `/` is the kind clause of a root declaration; a `:` after
  // a `/` is a ref key (a citation), and no `:` at all is a bare citation.
  if (colon >= 0 && (slash < 0 || colon < slash)) return "root";
  return undefined;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `deno test packages/markspec/core/uxil/recognize_test.ts` Expected: PASS (2
tests).

- [ ] **Step 5: Commit**

```bash
deno fmt packages/markspec/core/uxil/recognize.ts packages/markspec/core/uxil/recognize_test.ts
git add packages/markspec/core/uxil/recognize.ts packages/markspec/core/uxil/recognize_test.ts
git commit -m "feat(core): uxil form recognizer (#725)"
```

---

### Task 8: Barrel + acceptance (`mod.ts`, `mod_test.ts`)

**Files:**

- Create: `packages/markspec/core/uxil/mod.ts`,
  `packages/markspec/core/uxil/mod_test.ts`

**Interfaces:**

- Consumes: every module above.
- Produces: the `core/uxil` public surface (barrel).

- [ ] **Step 1: Write the barrel**

```ts
// packages/markspec/core/uxil/mod.ts
/**
 * @module uxil
 *
 * Parse-only uxil DSL layer (S7 #725): `ux:` reference + declaration-form
 * parsers, the declaration AST, structured parse diagnostics, and the
 * form recognizer. Not wired into `core/mod.ts` — S8 (uxil compiler +
 * uxRegistry) consumes these; S9 wires diagnostics to the CLI/LSP.
 */
export type {
  ChildSurfaceDecl,
  ElementDecl,
  Position,
  RootDecl,
  UxilDecl,
  UxKey,
  UxRef,
} from "./ast.ts";
export type { UxilCode, UxilCodeEntry, UxilDiagnostic } from "./diagnostics.ts";
export { UXIL_CODES, uxilDiagnostic } from "./diagnostics.ts";
export type { Token, TokenKind } from "./lexer.ts";
export { tokenize } from "./lexer.ts";
export {
  parseChildSurfaceDecl,
  parseElementBullet,
  parseRootDecl,
  parseUxRef,
} from "./grammar.ts";
export type { UxilForm } from "./recognize.ts";
export { classifyUxilForm } from "./recognize.ts";
```

- [ ] **Step 2: Write the acceptance test**

```ts
// packages/markspec/core/uxil/mod_test.ts
import { assertEquals } from "@std/assert";
import {
  classifyUxilForm,
  parseChildSurfaceDecl,
  parseElementBullet,
  parseRootDecl,
  parseUxRef,
} from "./mod.ts";

// Acceptance 1: grammar parses/round-trips all four forms + refs.
Deno.test("acceptance: all four forms parse through the public surface", () => {
  const root = parseRootDecl("ux:media.home : screen @ loading, error, ready");
  assertEquals(root.diagnostics, []);
  assertEquals(root.decl?.form, "root");

  const element = parseElementBullet("`/play : activate` — Resumes playback.");
  assertEquals(element.diagnostics, []);
  assertEquals(element.decl?.form, "element");

  const child = parseChildSurfaceDecl(".confirm_dialog @ default");
  assertEquals(child.diagnostics, []);
  assertEquals(child.decl?.form, "child");

  const ref = parseUxRef("ux:media.home/play:{id}!activate");
  assertEquals(ref.diagnostics, []);
  assertEquals(ref.ref?.element, "play");

  assertEquals(classifyUxilForm("/play : activate"), "element");
});

// Acceptance 2: scheme-less relative form parses identically (wire-compat).
Deno.test("acceptance: scheme-less wire form is byte-compatible", () => {
  const scheme = parseUxRef("ux:media.home/play");
  const wire = parseUxRef("media.home/play");
  assertEquals(scheme.diagnostics, []);
  assertEquals(wire.diagnostics, []);
  assertEquals(scheme.ref?.surface, wire.ref?.surface);
  assertEquals(scheme.ref?.element, wire.ref?.element);
  assertEquals(scheme.ref?.hasScheme, true);
  assertEquals(wire.ref?.hasScheme, false);
});

// Acceptance 3: parse errors are structured (feed S9).
Deno.test("acceptance: parse errors carry code + position", () => {
  const { diagnostics } = parseElementBullet("`/play : activate`");
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "UXIL-006");
  assertEquals(typeof diagnostics[0].position.line, "number");
  assertEquals(typeof diagnostics[0].position.column, "number");
});
```

- [ ] **Step 3: Run the whole uxil suite + type-check**

Run:
`deno test packages/markspec/core/uxil/ && deno check packages/markspec/core/uxil/mod.ts`
Expected: PASS (all uxil tests; check clean).

- [ ] **Step 4: Commit**

```bash
deno fmt packages/markspec/core/uxil/mod.ts packages/markspec/core/uxil/mod_test.ts
git add packages/markspec/core/uxil/mod.ts packages/markspec/core/uxil/mod_test.ts
git commit -m "feat(core): uxil module barrel + acceptance tests (#725)"
```

---

### Task 9: Full gate + garden the design doc

**Files:**

- Modify: `docs/wip/2026-07-05-uxil-parser-s7-design.md` (record K1 if it wasn't
  already noted; mark status implemented) — or garden per the sdd-gardening
  skill at branch close.

- [ ] **Step 1: Run the full build gate**

Run: `just build` Expected: PASS — `deno lint`, full `deno test`, the 4-target
`deno check`, and compile all green. Zero warnings.

- [ ] **Step 2: Run the format checks CI runs separately**

Run: `deno fmt --check && dprint check` Expected: PASS (both).

- [ ] **Step 3: Commit any format fixes (if the checks required them)**

```bash
git add -A
git commit -m "chore(core): fmt uxil (#725)"
```

- [ ] **Step 4: Garden working memory before PR**

Per the sdd-working-memory-lifecycle rule, run the `sdd-gardening` skill so the
S7 spec + plan are consolidated into durable `docs/` records (or archived) and
`docs/wip/` no longer holds this story's work before the `main`-targeting PR
opens. Do not garden the unrelated federated-upstream `docs/wip/` files
inherited from `main`.

---

## Self-Review

**Spec coverage:**

- Reference grammar (`ux-ref`, optional scheme, `?`/`#` reserved, `ux://`
  reserved) → Task 4 (`parseUxRef`, UXIL-002/003).
- Root declaration form → Task 5 (`parseRootDecl`).
- Element bullet form (verb set, key template, `@state`, `-> nav`, event
  dictionary) → Task 6 (`parseElementBullet`), decision K1 documented.
- Child-surface form → Task 5 (`parseChildSurfaceDecl`).
- AST → Task 1. Diagnostics shape → Task 2. Lexer → Task 3. Recognizer → Task 7.
- Acceptance 1 (all four forms + refs) / 2 (wire-compat) / 3 (structured errors)
  → Task 8 `mod_test.ts`. Table rows (§4.4) are deferred to S8 by design (S7
  supplies the row-level parsers already).
- Barrel not exported from `core/mod.ts` → Task 8 mod.ts is standalone; no
  `core/mod.ts` edit anywhere in the plan. ✓

**Placeholder scan:** none — every code step carries complete source.

**Type consistency:** `parseUxRef`/`parseRootDecl`/`parseChildSurfaceDecl`
return `{ ref?/decl?, diagnostics }`; `parseElementBullet` returns
`{ decl?, diagnostics }`; `classifyUxilForm` returns `UxilForm | undefined`. AST
field names (`surface`, `element`, `keyTemplate`, `verbs`, `states`, `nav`,
`eventDictionary`, `path`, `hasScheme`) are identical across ast.ts, the
parsers, and the tests. `Mut<T>` is defined once in grammar.ts and used by the
three node-building parsers.

**Known limitation (documented):** a surface whose first segment is literally
`ux` written as `ux:` collides with scheme detection (pathological; a UI surface
named `ux`). Positions are span-local (`line: 1`); S9 attaches file offsets.
