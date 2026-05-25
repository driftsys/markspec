/**
 * @module typl/grammar
 *
 * Statement-level parser for the typl DSL. Converts a flat `Token[]`
 * stream (from the lexer) into a `TyplBlock` AST containing `Binding[]`
 * and `Typedef[]` statements.
 *
 * Shape parsing (`parseShape` / `parseShapeOptional`) is stubbed in this
 * task and filled in by Task 6.
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

/**
 * Recursive-descent parser for a typl source block.
 *
 * The `protected parseShape*` methods are stubs intentionally left for
 * Task 6 to fill in. Subclasses (or an override in Task 6) will provide
 * the real implementation.
 */
class Parser {
  private i = 0;
  private diagnostics: TyplDiagnostic[] = [];

  constructor(private tokens: Token[]) {}

  parseBlock(): { ast: TyplBlock; diagnostics: TyplDiagnostic[] } {
    const bindings: Binding[] = [];
    const typedefs: Typedef[] = [];
    while (this.peek().kind !== "EOF") {
      const stmt = this.parseStatement();
      if (stmt) {
        if (stmt.statementKind === "binding") bindings.push(stmt);
        else typedefs.push(stmt);
      }
      this.skipToNextLine();
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
        if (next.value[0] && next.value[0] === next.value[0].toLowerCase()) {
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
        // PascalCase identifier: typedef ref — leave for parseShapeOptional.
      }
    }

    const shape = this.parseShapeOptional();
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
  // Shape parsing — stubbed. Task 6 fills these in.
  // -----------------------------------------------------------------------

  /** Parse a mandatory shape expression. Returns `undefined` when absent. */
  protected parseShape(): Shape | undefined {
    return undefined;
  }

  /**
   * Parse an optional shape expression. Returns `undefined` when no shape
   * token follows (e.g. `$Idle : state` with no payload).
   */
  protected parseShapeOptional(): Shape | undefined {
    return undefined;
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
  const tokens = tokenize(source);
  return new Parser(tokens).parseBlock();
}
