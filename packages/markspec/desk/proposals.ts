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
 * Known limit: a proposal that holds a link reference definition
 * (`[s]: https://...`) or a footnote definition (`[^1]: ...`) is refused
 * with `proposal-changes-entries`. The body-equality check in
 * `replaceEntryBody` compares text, and the parser does not keep those
 * definitions in the entry body, so the bodies differ.
 *
 * Web APIs only: no `Deno.*`, Node-compatible.
 */

import {
  type Diagnostic,
  type EntryBodyRefusal,
  format,
  parseFile,
  type ProseFormatter,
  readEntryBody,
  replaceEntryBody,
} from "../core/mod.ts";

/**
 * Largest accepted proposed body, in UTF-16 code units, as JavaScript
 * `String.length` counts them. A character outside the Basic Multilingual
 * Plane (for example an emoji) counts as two. Any other layer that enforces
 * the same limit counts the same unit (Rust: `encode_utf16().count()`).
 */
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
 *   `MSL-F900`; tests reach that refusal through a stand-in formatter.
 */
export function isTargetF900(
  diagnostics: readonly Diagnostic[],
  displayId: string,
): boolean {
  return diagnostics.some((d) =>
    d.code === "MSL-F900" && d.message.startsWith(`${displayId}:`)
  );
}

/** Parse codes that mean an entry's trailer block did not parse. */
const TRAILER_PARSE_CODES: ReadonlySet<string> = new Set([
  "MSL-P020",
  "MSL-P021",
  "MSL-P022",
]);

/**
 * Whether the trailer block of the entry `displayId` in `text` failed to
 * parse. When a trailer line is malformed (for example an empty
 * `Satisfies:`, a key without a colon, or a lowercase key), the parser
 * reads the whole trailer block, the `Id:` line included, as part of the
 * body. A body splice would then delete the `Id:` and trailer lines, and
 * the identity check cannot see it, because the entry has no `id` and no
 * attributes before or after the edit. The parser names the entry at the
 * start of each of these diagnostics (`<displayId>: ...`).
 *
 * The check is broader than that case. `MSL-P020` also fires when the
 * trailer parsed but a body paragraph starts with a recognized trailer
 * key (for example `References: ISO 26262 part 6.` followed by more
 * prose), so such an entry is refused too, although a splice would be
 * safe. The file already fails `markspec check` there (P020 is an
 * error), so the author must fix it first.
 *
 * The check relies on parser diagnostics. An entry with no `Id:` whose
 * trailer-looking lines use only unrecognized keys, and that the parser
 * reads as body without a diagnostic, is edited as the parser sees it:
 * those lines are part of the current body, appear in `currentBody`, and
 * a proposal that omits them removes them.
 */
async function hasUnparsedTrailer(
  text: string,
  file: string,
  displayId: string,
): Promise<boolean> {
  const { diagnostics } = await parseFile(text, { file });
  return diagnostics.some((d) =>
    TRAILER_PARSE_CODES.has(d.code) && d.message.startsWith(`${displayId}:`)
  );
}

/**
 * The whole-document formatter the pipeline runs: {@linkcode format}, or a
 * stand-in a test passes to reach the defensive refusals.
 *
 * @internal Exported for tests.
 */
export type DocumentFormatter = (
  text: string,
  options: {
    readonly file: string;
    readonly formatMarkdownProse: ProseFormatter;
  },
) => { readonly output: string; readonly diagnostics: readonly Diagnostic[] };

/**
 * Format `text` with the `markspec fmt` code path. Returns `undefined`
 * when the formatter throws, and the diagnostics otherwise. `MSL-F012`
 * (prose pass kept a segment as written) is not a failure.
 */
function formatText(
  text: string,
  file: string,
  formatProse: ProseFormatter,
  formatDocument: DocumentFormatter,
): { output: string; diagnostics: readonly Diagnostic[] } | undefined {
  try {
    const result = formatDocument(text, {
      file,
      formatMarkdownProse: formatProse,
    });
    return { output: result.output, diagnostics: result.diagnostics };
  } catch {
    return undefined;
  }
}

/** The words of `body`, split on whitespace, joined by one space. */
function words(body: string): string {
  return body.split(/\s+/).filter((w) => w !== "").join(" ");
}

/** A checked proposal: the formatted bodies plus the file text it produces. */
interface CheckedProposal {
  readonly body: string;
  /** Set only when the caller asked for the current body. */
  readonly currentBody: string | undefined;
  readonly text: string;
}

