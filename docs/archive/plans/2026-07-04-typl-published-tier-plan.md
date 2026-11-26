# typl Published/Namespaced Tier Implementation Plan (S5, #723)

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a published typl tier (`$powertrain.brake.pedal_position` —
dotted, declared once corpus-wide, citable anywhere) beside the unchanged
entry-local tier, retiring TYPL-002/003.

**Architecture:** Dots discriminate the tiers. An explicit `: namespace` kind
clause creates bases; `$.x` relative refs resolve through the merged S4 engine
(`core/decl/resolve.ts`) at parse time, so `Entry.types` carries absolute names
only and the registry/validator shape is unchanged. Citation validation is new:
bare published-shaped code spans are checked against the corpus registry in
`validateTypl`.

**Tech Stack:** Deno/TypeScript strict; existing typl lexer/grammar
(`core/typl/`); shared decl machinery (`core/decl/`); Deno test +
`tests/e2e/helpers.ts` blackbox harness.

**Spec:** `docs/wip/2026-07-04-typl-published-tier-design.md` (same branch).
Decision numbers below (D1–D8) refer to it.

## Global Constraints

- **NO `CORE_SCHEMA_VERSION` bump** (D1). The constant stays `1`.
- **TYPL-002/003 are deprecated, never deleted** (D7): codes stay in the
  `TyplCode` union and `TYPL_CODES` catalogue, marked deprecated, never emitted.
- **`core/parser/body_tokens.ts` (`ENTITY_REF_RE`) is untouched** — free-prose
  `$foo.bar` tokenization must not change (D6).
- Published name = `$` + ≥2 dot-separated segments (D2). Relative = `$.` prefix
  (D4). No half-absolute forms.
- Namespace declarations are scaffolding: never in `Entry.types.bindings`, never
  in the registry, not declared-once (D8).
- Zero warnings (`deno lint`, `deno check`); `deno fmt` + `dprint fmt` before
  every commit (pre-commit hook enforces).
- Conventional Commits, scope `core` (allowed-scope list excludes
  `typl`/`parser`).
- Commit per task locally; the PR is squash-merged (epic practice).
- NO CHANGELOG edits (release-time batching policy).
- Worktree:
  `/Users/sebastientasson/Workspace/driftsys/markspec/.claude/worktrees/story+723-typl-published-tier`
  — **every Bash command must `cd` there first** (file tools already point
  there; Bash does not).
- Run unit tests as `deno test packages/markspec/core/<dir>/`; e2e as
  `deno test --allow-run --allow-read --allow-write --allow-env tests/e2e/<file>`.

---

### Task 1: Acceptance test suite (e2e, written first — expected RED)

**Files:**

- Create: `tests/e2e/typl_published_test.ts`

**Interfaces:**

- Consumes: `markspec()` helper from `tests/e2e/helpers.ts` (blackbox; imports
  nothing from source).
- Produces: the story's acceptance gate. This file is NOT committed in this task
  — it stays working-tree-only (pre-commit runs no tests, but the suite must be
  green before push). It is committed in Task 10.

- [ ] **Step 1: Write the acceptance tests**

