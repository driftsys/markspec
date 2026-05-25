/**
 * @module typl/diagnostics
 *
 * Diagnostic codes emitted by the typl parser and validator (TYPL-001
 * through TYPL-008). Each code carries a severity and a template; the
 * `typlDiagnostic` helper performs `${var}` substitution.
 */
import type { Position } from "./ast.ts";
import { KINDS } from "./ast.ts";
import type { Severity } from "../model/mod.ts";

/**
 * The explicit-kind list used in TYPL-007 error messages. Derived from
 * `KINDS` (excluding the implicit default "value") so the message stays
 * in sync with the authoritative vocabulary automatically.
 */
const EXPLICIT_KIND_LIST: string = KINDS.filter((k) => k !== "value").join(
  ", ",
);

/** Shape of each entry in {@linkcode TYPL_CODES}. */
export interface TyplCodeEntry {
  readonly severity: Severity;
  readonly template: string;
}

/**
 * A diagnostic emitted by the typl parser.
 *
 * Carries only line/column position because the parser operates on raw
 * typl source strings (extracted from fences, bullets, or inline code
 * spans) without knowing the host file. Surface adapters bridge
 * TyplDiagnostic to the core `Diagnostic` type by attaching the
 * containing file path; see PR 6 in the implementation plan.
 */
export interface TyplDiagnostic {
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly position: Position;
}

export const TYPL_CODES: Record<string, TyplCodeEntry> = {
  "TYPL-001": {
    severity: "error",
    template:
      "Duplicate binding for ${name} in the same entry (first wins, this is a duplicate).",
  },
  "TYPL-002": {
    severity: "error",
    template:
      "${name} is declared as kind ${kindA} here and ${kindB} in ${otherFile}:${otherLine}.",
  },
  "TYPL-003": {
    severity: "error",
    template:
      "${name} is declared with a different shape than in ${otherFile}:${otherLine}.",
  },
  "TYPL-004": {
    severity: "error",
    template: "Typedef ${name} is redefined within the same entry.",
  },
  "TYPL-005": {
    severity: "error",
    template: "Reference to undefined typedef ${name}.",
  },
  "TYPL-006": {
    severity: "error",
    template: "Malformed schema: ${detail}.",
  },
  "TYPL-007": {
    severity: "error",
    template:
      `Unknown kind keyword \${keyword}. Expected one of: ${EXPLICIT_KIND_LIST}.`,
  },
  "TYPL-008": {
    severity: "error",
    template: "Literal ${value} violates declared ${constraint} (${detail}).",
  },
};

/**
 * Construct a typl diagnostic by substituting `${var}` placeholders in the
 * code's template with the supplied params.
 *
 * Note: param keys are not type-checked against the template — a missing
 * key leaves a raw `${key}` placeholder in the message. Compile-time
 * mapping per code is possible with conditional types but is deferred;
 * for now, callers should test message-formatting for each code.
 */
export function typlDiagnostic(
  code: string,
  params: Record<string, string | number>,
  position: Position,
): TyplDiagnostic {
  const entry = TYPL_CODES[code];
  if (!entry) {
    throw new Error(`Unknown TYPL code: ${code}`);
  }
  let message: string = entry.template;
  for (const [k, v] of Object.entries(params)) {
    message = message.replaceAll(`\${${k}}`, String(v));
  }
  return { code, severity: entry.severity, message, position };
}
