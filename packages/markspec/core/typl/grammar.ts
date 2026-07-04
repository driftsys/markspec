/**
 * @module typl/grammar
 *
 * Statement-level parser for the typl DSL. Converts a flat `Token[]`
 * stream (from the lexer) into a `TyplBlock` AST containing `Binding[]`
 * and `Typedef[]` statements.
 */

import {
  type Binding,
  type Kind,
  KINDS,
  type Shape,
  type Statement,
  type Typedef,
  type TyplBlock,
} from "./ast.ts";
import { type TyplDiagnostic, typlDiagnostic } from "./diagnostics.ts";
import { type Token, tokenize } from "./lexer.ts";

/** Fast set of valid kind keywords (excluding "value" which is the implicit default). */
const KIND_NAMES = new Set<string>(KINDS);

/**
 * Lowercase primitive type names. Used in the kind-detection heuristic to
 * distinguish a primitive type token from an unknown kind keyword.
 */
const PRIMITIVE_NAMES = new Set<string>([
  "int",
  "float",
  "bool",
  "string",
  "bytes",
]);

/** Recursive-descent parser for a typl source block. */
class Parser {
  private i = 0;
  private diagnostics: TyplDiagnostic[] = [];

  constructor(private tokens: Token[]) {}

  parseBlock(): { ast: TyplBlock; diagnostics: TyplDiagnostic[] } {
    const bindings: Binding[] = [];
    const typedefs: Typedef[] = [];
    const seenBindingNames = new Set<string>();
    const seenTypedefNames = new Set<string>();
    while (this.peek().kind !== "EOF") {
      const lineBefore = this.peek().position.line;
      const stmt = this.parseStatement();
      if (stmt) {
        if (stmt.statementKind === "binding") {
          if (seenBindingNames.has(stmt.name)) {
            this.diagnostics.push(
              typlDiagnostic("TYPL-001", { name: stmt.name }, stmt.position),
            );
          } else {
            seenBindingNames.add(stmt.name);
            bindings.push(stmt);
          }
        } else {
          if (seenTypedefNames.has(stmt.name)) {
            this.diagnostics.push(
              typlDiagnostic("TYPL-004", { name: stmt.name }, stmt.position),
            );
          } else {
            seenTypedefNames.add(stmt.name);
            typedefs.push(stmt);
          }
        }
      }
      // Only skip remaining tokens on the same line. If the cursor has
      // already advanced past lineBefore (parseStatement consumed the whole
      // line), we're already at the next statement — don't eat into it.
      if (
        this.peek().kind !== "EOF" &&
        this.peek().position.line === lineBefore
      ) {
        this.skipToNextLine();
      }
    }
    return { ast: { bindings, typedefs }, diagnostics: this.diagnostics };
  }

  private parseStatement(): Statement | undefined {
    const t = this.peek();
    if (t.kind === "COMMENT") {
      this.advance();
      return undefined;
    }
    if (t.kind === "DOLLAR_IDENT") return this.parseBinding();
    if (t.kind === "TYPE") return this.parseTypedef();
    this.diagnostics.push(
      typlDiagnostic(
        "TYPL-006",
        { detail: `unexpected token ${t.kind}` },
        t.position,
      ),
    );
    return undefined;
  }

  private parseBinding(): Binding | undefined {
    const nameTok = this.expect("DOLLAR_IDENT");
    if (!nameTok) return undefined;
    if (!this.expect("COLON")) return undefined;

    const next = this.peek();
    let kind: Kind = "value";

    if (next.kind === "IDENT") {
      if (KIND_NAMES.has(next.value)) {
        // Known kind keyword — consume and record.
        kind = next.value as Kind;
        this.advance();
      } else if (!PRIMITIVE_NAMES.has(next.value)) {
        // Not a primitive. Apply the heuristic: lowercase-starting tokens
        // that are not known primitives are likely mistyped kind keywords.
        // PascalCase tokens are typedef references and are left for the
        // shape parser.
        const firstChar = next.value[0];
        if (firstChar >= "a" && firstChar <= "z") {
          // Lowercase non-primitive non-kind → likely a typo on a kind keyword.
          // _-prefixed identifiers are typedef references, not kind keywords.
          this.diagnostics.push(
            typlDiagnostic(
              "TYPL-007",
              { keyword: next.value },
              next.position,
            ),
          );
          // Consume the bad keyword so the shape parser does not trip on it.
          this.advance();
        }
        // PascalCase or _-prefixed identifier: typedef ref — leave for parseShapeOptional.
      }
    }

    const shape = this.parseShapeOptional();

    // A namespace declaration (#723) is scaffolding — it establishes a
    // base for relative refs and must not carry a shape.
    if (kind === "namespace" && shape !== undefined) {
      this.diagnostics.push(
        typlDiagnostic(
          "TYPL-006",
          { detail: "a namespace declaration carries no shape" },
          nameTok.position,
        ),
      );
      return undefined;
    }

    return {
      statementKind: "binding",
      name: nameTok.value,
      kind,
      shape,
      position: nameTok.position,
    };
  }

