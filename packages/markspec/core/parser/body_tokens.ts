/**
 * @module core/parser/body_tokens
 *
 * Inline-construct token extraction (ADR-016). Scans entry body prose for
 * the six BodyTokenKind variants, skipping verbatim regions (code, math,
 * inline-code spans). Inside ` ```feature ` / ` ```gherkin ` fences the
 * modal/EARS/entity-ref scanners are suppressed and the gherkin
 * section/step scanners run instead.
 *
 * Single source of truth for inline-construct extraction. Replaces the
 * pre-ADR-016 marker mechanism (`InlineContent.markers`) and the
 * `Entry.entityRefs` field.
 */

import type { BodyToken, SourceLocation } from "../model/mod.ts";
import type { BodyBlock } from "../ast/nodes.ts";

/**
 * Extract body-token stream from an entry body.
 *
 * @param body - entry body string (post-`splitBodyAndAttributes`)
 * @param bodyAst - canonical body AST for the same body (drives
 *   code/math/feature fence detection)
 * @param baseLocation - `SourceLocation` of the body's first line; the
 *   `file` field is propagated to every emitted token
 * @returns tokens sorted by `(line, column)`. Empty when no constructs
 *   are recognised.
 */
export function extractBodyTokens(
  body: string,
  bodyAst: readonly BodyBlock[],
  baseLocation: SourceLocation,
): readonly BodyToken[] {
  void body;
  void bodyAst;
  void baseLocation;
  // TODO: implement in subsequent tasks (T4-T10)
  return [];
}
