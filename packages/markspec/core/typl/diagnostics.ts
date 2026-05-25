// packages/markspec/core/typl/diagnostics.ts
import type { Position } from "./ast.ts";

export interface TyplDiagnostic {
  readonly code: keyof typeof TYPL_CODES;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly position: Position;
}

export const TYPL_CODES = {
  "TYPL-001": {
    severity: "error" as const,
    template:
      "Duplicate binding for ${name} in the same entry (first wins, this is a duplicate).",
  },
  "TYPL-002": {
    severity: "error" as const,
    template:
      "${name} is declared as kind ${kindA} here and ${kindB} in ${otherFile}:${otherLine}.",
  },
  "TYPL-003": {
    severity: "error" as const,
    template:
      "${name} is declared with a different shape than in ${otherFile}:${otherLine}.",
  },
  "TYPL-004": {
    severity: "error" as const,
    template: "Typedef ${name} is redefined within the same entry.",
  },
  "TYPL-005": {
    severity: "error" as const,
    template: "Reference to undefined typedef ${name}.",
  },
  "TYPL-006": {
    severity: "error" as const,
    template: "Malformed schema: ${detail}.",
  },
  "TYPL-007": {
    severity: "error" as const,
    template:
      "Unknown kind keyword ${keyword}. Expected one of: event, signal, command, state, const, config, document, stream.",
  },
  "TYPL-008": {
    severity: "error" as const,
    template: "Literal ${value} violates declared ${constraint} (${detail}).",
  },
} as const;

export function typlDiagnostic<C extends keyof typeof TYPL_CODES>(
  code: C,
  params: Record<string, string | number>,
  position: Position,
): TyplDiagnostic {
  const entry = TYPL_CODES[code];
  let message: string = entry.template;
  for (const [k, v] of Object.entries(params)) {
    message = message.replaceAll(`\${${k}}`, String(v));
  }
  return { code, severity: entry.severity, message, position };
}
