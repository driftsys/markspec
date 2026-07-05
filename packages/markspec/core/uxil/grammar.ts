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
    uxilDiagnostic(
      "UXIL-001",
      { detail: `expected ${what}` },
      c.peek().position,
    ),
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
        uxilDiagnostic(
          "UXIL-008",
          { detail: "trailing '.' in surface" },
          c.peek().position,
        ),
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
        uxilDiagnostic(
          "UXIL-007",
          { detail: "expected a name inside { }" },
          c.peek().position,
        ),
      );
      return undefined;
    }
    const name = c.advance().value;
    if (c.peek().kind !== "RBRACE") {
      diags.push(
        uxilDiagnostic(
          "UXIL-007",
          { detail: "missing closing '}'" },
          c.peek().position,
        ),
      );
      return undefined;
    }
    c.advance();
    return { kind: "template", name };
  }
  if (c.peek().kind === "IDENT") {
    return { kind: "concrete", value: c.advance().value };
  }
  diags.push(
    uxilDiagnostic(
      "UXIL-001",
      { detail: "expected a key after ':'" },
      c.peek().position,
    ),
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

/** Push UXIL-001 for any leftover tokens before EOF. */
function expectEof(c: Cursor, diags: UxilDiagnostic[]): void {
  if (!c.atEof()) {
    const t = c.peek();
    diags.push(
      uxilDiagnostic("UXIL-001", {
        detail: `unexpected '${t.value || t.kind}'`,
      }, t.position),
    );
  }
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
        uxilDiagnostic(
          "UXIL-008",
          { detail: "missing surface" },
          c.peek().position,
        ),
      );
    }
    return { diagnostics };
  }

  const surface = parseSurface(c, diagnostics);
  if (!surface) {
    diagnostics.push(
      uxilDiagnostic(
        "UXIL-008",
        { detail: "expected a surface segment" },
        c.peek().position,
      ),
    );
    return { diagnostics };
  }

  const ref: Mut<UxRef> = {
    hasScheme,
    surface,
    position: { line: 1, column: 1 },
  };
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
      uxilDiagnostic(
        "UXIL-008",
        { detail: "expected a surface segment" },
        c.peek().position,
      ),
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
      uxilDiagnostic(
        "UXIL-008",
        { detail: "child surface must start with '.'" },
        c.peek().position,
      ),
    );
    return { diagnostics };
  }
  c.advance();
  const path = parseSurface(c, diagnostics);
  if (!path) {
    diagnostics.push(
      uxilDiagnostic(
        "UXIL-008",
        { detail: "expected a child surface name after '.'" },
        c.peek().position,
      ),
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
 * `/element : verb[, verb…] [: {key}] [@state, …] [-> nav]` followed by a
 * mandatory trailing prose event dictionary. Grammar decision K1 (#786,
 * per the epic design doc): the key template is its own `:` clause after
 * the verb set — never attached to the element name, so declarations
 * cannot collide with the ref grammar's `element:{key}` form.
 */
export function parseElementBullet(
  paragraph: string,
): { decl?: ElementDecl; diagnostics: UxilDiagnostic[] } {
  const diagnostics: UxilDiagnostic[] = [];
  const { span, rest } = splitLeadingCodeSpan(paragraph);
  if (span === undefined) {
    diagnostics.push(
      uxilDiagnostic(
        "UXIL-001",
        { detail: "element bullet must begin with a code span" },
        { line: 1, column: 1 },
      ),
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
      uxilDiagnostic(
        "UXIL-001",
        { detail: "element must start with '/'" },
        c.peek().position,
      ),
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

  // Old glued form `/element{key}` (pre-#786): one targeted diagnostic
  // pointing at the clause form, then consume-and-discard the braces so
  // the verb set still parses instead of cascading UXIL-005 + UXIL-001.
  if (c.peek().kind === "LBRACE") {
    diagnostics.push(
      uxilDiagnostic("UXIL-007", {
        detail:
          "the key template is a clause after the verb set (write '/element : verb : {key}')",
      }, c.peek().position),
    );
    parseKey(c, diagnostics);
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

  // Optional key-template clause: `: {key}` after the verb set (K1, #786).
  // Declarations declare templates — a concrete key is a citation-only form.
  if (c.peek().kind === "COLON") {
    c.advance();
    const keyAt = c.peek().position;
    const k = parseKey(c, diagnostics);
    if (k?.kind === "template") {
      decl.keyTemplate = k;
    } else if (k) {
      diagnostics.push(
        uxilDiagnostic("UXIL-007", {
          detail: "expected a '{name}' template, not a concrete key",
        }, keyAt),
      );
    }
  }

  const states = parseStateSet(c, diagnostics);
  if (states.length > 0) decl.states = states;
  expectEof(c, diagnostics);

  // Nav target (parsed as a ux ref; may be scheme-less / relative).
  if (navSource !== undefined) {
    if (navSource.length === 0) {
      diagnostics.push(
        uxilDiagnostic(
          "UXIL-001",
          { detail: "missing navigation target after '->'" },
          { line: 1, column: 1 },
        ),
      );
    } else {
      const nav = parseUxRef(navSource);
      diagnostics.push(...nav.diagnostics);
      if (nav.ref) decl.nav = nav.ref;
    }
  }

  // Event dictionary: trailing prose, minus a leading em-dash separator. Only
  // an em-dash "—" is stripped (never an ASCII "-"), so prose that legitimately
  // opens with a hyphen — e.g. "-5 dB is the floor" — keeps its first character.
  const eventDictionary = rest.replace(/^\s*—\s*/, "").trim();
  if (eventDictionary.length === 0) {
    diagnostics.push(uxilDiagnostic("UXIL-006", {}, { line: 1, column: 1 }));
  }
  decl.eventDictionary = eventDictionary;

  return { decl, diagnostics };
}
