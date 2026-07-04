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
