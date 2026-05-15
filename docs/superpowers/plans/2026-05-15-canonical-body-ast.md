# Canonical Body-AST Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `Entry.body: string` with a canonical `BodyBlock[]` AST so the
formatter renders from it and validators consume it, unblocking
`MSL-B044/M050/M051/C072`.

**Architecture:** Approach A from the spec — build the AST + an AST→text
renderer, prove it byte-identical to the current formatter across a corpus (the
equivalence gate), _then_ flip the formatter to be AST-driven, migrate
validators, ship the 4 codes. New module `core/ast/` (nodes/build/render);
`core/mod.ts` stays the library boundary.

**Tech Stack:** Deno + TypeScript (strict), `@std/assert`, the existing
remark/mdast pipeline in `core/parser/markdown.ts`, `just check` (deno lint +
test + typecheck), dprint.

**Spec:** `docs/superpowers/specs/2026-05-15-canonical-body-ast-design.md`

---

## Plan series (scope decomposition)

This refactor is 7 sequential, independently-shippable PRs (spec §6). Each PR is
its own working, CI-green slice. **This document fully details PR 1.** PRs 2–7
each get their own detailed plan written just-in-time at execution start (their
exact code legitimately depends on the prior PR's realised types/AST shape;
pre-writing it would be speculative). The roadmap below is the fixed contract
for those plans.

| PR    | File / responsibility                                                                                                                                              | Behaviour change                               | Acceptance                                                                                     | Test strategy                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **1** | `core/ast/nodes.ts` — node type contract; `core/mod.ts` re-export                                                                                                  | none                                           | `just check` green; node union exhaustive                                                      | colocated `nodes_test.ts`: construct each variant + exhaustive `switch`/`never` |
| 2     | `core/ast/build.ts` — `mdast → BodyBlock[]`; `parser/markdown.ts` fills additive `Entry.bodyAst` (unconsumed)                                                      | none                                           | per-node-type build unit tests over fixtures; full suite green                                 | colocated `build_test.ts`; characterization over `tests/fixtures`               |
| 3     | `core/ast/render.ts` — `BodyBlock[] → text`; CI equivalence-gate harness                                                                                           | none                                           | gate byte-identical `render(build(parse(x))) ≡ currentFormatter(x)` across corpus; suite green | new `tests/e2e/ast_equivalence_test.ts` corpus harness                          |
| 4     | Formatter cutover: AST-driven; `Entry.body: BodyBlock[]`; string body path deleted; `rawBody()` helper                                                             | internal only — output identical (gate-proven) | gate stays green; §5.5 round-trip green; full suite green                                      | reuse gate + existing format/round-trip e2e unchanged                           |
| 5     | Migrate `validator/captions.ts`, `validator/modal_keywords.ts`, `validator/body_blocks.ts`, `parser/entity_refs.ts` onto AST; delete their `walkProseLines` passes | none — identical diagnostics                   | every existing validator e2e/unit green unchanged                                              | existing suites are the regression oracle                                       |
| 6     | Implement `MSL-B044`, `MSL-M050`, `MSL-M051`, `MSL-C072` on the AST; `project.yaml` caption-convention knob (C072); in-project entity resolution (M050/M051)       | new diagnostics                                | TDD RED→GREEN per code; `docs/specs/markspec-core-data-model.md` §4.5–4.7 reflected            | per-code e2e RED→GREEN                                                          |
| 7     | ADR-012 amendment (bounded exception for the 4 AST-gated codes) + new `adr-014-canonical-body-ast.md`; AGENTS.md ADR index                                         | docs                                           | ADRs merged; AGENTS.md updated                                                                 | docs-only; pre-commit gate                                                      |

Conventional-commit scopes: PRs 1–6 `feat(core)`/`refactor(core)`/`test(core)`;
PR 7 `docs(repo)`. One commit per PR, branch `prompt-01-ast-prN-<slug>`, PR → CI
→ merge (the established loop).

---

## Task 1 (PR 1): AST node type contract

**Files:**

- Create: `packages/markspec/core/ast/nodes.ts`
- Test: `packages/markspec/core/ast/nodes_test.ts`
- Modify: `packages/markspec/core/mod.ts:20-43` (add AST re-export block after
  the `./model/mod.ts` type exports)

**Type-model decisions locked here (the PR-1 deliverable):**