```typescript
/**
 * E2E acceptance tests for the typl published/namespaced tier (S5, #723).
 * Blackbox: drives `markspec check` only. See the design spec
 * docs/wip/2026-07-04-typl-published-tier-design.md.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const DECLARING_ENTRY = `- [REQ_0001] Brake signals contract

  The brake namespace (\`$powertrain.brake : namespace\`) declares:

  - \`$.pedal_position : signal float[0..100]\` — pedal travel percent.
  - \`$.line_pressure : signal float[0..250]\` — hydraulic pressure bar.

  Latency budgets apply to \`$.pedal_position\`.
`;

Deno.test("published: declared-once + relative-under-base is clean", async () => {
  const { code, stderr } = await markspec(["check", "a.md"], {
    "a.md": DECLARING_ENTRY,
  });
  assertEquals(code, 0, stderr);
});

Deno.test("published: duplicate declaration across files is TYPL-009", async () => {
  const dup = `- [REQ_0002] Second declaration

  Duplicate: \`$powertrain.brake.pedal_position : signal float[0..100]\`.
`;
  const { code, stderr } = await markspec(["check", "a.md", "b.md"], {
    "a.md": DECLARING_ENTRY,
    "b.md": dup,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "TYPL-009");
});

Deno.test("published: absolute citation from another entry is clean", async () => {
  const citing = `- [REQ_0003] Pedal latency

  The system shall sample \`$powertrain.brake.pedal_position\` within 5 ms.
`;
  const { code, stderr } = await markspec(["check", "a.md", "b.md"], {
    "a.md": DECLARING_ENTRY,
    "b.md": citing,
  });
  assertEquals(code, 0, stderr);
});

Deno.test("published: citation of undeclared symbol is TYPL-011", async () => {
  const citing = `- [REQ_0004] Ghost citation

  The system shall read \`$powertrain.brake.rotor_temp\` each cycle.
`;
  const { code, stderr } = await markspec(["check", "a.md", "b.md"], {
    "a.md": DECLARING_ENTRY,
    "b.md": citing,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "TYPL-011");
});

Deno.test("published: relative ref with no base is TYPL-010", async () => {
  const orphan = `- [REQ_0005] Orphan relative

  Declares \`$.pedal_position : signal float[0..100]\` with no namespace.
`;
  const { code, stderr } = await markspec(["check", "a.md"], {
    "a.md": orphan,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "TYPL-010");
});

Deno.test("published: two root namespaces is TYPL-012", async () => {
  const twoRoots = `- [REQ_0006] Two roots

  First (\`$powertrain.brake : namespace\`) and second
  (\`$cabin.hvac : namespace\`) roots.
`;
  const { code, stderr } = await markspec(["check", "a.md"], {
    "a.md": twoRoots,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "TYPL-012");
});

Deno.test("published: namespace with a shape is TYPL-006", async () => {
  const badNs = `- [REQ_0007] Malformed namespace

  Declares \`$powertrain.brake : namespace float\`.
`;
  const { code, stderr } = await markspec(["check", "a.md"], {
    "a.md": badNs,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "TYPL-006");
});

Deno.test("compat: entry-local same-name different-shape no longer errors", async () => {
  // Under the retired flat-global model this was TYPL-003. Two entries,
  // two unrelated entry-local symbols (D7 relaxation).
  const a = `- [REQ_0008] Local A

  Declares \`$speed : signal float[0..300]\`.
`;
  const b = `- [REQ_0009] Local B

  Declares \`$speed : state\`.
`;
  const { code, stderr } = await markspec(["check", "a.md", "b.md"], {
    "a.md": a,
    "b.md": b,
  });
  assertEquals(code, 0, stderr);
  assertEquals(stderr.includes("TYPL-002"), false);
  assertEquals(stderr.includes("TYPL-003"), false);
});

Deno.test("compat: free-prose $foo.bar stays opaque", async () => {
  const prose = `- [REQ_0010] Prose mention

  The shell variable $HOME.backup is not a typl symbol; neither is
  $foo.bar outside a code span.
`;
  const { code, stderr } = await markspec(["check", "a.md"], {
    "a.md": prose,
  });
  assertEquals(code, 0, stderr);
  assertEquals(stderr.includes("TYPL-"), false);
});
```

- [ ] **Step 2: Run to verify the suite fails (RED)**

Run:
`cd <worktree> && deno test --allow-run --allow-read --allow-write --allow-env tests/e2e/typl_published_test.ts`
Expected: FAIL — TYPL-009/010/011/012 tests fail (codes don't exist yet); the
declaring-entry test fails (dotted `$` names not yet lexed as one token). Do NOT
commit; proceed.

---

### Task 2: Lexer — dotted and relative `DOLLAR_IDENT`

**Files:**

- Modify: `packages/markspec/core/typl/lexer.ts:129-144` (the `$` branch)
- Test: `packages/markspec/core/typl/lexer_test.ts`

**Interfaces:**

- Produces: `tokenize()` (signature unchanged) now emits one `DOLLAR_IDENT` for
  `$a.b.c` and `$.x`. A dot is consumed only when followed by an identifier
  character, so `float[0..100]` ranges (`DOTDOT`) and trailing dots are never
  eaten.

- [ ] **Step 1: Write the failing tests** (append to `lexer_test.ts`)

```typescript
Deno.test("lexer: dotted DOLLAR_IDENT is one token", () => {
  const { tokens } = tokenize("$powertrain.brake.pedal_position : signal");
  assertEquals(tokens[0].kind, "DOLLAR_IDENT");
  assertEquals(tokens[0].value, "$powertrain.brake.pedal_position");
  assertEquals(tokens[1].kind, "COLON");
});

Deno.test("lexer: relative $.name is one token", () => {
  const { tokens } = tokenize("$.pedal_position : signal");
  assertEquals(tokens[0].kind, "DOLLAR_IDENT");
  assertEquals(tokens[0].value, "$.pedal_position");
});

Deno.test("lexer: dot not followed by ident char ends the token", () => {
  const { tokens } = tokenize("$a..b");
  assertEquals(tokens[0].value, "$a");
  assertEquals(tokens[1].kind, "DOTDOT");
  assertEquals(tokens[2].kind, "IDENT");
});

Deno.test("lexer: trailing dot is not consumed", () => {
  const { tokens } = tokenize("$a. x");
  assertEquals(tokens[0].value, "$a");
  assertEquals(tokens[1].kind, "DOT");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd <worktree> && deno test packages/markspec/core/typl/lexer_test.ts`
Expected: FAIL — `$powertrain` splits at the first dot.

- [ ] **Step 3: Implement** — replace the `$` branch body in `lexer.ts`:

```typescript
// ── Dollar-prefixed identifier — `$Speed`, `$a.b.c`, `$.x` ──────
// $ identifier — body uses IDENT_BODY_RE (allows digits) intentionally;
// names like $1st are lexically valid and rejected by the parser.
// Dotted paths (published tier, #723): a `.` is consumed only when an
// identifier character follows, so `float[0..100]` ranges and trailing
// dots never get eaten. A leading `.` right after `$` marks a relative
// published ref (`$.name`).
if (ch === "$") {
  const startCol = column;
  let value = "$";
  i++;
  column++;
  if (
    source[i] === "." && i + 1 < source.length &&
    IDENT_BODY_RE.test(source[i + 1])
  ) {
    value += ".";
    i++;
    column++;
  }
  while (i < source.length) {
    if (IDENT_BODY_RE.test(source[i])) {
      value += source[i];
      i++;
      column++;
    } else if (
      source[i] === "." && i + 1 < source.length &&
      IDENT_BODY_RE.test(source[i + 1])
    ) {
      value += ".";
      i++;
      column++;
    } else {
      break;
    }
  }
  push("DOLLAR_IDENT", value, startCol);
  continue;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `cd <worktree> && deno test packages/markspec/core/typl/` Expected: PASS
(all typl unit suites — existing lexer tests unchanged).

- [ ] **Step 5: Commit**

```bash
cd <worktree> && git add packages/markspec/core/typl/lexer.ts packages/markspec/core/typl/lexer_test.ts && git commit -m "feat(core): lex dotted and relative typl names as one token (#723)"
```

---

### Task 3: `namespace` kind + grammar rules

**Files:**

- Modify: `packages/markspec/core/typl/ast.ts:12-22` (KINDS)
- Modify: `packages/markspec/core/typl/grammar.ts:103-147` (`parseBinding`)
- Test: `packages/markspec/core/typl/grammar_test.ts`

**Interfaces:**

- Produces: `KINDS` gains `"namespace"` (so `Kind` includes it; the TYPL-007
  message list updates automatically via `EXPLICIT_KIND_LIST`). `parseBinding`
  rejects a shape after `: namespace` with TYPL-006.

- [ ] **Step 1: Write the failing tests** (append to `grammar_test.ts`)

```typescript
Deno.test("grammar: namespace declaration parses without shape", () => {
  const { ast, diagnostics } = parseTyplBlock(
    "$powertrain.brake : namespace",
  );
  assertEquals(diagnostics.length, 0);
  assertEquals(ast.bindings.length, 1);
  assertEquals(ast.bindings[0].name, "$powertrain.brake");
  assertEquals(ast.bindings[0].kind, "namespace");
  assertEquals(ast.bindings[0].shape, undefined);
});

Deno.test("grammar: namespace with a shape is TYPL-006", () => {
  const { diagnostics } = parseTyplBlock(
    "$powertrain.brake : namespace float",
  );
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "TYPL-006");
});

Deno.test("grammar: relative binding name parses", () => {
  const { ast, diagnostics } = parseTyplBlock(
    "$.pedal_position : signal float[0..100]",
  );
  assertEquals(diagnostics.length, 0);
  assertEquals(ast.bindings[0].name, "$.pedal_position");
  assertEquals(ast.bindings[0].kind, "signal");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd <worktree> && deno test packages/markspec/core/typl/grammar_test.ts`
Expected: FAIL — `namespace` fires TYPL-007 (unknown kind).

- [ ] **Step 3: Implement**

In `ast.ts`, append to KINDS (comment included):

```typescript
export const KINDS = [
  "value",
  "event",
  "signal",
  "command",
  "state",
  "const",
  "config",
  "document",
  "stream",
  // Published-tier scaffolding (#723): a namespace declaration creates a
  // base for relative refs; it is not a symbol and carries no shape.
  "namespace",
] as const;
```

In `grammar.ts` `parseBinding`, after `const shape = this.parseShapeOptional();`
and before the `return`:

```typescript
// A namespace declaration (#723) is scaffolding — it establishes a
// base for relative refs and must not carry a shape.
if (kind === "namespace" && shape !== undefined) {
  this.diagnostics.push(
    typlDiagnostic(
      "TYPL-006",
      { detail: "a namespace declaration carries no shape" },
      nameTok.position,
    ),
  );
  return undefined;
}
```

- [ ] **Step 4: Run typl suites; fix any TYPL-007 message assertion** (the kind
      list in the message now ends with `namespace` — update the expected string
      in the existing test if one asserts it verbatim).

Run: `cd <worktree> && deno test packages/markspec/core/typl/` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd <worktree> && git add packages/markspec/core/typl/ast.ts packages/markspec/core/typl/grammar.ts packages/markspec/core/typl/grammar_test.ts && git commit -m "feat(core): add namespace kind for typl published-tier bases (#723)"
```

---

### Task 4: Recognizer — dotted/relative declarations reach the surfaces

**Files:**

- Modify: `packages/markspec/core/typl/recognize.ts:14`
- Test: create `packages/markspec/core/typl/recognize_test.ts`

**Interfaces:**

- Produces: `isTyplDeclarationText` (signature unchanged) now matches `$a.b :`
  and `$.x :` so the fence/bullet/inline surface walkers extract them.

- [ ] **Step 1: Write the failing test**

```typescript
import { assertEquals } from "@std/assert";
import { isTyplDeclarationText } from "./recognize.ts";

Deno.test("recognize: dotted and relative bindings", () => {
  assertEquals(isTyplDeclarationText("$powertrain.brake : namespace"), true);
  assertEquals(
    isTyplDeclarationText("$.pedal_position : signal float[0..100]"),
    true,
  );
  assertEquals(isTyplDeclarationText("$Speed : signal"), true); // unchanged
  assertEquals(isTyplDeclarationText("$powertrain.brake"), false); // citation, not decl
  assertEquals(isTyplDeclarationText("prose text"), false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd <worktree> && deno test packages/markspec/core/typl/recognize_test.ts`
Expected: FAIL on the dotted/relative cases.

- [ ] **Step 3: Implement** — replace `BINDING_RE`:

```typescript
/** Matches a typl binding: `$Name :`, `$a.b :` (published), `$.x :` (relative). */
const BINDING_RE = /^\$\.?[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)*\s*:/;
```

- [ ] **Step 4: Run to verify pass**

Run: `cd <worktree> && deno test packages/markspec/core/typl/` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd <worktree> && git add packages/markspec/core/typl/recognize.ts packages/markspec/core/typl/recognize_test.ts && git commit -m "feat(core): recognize dotted and relative typl declarations (#723)"
```

---

### Task 5: core/decl — nesting-aware bullet extraction

**Files:**

- Modify: `packages/markspec/core/decl/surfaces.ts` (add
  `NestedBlockDeclaration` + `extractNestedBulletDeclarations`; make
  `extractBulletDeclarations` delegate)
- Modify: `packages/markspec/core/decl/mod.ts` (export both)
- Test: `packages/markspec/core/decl/surfaces_test.ts`

**Interfaces:**

- Produces:
  - `interface NestedBlockDeclaration extends BlockDeclaration { readonly parent?: number }`
    — `parent` is the index (into the returned array) of the nearest enclosing
    extracted declaration; parents always precede children (`parent < index`).
  - `extractNestedBulletDeclarations(blocks: readonly BodyBlock[], matchText: TextRecognizer): readonly NestedBlockDeclaration[]`
    — same source-order output as `extractBulletDeclarations`, plus parent
    links.
- Consumed by: Task 6 (typl bullet adapter) and Task 7 (assembly scope chains).

- [ ] **Step 1: Write the failing test** (append to `surfaces_test.ts`; build
      the body AST the same way existing tests in that file do — reuse its
      helper)

```typescript
Deno.test("extractNestedBulletDeclarations: parent links follow nesting", () => {
  // - DECL root
  //   - DECL child-a
  //     - DECL grandchild
  //   - not a decl
  //   - DECL child-b
  const blocks = parseBodyBlocks(`- DECL root
  - DECL child-a
    - DECL grandchild
  - plain bullet
  - DECL child-b
`);
  const out = extractNestedBulletDeclarations(
    blocks,
    (t) => t.startsWith("DECL"),
  );
  assertEquals(out.map((d) => d.source), [
    "DECL root",
    "DECL child-a",
    "DECL grandchild",
    "DECL child-b",
  ]);
  assertEquals(out[0].parent, undefined);
  assertEquals(out[1].parent, 0);
  assertEquals(out[2].parent, 1);
  assertEquals(out[3].parent, 0);
});

Deno.test("extractBulletDeclarations output is unchanged by the delegation", () => {
  const blocks = parseBodyBlocks(`- DECL a
  - DECL b
`);
  const flat = extractBulletDeclarations(blocks, (t) => t.startsWith("DECL"));
  assertEquals(flat.map((d) => d.source), ["DECL a", "DECL b"]);
  assertEquals("parent" in flat[0], false);
});
```

(If `surfaces_test.ts` has no body-AST helper, use the same construction path
its existing bullet tests use — do not invent a new fixture style.)

- [ ] **Step 2: Run to verify failure**

Run: `cd <worktree> && deno test packages/markspec/core/decl/` Expected: FAIL —
`extractNestedBulletDeclarations` not defined.

- [ ] **Step 3: Implement** in `surfaces.ts` (below
      `extractBulletDeclarations`):

```typescript
/**
 * A bullet declaration with its structural parent: the index (into the
 * returned array) of the nearest enclosing extracted declaration, or
 * `undefined` at top level. Parents always precede children in the
 * depth-first output order, so `parent < index` holds for every link.
 * The base-resolution engine (resolve.ts) consumes these links to build
 * its innermost-wins scope chains (#723).
 */
export interface NestedBlockDeclaration extends BlockDeclaration {
  readonly parent?: number;
}

/**
 * Nesting-aware variant of {@linkcode extractBulletDeclarations}: same
 * declarations in the same depth-first source order, plus a `parent`
 * link per declaration. A DSL host walks the links to build the
 * {@linkcode BaseScope} chain a nested declaration resolves against.
 */
export function extractNestedBulletDeclarations(
  blocks: readonly BodyBlock[],
  matchText: TextRecognizer,
): readonly NestedBlockDeclaration[] {
  const results: NestedBlockDeclaration[] = [];
  const walk = (
    blocks: readonly BodyBlock[],
    parent: number | undefined,
  ): void => {
    for (const block of blocks) {
      if (block.kind !== "list") continue;
      for (const item of block.items) {
        if (item.blocks.length === 0) continue;
        const first = item.blocks[0];
        let itemParent = parent;
        if (first.kind === "paragraph" && matchText(first.content.text)) {
          results.push({
            source: first.content.text,
            range: first.range,
            parent,
          });
          itemParent = results.length - 1;
        }
        if (item.blocks.length > 1) {
          walk(item.blocks.slice(1), itemParent);
        } else if (first.kind === "list") {
          walk([first], itemParent);
        }
      }
    }
  };
  walk(blocks, undefined);
  return results;
}
```

Then replace the body of `extractBulletDeclarations` with a delegation (output
must stay identical — same order, no `parent` key):

```typescript
export function extractBulletDeclarations(
  blocks: readonly BodyBlock[],
  matchText: TextRecognizer,
): readonly BlockDeclaration[] {
  return extractNestedBulletDeclarations(blocks, matchText)
    .map(({ source, range }) => ({ source, range }));
}
```

Export both names from `core/decl/mod.ts`.

- [ ] **Step 4: Run decl + typl + parser suites** (delegation must be
      behavior-preserving)

Run:
`cd <worktree> && deno test packages/markspec/core/decl/ packages/markspec/core/typl/ packages/markspec/core/parser/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd <worktree> && git add packages/markspec/core/decl/ && git commit -m "feat(core): nesting-aware bullet declaration extraction (#723)"
```

---

### Task 6: typl resolve module + diagnostics codes

**Files:**

- Create: `packages/markspec/core/typl/resolve.ts`
- Create: `packages/markspec/core/typl/resolve_test.ts`
- Modify: `packages/markspec/core/typl/diagnostics.ts` (codes 009–012; deprecate
  002/003)
- Modify: `packages/markspec/core/typl/bullet.ts` (nested adapter)
- Modify: `packages/markspec/core/typl/mod.ts` (exports)

**Interfaces:**

- Produces (consumed by Tasks 7–9):
  - `isRelativeTyplName(name: string): boolean` — true for `$.x`, `$.a.b`.
  - `isPublishedTyplName(name: string): boolean` — true for `$a.b`+ (≥2
    segments).
  - `typlPathOf(name: string): string` — strips the `$` sigil.
  - `TYPL_REF_OPS: RefOps` — engine parameterization (`isAbsolute`, `join`).
  - `extractTyplBulletsNested(blocks: readonly BodyBlock[]): readonly NestedBlockDeclaration[]`.
  - `TyplCode` gains `"TYPL-009" | "TYPL-010" | "TYPL-011" | "TYPL-012"`.

- [ ] **Step 1: Write the failing tests** (`resolve_test.ts`)

```typescript
import { assertEquals } from "@std/assert";
import { resolveRef } from "../decl/mod.ts";
import {
  isPublishedTyplName,
  isRelativeTyplName,
  TYPL_REF_OPS,
  typlPathOf,
} from "./resolve.ts";

Deno.test("resolve: name predicates", () => {
  assertEquals(isRelativeTyplName("$.pedal_position"), true);
  assertEquals(isRelativeTyplName("$pedal"), false);
  assertEquals(isPublishedTyplName("$powertrain.brake"), true);
  assertEquals(isPublishedTyplName("$pedal"), false);
  assertEquals(isPublishedTyplName("$.x"), false);
  assertEquals(typlPathOf("$powertrain.brake"), "powertrain.brake");
});

Deno.test("resolve: relative joins innermost base", () => {
  const scope = { base: "powertrain.brake", parent: { base: "powertrain" } };
  const r = resolveRef("$.pedal_position", scope, TYPL_REF_OPS);
  assertEquals(r, { ok: true, ref: "$powertrain.brake.pedal_position" });
});

Deno.test("resolve: absolute passes through; no base fails", () => {
  const abs = resolveRef("$a.b", undefined, TYPL_REF_OPS);
  assertEquals(abs, { ok: true, ref: "$a.b" });
  const rel = resolveRef("$.x", undefined, TYPL_REF_OPS);
  assertEquals(rel, { ok: false, reason: "no-base-in-scope" });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd <worktree> && deno test packages/markspec/core/typl/resolve_test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `resolve.ts`**

```typescript
/**
 * @module typl/resolve
 *
 * typl instantiation of the DSL-agnostic base-resolution engine
 * (core/decl/resolve, #722). Published typl symbols are dotted paths
 * (`$powertrain.brake.pedal_position`, ≥2 segments); relative refs keep
 * the sigil and mark relativity with a leading dot (`$.pedal_position`).
 * `$` is a *sigil* (part of the token), not a URI scheme — unlike uxil's
 * `ux:`, it stays on relative forms. See the S5 design spec
 * (docs/wip/2026-07-04-typl-published-tier-design.md, D2–D5).
 */
import type { RefOps } from "../decl/mod.ts";

/** True for `$.x` / `$.a.b` — a relative published ref. */
export function isRelativeTyplName(name: string): boolean {
  return /^\$\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(name);
}

/** True for `$a.b` / `$a.b.c` — an absolute published name (≥2 segments). */
export function isPublishedTyplName(name: string): boolean {
  return /^\$[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(name);
}

/** Strip the `$` sigil: `$powertrain.brake` → `powertrain.brake`. */
export function typlPathOf(name: string): string {
  return name.startsWith("$") ? name.slice(1) : name;
}

/**
 * Engine parameterization for typl: absolute = the sigil is followed by
 * an identifier character; join = base path + relative segments with the
 * sigil restored (`join("powertrain.brake", "$.x")` → `$powertrain.brake.x`).
 */
export const TYPL_REF_OPS: RefOps = {
  isAbsolute: (ref) => /^\$[A-Za-z_]/.test(ref),
  join: (base, ref) => `$${base}.${ref.slice(2)}`,
};
```

- [ ] **Step 4: Add diagnostic codes** in `diagnostics.ts` — extend the union:

```typescript
export type TyplCode =
  | "TYPL-001"
  | "TYPL-002"
  | "TYPL-003"
  | "TYPL-004"
  | "TYPL-005"
  | "TYPL-006"
  | "TYPL-007"
  | "TYPL-008"
  | "TYPL-009"
  | "TYPL-010"
  | "TYPL-011"
  | "TYPL-012";
```

Add catalogue entries after `TYPL-008` (and add a deprecation note in the doc
comments directly above the `TYPL-002` and `TYPL-003` entries:
`// Deprecated (#723): retired by the published tier. Kept resolvable for tooling; never emitted.`):

```typescript
"TYPL-009": {
  severity: "error",
  template:
    "${name} is already declared in ${otherFile}:${otherLine} (published symbols are declared exactly once).",
},
"TYPL-010": {
  severity: "error",
  template: "Relative reference ${name} has no namespace base in scope.",
},
"TYPL-011": {
  severity: "error",
  template: "Citation of undeclared published symbol ${name}.",
},
"TYPL-012": {
  severity: "error",
  template:
    "Multiple root namespace declarations in one entry (root is ${first}).",
},
```

- [ ] **Step 5: Add the nested bullet adapter** in `bullet.ts`:

```typescript
import type { NestedBlockDeclaration } from "../decl/mod.ts";
import { extractNestedBulletDeclarations } from "../decl/mod.ts";

/** A typl bullet declaration with its structural parent link (#723). */
export type TyplNestedBulletExtraction = NestedBlockDeclaration;

/**
 * Nesting-aware variant of {@linkcode extractTyplBullets}: same items in
 * the same order, plus parent links for base-resolution scope chains.
 */
export function extractTyplBulletsNested(
  blocks: readonly BodyBlock[],
): readonly TyplNestedBulletExtraction[] {
  return extractNestedBulletDeclarations(blocks, isTyplDeclarationText);
}
```

Export `resolve.ts` names, the nested adapter, and the new types from
`typl/mod.ts`.

- [ ] **Step 6: Run to verify pass**

Run: `cd <worktree> && deno test packages/markspec/core/typl/` Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd <worktree> && git add packages/markspec/core/typl/ && git commit -m "feat(core): typl ref-ops, published-name predicates, TYPL-009..012 codes (#723)"
```

---

### Task 7: Assembly — parse-time resolution, roots, `rootNamespace`

**Files:**

- Create: `packages/markspec/core/typl/assemble.ts`
- Create: `packages/markspec/core/typl/assemble_test.ts`
- Modify: `packages/markspec/core/typl/ast.ts` (TyplBlock gains
  `rootNamespace?`)
- Modify: `packages/markspec/core/parser/markdown.ts:597-652` (replace the three
  inline loops with one call)
- Modify: `packages/markspec/core/typl/mod.ts` (export)

**Interfaces:**

- Produces:
  `assembleTyplTypes(bodyAst: readonly BodyBlock[], bodyTokens: readonly BodyToken[], file: string, bodyStartLine: number): { types?: TyplBlock; diagnostics: Diagnostic[] }`
  - `TyplBlock` gains `readonly rootNamespace?: string` (path without `$`, e.g.
    `"powertrain.brake"`) — consumed by Task 9's citation resolution.
  - All bindings in `types.bindings` carry **absolute** names; namespace
    bindings are excluded; relative bindings that fail to resolve are dropped
    with TYPL-010.
- Consumes: `extractTyplFences`, `extractTyplBulletsNested`,
  `extractTyplInlines`, `parseTyplBlock`, `bridgeTyplDiagnostic`, `resolveRef` +
  `BaseScope` (export from `core/decl/mod.ts` if not already), `TYPL_REF_OPS`,
  `typlPathOf`, `typlDiagnostic`.

**Semantics implemented (spec D5), three passes so root visibility is
order-independent:**

1. **Pass A — find the root:** root candidates are namespace bindings that are
   **absolute** and have **no namespace ancestor** in their bullet chain (a
   relative namespace can never be a root). First candidate in source order
   wins; each additional candidate fires TYPL-012 and establishes nothing.
2. **Pass B — establish bases:** in source order (bullet parents always precede
   children), each namespace binding's own name is resolved — absolute passes
   through; relative resolves against its bullet-ancestor bases + the root
   (TYPL-010 if neither) — and becomes the base its bullet subtree resolves
   against.
3. **Pass C — resolve bindings:** every non-namespace binding resolves against
   its bullet-ancestor chain terminated by the root base (innermost wins).
   Inline/fence blocks have no bullet chain, so their relative refs resolve
   against the root only (documented v1 simplification).

- [ ] **Step 1: Write the failing tests** (`assemble_test.ts`; drive through
      `parseFile` — the parser-level markdown fixture used by `markdown_test.ts`
      — or call `assembleTyplTypes` directly with a parsed body; follow
      whichever pattern `markdown_test.ts` uses for typl fixtures)

```typescript
Deno.test("assemble: relative bullets resolve under a root namespace", async () => {
  const md = `- [REQ_0001] Contract

  Root (\`$powertrain.brake : namespace\`) declares:

  - \`$.pedal_position : signal float[0..100]\` — pedal.
  - \`$.line_pressure : signal float[0..250]\` — pressure.
`;
  const { entries, diagnostics } = await parseFile(md, { file: "a.md" });
  assertEquals(diagnostics.filter((d) => d.code.startsWith("TYPL")), []);
  const types = entries[0].types!;
  assertEquals(types.rootNamespace, "powertrain.brake");
  assertEquals(types.bindings.map((b) => b.name), [
    "$powertrain.brake.pedal_position",
    "$powertrain.brake.line_pressure",
  ]);
});

Deno.test("assemble: nested namespace bullet scopes its subtree (innermost wins)", async () => {
  const md = `- [REQ_0002] Contract

  - \`$powertrain : namespace\`
    - \`$.brake : namespace\`
      - \`$.pedal : signal\`
    - \`$.speed : signal\`
`;
  const { entries } = await parseFile(md, { file: "a.md" });
  const names = entries[0].types!.bindings.map((b) => b.name);
  assertEquals(names, ["$powertrain.brake.pedal", "$powertrain.speed"]);
  assertEquals(entries[0].types!.rootNamespace, "powertrain");
});

Deno.test("assemble: relative with no base is TYPL-010, binding dropped", async () => {
  const md = `- [REQ_0003] Orphan

  Declares \`$.pedal : signal\`.
`;
  const { entries, diagnostics } = await parseFile(md, { file: "a.md" });
  assertEquals(diagnostics.some((d) => d.code === "TYPL-010"), true);
  assertEquals(entries[0].types, undefined);
});

Deno.test("assemble: second root namespace is TYPL-012; first wins", async () => {
  const md = `- [REQ_0004] Two roots

  First (\`$powertrain : namespace\`), second (\`$cabin : namespace\`),
  and \`$.speed : signal\`.
`;
  const { entries, diagnostics } = await parseFile(md, { file: "a.md" });
  assertEquals(diagnostics.some((d) => d.code === "TYPL-012"), true);
  assertEquals(entries[0].types!.rootNamespace, "powertrain");
  assertEquals(entries[0].types!.bindings.map((b) => b.name), [
    "$powertrain.speed",
  ]);
});

Deno.test("assemble: namespace bindings never enter Entry.types.bindings", async () => {
  const md = `- [REQ_0005] Contract

  Root (\`$powertrain.brake : namespace\`) and \`$local : signal\`.
`;
  const { entries } = await parseFile(md, { file: "a.md" });
  assertEquals(entries[0].types!.bindings.map((b) => b.name), ["$local"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd <worktree> && deno test packages/markspec/core/typl/assemble_test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `assemble.ts`**

```typescript
/**
 * @module typl/assemble
 *
 * Entry-level typl assembly (#723): extracts declarations from the three
 * surfaces (fence / bullet / inline), resolves published names through
 * the base-resolution engine (core/decl/resolve), and aggregates the
 * result into the `Entry.types` TyplBlock. Moved out of parser/markdown.ts
 * so the parser calls one function.
 *
 * Resolution rules (design spec D5):
 *   - a `: namespace` binding establishes a base; nested-bullet namespaces
 *     scope their subtree (innermost wins); the root namespace (no
 *     namespace ancestor) scopes the whole entry body, order-independent;
 *   - relative names (`$.x`) resolve to absolute dotted names before
 *     aggregation — Entry.types carries absolute names only;
 *   - namespace bindings are scaffolding: excluded from bindings;
 *   - a relative name with no base is TYPL-010 (binding dropped);
 *   - a second root is TYPL-012 (first root wins);
 *   - inline/fence relative refs resolve against the root base only.
 */
import type { BodyBlock } from "../ast/nodes.ts";
import type { BodyToken, Diagnostic } from "../model/mod.ts";
import type { Binding, TyplBlock, Typedef } from "./ast.ts";
import { type BaseScope, resolveRef } from "../decl/mod.ts";
import { bridgeTyplDiagnostic } from "./bridge.ts";
import { typlDiagnostic } from "./diagnostics.ts";
import { extractTyplFences } from "./fence.ts";
import { extractTyplBulletsNested } from "./bullet.ts";
import { extractTyplInlines } from "./inline.ts";
import { parseTyplBlock } from "./grammar.ts";
import { TYPL_REF_OPS, typlPathOf } from "./resolve.ts";

/** One parsed surface block with its diagnostic bridge offset and (for
 * bullets) the index of its parent bullet declaration. */
interface SurfaceBlock {
  readonly bindings: readonly Binding[];
  readonly typedefs: readonly Typedef[];
  readonly file: string;
  readonly lineOffset: number;
  /** Index into the bullet-extraction array of the enclosing bullet
   * declaration. Always undefined for fence and inline blocks. */
  readonly bulletParent?: number;
}

export function assembleTyplTypes(
  bodyAst: readonly BodyBlock[],
  bodyTokens: readonly BodyToken[],
  file: string,
  bodyStartLine: number,
): { types?: TyplBlock; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const blocks: SurfaceBlock[] = [];
  // Map bullet-extraction index → blocks[] index, for parent lookups.
  const bulletBlockIndex: number[] = [];

  for (const fence of extractTyplFences(bodyAst)) {
    const result = parseTyplBlock(fence.source);
    const lineOffset = bodyStartLine + fence.range.start.line - 1;
    for (const td of result.diagnostics) {
      diagnostics.push(bridgeTyplDiagnostic(td, file, lineOffset));
    }
    blocks.push({ ...result.ast, file, lineOffset });
  }

  const bullets = extractTyplBulletsNested(bodyAst);
  for (const bullet of bullets) {
    const result = parseTyplBlock(bullet.source);
    const lineOffset = bodyStartLine + bullet.range.start.line - 2;
    for (const td of result.diagnostics) {
      diagnostics.push(bridgeTyplDiagnostic(td, file, lineOffset));
    }
    bulletBlockIndex.push(blocks.length);
    blocks.push({
      ...result.ast,
      file,
      lineOffset,
      bulletParent: bullet.parent,
    });
  }

  for (const inline of extractTyplInlines(bodyTokens)) {
    const result = parseTyplBlock(inline.source);
    const lineOffset = inline.location.line - 1;
    for (const td of result.diagnostics) {
      diagnostics.push(bridgeTyplDiagnostic(td, inline.location.file, lineOffset));
    }
    blocks.push({ ...result.ast, file: inline.location.file, lineOffset });
  }

  // Emit a bridged typl diagnostic for a binding in blocks[i].
  const emit = (
    code: "TYPL-010" | "TYPL-012",
    params: Record<string, string>,
    i: number,
    position: { line: number; column: number },
  ): void => {
    const td = typlDiagnostic(code, params, position);
    diagnostics.push(
      bridgeTyplDiagnostic(td, blocks[i].file, blocks[i].lineOffset),
    );
  };

  // blockHasNamespace / hasNamespaceAncestor are static structure checks
  // (independent of resolution), so Pass A is order-independent.
  const blockHasNamespace = blocks.map((b) =>
    b.bindings.some((x) => x.kind === "namespace")
  );
  const hasNamespaceAncestor = (i: number): boolean => {
    let p = blocks[i].bulletParent;
    while (p !== undefined) {
      const idx = bulletBlockIndex[p];
      if (blockHasNamespace[idx]) return true;
      p = blocks[idx].bulletParent;
    }
    return false;
  };

  // ── Pass A: find the root ────────────────────────────────────────────
  // Root candidate = an ABSOLUTE namespace binding with no namespace
  // ancestor in its bullet chain (a relative namespace can never be a
  // root — it needs a base itself). First candidate in source order wins
  // (order-independent for authors: the root scopes the whole body);
  // every additional candidate fires TYPL-012 and establishes nothing.
  let rootPath: string | undefined;
  for (let i = 0; i < blocks.length; i++) {
    for (const binding of blocks[i].bindings) {
      if (binding.kind !== "namespace") continue;
      if (!TYPL_REF_OPS.isAbsolute(binding.name)) continue;
      if (hasNamespaceAncestor(i)) continue;
      if (rootPath === undefined) {
        rootPath = typlPathOf(binding.name);
      } else {
        emit("TYPL-012", { first: `$${rootPath}` }, i, binding.position);
      }
    }
  }

  // basePathOfBlock[i] = the base path blocks[i] provides to its bullet
  // subtree, or undefined. One base slot per block: a block with several
  // namespace bindings keeps the last (bullet blocks hold a single
  // declaration in practice).
  const basePathOfBlock: (string | undefined)[] = blocks.map(() => undefined);

  /**
   * Scope chain for blocks[i]: bullet-ancestor bases innermost-first,
   * terminated by the root base. Built immutably per call; non-bullet
   * blocks (fence/inline) have no bullet chain and see the root only.
   */
  const scopeFor = (i: number): BaseScope | undefined => {
    const chain: string[] = []; // innermost first
    let p = blocks[i].bulletParent;
    while (p !== undefined) {
      const idx = bulletBlockIndex[p];
      const base = basePathOfBlock[idx];
      if (base !== undefined) chain.push(base);
      p = blocks[idx].bulletParent;
    }
    let scope: BaseScope | undefined = rootPath !== undefined
      ? { base: rootPath }
      : undefined;
    for (let k = chain.length - 1; k >= 0; k--) {
      scope = { base: chain[k], parent: scope };
    }
    return scope;
  };

  // ── Pass B: establish bases ──────────────────────────────────────────
  // Source order is parents-before-children (bullet extraction is
  // depth-first), so an ancestor's base is always resolved before its
  // descendants need it. A relative namespace resolves against its own
  // chain (TYPL-010 when there is none). Extra roots (TYPL-012 in Pass A)
  // establish no base.
  for (let i = 0; i < blocks.length; i++) {
    for (const binding of blocks[i].bindings) {
      if (binding.kind !== "namespace") continue;
      if (TYPL_REF_OPS.isAbsolute(binding.name)) {
        const path = typlPathOf(binding.name);
        const isExtraRoot = !hasNamespaceAncestor(i) && path !== rootPath;
        if (!isExtraRoot) basePathOfBlock[i] = path;
        continue;
      }
      const res = resolveRef(binding.name, scopeFor(i), TYPL_REF_OPS);
      if (!res.ok) {
        emit("TYPL-010", { name: binding.name }, i, binding.position);
        continue;
      }
      basePathOfBlock[i] = typlPathOf(res.ref);
    }
  }

  // ── Pass C: resolve every non-namespace binding to an absolute name ──
  const allBindings: Binding[] = [];
  const allTypedefs: Typedef[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    for (const binding of block.bindings) {
      if (binding.kind === "namespace") continue; // scaffolding (D8)
      const res = resolveRef(binding.name, scopeFor(i), TYPL_REF_OPS);
      if (!res.ok) {
        emit("TYPL-010", { name: binding.name }, i, binding.position);
        continue;
      }
      allBindings.push(
        res.ref === binding.name ? binding : { ...binding, name: res.ref },
      );
    }
    allTypedefs.push(...block.typedefs);
  }

  if (
    allBindings.length === 0 && allTypedefs.length === 0 &&
    rootPath === undefined
  ) {
    return { diagnostics };
  }
  return {
    types: {
      bindings: allBindings,
      typedefs: allTypedefs,
      ...(rootPath !== undefined ? { rootNamespace: rootPath } : {}),
    },
    diagnostics,
  };
}
```

- [ ] **Step 4: Add `rootNamespace` to `TyplBlock`** in `ast.ts`:

```typescript
/** A parsed typl source unit. */
export interface TyplBlock {
  readonly bindings: readonly Binding[];
  readonly typedefs: readonly Typedef[];
  /**
   * The entry's root namespace path (no `$`, e.g. `"powertrain.brake"`),
   * when the entry declares one (#723). The validator resolves relative
   * citations against it.
   */
  readonly rootNamespace?: string;
}
```

- [ ] **Step 5: Swap the parser to the new module.** In `parser/markdown.ts`,
      delete the three extraction loops (lines ~597–652, from
      `let types: TyplBlock | undefined;` through the
      `if (allBindings.length > 0 …)` block) and replace with:

```typescript
// Extract + resolve typl declarations from all three surfaces (#723):
// published names resolve to absolute dotted form at parse time, so
// Entry.types carries absolute names only. See typl/assemble.ts.
const typl = assembleTyplTypes(bodyAst, bodyTokens, file, bodyStartLine);
diagnostics.push(...typl.diagnostics);
const types = typl.types;
```

Remove the now-unused imports (`extractTyplBullets`, `extractTyplFences`,
`extractTyplInlines`, `parseTyplBlock`, `bridgeTyplDiagnostic` — keep whatever
is still referenced elsewhere in the file; `deno lint` will flag leftovers).
Export `assembleTyplTypes` from `typl/mod.ts`.

- [ ] **Step 6: Run parser + typl + decl suites**

Run: `cd <worktree> && deno test packages/markspec/core/` Expected: PASS —
including all pre-existing typl fixture tests in `markdown_test.ts` (entry-local
behavior is unchanged: plain names are absolute per `TYPL_REF_OPS.isAbsolute`,
namespaces absent, aggregation order identical: fences, then bullets, then
inlines).

- [ ] **Step 7: Commit**

```bash
cd <worktree> && git add packages/markspec/core/typl/ packages/markspec/core/parser/markdown.ts && git commit -m "feat(core): resolve typl published names at parse via base engine (#723)"
```

---

### Task 8: Citation extraction

**Files:**

- Create: `packages/markspec/core/typl/citations.ts`
- Create: `packages/markspec/core/typl/citations_test.ts`
- Modify: `packages/markspec/core/typl/mod.ts` (exports)

**Interfaces:**

- Produces (consumed by Task 9):
  - `interface TyplCitation { readonly name: string; readonly location: SourceLocation }`
  - `extractTyplCitations(bodyTokens: readonly BodyToken[]): readonly TyplCitation[]`
    — bare published-shaped code spans only; plain `$Name` spans and declaration
    spans (with `:`) are excluded.

- [ ] **Step 1: Write the failing tests** (`citations_test.ts`; build
      `BodyToken[]` literals the way `inline_test.ts` does)

```typescript
import { assertEquals } from "@std/assert";
import type { BodyToken } from "../model/mod.ts";
import { extractTyplCitations, isTyplCitationText } from "./citations.ts";

Deno.test("citations: text predicate", () => {
  assertEquals(isTyplCitationText("$powertrain.brake.pedal_position"), true);
  assertEquals(isTyplCitationText("$.pedal_position"), true);
  assertEquals(isTyplCitationText(" $a.b "), true); // trimmed
  assertEquals(isTyplCitationText("$speed"), false); // entry-local, not checked
  assertEquals(isTyplCitationText("$a.b : signal"), false); // declaration
  assertEquals(isTyplCitationText("ux:media.home/play"), false); // uxil
});

Deno.test("citations: extracted from inline-code body tokens", () => {
  const loc = { file: "a.md", line: 5, column: 10 };
  const tokens: BodyToken[] = [
    { kind: "inline-code", text: "`$powertrain.brake.pedal_position`", location: loc },
    { kind: "inline-code", text: "`$speed`", location: loc },
    { kind: "inline-code", text: "`$a.b : signal`", location: loc },
  ] as BodyToken[];
  const out = extractTyplCitations(tokens);
  assertEquals(out.length, 1);
  assertEquals(out[0].name, "$powertrain.brake.pedal_position");
  assertEquals(out[0].location, loc);
});
```

(Match the exact `BodyToken` construction shape used by `inline_test.ts` — if
tokens carry extra required fields there, mirror them.)

- [ ] **Step 2: Run to verify failure**

Run: `cd <worktree> && deno test packages/markspec/core/typl/citations_test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `citations.ts`**

```typescript
/**
 * @module typl/citations
 *
 * Citation extraction for the published tier (#723): a *citation* is a
 * bare published-shaped ref in an inline code span — absolute
 * (`` `$powertrain.brake.pedal_position` ``) or relative
 * (`` `$.pedal_position` ``) — with no declaration clause. Plain `$Name`
 * spans are entry-local mentions and deliberately not validated
 * (unchanged pre-#723 behavior). The validator resolves relative
 * citations against the entry's root namespace and checks resolved names
 * against the corpus registry (TYPL-010 / TYPL-011).
 */
import type { BodyToken, SourceLocation } from "../model/mod.ts";
import { extractInlineDeclarations } from "../decl/mod.ts";
import { isPublishedTyplName, isRelativeTyplName } from "./resolve.ts";

/** One published-tier citation: the ref text and its file location. */
export interface TyplCitation {
  readonly name: string;
  readonly location: SourceLocation;
}

/** True when a code span's (trimmed) text is a bare published-shaped ref. */
export function isTyplCitationText(text: string): boolean {
  const t = text.trim();
  return isPublishedTyplName(t) || isRelativeTyplName(t);
}

/**
 * Filter `Entry.bodyTokens` to published-tier citations, in source order.
 * Reuses the shared inline-declaration walker with the citation
 * recognizer — the walker strips backtick delimiters before matching.
 */
export function extractTyplCitations(
  bodyTokens: readonly BodyToken[],
): readonly TyplCitation[] {
  return extractInlineDeclarations(bodyTokens, isTyplCitationText)
    .map((d) => ({ name: d.source.trim(), location: d.location }));
}
```

Export both from `typl/mod.ts`.

- [ ] **Step 4: Run to verify pass**

Run: `cd <worktree> && deno test packages/markspec/core/typl/` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd <worktree> && git add packages/markspec/core/typl/ && git commit -m "feat(core): extract published typl citations from code spans (#723)"
```

---

### Task 9: Validator — TYPL-009 declared-once, TYPL-011 citations, retire 002/003

**Files:**

- Modify: `packages/markspec/core/typl/validator.ts:32-74` (collision loop) and
  add the citation pass
- Test: `packages/markspec/core/typl/validator_test.ts` (flip 002/003
  expectations; add 009/011 cases)

**Interfaces:**

- Consumes: `extractTyplCitations` (Task 8), `resolveRef` + `TYPL_REF_OPS` (Task
  6), `Entry.types.rootNamespace` (Task 7).
- Produces: `validateTypl(entries)` — signature unchanged; TYPL-002/003 never
  emitted; TYPL-009 on duplicate dotted declarations; TYPL-010/011 on citations.

- [ ] **Step 1: Write the failing tests** (rework `validator_test.ts`): change
      existing TYPL-002/003 cases to assert `diagnostics.length === 0`; add:

```typescript
Deno.test("validateTypl: duplicate published declaration is TYPL-009", () => {
  const entries = [
    entryWith("REQ_1", "a.md", {
      bindings: [binding("$powertrain.brake.pedal", "signal", 3)],
      typedefs: [],
    }),
    entryWith("REQ_2", "b.md", {
      bindings: [binding("$powertrain.brake.pedal", "signal", 7)],
      typedefs: [],
    }),
  ];
  const { diagnostics } = validateTypl(entries);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "TYPL-009");
  assertEquals(diagnostics[0].location?.file, "b.md");
});

Deno.test("validateTypl: plain-name cross-entry difference is silent (002/003 retired)", () => {
  const entries = [
    entryWith("REQ_1", "a.md", {
      bindings: [binding("$speed", "signal", 3)],
      typedefs: [],
    }),
    entryWith("REQ_2", "b.md", {
      bindings: [binding("$speed", "state", 7)],
      typedefs: [],
    }),
  ];
  const { diagnostics } = validateTypl(entries);
  assertEquals(diagnostics.length, 0);
});

Deno.test("validateTypl: undeclared published citation is TYPL-011", () => {
  const citing = entryWithTokens("REQ_3", "c.md", [
    inlineCode("`$powertrain.brake.ghost`", "c.md", 4, 8),
  ]);
  const { diagnostics } = validateTypl([citing]);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "TYPL-011");
  assertEquals(diagnostics[0].location, { file: "c.md", line: 4, column: 8 });
});

Deno.test("validateTypl: relative citation with no root is TYPL-010", () => {
  const citing = entryWithTokens("REQ_4", "c.md", [
    inlineCode("`$.ghost`", "c.md", 4, 8),
  ]);
  const { diagnostics } = validateTypl([citing]);
  assertEquals(diagnostics.length, 1);
  assertEquals(diagnostics[0].code, "TYPL-010");
});
```

(`entryWith` / `binding` / `entryWithTokens` / `inlineCode` — use or extend the
entry-fixture helpers `validator_test.ts` already has; `entryWithTokens` sets
`bodyTokens`, others set `bodyTokens: []`.)

- [ ] **Step 2: Run to verify failure**

Run: `cd <worktree> && deno test packages/markspec/core/typl/validator_test.ts`
Expected: FAIL — 002/003 still emitted; 009/011/010 absent.

- [ ] **Step 3: Implement.** In `validator.ts`, replace the entire TYPL-002/003
      loop (lines 32–74) with:

```typescript
  // Published tier (#723): dotted names are declared exactly once
  // corpus-wide — every declaration after the first is TYPL-009. Plain
  // (entry-local) names have no cross-entry rule: TYPL-002/003 are
  // retired (deprecated, never emitted — see diagnostics.ts).
  for (const [name, decls] of registry.bindings) {
    if (decls.length < 2) continue;
    if (!name.includes(".")) continue;
    const first = decls[0];
    for (let i = 1; i < decls.length; i++) {
      const dup = decls[i];
      const td = typlDiagnostic(
        "TYPL-009",
        {
          name,
          otherFile: first.entryFile,
          otherLine: first.binding.position.line,
        },
        dup.binding.position,
      );
      diagnostics.push({
        code: td.code,
        severity: td.severity,
        message: td.message,
        location: { file: dup.entryFile, line: 1, column: 1 },
      });
    }
  }

  // Citation validation (#723): bare published-shaped code spans must
  // resolve (relative → entry root namespace) to a declared symbol.
  for (const entry of entries) {
    const citations = extractTyplCitations(entry.bodyTokens);
    if (citations.length === 0) continue;
    const root = entry.types?.rootNamespace;
    const scope = root !== undefined ? { base: root } : undefined;
    for (const citation of citations) {
      const res = resolveRef(citation.name, scope, TYPL_REF_OPS);
      if (!res.ok) {
        const td = typlDiagnostic(
          "TYPL-010",
          { name: citation.name },
          { line: citation.location.line, column: citation.location.column },
        );
        diagnostics.push({
          code: td.code,
          severity: td.severity,
          message: td.message,
          location: citation.location,
        });
        continue;
      }
      if (!registry.bindings.has(res.ref)) {
        const td = typlDiagnostic(
          "TYPL-011",
          { name: res.ref },
          { line: citation.location.line, column: citation.location.column },
        );
        diagnostics.push({
          code: td.code,
          severity: td.severity,
          message: td.message,
          location: citation.location,
        });
      }
    }
  }
```

Add imports: `import { extractTyplCitations } from "./citations.ts";`,
`import { resolveRef } from "../decl/mod.ts";`,
`import { TYPL_REF_OPS } from "./resolve.ts";`. Delete `shapesEqual` and any
now-unused imports (`deno lint` enforces). Update the module doc comment:
TYPL-002/003 retired → TYPL-009 declared-once + TYPL-010/011 citations.

- [ ] **Step 4: Run typl + validator + LSP suites** (LSP `validateAll` flows
      through `validate()` → `validateTypl`)

Run: `cd <worktree> && deno test packages/markspec/core/ packages/markspec/lsp/`
Expected: PASS. If an LSP or validator test asserts TYPL-002/003 behavior, flip
it to the retired expectation.

- [ ] **Step 5: Commit**

```bash
cd <worktree> && git add packages/markspec/core/typl/ && git commit -m "feat(core): declared-once + citation checks replace TYPL-002/003 (#723)"
```

---

### Task 10: Acceptance green, e2e regressions, docs, full build

**Files:**

- Commit: `tests/e2e/typl_published_test.ts` (from Task 1)
- Modify: `tests/e2e/typl_validation_test.ts` (flip any TYPL-002/003 case to the
  retired expectation)
- Modify: `docs/architecture/adr-019-typl-type-dsl.md` (published-tier addendum)

**Interfaces:** none — closure task.

- [ ] **Step 1: Run the acceptance suite**

Run:
`cd <worktree> && deno test --allow-run --allow-read --allow-write --allow-env tests/e2e/typl_published_test.ts`
Expected: PASS (all 9 tests). If any fail, fix the implementation — not the test
— unless the test contradicts the design spec.

- [ ] **Step 2: Fix `typl_validation_test.ts`** — any case asserting
      TYPL-002/003 emission now asserts exit 0 / no such code (mirror the Task 9
      unit-test flips at the CLI level).

Run:
`cd <worktree> && deno test --allow-run --allow-read --allow-write --allow-env tests/e2e/typl_validation_test.ts tests/e2e/typl_bullet_test.ts tests/e2e/typl_fence_test.ts tests/e2e/typl_inline_test.ts`
Expected: PASS.

- [ ] **Step 3: ADR-019 addendum.** Append a short section at the end of
      `docs/architecture/adr-019-typl-type-dsl.md`:

```markdown
## Addendum: published tier (#723, 2026-07-04)

S5 of the uxil epic (#717) added a **published** tier beside the entry-local
tier this ADR defines. Dots discriminate: `$name` stays entry-local (unchanged);
`$a.b`-style dotted names (≥ 2 segments) are **published** — declared exactly
once corpus-wide, citable from any entry. An explicit `: namespace` kind clause
establishes a base; relative refs keep the sigil with a leading dot (`$.name`)
and resolve through the entry-local base-resolution engine
(`core/decl/resolve.ts`, innermost base wins; at most one root namespace per
entry). Citations — bare published-shaped code spans — are validated against the
corpus registry. New diagnostics: TYPL-009 (duplicate published declaration),
TYPL-010 (relative ref without base), TYPL-011 (undeclared citation), TYPL-012
(multiple roots). TYPL-002/003 are **retired** (deprecated, never emitted):
plain names are entry-local, so cross-entry pairwise consistency no longer
applies. `CORE_SCHEMA_VERSION` unchanged.

Full design record: `docs/wip/2026-07-04-typl-published-tier-design.md`
(gardened to `docs/archive/` when this branch lands). The complete namespacing
rewrite of this ADR plus guide chapter is story #730.
```

- [ ] **Step 4: Full gate**

Run: `cd <worktree> && just build` Expected: PASS (lint + full test suite +
typecheck + compile). Also run `deno fmt --check` separately (not covered by
`just build`).

- [ ] **Step 5: Commit**

```bash
cd <worktree> && git add tests/e2e/ docs/architecture/adr-019-typl-type-dsl.md && git commit -m "test(core): typl published-tier acceptance suite + ADR-019 addendum (#723)"
```

---

### Task 11: Finish — garden, PR, follow-up story

Not an implementation task — hand off to the finishing skills:

- [ ] Run superpowers:finishing-a-development-branch + sdd-gardening: garden
      `docs/wip/` (spec + this plan → `docs/archive/`; durable record = the
      ADR-019 addendum already in Task 10) so the branch merges with an empty
      `docs/wip/`.
- [ ] PR: title `feat(core): typl published/namespaced tier (#723)`; body first
      line `Closes #723.`; include the release-note paragraph (published tier
      semantics + TYPL-002/003 retirement + "no schema bump") for release-time
      CHANGELOG batching. Squash-merge.
- [ ] File the **typl-LSP alignment follow-up story** (from the design review):
      hover/completion still assume the flat-global registry (cross-entry
      plain-`$Name` hover now misleading; dotted tokens unsupported —
      `dollarNameAtPosition` in `lsp/typl.ts` won't span dots). Reference the S5
      PR.
- [ ] `/review` the PR per AGENTS.md.
