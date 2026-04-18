/**
 * @module migrate
 *
 * One-shot migration from legacy `Id: TYPE_<26-char>` attributes (ADR-001
 * two-family model) to the ADR-002 v2 four-family identity attributes
 * (`Spec-id`, bare Crockford ULID).
 *
 * Scope today:
 * - Only `Id:` on spec entries is rewritten. Reference entries already use
 *   `URI` / `URL` — no migration needed; the v2 `Reference-id` URI is
 *   author-provided and can't be derived from the legacy fields.
 * - Test and Element families have no legacy corpus (they're new), so no
 *   migration path is needed for them.
 *
 * The migration strips the `TYPE_` prefix and emits `Spec-id: <bare-ULID>`.
 * The Crockford alphabet is checked; values containing I/L/O/U are flagged
 * (per ADR-002 §Annex B) but still written through, because the validator's
 * MSL-R004 will surface the problem in the next `markspec validate` run.
 */

import type { Diagnostic } from "../model/mod.ts";

/** Match a legacy `Id: TYPE_BODY` attribute line (with optional trailing `\`). */
const LEGACY_ID_LINE_RE = /^(\s*)Id:\s+([A-Z]{2,6})_([0-9A-Z]{26})(\s*\\?)\s*$/;

/** Bare Crockford base32, 26 chars — matches ADR-002 §Annex B. */
const CROCKFORD_BODY_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** Options for {@linkcode migrateLegacyIds}. */
export interface MigrateOptions {
  /** File path used in diagnostic locations. */
  readonly file?: string;
}

/** Result of a migration pass. */
export interface MigrateResult {
  /** The rewritten Markdown. */
  readonly output: string;
  /** Diagnostics (non-Crockford bodies, skipped entries). */
  readonly diagnostics: readonly Diagnostic[];
  /** Number of `Id:` → `Spec-id:` substitutions performed. */
  readonly migrations: number;
  /** Whether the output differs from the input. */
  readonly changed: boolean;
}

/**
 * Rewrite legacy `Id: TYPE_BODY` attributes to `Spec-id: BODY`.
 *
 * Operates line-by-line on the raw markdown so surrounding formatting
 * (indentation, trailing backslash continuation, prose) is preserved
 * exactly. Idempotent: running twice on the same input yields the same
 * output (the second pass is a no-op because no `Id:` lines remain).
 *
 * @param markdown - Source text
 * @param options - File path for diagnostics
 */
export function migrateLegacyIds(
  markdown: string,
  options?: MigrateOptions,
): MigrateResult {
  const file = options?.file ?? "<unknown>";
  const lines = markdown.split("\n");
  const diagnostics: Diagnostic[] = [];
  let migrations = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = LEGACY_ID_LINE_RE.exec(lines[i]);
    if (!match) continue;

    const [, indent, _typePrefix, body, trailing] = match;

    if (!CROCKFORD_BODY_RE.test(body)) {
      diagnostics.push({
        code: "MSL-M001",
        severity: "warning",
        message:
          `Id value '${body}' contains Crockford-invalid characters (I/L/O/U); migrated value will fail MSL-R004`,
        location: { file, line: i + 1, column: 1 },
      });
    }

    lines[i] = `${indent}Spec-id: ${body}${trailing ?? ""}`;
    migrations++;
  }

  const output = lines.join("\n");
  return {
    output,
    diagnostics,
    migrations,
    changed: migrations > 0,
  };
}
