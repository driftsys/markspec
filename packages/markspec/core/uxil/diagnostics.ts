/**
 * @module uxil/diagnostics
 *
 * Diagnostic codes emitted by the uxil parser and compiler (UXIL-001 through
 * UXIL-022). Source-local positions only — S9 bridges these to file-anchored
 * core `Diagnostic`s. Shape and helper mirror typl's `typlDiagnostic`.
 */
import type { Position } from "./ast.ts";
import type { Severity } from "../model/mod.ts";

/** Union of all uxil parser + compiler diagnostic codes. */
export type UxilCode =
  | "UXIL-001"
  | "UXIL-002"
  | "UXIL-003"
  | "UXIL-004"
  | "UXIL-005"
  | "UXIL-006"
  | "UXIL-007"
  | "UXIL-008"
  | "UXIL-009"
  | "UXIL-010"
  | "UXIL-011"
  | "UXIL-012"
  | "UXIL-013"
  | "UXIL-014"
  | "UXIL-015"
  | "UXIL-016"
  | "UXIL-017"
  | "UXIL-018"
  | "UXIL-019"
  | "UXIL-020"
  | "UXIL-021"
  | "UXIL-022";

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
    template:
      "Root declaration is missing its kind (expected 'ux:surface : kind').",
  },
  "UXIL-005": {
    severity: "error",
    template:
      "Element declaration has an empty verb set (expected '/element : verb').",
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
  "UXIL-009": {
    severity: "error",
    template:
      "Unknown surface kind '${kind}' (expected screen, panel, or agent).",
  },
  "UXIL-010": {
    severity: "error",
    template: "Unknown interaction verb '${verb}'.",
  },
  "UXIL-011": {
    severity: "error",
    template:
      "A ux-contract entry must declare exactly one root surface; none was found.",
  },
  "UXIL-012": {
    severity: "error",
    template:
      "A ux-contract entry must declare exactly one root surface; found another after '${first}'.",
  },
  "UXIL-013": {
    severity: "error",
    template: "Kind '${kind}' is stateless and cannot declare @ states.",
  },
  "UXIL-014": {
    severity: "error",
    template:
      "'observe' is exclusive and cannot be combined with other verbs on element '${element}'.",
  },
  "UXIL-015": {
    severity: "error",
    template:
      "Surface '${surface}' is already declared (first at ${otherFile}:${otherLine}).",
  },
  "UXIL-016": {
    severity: "error",
    template:
      "Surface '${surface}' has no declared parent surface '${parent}'.",
  },
  "UXIL-017": {
    severity: "error",
    template:
      "navigate target '${target}' does not resolve to a navigable (screen) surface.",
  },
  "UXIL-018": {
    severity: "error",
    template: "Unknown surface '${surface}'.",
  },
  "UXIL-019": {
    severity: "error",
    template: "Unknown element '${element}' on surface '${surface}'.",
  },
  "UXIL-020": {
    severity: "error",
    template:
      "Verb '${verb}' is not in the declared verb set of element '${element}'.",
  },
  "UXIL-021": {
    severity: "error",
    template: "State '${state}' is not declared on surface '${surface}'.",
  },
  "UXIL-022": {
    severity: "error",
    template:
      "Element '${element}' declares a key template; cite it with a '{name}' template, not a concrete key.",
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