- Body-relative `SourceRange` with 1-based `{line, column}` start/end (matches
  the codebase's 1-based `SourceLocation` convention; no `file` — that lives on
  the `Entry`).
- Prose-bearing blocks carry `InlineContent` (`text` + recognised `markers`).
  Verbatim blocks (`Code`, `Feature`, `Math`, `Figure`) carry raw payload and
  **no** markers (spec §2.5: markers not recognised there).
- The §2.6 caption is `CaptionNode` — a **distinct** name from the existing
  render-pipeline `Caption` (model/mod.ts:430), which is an unrelated concept.
- `EntityRefConvention` is **reused** from `core/model/mod.ts` (already
  exported), not redefined.
- `FeatureNode` keeps Gherkin as verbatim `source` for PR 1–5; structured
  scenario parsing is out of scope (spec §2: "AST records scenarios/steps" is
  deferred — noted in the node doc comment).
- `CaptionNode.block?` (resolved owner) is optional in the type; it is populated
  by the builder/validator in later PRs, not PR 1.

- [ ] **Step 1: Write the failing test**

Create `packages/markspec/core/ast/nodes_test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import type {
  BodyBlock,
  CaptionNode,
  CodeNode,
  EntityRefMarker,
  InlineContent,
  ModalMarker,
  ParagraphNode,
  SourceRange,
} from "./nodes.ts";

const R: SourceRange = {
  start: { line: 1, column: 1 },
  end: { line: 1, column: 2 },
};

Deno.test("nodes: InlineContent carries text + typed markers", () => {
  const modal: ModalMarker = {
    kind: "modal",
    cls: "rfc2119",
    canonical: "shall",
    range: R,
  };
  const ent: EntityRefMarker = {
    kind: "entity",
    ident: "$Sensor",
    convention: "type",
    range: R,
  };
  const ic: InlineContent = {
    text: "The system shall read $Sensor.",
    markers: [modal, ent],
  };
  assertEquals(ic.markers.length, 2);
  assertEquals(ic.markers[0].kind, "modal");
  assertEquals(ic.markers[1].kind, "entity");
});

Deno.test("nodes: block union is discriminated and exhaustive", () => {
  const para: ParagraphNode = {
    kind: "paragraph",
    content: { text: "x", markers: [] },
    range: R,
  };
  const code: CodeNode = {
    kind: "code",
    lang: "rust",
    text: "fn main() {}",
    range: R,
  };
  const cap: CaptionNode = {
    kind: "caption",
    keyword: "Figure",
    text: "A diagram",
    position: "below",
    range: R,
  };

  // Exhaustiveness: every BodyBlock kind must be handled; the
  // `never` assignment fails to compile if a variant is added
  // without updating this switch.
  const label = (b: BodyBlock): string => {
    switch (b.kind) {
      case "paragraph":
        return "paragraph";
      case "list":
        return "list";
      case "table":
        return "table";
      case "figure":
        return "figure";
      case "code":
        return "code";
      case "feature":
        return "feature";
      case "math":
        return "math";
      case "definition-list":
        return "definition-list";
      case "note":
        return "note";
      case "blockquote":
        return "blockquote";
      case "caption":
        return "caption";
      case "unknown":
        return "unknown";
      default: {
        const _exhaustive: never = b;
        return _exhaustive;
      }
    }
  };

  assertEquals(label(para), "paragraph");
  assertEquals(label(code), "code");
  assertEquals(label(cap), "caption");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-read packages/markspec/core/ast/nodes_test.ts` Expected:
FAIL — `Module not found "./nodes.ts"`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/markspec/core/ast/nodes.ts`:

```typescript
/**
 * @module core/ast/nodes
 *
 * Canonical body-AST node taxonomy. Authoritative spec:
 * `docs/specs/markspec-core-data-model.md` §2.4 (closed 10-block
 * catalogue), §2.5 (inline markers), §2.6 (captions).
 *
 * PR 1 of the canonical-body-AST plan: pure type contract, zero
 * behaviour. The builder (`build.ts`) and renderer (`render.ts`)
 * land in later PRs.
 */

import type { EntityRefConvention } from "../model/mod.ts";

/** Body-relative source span. 1-based line/column, matching the
 * codebase's {@link SourceLocation} convention. No `file`: that
 * lives on the owning {@link Entry}. */
