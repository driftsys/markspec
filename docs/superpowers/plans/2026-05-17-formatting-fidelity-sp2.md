# SP2 — The Faithful Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `buildBodyAst` capture the §5.1 inline prose it currently
flattens away (emphasis, strong, links, autolinks, hard line breaks,
reference-style links + definitions) and preserve §2.4.1-excluded constructs
verbatim, so the SP1 fidelity matrix surface drops to its documented residual.

**Architecture:** One root cause — `extractMdastText` flattens the mdast inline
tree. Fix: store the **verbatim source-offset slice** for every prose-bearing
node (the mechanism `TableNode.raw` already uses), while keeping marker
recognition on the **flattened** projection (decoupled, so `\bshall\b` still
matches inside `_shall_`). `render` already emits stored text verbatim, so it
needs minimal change. The `emitBodyViaAst` formatter guard and
`ast_equivalence_test.ts` are not weakened — they strengthen as more constructs
round-trip.

**Tech Stack:** Deno/TypeScript, mdast/remark (`remark-parse` + `remark-gfm`),
`@std/assert`, `just`, dprint.

**Spec:** `docs/superpowers/specs/2026-05-17-formatting-fidelity-sp2-design.md`.

**Working conventions (from project memory + the spec):** Work stays in the
existing worktree (`worktree-formatting-fidelity-sp2`, already bootstrapped,
baseline `just check` already verified clean). WIP-commit each task with
`git commit --no-verify -m "wip(...)"`; **Task 10** squashes to ONE Conventional
Commit onto `$(git merge-base origin/main HEAD)`. If any step uncovers a genuine
design fork or a validator conflict the spec did not anticipate, **STOP and
surface to the owner** — do not weaken a test or the equivalence gate to make
something pass.

---

## File Structure

| File                                              | Responsibility                                                                                                             | Change       |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------ |
| `packages/markspec/core/ast/build.ts`             | mdast → `BodyBlock[]`. Hosts the new `verbatimSlice` helper, the decoupled `inlineContent`, and per-node verbatim capture. | Heavy modify |
| `packages/markspec/core/ast/nodes.ts`             | Node taxonomy. Add `ListItemNode.checked?`; document the new `InlineContent.text` / `Unknown.raw` field contract.          | Light modify |
| `packages/markspec/core/ast/render.ts`            | `BodyBlock[]` → string. Re-emit task-list checkbox.                                                                        | Light modify |
| `packages/markspec/core/ast/build_test.ts`        | Colocated TDD unit tests for the builder.                                                                                  | Add tests    |
| `packages/markspec/core/ast/render_test.ts`       | Colocated TDD unit tests for the renderer.                                                                                 | Add tests    |
| `packages/markspec/core/validator/*_test.ts`      | Validator regression — B040–B044/C072/M060 behaviour pinned unchanged.                                                     | Add tests    |
| `tests/e2e/ast_equivalence_test.ts`               | Byte-identical build/render gate. Add inline-markup edge cases (strengthen).                                               | Add cases    |
| `tests/e2e/ast_fidelity.ts`                       | SP1 corpus. Append inline-markup-inside-{note,bq,list,table,deflist} + link-ref-definition.                                | Add corpus   |
| `tests/e2e/ast_fidelity_test.ts`                  | SP1 unit tests. Flip the emphasis tripwire.                                                                                | Modify test  |
| `docs/product/ast-fidelity-matrix.md`             | Generated catalogue. Regenerate via `just ast-fidelity-matrix`.                                                            | Regenerate   |
| `docs/architecture/adr-014-canonical-body-ast.md` | Record that the inverse is materially widened (one note; do not rewrite the decision).                                     | One-line add |

---

## Task 1: Extract the `verbatimSlice` helper (behaviour-preserving refactor)

`TableNode` already slices verbatim source with list-indent normalisation
inline. Extract it so every prose-bearing node reuses one tested function.
Behaviour is unchanged — the equivalence gate proves it.

**Files:**

- Modify: `packages/markspec/core/ast/build.ts` (add helper; rewire
  `case "table"`)
- Test: `packages/markspec/core/ast/build_test.ts`

- [ ] **Step 1: Write the failing test**

Add to the end of `packages/markspec/core/ast/build_test.ts`:

```typescript
import { verbatimSlice } from "./build.ts";

Deno.test("verbatimSlice: top-level node returns exact source slice", () => {
  const body = "alpha _beta_ gamma";
  const pos = {
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: 19, offset: 18 },
  };
  assertEquals(verbatimSlice(body, pos), "alpha _beta_ gamma");
});

Deno.test("verbatimSlice: nested node strips list-continuation indent", () => {
  // Two-line slice whose continuation line carries a 2-space list indent.
  const body = "- x\n\n  line a\n  line b";
  const pos = {
    start: { line: 3, column: 3, offset: 6 },
    end: { line: 4, column: 9, offset: 22 },
  };
  // start.column 3 → strip 2 leading spaces from every line after the first.
  assertEquals(verbatimSlice(body, pos), "line a\nline b");
});

Deno.test("verbatimSlice: undefined position → empty string", () => {
  assertEquals(verbatimSlice("anything", undefined), "");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:
`deno test packages/markspec/core/ast/build_test.ts --filter "verbatimSlice"`
Expected: FAIL — `verbatimSlice` is not exported / not defined.

- [ ] **Step 3: Add the helper and rewire the table case**

In `packages/markspec/core/ast/build.ts`, add this function immediately after
`positionToRange` (before the "Caption detection" section):

```typescript
/**
 * Return the exact source substring for an mdast node `position`, with
 * list-continuation indentation normalised to column 0 so the slice is a
 * self-contained, column-0-anchored string. This is the load-bearing
 * mechanism for §5.1 faithful capture (spec
 * `docs/superpowers/specs/2026-05-17-formatting-fidelity-sp2-design.md` §3):
 * remark populates byte `offset` when a string is passed to `.parse()`;
 * a line/column reconstruction is the defensive fallback. Extracted from
 * the original inline `TableNode` logic — behaviour is identical.
 */