  private parseTypedef(): Typedef | undefined {
    const typeTok = this.expect("TYPE");
    if (!typeTok) return undefined;
    const nameTok = this.expect("IDENT");
    if (!nameTok) return undefined;
    if (!this.expect("EQUALS")) return undefined;
    const shape = this.parseShape();
    if (!shape) return undefined;
    return {
      statementKind: "typedef",
      name: nameTok.value,
      shape,
      position: typeTok.position,
    };
  }

  // -----------------------------------------------------------------------
  // Shape parsing
  // -----------------------------------------------------------------------

  /**
   * Parse an optional shape expression. Returns `undefined` when no shape
   * token follows (e.g. `$Idle : state` with no payload).
   */
  private parseShapeOptional(): Shape | undefined {
    if (this.peek().kind === "EOF" || this.peek().kind === "COMMENT") {
      return undefined;
    }
    return this.parseShape();
  }

  /** Parse a mandatory shape expression. Returns `undefined` when absent. */
  private parseShape(): Shape | undefined {
    const base = this.parsePrimary();
    if (!base) return undefined;
    return this.wrapArrayOrOptional(base);
  }

  private parsePrimary(): Shape | undefined {
    const t = this.peek();

    // Pattern
    if (t.kind === "REGEX") {
      this.advance();
      const flagsTok = this.peek().kind === "REGEX_FLAGS"
        ? this.advance()
        : undefined;
      return flagsTok
        ? { kind: "pattern", regex: t.value, flags: flagsTok.value }
        : { kind: "pattern", regex: t.value };
    }

    // Record
    if (t.kind === "LBRACE") return this.parseRecord();

    // Enum (literal followed by PIPE) — also handles a single literal
    if (t.kind === "STRING" || t.kind === "NUMBER" || t.kind === "BOOL") {
      return this.parseEnumOrLiteral();
    }

    // Primitive | typedef ref
    if (t.kind === "IDENT") {
      const name = t.value;
      if (["int", "float"].includes(name)) {
        this.advance();
        if (this.peek().kind === "LBRACKET") {
          // `[]` empty brackets → array (never a range). Leave for wrapArrayOrOptional.
          // For float, `[N]` (no DOTDOT) is also an array-exact. Leave for wrapper.
          // For int, `[N]` (no DOTDOT) is a range-exact → enter parseRangeBody.
          const isEmpty = this.tokens[this.i + 1]?.kind === "RBRACKET";
          const hasDotDot = this.bracketHasDotDot();
          if (!isEmpty && (name === "int" || hasDotDot)) {
            return this.parseRangeBody(name as "int" | "float");
          }
          // Otherwise leave `[…]` for wrapArrayOrOptional.
        }
        return { kind: "primitive", type: name as "int" | "float" };
      }
      if (["string", "bytes"].includes(name)) {
        this.advance();
        if (this.peek().kind === "LBRACKET") {
          // `[]` empty brackets → array (never a length). Leave for wrapArrayOrOptional.
          // `[N]` single number → length exact → enter parseLengthBody.
          // `[N..M]` range form → length range → enter parseLengthBody.
          const isEmpty = this.tokens[this.i + 1]?.kind === "RBRACKET";
          const hasDotDot = this.bracketHasDotDot();
          if (
            !isEmpty &&
            (hasDotDot || this.tokens[this.i + 1]?.kind === "NUMBER")
          ) {
            return this.parseLengthBody(name as "string" | "bytes");
          }
          // Otherwise (empty `[]`) leave for wrapArrayOrOptional.
        }
        return { kind: "primitive", type: name as "string" | "bytes" };
      }
      if (name === "bool") {
        this.advance();
        return { kind: "primitive", type: "bool" };
      }
      this.advance();
      return { kind: "ref", name };
    }

    return undefined;
  }