export interface SourceRange {
  readonly start: { readonly line: number; readonly column: number };
  readonly end: { readonly line: number; readonly column: number };
}

/** RFC 2119 vs EARS modal class (spec §2.5.1). */
export type ModalMarkerClass = "rfc2119" | "ears";

/** A recognised modal keyword occurrence in prose (spec §2.5.1). */
export interface ModalMarker {
  readonly kind: "modal";
  readonly cls: ModalMarkerClass;
  /** Canonical (lowercased RFC 2119 / case-preserved EARS) form. */
  readonly canonical: string;
  readonly range: SourceRange;
}

/** An inline `$Identifier` entity reference (spec §2.5.2). Reuses
 * the existing {@link EntityRefConvention}. */
export interface EntityRefMarker {
  readonly kind: "entity";
  /** Identifier including the leading `$`. */
  readonly ident: string;
  readonly convention: EntityRefConvention;
  readonly range: SourceRange;
}

/** Inline marker union (spec §2.5). */
export type InlineMarker = ModalMarker | EntityRefMarker;

/** Prose text plus the inline markers recognised within it. */
export interface InlineContent {
  readonly text: string;
  readonly markers: readonly InlineMarker[];
}

/** A list item: a sequence of blocks (spec §2.4 `List`). */
export interface ListItemNode {
  readonly blocks: readonly BodyBlock[];
  readonly range: SourceRange;
}

/** One `Term : definition` pair (spec §2.4 `DefinitionList`). */
export interface DefinitionPair {
  readonly term: InlineContent;
  readonly definition: InlineContent;
}

/** GitHub-style admonition kinds (spec §2.4 `Note`). */
export type AdmonitionKind =
  | "NOTE"
  | "TIP"
  | "IMPORTANT"
  | "WARNING"
  | "CAUTION";

export interface ParagraphNode {
  readonly kind: "paragraph";
  readonly content: InlineContent;
  readonly range: SourceRange;
}

export interface ListNode {
  readonly kind: "list";
  readonly ordered: boolean;
  readonly items: readonly ListItemNode[];
  readonly range: SourceRange;
}

export interface TableNode {
  readonly kind: "table";
  readonly header: readonly InlineContent[];
  readonly rows: readonly (readonly InlineContent[])[];
  readonly range: SourceRange;
}

export interface FigureNode {
  readonly kind: "figure";
  readonly alt: string;
  readonly path: string;
  readonly range: SourceRange;
}

export interface CodeNode {
  readonly kind: "code";
  /** Info-string language tag, or `undefined` for a bare fence. */
  readonly lang: string | undefined;
  readonly text: string;
  readonly range: SourceRange;
}

/** Fenced code with info-string `gherkin`. Gherkin is kept verbatim
 * for now; structured scenario parsing is deferred (spec §2 note). */
export interface FeatureNode {
  readonly kind: "feature";
  readonly source: string;
  readonly range: SourceRange;
}

export interface MathNode {
  readonly kind: "math";
  readonly tex: string;
  readonly range: SourceRange;
}

export interface DefinitionListNode {
  readonly kind: "definition-list";
  readonly items: readonly DefinitionPair[];
  readonly range: SourceRange;
}

export interface NoteNode {
  readonly kind: "note";
  readonly admonition: AdmonitionKind;
  readonly content: InlineContent;
  readonly range: SourceRange;
}

export interface BlockquoteNode {
  readonly kind: "blockquote";
  readonly content: InlineContent;
  readonly range: SourceRange;
}

/** §2.6 caption. Distinct from the render-pipeline `Caption`
 * (model/mod.ts) — unrelated concept. `block` (resolved owner) is
 * populated by the builder/validator in later PRs. */
export interface CaptionNode {
  readonly kind: "caption";
  readonly keyword:
    | "Figure"
    | "Table"
    | "Listing"
    | "Feature"
    | "Equation"
    | "List";
  readonly text: string;
  readonly position: "above" | "below";
  readonly block?: BodyBlock;
  readonly range: SourceRange;
}

/** Fallback for malformed / excluded constructs so content is never
 * lost (spec §5.4). Excluded constructs still emit MSL-B040–B043. */
export interface UnknownNode {
  readonly kind: "unknown";
  readonly raw: string;
  readonly range: SourceRange;
}

