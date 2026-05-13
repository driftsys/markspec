/**
 * @module mcp/tools/validate
 *
 * `validate` MCP tool. Runs the validator pipeline and renders the
 * diagnostics as a Markdown report. Optional `files` argument filters
 * diagnostics to a subset of paths (relative paths resolved against the
 * project root).
 */

import type { Diagnostic } from "../../core/mod.ts";
import { relativeToRoot } from "../path.ts";

/** Filter diagnostics by a list of file paths. */
export function filterDiagnostics(
  diagnostics: readonly Diagnostic[],
  files: readonly string[] | undefined,
  projectRoot: string,
): readonly Diagnostic[] {
  if (!files || files.length === 0) return diagnostics;
  const absolute = new Set<string>();
  for (const f of files) {
    if (f.startsWith("/")) absolute.add(f);
    else absolute.add(`${projectRoot}/${f}`);
  }
  return diagnostics.filter(
    (d) => d.location && absolute.has(d.location.file),
  );
}

/** Render diagnostics as a Markdown report. */
export function renderDiagnosticsReport(
  diagnostics: readonly Diagnostic[],
  profileLabel: string | null,
  entryCount: number,
  projectRoot?: string,
): string {
  if (diagnostics.length === 0) {
    const profilePart = profileLabel ? ` under ${profileLabel}` : "";
    return `✓ All ${entryCount} entries pass validation${profilePart}.\n`;
  }

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const infos = diagnostics.filter((d) => d.severity === "info");

  const summaryParts: string[] = [];
  if (errors.length) {
    summaryParts.push(
      `${errors.length} error${errors.length === 1 ? "" : "s"}`,
    );
  }
  if (warnings.length) {
    summaryParts.push(
      `${warnings.length} warning${warnings.length === 1 ? "" : "s"}`,
    );
  }
  if (infos.length) {
    summaryParts.push(`${infos.length} info`);
  }

  const lines: string[] = [`# Validation: ${summaryParts.join(", ")}`, ""];

  for (
    const [label, list] of [
      ["Errors", errors],
      ["Warnings", warnings],
      ["Info", infos],
    ] as const
  ) {
    if (list.length === 0) continue;
    lines.push(`## ${label}`, "");
    for (const d of list) {
      lines.push(`### ${d.code}`, "");
      const loc = d.location
        ? `${
          relativeToRoot(d.location.file, projectRoot)
        }:${d.location.line}:${d.location.column}`
        : "(no location)";
      lines.push(loc, "");
      // Strip any absolute projectRoot prefix that the core validator may
      // have embedded inside the message (e.g. "also at /abs/path/...").
      const message = projectRoot
        ? d.message.split(projectRoot + "/").join("")
        : d.message;
      lines.push(message, "");
    }
  }

  return lines.join("\n");
}

/** Tool input schema. */
export const VALIDATE_INPUT_SCHEMA = {
  type: "object",
  properties: {
    files: {
      type: "array",
      items: { type: "string" },
    },
  },
  additionalProperties: false,
} as const;

/** Tool descriptor metadata. */
export const VALIDATE_DESCRIPTOR = {
  name: "validate",
  description:
    "Run the project's validation pipeline: broken cross-references, missing or duplicate IDs, malformed entries, and profile rule violations. Returns a Markdown report grouped by severity. " +
    "Use after edits, before committing, or when an entry's relationships look wrong. " +
    "Optional 'files' restricts diagnostics to a subset of paths (relative to the project root). " +
    "An empty 'files' list means all files.",
  inputSchema: VALIDATE_INPUT_SCHEMA,
  annotations: {
    title: "Validate project",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};