export function verbatimSlice(
  body: string,
  pos: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  } | undefined,
): string {
  if (!pos) return "";
  let raw: string;
  if (pos.start.offset !== undefined && pos.end.offset !== undefined) {
    raw = body.slice(pos.start.offset, pos.end.offset);
  } else {
    const bodyLines = body.split("\n");
    const startLine = pos.start.line - 1;
    const endLine = pos.end.line - 1;
    const startCol = pos.start.column - 1;
    const endCol = pos.end.column - 1;
    if (startLine === endLine) {
      raw = bodyLines[startLine]?.slice(startCol, endCol) ?? "";
    } else {
      const firstPart = bodyLines[startLine]?.slice(startCol) ?? "";
      const middleParts = bodyLines.slice(startLine + 1, endLine);
      const lastPart = bodyLines[endLine]?.slice(0, endCol) ?? "";
      raw = [firstPart, ...middleParts, lastPart].join("\n");
    }
  }
  const listIndent = pos.start.column - 1; // 0 for top-level nodes
  if (listIndent > 0) {
    const prefix = " ".repeat(listIndent);
    const rawLines = raw.split("\n");
    raw = [
      rawLines[0],
      ...rawLines.slice(1).map((line) =>
        line.startsWith(prefix) ? line.slice(listIndent) : line
      ),
    ].join("\n");
  }
  return raw;
}
```

Then in `case "table":`, replace the entire `let raw: string; … }` block (from
`// Extract verbatim source substring` through the final `else { raw = ""; }`)
with a single line so the case body becomes:

```typescript
case "table": {
  // deno-lint-ignore no-explicit-any
  const rows: (readonly InlineContent[])[] = node.children.map((row: any) =>
    // deno-lint-ignore no-explicit-any
    (row.children ?? []).map((cell: any) => {
      const cellText = extractMdastText(cell);
      const cellRange = positionToRange(cell.position);
      return inlineContent(cellText, cellText, cellRange);
    })
  );
  const [header = [], ...dataRows] = rows;
  const raw = verbatimSlice(body, node.position);
  return {
    kind: "table",
    header,
    rows: dataRows,
    raw,
    range,
  } satisfies TableNode;
}
```

> Note: `inlineContent(cellText, cellText, cellRange)` uses the three-argument
> signature introduced in Task 2. Until Task 2 lands, keep the existing
> two-argument `inlineContent(cellText, cellRange)` call here and switch it in
> Task 2. (If executing strictly in order, write the two-argument form now.)

- [ ] **Step 4: Run the test to verify it passes**

Run:
`deno test packages/markspec/core/ast/build_test.ts --filter "verbatimSlice"`
Expected: PASS (3 steps).

- [ ] **Step 5: Prove table behaviour is unchanged**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/ast_equivalence_test.ts packages/markspec/core/ast/`
Expected: PASS — every existing table/render/build test green (refactor is
behaviour-preserving).

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/core/ast/build.ts packages/markspec/core/ast/build_test.ts
git commit --no-verify -m "wip(core): extract verbatimSlice helper from TableNode"
```

---

## Task 2: Faithful Paragraph + decoupled marker recognition

Switch `inlineContent` to a stored-text / recognition-text split, and store the
verbatim slice for plain paragraphs. Caption / Math / Figure / DefinitionList
detection still runs on the flattened text local.

**Files:**

- Modify: `packages/markspec/core/ast/build.ts` (`inlineContent`, all call
  sites, `case "paragraph"`)
- Test: `packages/markspec/core/ast/build_test.ts`,
  `packages/markspec/core/ast/render_test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/markspec/core/ast/build_test.ts`:

```typescript
import { render } from "./render.ts";

Deno.test("build: paragraph preserves inline emphasis verbatim", () => {
  const s = "The driver _shall_ debounce inputs.";
  const blocks = buildBodyAst(s);
  const p = blocks[0] as ParagraphNode;
  assertEquals(p.kind, "paragraph");
  assertEquals(p.content.text, s); // verbatim — markup NOT flattened
  assertEquals(render(blocks), s); // round-trips byte-identically
});

Deno.test("build: emphasised modal keyword is still recognised (decoupled)", () => {
  const blocks = buildBodyAst("The driver _shall_ debounce inputs.");
  const p = blocks[0] as ParagraphNode;
  const modal = p.content.markers.find((m) => m.kind === "modal");
  assertExists(modal); // recognition runs on the FLATTENED projection
  assertEquals(modal?.kind === "modal" ? modal.canonical : "", "shall");
});

Deno.test("build: strong / link / autolink / hardbreak preserved verbatim", () => {
  for (
    const s of [
      "The driver **must** debounce inputs.",
      "See [the spec](docs/specs/x.md) for detail.",
      "Reference: <https://example.com/spec>.",
      "line one  \nline two",
      "line one\\\nline two",
    ]
  ) {
    const blocks = buildBodyAst(s);
    assertEquals(render(blocks), s, `round-trip failed for ${JSON.stringify(s)}`);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
`deno test packages/markspec/core/ast/build_test.ts --filter "verbatim|decoupled|preserved"`
Expected: FAIL — `p.content.text` is the flattened
`"The driver shall debounce
inputs."`; `render` drops the markup.

- [ ] **Step 3: Decouple `inlineContent` and update every call site**

In `packages/markspec/core/ast/build.ts` replace `inlineContent`:

```typescript
/**
 * Build an InlineContent. `storedText` is the verbatim source prose that
 * `render` emits (§5.1 faithful); `recognitionText` is the flattened
 * projection that modal / $Identifier recognition runs on (so `\bshall\b`
 * still matches inside `_shall_`). For nodes whose text carries no inline
 * markup the two are identical and behaviour is unchanged.
 */
function inlineContent(
  storedText: string,
  recognitionText: string,
  range: SourceRange,
): InlineContent {
  const markers = extractMarkersFromText(recognitionText, range);
  return { text: storedText, markers };
}
```

Now update `case "paragraph":` (entire case body) to:

```typescript
    case "paragraph": {
      const text = extractMdastText(node); // flattened — detection + recognition
      const verbatim = verbatimSlice(body, node.position);

      if (
        node.children.length === 1 &&
        node.children[0].type === "image"
      ) {
        const img = node.children[0];
        return {
          kind: "figure",
          alt: img.alt ?? "",
          path: img.url ?? "",
          range,
        } satisfies FigureNode;
      }

      const mathTex = tryMathParagraph(text);
      if (mathTex !== undefined) {
        return { kind: "math", tex: mathTex, range } satisfies MathNode;
      }

      const defList = tryDefinitionList(text);
      if (defList) {
        // Verbatim term/definition: re-run the deflist split on the
        // verbatim slice so inline markup in either side survives.
        const vm = DEFLIST_RE.exec(verbatim.trim());
        const vTerm = vm ? vm[1].trim() : defList.term;
        const vDef = vm ? vm[2].trim() : defList.definition;
        const termRange: SourceRange = { start: range.start, end: range.start };
        const defRange: SourceRange = { start: range.start, end: range.end };
        return {
          kind: "definition-list",
          items: [
            {
              term: inlineContent(vTerm, defList.term, termRange),
              definition: inlineContent(vDef, defList.definition, defRange),
            },
          ],
          range,
        } satisfies DefinitionListNode;
      }

      const caption = tryCaptionParagraph(text);
      if (caption) {
        return {
          kind: "caption",
          keyword: caption.keyword,
          text: caption.text,
          position: "below",
          range,
        } satisfies CaptionNode;
      }

      return {
        kind: "paragraph",
        content: inlineContent(verbatim, text, range),
        range,
      } satisfies ParagraphNode;
    }
```

Update the remaining `inlineContent(` call sites to the 3-arg form (stored ==
recognition for these until their own task changes them):

- Table cell (`case "table"`): `inlineContent(cellText, cellText, cellRange)`
- Note (`case "blockquote"` admonition branch):
  `inlineContent(fullText, fullText, range)`
- Blockquote (`case "blockquote"` plain branch):
  `inlineContent(bqText, bqText, range)`

- [ ] **Step 4: Run tests to verify they pass**

Run:
`deno test packages/markspec/core/ast/build_test.ts --filter "verbatim|decoupled|preserved"`
Expected: PASS.

- [ ] **Step 5: Prove no regression in builder/renderer/gate**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi packages/markspec/core/ast/ tests/e2e/ast_equivalence_test.ts`
Expected: PASS — plain-prose tests unaffected (verbatim == flattened there);
gate still byte-identical.

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/core/ast/build.ts packages/markspec/core/ast/build_test.ts
git commit --no-verify -m "wip(core): faithful paragraph + decoupled marker recognition"
```

---

## Task 3: Faithful List items + task-list checkbox round-trip

List items recurse through `mapMdastNode`, so paragraph faithfulness is
inherited; `verbatimSlice`'s list-indent normalisation prevents double-indent.
Separately, capture the GFM task-list checkbox so `- [ ]`/`- [x]` round-trips
while `MSL-B042` stays unchanged.

**Files:**

- Modify: `packages/markspec/core/ast/nodes.ts` (`ListItemNode.checked?`)
- Modify: `packages/markspec/core/ast/build.ts` (`case "list"`)
- Modify: `packages/markspec/core/ast/render.ts` (`renderListItem`)
- Test: `packages/markspec/core/ast/build_test.ts`,
  `packages/markspec/core/ast/render_test.ts`,
  `packages/markspec/core/validator/body_blocks_test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/markspec/core/ast/build_test.ts`:

```typescript
Deno.test("build: nested list paragraph keeps emphasis and round-trips", () => {
  const s = "- outer _one_\n  - inner **a**\n- outer two";
  assertEquals(render(buildBodyAst(s)), s);
});

Deno.test("build: task-list checkbox is captured and round-trips", () => {
  const s = "- [ ] todo item\n- [x] done item";
  const list = buildBodyAst(s)[0] as ListNode;
  assertEquals(list.kind, "list");
  assertEquals(list.hasTaskItems, true); // B042 source unchanged
  assertEquals(list.items[0].checked, false);
  assertEquals(list.items[1].checked, true);
  assertEquals(render(buildBodyAst(s)), s); // round-trips byte-identically
});
```

Add to `packages/markspec/core/validator/body_blocks_test.ts` (a regression pin
— B042 must still fire once per task-list block):

```typescript
Deno.test("MSL-B042: task list still flagged after checkbox round-trip", async () => {
  const { parseFile } = await import("../mod.ts");
  const { validateBodyBlocks } = await import("./body_blocks.ts");
  const doc =
    "- [TST_BB_0001] Probe\n\n  - [ ] todo item\n  - [x] done item\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const { entries } = await parseFile(doc, { file: "t.md" });
  const diags = validateBodyBlocks(entries[0]);
  const b042 = diags.filter((d) => d.code === "MSL-B042");
  assertEquals(b042.length, 1);
});
```

(Ensure `body_blocks_test.ts` imports `assertEquals` from `@std/assert`; add the
import if absent.)

- [ ] **Step 2: Run tests to verify they fail**

Run:
`deno test packages/markspec/core/ast/build_test.ts --filter "nested list|task-list checkbox"`
Expected: FAIL — `items[*].checked` undefined; `render` drops `[ ]`/`[x]` and
may double-indent the nested paragraph.

- [ ] **Step 3: Add `checked?` to the node, capture it, re-emit it**

In `packages/markspec/core/ast/nodes.ts`, add to `ListItemNode`:

```typescript
/** A list item: a sequence of blocks (spec §2.4 `List`). */
export interface ListItemNode {
  readonly blocks: readonly BodyBlock[];
  /**
   * GFM task-list checkbox state for this item, when present:
   * `false` = `[ ]`, `true` = `[x]`. Absent for non-task items.
   * Round-tripped by the renderer; `ListNode.hasTaskItems` (used by
   * MSL-B042) is derived independently and unaffected.
   */
  readonly checked?: boolean;
  readonly range: SourceRange;
}
```

In `packages/markspec/core/ast/build.ts`, `case "list":`, set `checked` on each
item from the mdast `checked` property:

```typescript
const items: ListItemNode[] = node.children.map(
  // deno-lint-ignore no-explicit-any
  (item: any): ListItemNode => {
    const itemRange = positionToRange(item.position);
    const subBlocks: BodyBlock[] = (item.children ?? []).map(
      // deno-lint-ignore no-explicit-any
      (child: any) => mapMdastNode(child, body),
    );
    return {
      blocks: subBlocks,
      ...(item.checked != null ? { checked: item.checked } : {}),
      range: itemRange,
    };
  },
);
```

In `packages/markspec/core/ast/render.ts`, `renderListItem`, re-emit the
checkbox immediately after the bullet when present. Replace the
`if (firstBlock.kind === "paragraph") { … }` opening so the paragraph branch
prepends the checkbox:

```typescript
  const checkbox = item.checked === undefined
    ? ""
    : item.checked
    ? "[x] "
    : "[ ] ";

  if (firstBlock.kind === "paragraph") {
    const text = (firstBlock as ParagraphNode).content.text;
    const textLines = text.split("\n");
    firstLine = `${bullet} ${checkbox}${textLines[0]}`;
    if (textLines.length > 1) {
      extraLines = textLines.slice(1).map((l) => (l ? `  ${l}` : ""));
    }
  } else {
    firstLine = checkbox ? `${bullet} ${checkbox}`.trimEnd() : bullet;
    const blockStr = renderBlock(firstBlock);
    extraLines = blockStr.split("\n").map((l) => (l ? `  ${l}` : ""));
  }
```

Add `checked` to the `ListItemNode` import usage if the renderer destructures
it; `item.checked` is accessed directly so no import change is needed.

- [ ] **Step 4: Run tests to verify they pass**

Run:
`deno test packages/markspec/core/ast/build_test.ts packages/markspec/core/validator/body_blocks_test.ts --filter "nested list|task-list|B042"`
Expected: PASS.

- [ ] **Step 5: Prove no regression**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi packages/markspec/core/ast/ packages/markspec/core/validator/ tests/e2e/ast_equivalence_test.ts`
Expected: PASS — existing list/render/gate tests green; non-task lists
unaffected (`checked` absent → no checkbox emitted).

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/core/ast/nodes.ts packages/markspec/core/ast/build.ts packages/markspec/core/ast/render.ts packages/markspec/core/ast/build_test.ts packages/markspec/core/validator/body_blocks_test.ts
git commit --no-verify -m "wip(core): faithful list items + task-list checkbox round-trip"
```

---

## Task 4: Faithful Note / Blockquote (verbatim de-quote)

Slice the whole blockquote verbatim, strip the per-line `>`/`>` quote marker
(and the `[!KIND]` first line for notes), keeping the existing paragraph-join /
interior-blank-`>` convention. Marker recognition keeps using the current
flattened join. **Highest-risk task — pin heavily.**

**Files:**

- Modify: `packages/markspec/core/ast/build.ts` (`case "blockquote"`)
- Test: `packages/markspec/core/ast/build_test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/markspec/core/ast/build_test.ts`:

```typescript
Deno.test("build: note preserves inline emphasis and round-trips", () => {
  const s = "> [!NOTE]\n> See _the spec_ for **detail**.";
  const n = buildBodyAst(s)[0] as NoteNode;
  assertEquals(n.kind, "note");
  assertEquals(n.admonition, "NOTE");
  assertEquals(render(buildBodyAst(s)), s);
});

Deno.test("build: blockquote preserves inline link and round-trips", () => {
  const s = "> See [the spec](docs/x.md) for detail.";
  assertEquals(render(buildBodyAst(s)), s);
});

Deno.test("build: note/blockquote canonical shapes still byte-exact", () => {
  for (
    const s of [
      "> [!WARNING]\n> line one\n> line two",
      "> [!NOTE]\n> a\n>\n> c",
      "> line one\n> line two",
      "> a\n>\n> b",
      "> [!NOTE]\n> This is an informational note.",
    ]
  ) {
    assertEquals(render(buildBodyAst(s)), s, `failed: ${JSON.stringify(s)}`);
  }
});

Deno.test("build: emphasised modal in a note is still recognised", () => {
  const n = buildBodyAst("> [!NOTE]\n> The driver _shall_ act.")[0] as NoteNode;
  const modal = n.content.markers.find((m) => m.kind === "modal");
  assertExists(modal);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
`deno test packages/markspec/core/ast/build_test.ts --filter "note|blockquote"`
Expected: the inline-markup cases FAIL (markup flattened); the canonical-shape
cases should still PASS (guard against regressing them in Step 3).

- [ ] **Step 3: Rewrite `case "blockquote"` with verbatim de-quote**

In `packages/markspec/core/ast/build.ts`, add this helper just above
`function mapMdastNode`:

```typescript
/**
 * De-quote a verbatim blockquote slice: strip the per-line `> ` (or bare
 * `>` for blank quoted lines) marker, preserving inline markup and the
 * interior-blank-line convention. CommonMark canonical quoting is `> `
 * on content lines and `>` alone on blank lines; a defensive `>`-without
 * -space strip handles non-canonical input.
 */
function deQuote(rawBlockquote: string): string {
  return rawBlockquote
    .split("\n")
    .map((line) => {
      if (line.startsWith("> ")) return line.slice(2);
      if (line === ">") return "";
      if (line.startsWith(">")) return line.slice(1);
      return line;
    })
    .join("\n");
}
```

Replace the entire `case "blockquote": { … }` body with:

```typescript
    case "blockquote": {
      const verbatim = deQuote(verbatimSlice(body, node.position));
      const firstChild = node.children?.[0];

      if (firstChild?.type === "paragraph") {
        const paraText = extractMdastText(firstChild);
        const admonMatch = ADMONITION_FIRST_LINE_RE.exec(paraText.trim());
        if (admonMatch) {
          const kind = admonMatch[1] as AdmonitionKind;

          // Flattened recognition text (unchanged from prior behaviour):
          // marker-stripped first paragraph + remaining paragraphs.
          const rest = paraText.replace(ADMONITION_FIRST_LINE_RE, "").trim();
          const otherText = node.children
            .slice(1)
            // deno-lint-ignore no-explicit-any
            .map((c: any) => extractMdastText(c))
            .join("\n\n");
          const flattened = [rest, otherText].filter(Boolean).join("\n\n");

          // Verbatim stored text: de-quoted slice with the `[!KIND]`
          // token removed from the first line. Anything the author put
          // after the marker on the same line is kept verbatim.
          const vLines = verbatim.split("\n");
          const markerRe = new RegExp(`^\\[!${kind}\\]`);
          const afterMarker = (vLines[0] ?? "").replace(markerRe, "");
          const bodyLines = vLines.slice(1);
          const storedText = afterMarker.trim()
            ? [afterMarker.trimStart(), ...bodyLines].join("\n")
            : bodyLines.join("\n");

          return {
            kind: "note",
            admonition: kind,
            content: inlineContent(storedText, flattened, range),
            range,
          } satisfies NoteNode;
        }
      }

      const bqFlattened = node.children
        // deno-lint-ignore no-explicit-any
        .map((c: any) => extractMdastText(c))
        .join("\n\n");
      return {
        kind: "blockquote",
        content: inlineContent(verbatim, bqFlattened, range),
        range,
      } satisfies BlockquoteNode;
    }