  private parseRangeBody(type: "int" | "float"): Shape | undefined {
    if (!this.expect("LBRACKET")) return undefined;
    const first = this.peek();
    if (
      first.kind === "NUMBER" && this.tokens[this.i + 1].kind === "RBRACKET"
    ) {
      const n = Number(this.advance().value);
      this.expect("RBRACKET");
      return { kind: "range", type, exact: n };
    }
    let min: number | undefined;
    let max: number | undefined;
    if (this.peek().kind === "NUMBER") min = Number(this.advance().value);
    if (this.peek().kind !== "DOTDOT") {
      this.diagnostics.push(
        typlDiagnostic(
          "TYPL-006",
          { detail: "expected '..'" },
          this.peek().position,
        ),
      );
      return undefined;
    }
    this.advance();
    if (this.peek().kind === "NUMBER") max = Number(this.advance().value);
    if (!this.expect("RBRACKET")) return undefined;
    if (type === "int") {
      if (min !== undefined && !Number.isInteger(min)) {
        this.diagnostics.push(
          typlDiagnostic(
            "TYPL-008",
            {
              value: min,
              constraint: "int range",
              detail: "non-integer literal",
            },
            first.position,
          ),
        );
      }
      if (max !== undefined && !Number.isInteger(max)) {
        this.diagnostics.push(
          typlDiagnostic(
            "TYPL-008",
            {
              value: max,
              constraint: "int range",
              detail: "non-integer literal",
            },
            first.position,
          ),
        );
      }
    }
    return {
      kind: "range",
      type,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
    };
  }

  private parseLengthBody(type: "string" | "bytes"): Shape | undefined {
    if (!this.expect("LBRACKET")) return undefined;
    if (
      this.peek().kind === "NUMBER" &&
      this.tokens[this.i + 1].kind === "RBRACKET"
    ) {
      const exact = Number(this.advance().value);
      this.expect("RBRACKET");
      return { kind: "length", type, exact };
    }
    let min: number | undefined;
    let max: number | undefined;
    if (this.peek().kind === "NUMBER") min = Number(this.advance().value);
    if (this.peek().kind !== "DOTDOT") {
      this.diagnostics.push(
        typlDiagnostic(
          "TYPL-006",
          { detail: "expected '..'" },
          this.peek().position,
        ),
      );
      return undefined;
    }
    this.advance();
    if (this.peek().kind === "NUMBER") max = Number(this.advance().value);
    if (!this.expect("RBRACKET")) return undefined;
    return {
      kind: "length",
      type,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
    };
  }

  private parseRecord(): Shape | undefined {
    if (!this.expect("LBRACE")) return undefined;
    const fields: Record<string, Shape> = {};
    while (this.peek().kind !== "RBRACE" && this.peek().kind !== "EOF") {
      const nameTok = this.expect("IDENT");
      if (!nameTok) break;
      // shorthand `{ a, b }` => fields with ref to typedef of same name
      if (this.peek().kind === "COMMA" || this.peek().kind === "RBRACE") {
        fields[nameTok.value] = { kind: "ref", name: nameTok.value };
      } else {
        if (!this.expect("COLON")) break;
        const fieldShape = this.parseShape();
        if (!fieldShape) break;
        fields[nameTok.value] = fieldShape;
      }
      if (this.peek().kind === "COMMA") this.advance();
    }
    this.expect("RBRACE");
    return { kind: "record", fields };
  }

  private parseEnumOrLiteral(): Shape | undefined {
    const values: (string | number | boolean)[] = [];
    const t = this.advance();
    values.push(this.literalValue(t));
    while (this.peek().kind === "PIPE") {
      this.advance();
      const next = this.peek();
      if (
        next.kind !== "STRING" && next.kind !== "NUMBER" &&
        next.kind !== "BOOL"
      ) {
        this.diagnostics.push(
          typlDiagnostic(
            "TYPL-006",
            { detail: "expected literal after '|'" },
            next.position,
          ),
        );
        break;
      }
      values.push(this.literalValue(this.advance()));
    }
    if (values.length === 1) return { kind: "literal", value: values[0] };
    return { kind: "enum", values };
  }

