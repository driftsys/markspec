/**
 * Word-level diff between the current and the proposed entry body.
 * Tokens are words and whitespace runs (split by `/(\s+)/`), so joining
 * the parts of one side gives that side back exactly. The diff is a plain
 * longest-common-subsequence over tokens; it has no dependency.
 */

/** One run of tokens that is unchanged, only in the current text
 *  (`removed`), or only in the proposed text (`added`). */
export interface DiffPart {
  readonly kind: "same" | "removed" | "added";
  readonly text: string;
}

/** Above this many token-pair cells the LCS table is not built and the
 *  diff falls back to one removed part and one added part. */
const MAX_CELLS = 1_000_000;

function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token !== "");
}

function push(parts: DiffPart[], kind: DiffPart["kind"], text: string): void {
  if (text === "") return;
  const last = parts[parts.length - 1];
  if (last && last.kind === kind) {
    parts[parts.length - 1] = { kind, text: last.text + text };
  } else {
    parts.push({ kind, text });
  }
}

/**
 * Diff `before` against `after` by word. Adjacent parts of the same kind
 * are merged. At a change, the removed part comes before the added part.
 * The `same` and `removed` parts join to `before`; the `same` and `added`
 * parts join to `after`.
 */
export function diffWords(before: string, after: string): DiffPart[] {
  const parts: DiffPart[] = [];
  if (before === after) {
    push(parts, "same", before);
    return parts;
  }
  const a = tokenize(before);
  const b = tokenize(after);
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    push(parts, "removed", before);
    push(parts, "added", after);
    return parts;
  }
  // lcs[i * width + j] is the LCS length of a[i..] and b[j..].
  const width = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] = a[i] === b[j]
        ? lcs[(i + 1) * width + j + 1] + 1
        : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(parts, "same", a[i]);
      i++;
      j++;
    } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
      push(parts, "removed", a[i]);
      i++;
    } else {
      push(parts, "added", b[j]);
      j++;
    }
  }
  for (; i < a.length; i++) push(parts, "removed", a[i]);
  for (; j < b.length; j++) push(parts, "added", b[j]);
  return parts;
}