```

> Rationale: `renderNote` re-prepends `> [!KIND]\n` and re-quotes every stored
> line; `renderBlockquote` re-quotes every stored line. The stored text
> therefore must be the de-quoted body **without** the `[!KIND]` line — exactly
> what the existing canonical corpus produced via the old flattened path, so the
> canonical-shape tests stay byte-exact while inline markup now survives.

- [ ] **Step 4: Run tests to verify they pass**

Run:
`deno test packages/markspec/core/ast/build_test.ts --filter "note|blockquote"`
Expected: PASS — both the new inline-markup cases and the canonical-shape
guards.

- [ ] **Step 5: Prove the equivalence gate (note/blockquote) is unbroken**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/ast_equivalence_test.ts packages/markspec/core/ast/`
Expected: PASS — every existing note/blockquote gate case (multi-line,
interior-blank, mixed) still byte-identical.

> If any existing gate case fails here, **STOP and surface to the owner** — the
> de-quote algorithm changed an established canonical shape; that is a design
> problem, not a test to weaken.

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/core/ast/build.ts packages/markspec/core/ast/build_test.ts
git commit --no-verify -m "wip(core): faithful note/blockquote via verbatim de-quote"
```

---

## Task 5: Faithful DefinitionList + confirm Table-cell safety

The paragraph case already routes deflist through the verbatim split (Task 2).
This task pins it and confirms table cells are unaffected (render uses
`TableNode.raw`, not cell text).

**Files:**

- Test only: `packages/markspec/core/ast/build_test.ts`

- [ ] **Step 1: Write the failing/guard tests**

```typescript
Deno.test("build: definition list preserves inline markup and round-trips", () => {
  const s = "ASIL\n: _Automotive_ Safety **Integrity** Level";
  const dl = buildBodyAst(s)[0] as DefinitionListNode;
  assertEquals(dl.kind, "definition-list");
  assertEquals(dl.items[0].term.text, "ASIL");
  assertEquals(dl.items[0].definition.text, "_Automotive_ Safety **Integrity** Level");
  assertEquals(render(buildBodyAst(s)), s);
});

Deno.test("build: table with inline markup in a cell round-trips via raw", () => {
  const s = "| A | B |\n|---|---|\n| _x_ | **y** |";
  assertEquals(render(buildBodyAst(s)), s); // raw passthrough — exact
});
```

- [ ] **Step 2: Run tests**

Run:
`deno test packages/markspec/core/ast/build_test.ts --filter "definition list|table with inline"`
Expected: PASS already (Task 2's deflist verbatim split + Task 1's
`TableNode.raw` cover these). If the deflist case FAILS, the Task 2 verbatim
split has a defect — fix it in `case "paragraph"`'s deflist branch, re-run.

- [ ] **Step 3: (only if Step 2 failed) fix the deflist verbatim split**

The verbatim split must mirror `DEFLIST_RE` on `verbatim.trim()`. Verify
`vm[1]`/`vm[2]` trimming matches the renderer's
`${term.text}\n: ${definition.text}` shape; adjust the `vTerm`/`vDef` derivation
in `case "paragraph"` accordingly.

- [ ] **Step 4: Run tests to verify they pass**

Run:
`deno test packages/markspec/core/ast/build_test.ts --filter "definition list|table with inline"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/markspec/core/ast/build_test.ts packages/markspec/core/ast/build.ts
git commit --no-verify -m "wip(core): pin faithful definition-list + table-cell safety"
```

---

## Task 6: Verbatim `Unknown.raw` for excluded / unowned constructs

Make the `default:` branch capture the verbatim source slice so headings,
thematic breaks, raw HTML, and link-reference definitions round-trip and stay
diagnosed (MSL-B040/B041/B043).

**Files:**

- Modify: `packages/markspec/core/ast/build.ts` (`default:` branch)
- Test: `packages/markspec/core/ast/build_test.ts`,
  `packages/markspec/core/validator/body_blocks_test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `packages/markspec/core/ast/build_test.ts`:

```typescript
Deno.test("build: thematic break preserved verbatim and round-trips", () => {
  const s = "before\n\n---\n\nafter";
  const blocks = buildBodyAst(s);
  const tb = blocks.find((b) => b.kind === "unknown") as UnknownNode;
  assertEquals(tb.subkind, "thematic-break");
  assertEquals(tb.raw, "---");
  assertEquals(render(blocks), s);
});

Deno.test("build: heading preserved verbatim (# survives) and round-trips", () => {
  const s = "# Not allowed in a body";
  const blocks = buildBodyAst(s);
  const h = blocks[0] as UnknownNode;
  assertEquals(h.kind, "unknown");
  assertEquals(h.subkind, "heading");
  assertEquals(h.raw, s);
  assertEquals(render(blocks), s);
});

Deno.test("build: link reference definition preserved verbatim", () => {
  const s = "See [the spec][s] for detail.\n\n[s]: docs/specs/x.md";
  assertEquals(render(buildBodyAst(s)), s);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
`deno test packages/markspec/core/ast/build_test.ts --filter "thematic break|heading preserved|link reference"`
Expected: FAIL — `raw` is `""` (thematic break) / `"Not allowed in a body"`
(heading, `#` lost) / definition dropped.

- [ ] **Step 3: Capture verbatim in the default branch**

In `packages/markspec/core/ast/build.ts`, change the `default:` branch's
returned node so `raw` is the verbatim slice:

```typescript
default: {
  type SubKind = "heading" | "thematic-break" | "html" | undefined;
  let subkind: SubKind;
  if (
    node.type === "heading" ||
    node.type === "setextHeading"
  ) {
    subkind = "heading";
  } else if (node.type === "thematicBreak") {
    subkind = "thematic-break";
  } else if (node.type === "html") {
    subkind = "html";
  }
  return {
    kind: "unknown",
    raw: verbatimSlice(body, node.position),
    ...(subkind !== undefined ? { subkind } : {}),
    range,
  } satisfies UnknownNode;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
`deno test packages/markspec/core/ast/build_test.ts --filter "thematic break|heading preserved|link reference"`
Expected: PASS.

- [ ] **Step 5: Confirm B040/B041/B043 still fire**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi packages/markspec/core/validator/body_blocks_test.ts packages/markspec/core/ast/ tests/e2e/ast_equivalence_test.ts`
Expected: PASS — `subkind` is unchanged so the excluded-construct diagnostics
still fire; raw-HTML round-trip (already OK) unbroken.

- [ ] **Step 6: Commit**