  private literalValue(t: Token): string | number | boolean {
    if (t.kind === "STRING") return t.value;
    if (t.kind === "BOOL") return t.value === "true";
    return Number(t.value);
  }

  /**
   * Lookahead: does the upcoming `[…]` bracket contain a DOTDOT token?
   * Used to disambiguate `float[4]` (array-exact) from `float[0..300]` (range).
   * Scans forward from `i+1` (the token after LBRACKET) without consuming.
   */
  private bracketHasDotDot(): boolean {
    let j = this.i + 1; // skip over the LBRACKET itself (not yet consumed here)
    while (j < this.tokens.length) {
      const k = this.tokens[j].kind;
      if (k === "RBRACKET" || k === "EOF") return false;
      if (k === "DOTDOT") return true;
      j++;
    }
    return false;
  }

  private wrapArrayOrOptional(base: Shape): Shape {
    let s = base;
    while (true) {
      if (this.peek().kind === "LBRACKET") {
        this.advance();
        if (this.peek().kind === "RBRACKET") {
          this.advance();
          s = { kind: "array", element: s };
          if (this.peek().kind === "LPAREN") {
            this.advance();
            let min: number | undefined;
            let max: number | undefined;
            if (this.peek().kind === "NUMBER") {
              min = Number(this.advance().value);
            }
            if (this.peek().kind === "DOTDOT") {
              this.advance();
              if (this.peek().kind === "NUMBER") {
                max = Number(this.advance().value);
              }
            }
            this.expect("RPAREN");
            const arr = s as {
              kind: "array";
              element: Shape;
              min?: number;
              max?: number;
            };
            if (min !== undefined) arr.min = min;
            if (max !== undefined) arr.max = max;
            s = arr;
          }
        } else if (this.peek().kind === "NUMBER") {
          const exact = Number(this.advance().value);
          this.expect("RBRACKET");
          s = { kind: "array", element: s, exact };
        } else {
          this.diagnostics.push(
            typlDiagnostic(
              "TYPL-006",
              { detail: `unexpected token ${this.peek().kind} inside '['` },
              this.peek().position,
            ),
          );
          break;
        }
      } else if (this.peek().kind === "QUESTION") {
        this.advance();
        s = { kind: "optional", inner: s };
      } else {
        break;
      }
    }
    return s;
  }

  // -----------------------------------------------------------------------
  // Low-level helpers
  // -----------------------------------------------------------------------

  private peek(): Token {
    return this.tokens[this.i];
  }

  private advance(): Token {
    return this.tokens[this.i++];
  }

  private expect(kind: Token["kind"]): Token | undefined {
    const t = this.peek();
    if (t.kind !== kind) {
      this.diagnostics.push(
        typlDiagnostic(
          "TYPL-006",
          { detail: `expected ${kind} but got ${t.kind}` },
          t.position,
        ),
      );
      return undefined;
    }
    return this.advance();
  }

  /**
   * Advance past all remaining tokens on the current line so that a parse
   * error on one statement does not cascade into the next. Stops at the
   * first token whose line number is greater than the current peek's line,
   * or at EOF.
   */
  private skipToNextLine(): void {
    const startLine = this.peek().position.line;
    while (
      this.peek().kind !== "EOF" &&
      this.peek().position.line === startLine
    ) {
      this.advance();
    }
  }
}

/**
 * Parse a typl source block into a `TyplBlock` AST.
 *
 * @param source - Raw typl text (may be multi-line).
 * @returns Parsed AST and any diagnostics emitted during parsing.
 */
export function parseTyplBlock(
  source: string,
): { ast: TyplBlock; diagnostics: readonly TyplDiagnostic[] } {
  const { tokens, diagnostics: lexDiagnostics } = tokenize(source);
  const { ast, diagnostics: parseDiagnostics } = new Parser(tokens)
    .parseBlock();
  return { ast, diagnostics: [...lexDiagnostics, ...parseDiagnostics] };
}
