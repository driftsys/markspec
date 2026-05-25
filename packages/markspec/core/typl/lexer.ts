/**
 * @module typl/lexer
 *
 * Tokenizer for the typl DSL. Converts a source string into a flat
 * `Token[]` stream. Whitespace (except newlines) is silently skipped;
 * newlines advance the line counter for position tracking. Comments
 * (`#` to end-of-line) are emitted as `COMMENT` tokens so the parser
 * can skip whole lines cleanly.
 *
 * The lexer is intentionally lenient — unrecognised characters are
 * skipped. The parser surfaces TYPL-006 when grammar expectations are
 * not met, keeping diagnostic responsibility clearly separated.
 */

import type { Position } from "./ast.ts";

/** All token kinds produced by the typl tokenizer. */
export type TokenKind =
  | "DOLLAR_IDENT"
  | "IDENT"
  | "NUMBER"
  | "STRING"
  | "BOOL"
  | "REGEX"
  | "REGEX_FLAGS"
  | "COLON"
  | "EQUALS"
  | "TYPE"
  | "DOTDOT"
  | "DOT"
  | "COMMA"
  | "PIPE"
  | "QUESTION"
  | "LBRACE"
  | "RBRACE"
  | "LBRACKET"
  | "RBRACKET"
  | "LPAREN"
  | "RPAREN"
  | "COMMENT"
  | "EOF";

/** A single token emitted by {@linkcode tokenize}. */
export interface Token {
  readonly kind: TokenKind;
  /** Raw text of the token (empty string for EOF). */
  readonly value: string;
  /** 1-based source position of the token's first character. */
  readonly position: Position;
}

/** Single-character token map (punctuation). */
const SINGLE_CHAR_MAP: Readonly<Record<string, TokenKind>> = {
  ":": "COLON",
  "=": "EQUALS",
  ",": "COMMA",
  "|": "PIPE",
  "?": "QUESTION",
  "{": "LBRACE",
  "}": "RBRACE",
  "[": "LBRACKET",
  "]": "RBRACKET",
  "(": "LPAREN",
  ")": "RPAREN",
};

/** Pattern for identifier-body characters (after the first character). */
const IDENT_BODY_RE = /[A-Za-z0-9_]/;

/** Pattern for the first character of an identifier (excluding `$`). */
const IDENT_START_RE = /[A-Za-z_]/;

/** Pattern for digit characters (used in numeric tokens). */
const DIGIT_RE = /[0-9]/;

