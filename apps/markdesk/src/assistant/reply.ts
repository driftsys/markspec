/**
 * Clean-up of an assistant reply before it becomes a proposed entry body.
 * Assistants often wrap their answer in one fenced code block even when
 * told not to; that one fence is removed so the body is the text inside.
 */

/** An opening fence line: three or more backticks or tildes, then an
 *  optional info string. */
const OPENER_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Inner text when the whole trimmed reply is one fenced block (``` or ~~~,
 * optional info string, matching closer, no other closer inside); else the
 * trimmed reply.
 *
 * A matching closer uses the same fence character and is at least as long
 * as the opener. A backtick opener whose info string contains a backtick is
 * not a fence (CommonMark), so the reply is kept as it is.
 */
export function stripOneFence(reply: string): string {
  const trimmed = reply.trim();
  const lines = trimmed.split(/\r\n|\r|\n/);
  if (lines.length < 2) return trimmed;
  const opener = OPENER_RE.exec(lines[0]);
  if (!opener) return trimmed;
  const fence = opener[1];
  if (fence[0] === "`" && opener[2].includes("`")) return trimmed;
  const isCloser = (line: string): boolean => {
    const match = /^ {0,3}(`+|~+)\s*$/.exec(line);
    return match !== null && match[1][0] === fence[0] &&
      match[1].length >= fence.length;
  };
  if (!isCloser(lines[lines.length - 1])) return trimmed;
  const inner = lines.slice(1, -1);
  if (inner.some(isCloser)) return trimmed;
  return inner.join("\n").trim();
}