```bash
git add packages/markspec/core/ast/build.ts packages/markspec/core/ast/build_test.ts
git commit --no-verify -m "wip(core): verbatim Unknown.raw for excluded constructs"
```

---

## Task 7: Validator-safety audit (B043 / C072 / M060 / B044)

The spec mandates an explicit audit that no `Entry.bodyAst` consumer assumes
markup-free `content.text` and that no validator test pins exact inline-marker
columns. `body_blocks.ts` scans `block.content.text` for forbidden HTML
(MSL-B043) — the highest-risk consumer.

**Files:**

- Test: `packages/markspec/core/validator/body_blocks_test.ts`,
  `packages/markspec/core/validator/modal_keywords_test.ts`

- [ ] **Step 1: Audit (read, do not modify)**

Read each consumer and confirm the property it reads:

- `packages/markspec/core/validator/body_blocks.ts` —
  `htmlViolations(
  block.content.text, …)` for paragraph/note/blockquote;
  `block.raw` for table; `item.term.text`/`item.definition.text` for deflist.
  Verbatim text is a **superset** of the old flattened text (HTML markup was
  already retained), so HTML detection still sees the same `<...>` tokens.
- `packages/markspec/core/validator/modal_keywords.ts` — reads `content.markers`
  only (the decoupled, flattened-derived path).
- `packages/markspec/core/validator/captions.ts` — reads `CaptionNode`
  (flattened detection, pre-storage).
- `packages/markspec/core/validator/feature_ac.ts` — MSL-B044, reads block kinds
  (Feature + list), not inline `content.text`.

If any consumer indexes into `content.text` by a column derived from a marker
range, or asserts an exact marker column in its test, **STOP and surface to the
owner** (spec §4 — surface-to-owner finding, not a silent relaxation).

- [ ] **Step 2: Write regression pins**

Add to `packages/markspec/core/validator/body_blocks_test.ts`:

```typescript
Deno.test("MSL-B043: inline emphasis in a paragraph does NOT false-positive HTML", async () => {
  const { parseFile } = await import("../mod.ts");
  const { validateBodyBlocks } = await import("./body_blocks.ts");
  const doc =
    "- [TST_BB_0002] Probe\n\n  The driver _shall_ act and **must** stop.\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const { entries } = await parseFile(doc, { file: "t.md" });
  const b043 = validateBodyBlocks(entries[0]).filter((d) =>
    d.code === "MSL-B043"
  );
  assertEquals(b043.length, 0);
});

Deno.test("MSL-B043: real inline HTML is still flagged with markup present", async () => {
  const { parseFile } = await import("../mod.ts");
  const { validateBodyBlocks } = await import("./body_blocks.ts");
  const doc =
    "- [TST_BB_0003] Probe\n\n  The _driver_ <span>x</span> shall act.\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const { entries } = await parseFile(doc, { file: "t.md" });
  const b043 = validateBodyBlocks(entries[0]).filter((d) =>
    d.code === "MSL-B043"
  );
  assertEquals(b043.length, 1);
});
```

Add to `packages/markspec/core/validator/modal_keywords_test.ts`:

```typescript
Deno.test("MSL-M060: emphasised modal keyword is still detected", async () => {
  const { parseFile } = await import("../mod.ts");
  const { validateModalKeywords } = await import("./modal_keywords.ts");
  const doc =
    "- [TST_MK_0001] Probe\n\n  The driver _SHALL_ act.\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const { entries } = await parseFile(doc, { file: "t.md" });
  // _SHALL_ flattens to SHALL for recognition → M060 (non-canonical case).
  const m060 = validateModalKeywords(entries[0]).filter((d) =>
    d.code === "MSL-M060"
  );
  assertEquals(m060.length, 1);
});
```

(Confirm the exported validator function names by reading the two modules;
adjust `validateBodyBlocks` / `validateModalKeywords` if the codebase uses
different identifiers. Add missing `@std/assert` imports.)

- [ ] **Step 3: Run tests to verify they pass**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi packages/markspec/core/validator/`
Expected: PASS — entire validator suite green, including the new pins.

> If `MSL-M060: emphasised modal keyword is still detected` fails, marker
> decoupling is not actually routing recognition through the flattened text —
> revisit Task 2/Task 4 `inlineContent` call sites. Do not delete the test.

- [ ] **Step 4: Commit**

```bash
git add packages/markspec/core/validator/body_blocks_test.ts packages/markspec/core/validator/modal_keywords_test.ts
git commit --no-verify -m "wip(core): validator-safety regression pins (B043/M060)"
```

---

## Task 8: SP1-asset updates — corpus, tripwire, field-contract docs

Extend the corpus so the matrix actually proves §5.1 faithfulness everywhere;
flip the emphasis tripwire into a faithfulness assertion; document the new field
contract.

**Files:**

- Modify: `tests/e2e/ast_fidelity.ts` (`CORPUS`)
- Modify: `tests/e2e/ast_fidelity_test.ts` (tripwire)
- Modify: `packages/markspec/core/ast/nodes.ts` (field-contract doc)
- Modify: `docs/architecture/adr-014-canonical-body-ast.md` (one-line note)

- [ ] **Step 1: Extend the corpus**

In `tests/e2e/ast_fidelity.ts`, append these samples to `CORPUS` **after** the
last edge-case entry (`edge-paragraph-then-table`), before the closing
`] as const;` (appending keeps every existing catalogue row's diff stable):

```typescript
// ── SP2: inline markup inside every prose-bearing node kind ───────────
{
  name: "inline-in-list-item",
  markdown: "- The driver _shall_ debounce **inputs**.\n- Plain item.",
},
{
  name: "inline-in-note",
  markdown: "> [!NOTE]\n> See _the spec_ and the [guide](docs/g.md).",
},
{
  name: "inline-in-blockquote",
  markdown: "> An excerpt with _emphasis_ and a [link](docs/x.md).",
},
{
  name: "inline-in-table-cell",
  markdown: "| A | B |\n|---|---|\n| _x_ | **y** |",
},
{
  name: "inline-in-deflist",
  markdown: "ASIL\n: _Automotive_ Safety **Integrity** Level",
},
{
  name: "link-ref-definition-standalone",
  markdown: "See [the spec][s].\n\n[s]: docs/specs/x.md",
},
```

- [ ] **Step 2: Flip the tripwire**

In `tests/e2e/ast_fidelity_test.ts`, replace the test
`characterization: buildBodyAst erases inline emphasis (SP1 LOSS finding)` (the
whole `Deno.test(...)` block) with:

```typescript
Deno.test("buildBodyAst preserves inline emphasis (SP2 faithful builder)", () => {
  // SP2 flipped the SP1 tripwire: the builder is now faithful. `_shall_`
  // and `shall` must produce DIFFERENT ASTs (the markup is retained), and
  // the paragraph's stored text must carry the verbatim emphasis source.
  const emphasised = ast("The driver _shall_ debounce inputs.");
  const plain = ast("The driver shall debounce inputs.");
  assertFalse(astEquivalent(emphasised, plain));
  const p = emphasised[0];
  assert(p.kind === "paragraph");
  assertStringIncludes(
    (p as { content: { text: string } }).content.text,
    "_shall_",
  );
});
```

Update the import line at the top of `ast_fidelity_test.ts` to include the
helpers used:
`import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";`
(add `assertStringIncludes`; keep the existing `astEquivalent`, `BodyBlock`,
`buildBodyAst` import from `./ast_fidelity.ts`).