/** The closed body-block union (spec §2.4) + `caption` + `unknown`. */
export type BodyBlock =
  | ParagraphNode
  | ListNode
  | TableNode
  | FigureNode
  | CodeNode
  | FeatureNode
  | MathNode
  | DefinitionListNode
  | NoteNode
  | BlockquoteNode
  | CaptionNode
  | UnknownNode;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-read packages/markspec/core/ast/nodes_test.ts` Expected:
PASS — 2 tests ok.

- [ ] **Step 5: Re-export AST types from the library boundary**

In `packages/markspec/core/mod.ts`, immediately after the closing
`} from "./model/mod.ts";` of the type-export block (line 43), add:

```typescript
// AST (canonical body-AST — spec docs/specs/markspec-core-data-model.md §2)
export type {
  AdmonitionKind,
  BlockquoteNode,
  BodyBlock,
  CaptionNode,
  CodeNode,
  DefinitionListNode,
  DefinitionPair,
  EntityRefMarker,
  FeatureNode,
  FigureNode,
  InlineContent,
  InlineMarker,
  ListItemNode,
  ListNode,
  MathNode,
  ModalMarker,
  ModalMarkerClass,
  NoteNode,
  ParagraphNode,
  SourceRange,
  TableNode,
  UnknownNode,
} from "./ast/nodes.ts";
```

- [ ] **Step 6: Verify the boundary type-checks and the full gate is green**

Run: `deno check packages/markspec/core/mod.ts` Expected: OK — no errors.

Run: `just check` Expected: exit 0; test summary `ok | <N> passed | 0 failed` (N
= prior total + 2).

- [ ] **Step 7: Format and commit**

```bash
git checkout -b prompt-01-ast-pr1-node-types
git add packages/markspec/core/ast/nodes.ts \
  packages/markspec/core/ast/nodes_test.ts \
  packages/markspec/core/mod.ts
git commit -m "feat(core): canonical body-AST node type contract (Path A PR 1)

PR 1 of the canonical-body-AST plan (spec
docs/superpowers/specs/2026-05-15-canonical-body-ast-design.md).

Pure type contract for the §2.4 closed 10-block catalogue, §2.5
inline markers (ModalMarker, EntityRefMarker), and the §2.6
CaptionNode (distinct from the unrelated render-pipeline Caption).
EntityRefConvention reused from model. Zero behaviour; builder and
renderer land in PRs 2-3.

Re-exported from core/mod.ts (library boundary unchanged).
just check green.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

Then push, open PR, watch CI, merge on green, delete branch (the established
loop):

```bash
git push -u origin prompt-01-ast-pr1-node-types
gh pr create --base main --head prompt-01-ast-pr1-node-types \
  --title "feat(core): canonical body-AST node type contract (Path A PR 1)" \
  --body-file <(printf '%s\n' "## Summary" "PR 1 of canonical body-AST (spec 2026-05-15). Pure node type contract; zero behaviour. Re-exported from core/mod.ts." "" "## Test Plan" "- [x] colocated nodes_test.ts: marker typing + exhaustive block-union switch" "- [x] just check green" "" "🤖 Generated with [Claude Code](https://claude.com/claude-code)")
gh pr checks <N> --watch --interval 20
gh pr merge <N> --merge --delete-branch
```

---

## Self-Review

**Spec coverage:** PR 1 implements spec §3 (node taxonomy) + §4
`core/ast/nodes.ts` + the `core/mod.ts` boundary rule. Spec §4 build/render, §5
gate, §6 PRs 2–7, §7 four codes, §8 ADRs are covered by the roadmap table and
their just-in-time plans (scope decomposition — each is a working slice per the
skill's scope guidance). No spec section is unassigned.

**Placeholder scan:** PR 1 has complete code in every code step, exact paths,
exact commands with expected output. PRs 2–7 are a declared plan series with a
concrete contract table (files/acceptance/test-strategy), not in-task
placeholders — this is the skill's sanctioned decomposition for a multi-phase
refactor, not "implement later" hand-waving.

**Type consistency:** `SourceRange`, `InlineContent`, `ModalMarker`,
`EntityRefMarker`, `BodyBlock` and all member names are used identically in the
test (Step 1), the module (Step 3), and the re-export (Step 5).
`EntityRefConvention` is imported from `../model/mod.ts` (verified exported at
`core/mod.ts:30`). `CaptionNode` is deliberately distinct from the existing
`Caption`.
