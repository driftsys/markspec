/**
 * @module desk/proposals
 *
 * Preview and apply pipeline for an assistant proposal that rewrites the
 * body of one entry (ADR-035: agents propose, the author accepts).
 *
 * {@linkcode previewBody} checks the proposal, splices it into the file
 * text, runs the `markspec fmt` formatter on the result, and returns the
 * formatted body next to the current (formatted) body. It writes
 * nothing. {@linkcode applyBody} runs the same pipeline and returns the
 * new file text: the original text with only the target body replaced by
 * the formatted proposal. Every other byte of the file stays unchanged.
 *
 * Web APIs only: no `Deno.*`, Node-compatible.
 */

import {
  type Diagnostic,
  type EntryBodyRefusal,
  format,
  type ProseFormatter,
  readEntryBody,
  replaceEntryBody,
} from "../core/mod.ts";

/** Largest accepted proposed body, in characters. */
export const MAX_PROPOSAL_CHARS = 20_000;

/** Why a proposal was refused. */
export type ProposalRefusal =
  | "entry-not-found"
  | "entry-body-empty"
  | "proposal-empty"
  | "proposal-too-large"
  | "proposal-changes-entries"
  | "format-failed";

/** Result of {@linkcode previewBody} and {@linkcode applyBody}. */
export type ProposalOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: ProposalRefusal };

/** A formatted proposed body next to the current formatted body. */
export interface BodyPreview {
  /** The proposed body as `markspec fmt` writes it (dedented, LF). */
  readonly body: string;
  /** The current body as `markspec fmt` writes it (dedented, LF). */
  readonly currentBody: string;
}

/** Refusal-only outcome, typed for any value. */
function refuse<T>(refusal: ProposalRefusal): ProposalOutcome<T> {
  return { ok: false, refusal };
}

/** Map a core entry-body refusal to the proposal refusal it means. */
function fromEditRefusal(refusal: EntryBodyRefusal): ProposalRefusal {
  switch (refusal) {
    case "entries-changed":
      return "proposal-changes-entries";
    case "body-empty":
      return "entry-body-empty";
    default:
      return refusal;
  }
}

/**
 * Whether `diagnostics` holds an `MSL-F900` for the entry `displayId`:
 * the formatter kept that body unchanged because it did not survive
 * canonicalization. The message starts with `<displayId>:`, so an ID
 * that only shares a prefix (`SYS_BRK_00011`) does not match.
 *
 * @internal Exported for tests. No known input makes the formatter emit
 *   `MSL-F900`, so this helper is the only tested part of that refusal.
 */
export function isTargetF900(
  diagnostics: readonly Diagnostic[],
  displayId: string,
): boolean {
  return diagnostics.some((d) =>
    d.code === "MSL-F900" && d.message.startsWith(`${displayId}:`)
  );
}

/**
 * Format `text` with the `markspec fmt` code path. Returns `undefined`
 * when the formatter throws, and the diagnostics otherwise. `MSL-F012`
 * (prose pass kept a segment as written) is not a failure.
 */
function formatText(
  text: string,
  file: string,
  formatProse: ProseFormatter,
): { output: string; diagnostics: readonly Diagnostic[] } | undefined {
  try {
    const result = format(text, { file, formatMarkdownProse: formatProse });
    return { output: result.output, diagnostics: result.diagnostics };
  } catch {
    return undefined;
  }
}

/** A checked proposal: the preview plus the file text it produces. */
interface CheckedProposal {
  readonly preview: BodyPreview;
  readonly text: string;
}

/**
 * The shared preview and apply pipeline. Refuses with `format-failed`
 * when the formatter throws on either text, or when it keeps the
 * candidate's target body unchanged (`MSL-F900`). An `MSL-F900` on the
 * current text is not a refusal: the formatter keeps the body as
 * written, and that is the `currentBody` the author sees. The formatted
 * body goes through the entry-identity check again, so a preview the
 * author sees always splices at Accept.
 */
async function checkProposal(
  text: string,
  file: string,
  displayId: string,
  proposed: string,
  formatProse: ProseFormatter,
): Promise<ProposalOutcome<CheckedProposal>> {
  if (proposed.length > MAX_PROPOSAL_CHARS) {
    return refuse("proposal-too-large");
  }
  const current = await readEntryBody(text, file, displayId);
  if (current === undefined) return refuse("entry-not-found");
  if (current === "") return refuse("entry-body-empty");

  const edit = await replaceEntryBody(text, file, displayId, proposed);
  if (!edit.ok) return refuse(fromEditRefusal(edit.refusal));

  const formattedCandidate = formatText(edit.text, file, formatProse);
  const formattedCurrent = formatText(text, file, formatProse);
  if (
    formattedCandidate === undefined || formattedCurrent === undefined ||
    isTargetF900(formattedCandidate.diagnostics, displayId)
  ) {
    return refuse("format-failed");
  }
  const body = await readEntryBody(formattedCandidate.output, file, displayId);
  const currentBody = await readEntryBody(
    formattedCurrent.output,
    file,
    displayId,
  );
  if (body === undefined || currentBody === undefined) {
    return refuse("format-failed");
  }
  const spliced = await replaceEntryBody(text, file, displayId, body);
  if (!spliced.ok) return refuse(fromEditRefusal(spliced.refusal));
  return {
    ok: true,
    value: { preview: { body, currentBody }, text: spliced.text },
  };
}

/**
 * Preview a proposed body for the entry `displayId` in `text`. Writes
 * nothing.
 *
 * @param text - Current file text.
 * @param file - Absolute path of the `.md` file; it gates the prose pass.
 * @param displayId - Display ID of the target entry.
 * @param proposed - Proposed body, as the assistant returned it.
 * @param formatProse - The Markdown prose formatter (`loadMarkdownFormatter()`).
 */
export async function previewBody(
  text: string,
  file: string,
  displayId: string,
  proposed: string,
  formatProse: ProseFormatter,
): Promise<ProposalOutcome<BodyPreview>> {
  const checked = await checkProposal(
    text,
    file,
    displayId,
    proposed,
    formatProse,
  );
  if (!checked.ok) return checked;
  return { ok: true, value: checked.value.preview };
}

/**
 * Build the new file text for an accepted proposal: `text` with only the
 * target body replaced by the formatted proposed body. Runs the whole
 * {@linkcode previewBody} pipeline first, so a body from a preview
 * splices unchanged (formatting is idempotent). Writes nothing; the
 * caller writes the returned text.
 */
export async function applyBody(
  text: string,
  file: string,
  displayId: string,
  proposed: string,
  formatProse: ProseFormatter,
): Promise<ProposalOutcome<string>> {
  const checked = await checkProposal(
    text,
    file,
    displayId,
    proposed,
    formatProse,
  );
  if (!checked.ok) return checked;
  return { ok: true, value: checked.value.text };
}