/**
 * The shared preview and apply pipeline. Refuses with
 * `proposal-changes-entries` when the target entry's trailer block did
 * not parse (see {@linkcode hasUnparsedTrailer}). Refuses with
 * `format-failed` when the formatter throws on a text it formats, or when
 * it keeps the candidate's target body unchanged (`MSL-F900`). An
 * `MSL-F900` on the current text is not a refusal: the formatter keeps
 * the body as written, and that is the `currentBody` the author sees.
 * The formatted body goes through the entry-identity check again, so a
 * preview the author sees always splices at Accept.
 *
 * The current text is formatted only when `withCurrent` is true (the
 * preview shows `currentBody`; apply does not need it), so an apply runs
 * the whole-document formatter once.
 *
 * `currentBody` is the target body read from the formatted current text
 * only when it holds the same words as the raw body, which is the body
 * apply replaces. Otherwise (the formatter moved lines out of the body,
 * as it can do with a lazy continuation line) `currentBody` is the raw
 * body, so the author sees every line that Accept removes.
 *
 * The `format-failed` branches and the final identity check are
 * defensive: `format` catches a prose formatter that throws (MSL-F012),
 * no known input makes it emit `MSL-F900`, and no known formatter output
 * fails the second splice. Tests reach them through `formatDocument`.
 */
async function checkProposal(
  text: string,
  file: string,
  displayId: string,
  proposed: string,
  formatProse: ProseFormatter,
  withCurrent: boolean,
  formatDocument: DocumentFormatter,
): Promise<ProposalOutcome<CheckedProposal>> {
  if (proposed.length > MAX_PROPOSAL_CHARS) {
    return refuse("proposal-too-large");
  }
  const current = await readEntryBody(text, file, displayId);
  if (current === undefined) return refuse("entry-not-found");
  if (current === "") return refuse("entry-body-empty");
  if (await hasUnparsedTrailer(text, file, displayId)) {
    return refuse("proposal-changes-entries");
  }

  const edit = await replaceEntryBody(text, file, displayId, proposed);
  if (!edit.ok) return refuse(fromEditRefusal(edit.refusal));

  const formattedCandidate = formatText(
    edit.text,
    file,
    formatProse,
    formatDocument,
  );
  if (
    formattedCandidate === undefined ||
    isTargetF900(formattedCandidate.diagnostics, displayId)
  ) {
    return refuse("format-failed");
  }
  const body = await readEntryBody(formattedCandidate.output, file, displayId);
  if (body === undefined) return refuse("format-failed");

  let currentBody: string | undefined;
  if (withCurrent) {
    const formattedCurrent = formatText(
      text,
      file,
      formatProse,
      formatDocument,
    );
    if (formattedCurrent === undefined) return refuse("format-failed");
    const formattedBody = await readEntryBody(
      formattedCurrent.output,
      file,
      displayId,
    );
    if (formattedBody === undefined) return refuse("format-failed");
    currentBody = words(formattedBody) === words(current)
      ? formattedBody
      : current;
  }

  const spliced = await replaceEntryBody(text, file, displayId, body);
  if (!spliced.ok) return refuse(fromEditRefusal(spliced.refusal));
  return { ok: true, value: { body, currentBody, text: spliced.text } };
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
 * @param formatDocument - Test seam (internal); defaults to {@linkcode format}.
 */
export async function previewBody(
  text: string,
  file: string,
  displayId: string,
  proposed: string,
  formatProse: ProseFormatter,
  formatDocument: DocumentFormatter = format,
): Promise<ProposalOutcome<BodyPreview>> {
  const checked = await checkProposal(
    text,
    file,
    displayId,
    proposed,
    formatProse,
    true,
    formatDocument,
  );
  if (!checked.ok) return checked;
  const { body, currentBody } = checked.value;
  if (currentBody === undefined) return refuse("format-failed");
  return { ok: true, value: { body, currentBody } };
}

/**
 * Build the new file text for an accepted proposal: `text` with only the
 * target body replaced by the formatted proposed body. Runs every check
 * of {@linkcode previewBody} (it skips only formatting the current body,
 * which the preview shows and a write does not need), so a body from a
 * preview splices unchanged (formatting is idempotent). Writes nothing;
 * the caller writes the returned text. `formatDocument` is the same test
 * seam as in {@linkcode previewBody}.
 */
export async function applyBody(
  text: string,
  file: string,
  displayId: string,
  proposed: string,
  formatProse: ProseFormatter,
  formatDocument: DocumentFormatter = format,
): Promise<ProposalOutcome<string>> {
  const checked = await checkProposal(
    text,
    file,
    displayId,
    proposed,
    formatProse,
    false,
    formatDocument,
  );
  if (!checked.ok) return checked;
  return { ok: true, value: checked.value.text };
}
