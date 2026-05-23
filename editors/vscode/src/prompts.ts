/**
 * Prompt assembly for the MarkSpec inline AI completion provider.
 *
 * `SYSTEM_PROMPT` is a static description of the MarkSpec entry format,
 * the EARS / Gherkin patterns we expect in requirement bodies, and the
 * editing conventions the completion should respect.
 *
 * `buildUserPrompt(ctx)` shapes the user prompt to the cursor context:
 * what the model sees on each call depends on whether we're completing
 * an entry title, body prose, a trace attribute value, or generic
 * markdown prose.
 *
 * This module is pure — no `vscode` imports, no I/O. The seam between
 * the provider and the language model lives here so unit tests can pin
 * the prompt shape with snapshot-style assertions.
 */

import type { InlineContext } from "./inlineCompletions";

/** A workspace entry pointer used for trace-attribute candidate lists. */
export interface EntryRef {
  readonly displayId: string;
  readonly title: string;
}

/** Full prompt context — what `buildUserPrompt` consumes. */
export interface PromptContext {
  readonly cursorContext: InlineContext;
  readonly localWindow: string;
  readonly currentFileEntries: readonly EntryRef[];
  readonly workspaceEntries: readonly EntryRef[];
}

/** Static system prompt sent on every request. */
export const SYSTEM_PROMPT =
  `You are an AI assistant embedded in a MarkSpec editor.

MarkSpec is a Markdown flavor for traceable requirements. A typical entry block looks like:

  - [STK_AEB_0001] Sensor debouncing

    The sensor driver shall debounce raw inputs within 20 ms.

        Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
        Satisfies: SYS_AEB_0001
        Labels: ASIL-B

Authoring conventions:
- One requirement per entry block. Single responsibility. Active voice.
- Bodies must be measurable: include units, thresholds, tolerances. Avoid "fast" / "reliable" / "user-friendly".
- Use EARS patterns when possible: ubiquitous, event-driven, state-driven, optional, unwanted.
- Use Gherkin (Given/When/Then) inside fenced \`gherkin\` blocks when scenarios are clearer than EARS.
- Trace attributes (Satisfies, Derived-from, Verified-by, etc.) reference other entries by their display ID.

Inline completion guidance:
- When suggesting a title, produce a short noun phrase (≤8 words). No trailing period.
- When suggesting body prose, use one sentence in active voice with a measurable predicate.
- When suggesting a trace-attribute value, return only display IDs that appear in the supplied workspace context, never invent new ones.
- Suggest only the text to insert. Do not echo the surrounding document.
`;

/** Build the user prompt for the current cursor context. */
export function buildUserPrompt(ctx: PromptContext): string {
  const sections: string[] = [];

  switch (ctx.cursorContext.kind) {
    case "title-after-bracket": {
      sections.push(
        `# Task\nSuggest a short title for the entry whose display ID is ${ctx.cursorContext.displayId}.`,
      );
      sections.push(`# Surrounding markdown\n${ctx.localWindow}`);
      break;
    }
    case "entry-body": {
      sections.push(
        `# Task\nContinue the body of entry "${ctx.cursorContext.entryTitle}" with one measurable, active-voice sentence following an EARS pattern.`,
      );
      sections.push(`# Surrounding markdown\n${ctx.localWindow}`);
      if (ctx.currentFileEntries.length > 0) {
        sections.push(
          `# Other entries in this file\n${
            formatEntryList(ctx.currentFileEntries)
          }`,
        );
      }
      break;
    }
    case "trace-attribute": {
      sections.push(
        `# Task\nSuggest the display ID(s) that should appear after \`${ctx.cursorContext.attribute}:\` for the entry titled "${ctx.cursorContext.entryTitle}".`,
      );
      sections.push(`# Surrounding markdown\n${ctx.localWindow}`);
      if (ctx.workspaceEntries.length > 0) {
        sections.push(
          `# Candidate workspace entries\n${
            formatEntryList(ctx.workspaceEntries)
          }`,
        );
      }
      break;
    }
    case "doc-prose": {
      sections.push(`# Task\nContinue the prose at the cursor.`);
      sections.push(`# Surrounding markdown\n${ctx.localWindow}`);
      break;
    }
    case "skip":
      sections.push(`# Task\nNo completion.`);
      break;
  }

  return sections.join("\n\n");
}

function formatEntryList(entries: readonly EntryRef[]): string {
  return entries.map((e) => `- ${e.displayId} — ${e.title}`).join("\n");
}
