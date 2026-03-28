/**
 * @module parser/directives
 *
 * Extracts MarkSpec directives from HTML comments in Markdown files.
 *
 * Directives use the form `<!-- markspec:<name> <payload> -->` and allow
 * documents to carry processing hints such as output mode, deprecation
 * notices, or slide layout declarations.
 */

import type { Directive, SourceLocation } from "../model/mod.ts";
import { processor } from "./remark.ts";

/** Options for {@linkcode detectDirectives}. */
export interface DetectDirectivesOptions {
  /** File path used in source locations. */
  readonly file?: string;
}

/** Matches the opening and closing of an HTML comment. */
const COMMENT_RE = /^<!--([\s\S]*?)-->$/;

/** Matches a `markspec:` directive line within a comment body. */
const DIRECTIVE_RE = /^markspec:(\S+)\s?(.*)?$/;

/**
 * Detect MarkSpec directives in a Markdown string.
 *
 * Walks the mdast AST looking for `html` nodes that are HTML comments.
 * Inside each comment, lines starting with `markspec:` are parsed as
 * directives. Continuation lines (not starting with `markspec:`) are
 * appended to the preceding directive's payload.
 *
 * @param markdown - Markdown source text
 * @param options - Detection options (file path for source locations)
 * @returns Array of detected directives
 */
export function detectDirectives(
  markdown: string,
  options?: DetectDirectivesOptions,
): Directive[] {
  const file = options?.file ?? "<unknown>";
  const tree = processor.parse(markdown);
  const directives: Directive[] = [];

  for (const node of tree.children) {
    if (node.type !== "html") continue;

    const html = node as {
      type: string;
      value: string;
      position?: { start: { line: number; column: number } };
    };
    const commentMatch = COMMENT_RE.exec(html.value.trim());
    if (!commentMatch) continue;

    const commentBody = commentMatch[1];
    const commentLines = commentBody.split("\n");

    // The node's starting line in the source file.
    const nodeStartLine = html.position?.start.line ?? 1;
    const nodeStartColumn = html.position?.start.column ?? 1;

    // Track the line offset within the comment for each content line.
    // The first line of the comment body is on the same line as `<!--`.
    let currentDirective: {
      name: string;
      payloadParts: string[];
      location: SourceLocation;
    } | undefined;

    for (let i = 0; i < commentLines.length; i++) {
      const line = commentLines[i].trim();
      if (line === "") {
        // Empty lines are ignored; they do NOT continue a payload.
        continue;
      }

      const directiveMatch = DIRECTIVE_RE.exec(line);
      if (directiveMatch) {
        // Flush any in-progress directive.
        if (currentDirective) {
          directives.push(finalizeDirective(currentDirective));
        }

        const location: SourceLocation = {
          file,
          line: nodeStartLine + i,
          column: nodeStartColumn,
        };

        currentDirective = {
          name: directiveMatch[1],
          payloadParts: directiveMatch[2] ? [directiveMatch[2]] : [],
          location,
        };
      } else if (currentDirective) {
        // Continuation line for the current directive's payload.
        currentDirective.payloadParts.push(line);
      }
    }

    // Flush final directive from this comment.
    if (currentDirective) {
      directives.push(finalizeDirective(currentDirective));
    }
  }

  return directives;
}

/** Assemble a Directive from accumulated parts. */
function finalizeDirective(
  pending: { name: string; payloadParts: string[]; location: SourceLocation },
): Directive {
  return {
    name: pending.name,
    payload: pending.payloadParts.join("\n").trim(),
    location: pending.location,
  };
}
