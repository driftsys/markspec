/**
 * @module mcp/tools/profile_describe
 *
 * `profile_describe` tool — look up a profile element by kind + name
 * with fuzzy fallback and disambiguation output.
 */
import type {
  ProfileElementKind,
  ProfileIntrospection,
} from "../../core/mod.ts";
import { renderProfileDetail } from "../resources/profile.ts";

/** Map CLI-friendly kind names to ProfileElementKind (label → label-concern). */
const URI_KIND_TO_ELEMENT_KIND: Record<string, ProfileElementKind> = {
  type: "type",
  attribute: "attribute",
  relation: "relation",
  label: "label-concern",
  convention: "convention",
};

/** Tool descriptor metadata for the `profile_describe` MCP tool. */
export const PROFILE_DESCRIBE_DESCRIPTOR = {
  name: "profile_describe",
  description:
    "Fetch the full description of a profile element (type, attribute, relation, label concern, or convention). " +
    "Supply a `name` and optionally a `kind` to narrow the search. " +
    "Fuzzy matching is used when no exact match is found — the response lists candidates if more than one matches.",
  inputSchema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: ["type", "attribute", "relation", "label", "convention"],
        description:
          "Element kind to restrict the search to. Omit to search across all kinds.",
      },
      name: {
        type: "string",
        description:
          "Element name or partial name (fuzzy match if no exact hit).",
      },
    },
    required: ["name"],
  },
  annotations: {
    title: "Describe profile element",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
} as const;

/**
 * Dispatch the `profile_describe` tool call.
 *
 * Resolution order:
 * 1. If `kind` is provided: try `intro.describe(kind, name)` for an exact match.
 * 2. Fall back to `intro.resolve(name)`, optionally filtered by `kind`.
 * 3. Single candidate → return full detail via `renderProfileDetail`.
 * 4. Multiple candidates → return disambiguation list.
 * 5. No candidates → return "no profile element found for '<name>'" message.
 */
export function dispatchProfileDescribe(
  intro: ProfileIntrospection,
  // deno-lint-ignore no-explicit-any
  args: any,
): string {
  const name = String(args?.name ?? "").trim();
  const rawKind = args?.kind != null ? String(args.kind) : undefined;
  const elementKind = rawKind != null
    ? (URI_KIND_TO_ELEMENT_KIND[rawKind] ?? rawKind as ProfileElementKind)
    : undefined;

  // Step 1: exact match when kind is provided.
  if (elementKind !== undefined) {
    const detail = intro.describe(elementKind, name);
    if (detail) return renderProfileDetail(detail);
  }

  // Step 2: fuzzy resolve, then filter by kind if specified.
  let candidates = intro.resolve(name);
  if (elementKind !== undefined) {
    candidates = candidates.filter((c) => c.kind === elementKind);
  }

  // Step 3: single candidate.
  if (candidates.length === 1) {
    const detail = intro.describe(candidates[0].kind, candidates[0].name);
    if (detail) return renderProfileDetail(detail);
  }

  // Step 4: disambiguation.
  if (candidates.length > 1) {
    const lines = [
      `Multiple profile elements match '${name}':`,
      "",
    ];
    for (const c of candidates) {
      lines.push(`- **${c.kind}** · ${c.name} — ${c.summary}`);
    }
    lines.push("", "Provide a `kind` to narrow the search.");
    return lines.join("\n") + "\n";
  }

  // Step 5: no match.
  return `no profile element found for '${name}'\n`;
}