- [ ] **Step 3: Document the new field contract**

In `packages/markspec/core/ast/nodes.ts`, update the `InlineContent` doc comment
to:

```typescript
/**
 * Prose text plus the inline markers recognised within it.
 *
 * `text` is the **verbatim source prose** (markup-preserving — emphasis,
 * strong, links, autolinks, hard line breaks survive byte-identically per
 * spec §5.1). `markers` are recognised from the flattened projection so
 * modal / $Identifier detection is unaffected by surrounding markup.
 * Marker `range` columns are best-effort relative to the verbatim text.
 */
export interface InlineContent {
  readonly text: string;
  readonly markers: readonly InlineMarker[];
}
```

And update the `UnknownNode.raw` doc to note it is now the verbatim source slice
(so excluded constructs round-trip). Append to the existing `raw` JSDoc:
`Carries the verbatim source slice (spec §5.4 lossless preservation).`

In `docs/architecture/adr-014-canonical-body-ast.md`, under "### What this
enables", add one bullet:

```markdown
- SP2 (faithful builder) materially widened the build/render inverse: §5.1
  inline prose and §2.4.1-excluded constructs now round-trip. The
  string-fallback guard remains as the safety net; its formal retirement is SP3,
  not SP2.
```

- [ ] **Step 4: Run the SP1 unit tests + type-check**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/ast_fidelity_test.ts`
Expected: PASS — the flipped tripwire asserts faithfulness; `runMatrix`
determinism/coverage tests still pass with the extended corpus.

Run: `deno check packages/markspec/core/ast/nodes.ts` Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/ast_fidelity.ts tests/e2e/ast_fidelity_test.ts packages/markspec/core/ast/nodes.ts docs/architecture/adr-014-canonical-body-ast.md
git commit --no-verify -m "wip(repo): extend SP1 corpus, flip tripwire, doc field contract"
```

---

## Task 9: Strengthen the equivalence gate, regenerate the matrix, full verify

Add inline-markup edge cases to the gate (it strengthens, never weakens),
regenerate the catalogue, and run the full project gate.

**Files:**

- Modify: `tests/e2e/ast_equivalence_test.ts` (add edge cases)
- Regenerate: `docs/product/ast-fidelity-matrix.md`

- [ ] **Step 1: Add inline-markup edge cases to the gate**

In `tests/e2e/ast_equivalence_test.ts`, in the `cases` array of the
`ast-equivalence: edge cases` test, append:

```typescript
[
  "paragraph: inline emphasis/strong/link preserved",
  "The driver _shall_ debounce **inputs** — see [spec](docs/x.md).",
],
[
  "paragraph: hard line break (two-space)",
  "line one  \nline two",
],
[
  "note: inline markup in admonition body",
  "> [!NOTE]\n> See _the spec_ and the [guide](docs/g.md).",
],
[
  "blockquote: inline markup excerpt",
  "> An excerpt with _emphasis_ and a [link](docs/x.md).",
],
[
  "definition-list: inline markup in definition",
  "ASIL\n: _Automotive_ Safety **Integrity** Level",
],
```

- [ ] **Step 2: Run the full equivalence gate**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/ast_equivalence_test.ts`
Expected: PASS — fixtures + `docs/product` + `docs/examples` broadened corpus

- the new inline-markup edge cases all byte-identical.

> A failure on the broadened `docs/product`/`docs/examples` corpus means a real
> project-doc body now renders differently. Net formatter output is still
> guarded byte-identical, but the gate asserts
> `render(bodyAst) ===
> entry.body`. **STOP and surface to the owner** with the
> failing entry — do not relax the gate.

- [ ] **Step 3: Verify the format guard pins are still green (not modified)**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/format_test.ts`
Expected: PASS — including
`format: safe fallback — thematic break body
preserved and idempotent` and
`… hard line break body preserved and
idempotent`. These bodies now round-trip
via the AST path, but output stays byte-identical and idempotent, so the
assertions hold. **Do not edit `format_test.ts`** — the guard pin stays as
written (spec §7).

- [ ] **Step 4: Regenerate the fidelity matrix**

Run: `just ast-fidelity-matrix` Then:
`git diff --stat docs/product/ast-fidelity-matrix.md` Expected: the catalogue
changes — emphasis/strong/combined/inline-link/
autolink/both-hardbreak/refstyle-link rows flip toward `OK`; excluded
thematic-break/heading become verbatim (`r==s yes`); task-list `OK`; the new SP2
corpus rows appear; the headline `surface` drops.

- [ ] **Step 5: Inspect the regenerated headline and surface any residual**

Run:
`grep -n "Headline\|^- LOSS\|^- UNREPRESENTABLE" docs/product/ast-fidelity-matrix.md`
Expected: `surface = LOSS + UNREPRESENTABLE = 0`.

> If the surface is **not** 0, do **not** proceed silently. Identify the
> residual construct(s) and **STOP and surface to the owner** (spec §2/§9 — an
> explicit, spec-recorded residual, never a silent `NORMALIZE`).

- [ ] **Step 6: Run the staleness gate and full project check**

Run: `bash scripts/check_ast_fidelity_matrix.sh` Expected: exit 0 (catalogue
matches generator output once staged).

Run:
`git add docs/product/ast-fidelity-matrix.md && bash scripts/check_ast_fidelity_matrix.sh`
Expected: exit 0.

Run: `just check` Expected: PASS — lint + full test suite + type-check all
green, zero warnings.

- [ ] **Step 7: Verify format idempotence over docs/product (zero diff)**