/**
 * Tokenize a typl source string.
 *
 * Returns a `Token[]` terminated by an `EOF` token. Position values are
 * 1-based (line 1, column 1 is the first character of the source). The
 * stream always ends with exactly one `EOF` token.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  let column = 1;
  let i = 0;

  /** Append a token using the current position tracking. */
  const push = (kind: TokenKind, value: string, startCol: number): void => {
    tokens.push({ kind, value, position: { line, column: startCol } });
  };

  while (i < source.length) {
    const ch = source[i];

    // ── Newline — advance line counter ───────────────────────────────
    if (ch === "\n") {
      line++;
      column = 1;
      i++;
      continue;
    }

    // ── Other whitespace — skip silently ─────────────────────────────
    if (/\s/.test(ch)) {
      i++;
      column++;
      continue;
    }

    // ── Comment — `#` to end-of-line ─────────────────────────────────
    if (ch === "#") {
      const startCol = column;
      let value = "";
      while (i < source.length && source[i] !== "\n" && source[i] !== "\r") {
        value += source[i];
        i++;
        column++;
      }
      push("COMMENT", value, startCol);
      continue;
    }

    // ── Dollar-prefixed identifier — `$Speed` ────────────────────────
    // $ identifier — body uses IDENT_BODY_RE (allows digits) intentionally;
    // names like $1st are lexically valid and rejected by the parser
    if (ch === "$") {
      const startCol = column;
      let value = "$";
      i++;
      column++;
      while (i < source.length && IDENT_BODY_RE.test(source[i])) {
        value += source[i];
        i++;
        column++;
      }
      push("DOLLAR_IDENT", value, startCol);
      continue;
    }

    // ── Regex literal — `/pattern/flags` ─────────────────────────────
    if (ch === "/") {
      const startCol = column;
      i++;
      column++;
      let regex = "";
      while (i < source.length && source[i] !== "/") {
        if (source[i] === "\\" && i + 1 < source.length) {
          // Preserve escape sequences verbatim inside the regex body.
          regex += source[i] + source[i + 1];
          i += 2;
          column += 2;
        } else {
          regex += source[i];
          i++;
          column++;
        }
      }
      // Consume the closing `/`.
      if (i < source.length && source[i] === "/") {
        i++;
        column++;
      }
      push("REGEX", regex, startCol);
      // Optional flags after the closing `/`.
      const flagsStartCol = column;
      let flags = "";
      while (i < source.length && /[a-z]/.test(source[i])) {
        flags += source[i];
        i++;
        column++;
      }
      if (flags) push("REGEX_FLAGS", flags, flagsStartCol);
      continue;
    }

    // ── String literal — `'…'` or `"…"` ─────────────────────────────
    if (ch === "'" || ch === '"') {
      const startCol = column;
      const quote = ch;
      let value = "";
      i++;
      column++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < source.length) {
          value += source[i + 1];
          i += 2;
          column += 2;
        } else {
          value += source[i];
          i++;
          column++;
        }
      }
      // Consume closing quote.
      if (i < source.length && source[i] === quote) {
        i++;
        column++;
      }
      push("STRING", value, startCol);
      continue;
    }

    // ── Numeric literal (and negative numbers starting with `-`) ─────
    // Negative: `-` followed immediately by a digit.
    // Must stop at `..` (DOTDOT) to correctly lex `int[0..300]`.
    if (
      DIGIT_RE.test(ch) ||
      (ch === "-" && i + 1 < source.length && DIGIT_RE.test(source[i + 1]))
    ) {
      const startCol = column;
      let value = "";
      if (ch === "-") {
        value = "-";
        i++;
        column++;
      }
      while (i < source.length) {
        // Stop at `..` so `0..300` produces NUMBER(0) DOTDOT NUMBER(300).
        if (
          source[i] === "." && i + 1 < source.length && source[i + 1] === "."
        ) break;
        if (!DIGIT_RE.test(source[i]) && source[i] !== ".") break;
        value += source[i];
        i++;
        column++;
      }
      push("NUMBER", value, startCol);
      continue;
    }

    // ── Identifier or keyword ─────────────────────────────────────────
    if (IDENT_START_RE.test(ch)) {
      const startCol = column;
      let value = "";
      while (i < source.length && IDENT_BODY_RE.test(source[i])) {
        value += source[i];
        i++;
        column++;
      }
      if (value === "type") push("TYPE", value, startCol);
      else if (value === "true" || value === "false") {
        push("BOOL", value, startCol);
      } else push("IDENT", value, startCol);
      continue;
    }

    // ── DOTDOT — must be checked before DOT ──────────────────────────
    if (ch === "." && i + 1 < source.length && source[i + 1] === ".") {
      push("DOTDOT", "..", column);
      i += 2;
      column += 2;
      continue;
    }

    // ── Single-character DOT ──────────────────────────────────────────
    if (ch === ".") {
      push("DOT", ".", column);
      i++;
      column++;
      continue;
    }

    // ── Single-character punctuation ──────────────────────────────────
    const singleKind = SINGLE_CHAR_MAP[ch];
    if (singleKind !== undefined) {
      push(singleKind, ch, column);
      i++;
      column++;
      continue;
    }

    // ── Unrecognised character — skip silently ────────────────────────
    // The parser will surface TYPL-006 when grammar expectations are unmet.
    i++;
    column++;
  }

  tokens.push({ kind: "EOF", value: "", position: { line, column } });
  return tokens;
}