Run:
`deno run --allow-read --allow-write packages/markspec/main.ts format docs/product/*.md && git diff --stat docs/product/`
Expected: only `docs/product/ast-fidelity-matrix.md` (regenerated in Step 4,
already staged) shows — the entry-bearing product docs reformat to **zero diff**
(the guard guarantees byte-identical net output).

> Any non-matrix diff in `docs/product/` means the formatter changed a document.
> **STOP and surface to the owner.**

- [ ] **Step 8: Commit**

```bash
git add tests/e2e/ast_equivalence_test.ts docs/product/ast-fidelity-matrix.md
git commit --no-verify -m "wip(repo): strengthen equivalence gate, regenerate matrix"
```

---

## Task 10: Squash, PR, and merge

**Files:** none (git + GitHub only).

- [ ] **Step 1: Confirm a clean tree and a green local gate**

Run: `git status --porcelain` (expect empty) and `just check` (expect PASS).

- [ ] **Step 2: Squash all WIP commits into one Conventional Commit**

```bash
BASE=$(git merge-base origin/main HEAD)
git reset --soft "$BASE"
git commit -m "feat(core): faithful body-AST builder — preserve §5.1 inline prose

buildBodyAst now stores the verbatim source slice for every prose-bearing
node (paragraph, list item, note, blockquote, definition-list) and for
§2.4.1-excluded constructs (heading, thematic break, link reference
definition), while marker recognition stays on the flattened projection.
GFM task-list checkboxes round-trip; MSL-B040–B044/C072/M060 unchanged.
The SP1 fidelity matrix surface drops to its documented residual; the
emphasis tripwire is flipped to a faithfulness assertion. The
emitBodyViaAst guard and ast_equivalence gate are not weakened — they
strengthen as more constructs round-trip.

Spec: docs/superpowers/specs/2026-05-17-formatting-fidelity-sp2-design.md
Plan: docs/superpowers/plans/2026-05-17-formatting-fidelity-sp2.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> Use `feat(core)` if the diff is core-dominant; if the reviewer prefers
> `feat(repo)` because the change spans SP1 test assets + docs, that scope is
> also allowed (project convention). Pick one; the pre-commit hook lints the
> message on the real (hook-enabled) commit — re-run if it rejects.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin worktree-formatting-fidelity-sp2
gh pr create --title "feat(core): SP2 — faithful body-AST builder (Formatting Fidelity)" --body-file - <<'EOF'
## Summary

SP2 of the Formatting Fidelity epic — the faithful builder.

`buildBodyAst` now captures §5.1 inline prose verbatim (emphasis, strong,
links, autolinks, hard line breaks, reference-style links + definitions)
and preserves §2.4.1-excluded constructs verbatim, so they round-trip and
stay diagnosed. Marker recognition is decoupled onto the flattened
projection. The SP1 fidelity-matrix surface drops to its documented
residual; the emphasis tripwire is flipped into a faithfulness assertion.

## Invariants honoured

- `ast_equivalence_test.ts` strengthened, never weakened (new inline-markup
  edge cases added).
- `emitBodyViaAst` fallback guard byte-untouched; `format_test.ts` guard
  pins unchanged and green.
- `astEquivalent` stays SP1-local/provisional (SP3 ratifies).
- M050/M051 still deferred (ADR-014).

Spec: `docs/superpowers/specs/2026-05-17-formatting-fidelity-sp2-design.md`
Plan: `docs/superpowers/plans/2026-05-17-formatting-fidelity-sp2.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

- [ ] **Step 4: Watch checks to full green (incl. CodeQL)**

Run: `gh pr checks --watch --interval 20` Expected: all checks pass, including
`ast-fidelity-matrix` staleness, dprint, deno fmt/lint/test/typecheck, and
CodeQL.

> If CI fails, fix forward with WIP commits, then re-squash (Step 2) before
> merge so the PR stays one Conventional Commit. Do not weaken any gate.

- [ ] **Step 5: Merge on full green**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 6: Report outcome**

Summarise to the owner: the regenerated matrix headline (surface number), any
spec-recorded residual surfaced, and confirmation that the guard and equivalence
gate were not weakened. Update project memory
(`project_formatting_fidelity_sp1.md` → note SP2 shipped + new baseline; or a
new SP2 memory) per the working conventions.

---

## Self-Review

**Spec coverage** (each spec section → task):

- §2 success criterion (§5.1 faithful, surface → 0 or surfaced residual) → Tasks
  2–6 + Task 9 Step 5.
- §3 mechanism (verbatim slice, Approach A) → Task 1 (helper) + Tasks 2–6.
- §3 per-node table (paragraph / list / table / note-bq / deflist) → Tasks 2 / 3
  / 1+5 / 4 / 5.
- §4 marker decoupling + validator-safety audit → Task 2 (`inlineContent`
  split) + Task 7 (audit + pins).
- §5 excluded constructs + §5.4 + task-list checkbox → Task 3 (checkbox) + Task
  6 (verbatim Unknown.raw).
- §6 SP1-asset changes (corpus, tripwire, matrix, astEquivalent untouched) →
  Task 8 + Task 9 Steps 4–6.
- §7 hard invariants (gate strengthens, guard untouched, SP3 boundary,
  M050/M051) → Task 9 Steps 2–3 + Task 8 Step 3 (ADR note) + commit message.
- §8 testing/CI → Tasks 2–9 (TDD throughout) + Task 9 Step 6 + Task 10.
- §9 risks (note/bq highest, nested double-indent, marker drift, residual) →
  Task 4 (heavy pins + STOP gate), Task 1/3 (column-0 normalisation), Task 7
  (audit STOP gate), Task 9 Step 5 (residual STOP gate).

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the two
conditional notes (Task 1 Step 3 signature ordering, Task 5 Step 3) give
explicit instructions, not placeholders.

**Type consistency:** `verbatimSlice(body, pos)` signature consistent across
Tasks 1/2/4/6. `inlineContent(storedText, recognitionText, range)` 3-arg form
defined in Task 2 and used consistently in Tasks 2/4 (Task 1 notes the ordering
caveat). `ListItemNode.checked?: boolean` defined in Task 3, consumed by
`renderListItem` in the same task. `UnknownNode.subkind` preserved unchanged in
Task 6. Validator function names flagged for confirmation-on-read in Task 7 Step
2 (the codebase exposes them via `core/validator/*`; verify exact identifiers
before asserting).
