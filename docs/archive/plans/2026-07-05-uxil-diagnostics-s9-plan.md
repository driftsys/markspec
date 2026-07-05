# UXIL-0xx Diagnostics Family (S9 #727) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the uxil diagnostics family into `markspec check` and the LSP:
file-anchored core diagnostics, a profile-driven type gate
(`declares: ux-surface`), four new codes (UXIL-023..026), catalogue
registration, and LSP `codeDescription` targets.

**Architecture:** A profile type-level `declares: ux-surface` field gates the
whole family (no designation → fully inert). A new orchestrator
`core/validator/uxil_family.ts` classifies entries, runs S8's `validateUxil`
over declaring entries (citations corpus-wide), and emits core `Diagnostic`s.
S8's `assemble`/`validator` are upgraded to anchor grammar diagnostics into file
coordinates at collection time. Wired at two sites: `runPipeline` (Stage 5) and
LSP `WorkspaceIndex.validateAll`.

**Tech Stack:** Deno/TypeScript strict. Tests: `@std/assert`, colocated
`*_test.ts` (unit) + `tests/e2e/` blackbox via `Deno.Command`.

**Spec:** `docs/wip/2026-07-05-uxil-diagnostics-s9-design.md` (committed on this
branch).

## Global Constraints

- Work in worktree `markspec-worktrees/727-uxil-diagnostics`, branch
  `story/727-uxil-diagnostics`. All paths below are worktree-relative.
- No `CORE_SCHEMA_VERSION` bump (optional profile field only; `Entry`
  untouched).
- Zero warnings from `deno check` / `deno lint` / `deno test`.
- TS formatted by `deno fmt`; MD/YAML by `dprint fmt`. Run `just fmt` before
  each commit.
- Conventional Commits, imperative mood. End commit bodies with
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No `Deno.*` APIs in core library code (tests and e2e are fine).
- Test commands: unit `deno test --allow-read <path>`; full suite via
  `just test`. E2E:
  `deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/<file>`.
- No CHANGELOG edits (batched at release).
- Known accepted warts (document, don't fight): bullet-anchored columns are
  body-indent-relative (same dedent wart typl's `bridge.ts` documents);
  inline-span inner columns assume a 1-backtick delimiter (the tokenizer
  canonicalises `token.text` to single backticks).

---

### Task 1: Profile field `declares: ux-surface`

**Files:**

- Modify: `packages/markspec/core/model/profile.ts` (TypeDef ~line 157,
  EffectiveTypeDef ~line 373)
- Modify: `packages/markspec/core/profile/manifest.ts` (ALLOWED_TYPE_KEYS ~line
  65, parseTypeDef ~line 1186, return literal ~line 1211)
- Modify: `packages/markspec/core/profile/merge.ts` (fresh-type branch ~line
  188, tightenType discipline fold + merged literal)
- Test: `packages/markspec/core/profile/manifest_test.ts`,
  `packages/markspec/core/profile/merge_test.ts`

**Interfaces:**

- Consumes: existing `TypeDef`, `EffectiveTypeDef`, `ProvenancedValue`.
- Produces: `TypeDef.declares?: string`;
  `EffectiveTypeDef.declares?: ProvenancedValue<string | undefined>` (always set
  by merge; optional so pre-existing test literals compile — mirrors the
  `DeliveredDocument.baseDir` precedent). New diagnostic `PROFILE-TYPE-009` for
  an unknown `declares` value.

- [ ] **Step 1: Confirm PROFILE-TYPE-009 is unused**

Run: `grep -rn "PROFILE-TYPE-009" packages/markspec/` Expected: no output. (If
taken, use the next free number and adjust all later steps.)

- [ ] **Step 2: Write the failing tests**

In `packages/markspec/core/profile/manifest_test.ts` (mirroring the existing
`parseManifest: types map parsed` test around line 212):

```ts
Deno.test("parseManifest: type-level declares: ux-surface accepted (#727)", () => {
  const result = parseManifest(`id: "@t/p"
version: 0.1.0
markspec-schema: "1"
profile:
  types:
    ux-contract:
      extends: Contract
      declares: ux-surface
`);
  assertEquals(
    result.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  assertEquals(result.manifest?.types.get("ux-contract")?.declares, "ux-surface");
});

Deno.test("parseManifest: unknown declares value is PROFILE-TYPE-009 (#727)", () => {
  const result = parseManifest(`id: "@t/p"
version: 0.1.0
markspec-schema: "1"
profile:
  types:
    ux-contract:
      extends: Contract
      declares: something-else
`);
  assertEquals(
    result.diagnostics.some((d) => d.code === "PROFILE-TYPE-009"),
    true,
  );
});
```

In `packages/markspec/core/profile/merge_test.ts` (the file already defines
`singleTierChain` / `multiTierChain` helpers and imports `mergeChain`):

```ts
Deno.test("mergeChain: declares flows into a fresh effective type (#727)", () => {
  const chain = singleTierChain(`
id: "@acme/single"
version: 1.0.0
profile:
  types:
    ux-contract:
      extends: Contract
      declares: ux-surface
`);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  assertEquals(
    result.effective!.types.get("ux-contract")?.value.declares?.value,
    "ux-surface",
  );
});

Deno.test("mergeChain: tightened type keeps the parent's declares (#727)", () => {
  const chain = multiTierChain([
    `
id: "@acme/parent"
version: 1.0.0
profile:
  types:
    ux-contract:
      extends: Contract
      declares: ux-surface
`,
    `
id: "@acme/child"
version: 1.0.0
extends: "../parent"
profile:
  types:
    ux-contract:
      extends: Contract
      description: tightened by the child
`,
  ]);
  const result = mergeChain(chain);
  assertEquals(result.diagnostics, []);
  assertEquals(
    result.effective!.types.get("ux-contract")?.value.declares?.value,
    "ux-surface",
  );
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:
`deno test --allow-read packages/markspec/core/profile/manifest_test.ts packages/markspec/core/profile/merge_test.ts`
Expected: FAIL (`declares` property does not exist / diagnostics missing).

- [ ] **Step 4: Implement**

`packages/markspec/core/model/profile.ts` — in `TypeDef`, after
`readonly discipline?: string;`:

```ts
/**
 * Declaration-DSL designation (uxil S9 #727). `"ux-surface"` marks this
 * type as a uxil declaring entry type: its entries may declare ux
 * surfaces; entries of other types may not (UXIL-023). Closed
 * vocabulary — `parseTypeDef` rejects anything else (PROFILE-TYPE-009).
 */
readonly declares?: string;
```

In `EffectiveTypeDef`, after the `discipline` field:

```ts
/**
 * Declaration-DSL designation (uxil S9 #727), folded child-wins like
 * `discipline`. Optional so pre-existing hand-built test fixtures need
 * not set it; the merge always does (mirrors `DeliveredDocument.baseDir`).
 */
readonly declares?: ProvenancedValue<string | undefined>;
```

`packages/markspec/core/profile/manifest.ts` — add `"declares"` to
`ALLOWED_TYPE_KEYS`. In `parseTypeDef`, after the `discipline` block (~line
1186):

```ts
// uxil S9 (#727): `declares: ux-surface` designates a uxil declaring
// entry type. Closed vocabulary — reject anything else at load time.
let declares: string | undefined;
if (r.declares !== undefined) {
  if (r.declares !== "ux-surface") {
    diagnostics.push({
      code: "PROFILE-TYPE-009",
      severity: "error",
      message:
        `${ctx}: 'declares' value '${r.declares}' is not recognised (expected 'ux-surface')`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  declares = r.declares;
}
```

Add `declares,` to the returned object literal (after `discipline,`).

`packages/markspec/core/profile/merge.ts` — fresh-type branch (~line 188), after
`discipline: { value: td.discipline, origin },`:

```ts
declares: { value: td.declares, origin },
```

In `tightenType`, next to the discipline fold:

```ts
// Declares (uxil S9 #727): child wins when set; otherwise parent stays.
const declares: ProvenancedValue<string | undefined> =
  child.declares !== undefined
    ? { value: child.declares, origin: childOrigin }
    : effExisting.declares ?? { value: undefined, origin: existing.origin };
```

and add `declares,` to the `merged` literal.

- [ ] **Step 5: Run tests to verify they pass**

Run: `deno test --allow-read packages/markspec/core/profile/` Expected: PASS.

- [ ] **Step 6: Type-check + commit**

```bash
deno check packages/markspec/main.ts packages/markspec/core/mod.ts
just fmt
git add -A && git commit -m "feat(core): type-level 'declares: ux-surface' profile field (#727)"
```

---

### Task 2: New diagnostic codes UXIL-023..026 + anchored factory

**Files:**

- Modify: `packages/markspec/core/uxil/diagnostics.ts`
- Test: `packages/markspec/core/uxil/diagnostics_test.ts`

**Interfaces:**

- Produces: `UxilCode` union extended with
  `"UXIL-023" | "UXIL-024" |
  "UXIL-025" | "UXIL-026"`; new factory
  `uxilDiagnosticAt(code: UxilCode, params: Record<string, string | number>, location: SourceLocation): Diagnostic`
  (core `Diagnostic` with `location.file` — Tasks 4–8 emit through it).

- [ ] **Step 1: Write the failing tests**

Append to `packages/markspec/core/uxil/diagnostics_test.ts`:

```ts
Deno.test("uxilDiagnosticAt: file-anchored core diagnostic (#727)", () => {
  const d = uxilDiagnosticAt(
    "UXIL-024",
    { ref: ".confirm" },
    { file: "a.md", line: 7, column: 5 },
  );
  assertEquals(d.code, "UXIL-024");
  assertEquals(d.severity, "error");
  assertEquals(d.message, "Relative reference '.confirm' has no base in scope.");
  assertEquals(d.location, { file: "a.md", line: 7, column: 5 });
});

Deno.test("UXIL-023/025/026 templates substitute their params (#727)", () => {
  const loc = { file: "a.md", line: 1, column: 1 };
  assertEquals(
    uxilDiagnosticAt("UXIL-023", { entry: "REQ_0001", type: "requirement" }, loc)
      .message,
    "uxil declaration outside a declaring entry type: 'REQ_0001' (type 'requirement') may not declare surfaces (requires 'declares: ux-surface').",
  );
  assertEquals(
    uxilDiagnosticAt(
      "UXIL-025",
      { element: "hint", surface: "voice", kind: "agent" },
      loc,
    ).message,
    "Element 'hint' declares 'observe' but surface 'voice' has non-visual kind 'agent'.",
  );
  assertEquals(
    uxilDiagnosticAt("UXIL-026", { element: "go" }, loc).message,
    "Element 'go' declares 'navigate' without a '-> target' clause.",
  );
});
```

(Import `uxilDiagnosticAt` alongside the existing imports.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-read packages/markspec/core/uxil/diagnostics_test.ts`
Expected: FAIL (`uxilDiagnosticAt` not exported; codes unknown).

- [ ] **Step 3: Implement**

In `packages/markspec/core/uxil/diagnostics.ts`:

- Extend the `UxilCode` union with
  `"UXIL-023" | "UXIL-024" | "UXIL-025" |
  "UXIL-026"` and bump the module doc
  comment's range to `UXIL-026`.
- Import `Diagnostic` and `SourceLocation` types from `../model/mod.ts` (extend
  the existing `Severity` import line).
- Add the four entries to `UXIL_CODES`:

```ts
"UXIL-023": {
  severity: "error",
  template:
    "uxil declaration outside a declaring entry type: '${entry}' (type '${type}') may not declare surfaces (requires 'declares: ux-surface').",
},
"UXIL-024": {
  severity: "error",
  template: "Relative reference '${ref}' has no base in scope.",
},
"UXIL-025": {
  severity: "error",
  template:
    "Element '${element}' declares 'observe' but surface '${surface}' has non-visual kind '${kind}'.",
},
"UXIL-026": {
  severity: "error",
  template:
    "Element '${element}' declares 'navigate' without a '-> target' clause.",
},
```

- Add the anchored factory after `uxilDiagnostic`:

```ts
/**
 * Construct a file-anchored core {@linkcode Diagnostic} for a uxil code —
 * the S9 sibling of {@linkcode uxilDiagnostic} (#727). Assembly, the
 * validator, and the family orchestrator know their file coordinates, so
 * they emit core diagnostics directly; only the file-agnostic grammar
 * layer still uses the source-local shape.
 */
export function uxilDiagnosticAt(
  code: UxilCode,
  params: Record<string, string | number>,
  location: SourceLocation,
): Diagnostic {
  const d = uxilDiagnostic(code, params, {
    line: location.line,
    column: location.column,
  });
  return { code: d.code, severity: d.severity, message: d.message, location };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-read packages/markspec/core/uxil/diagnostics_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
just fmt
git add -A && git commit -m "feat(core): UXIL-023..026 codes + file-anchored uxil diagnostic factory (#727)"
```

---

### Task 3: `innerColumn` on `InlineDeclaration`

**Files:**

- Modify: `packages/markspec/core/decl/surfaces.ts` (interface ~line 48,
  `extractInlineDeclarations` ~line 174)
- Test: `packages/markspec/core/decl/surfaces_test.ts`

**Interfaces:**

- Produces: `InlineDeclaration.innerColumn: number` (required; the only
  production constructor is `extractInlineDeclarations`). Task 4's span
  anchoring composes parse-diagnostic columns against it.

- [ ] **Step 1: Check for other `InlineDeclaration` constructors**

Run:
`grep -rn "InlineDeclaration" packages/markspec --include="*.ts" | grep -v "type\b" | grep -v import`
Expected: construction only inside `extractInlineDeclarations`. If a test
constructs literals, add `innerColumn` there in Step 4.

- [ ] **Step 2: Write the failing test**

Append to `packages/markspec/core/decl/surfaces_test.ts` (mirror the existing
inline-extraction test's BodyToken fixture style in that file):

```ts
Deno.test("extractInlineDeclarations: innerColumn skips the delimiter (#727)", () => {
  const tokens = [
    {
      kind: "inline-code" as const,
      text: "`ux:a.b : screen`",
      location: { file: "a.md", line: 3, column: 3 },
    },
  ];
  const [decl] = extractInlineDeclarations(tokens, () => true);
  assertEquals(decl.source, "ux:a.b : screen");
  assertEquals(decl.innerColumn, 4);
});
```

(If the file's existing fixtures build `BodyToken`s through a helper, reuse that
helper instead of the literal — the assertion stays the same.)

- [ ] **Step 3: Run test to verify it fails**

Run: `deno test --allow-read packages/markspec/core/decl/surfaces_test.ts`
Expected: FAIL (`innerColumn` missing).

- [ ] **Step 4: Implement**

In `InlineDeclaration`:

```ts
/**
 * Column of the span's inner text: `location.column` plus the opening
 * delimiter width. A DSL host composes span-relative parse-diagnostic
 * columns against this, not `location.column` (#727). Note the token
 * model canonicalises `text` to single-backtick delimiters, so the
 * width is 1 in practice — a double-backtick original anchors one
 * column left (accepted wart, same class as the typl indent wart).
 */
readonly innerColumn: number;
```

In `extractInlineDeclarations`:

```ts
const inner = stripCodeSpanDelimiters(token.text);
if (!matchText(inner)) continue;
const delim = token.text.startsWith("``") ? 2 : 1;
results.push({
  source: inner,
  location: token.location,
  innerColumn: token.location.column + delim,
});
```

Fix any test literals found in Step 1.

- [ ] **Step 5: Run decl + typl tests (typl consumes this walker)**

Run:
`deno test --allow-read packages/markspec/core/decl/ packages/markspec/core/typl/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
just fmt
git add -A && git commit -m "feat(core): InlineDeclaration.innerColumn for span-relative column anchoring (#727)"
```

---

### Task 4: File-anchor all uxil diagnostics (assemble + validator)

**Files:**

- Modify: `packages/markspec/core/uxil/assemble.ts`
- Modify: `packages/markspec/core/uxil/validator.ts`
- Test: `packages/markspec/core/uxil/assemble_test.ts`,
  `packages/markspec/core/uxil/validator_test.ts`

**Interfaces:**

- Consumes: `uxilDiagnosticAt` (Task 2), `InlineDeclaration.innerColumn` (Task
  3).
- Produces: `UxSurfaceTree.diagnostics: readonly Diagnostic[]` and
  `UxilValidation.diagnostics: readonly Diagnostic[]` — every diagnostic carries
  `location: { file, line, column }` in file coordinates. Tasks 5–9 rely on this
  shape.

- [ ] **Step 1: Write the failing anchoring tests**

Append to `packages/markspec/core/uxil/validator_test.ts` (reusing its
`entriesOf` helper):

```ts
Deno.test("anchoring: bullet parse diagnostic is file-anchored (#727)", () => {
  const md = `- [UXI_A_0001] X

  \`ux:a.b : screen\` offers:

  - \`/play :\` — empty verb set.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const { diagnostics } = validateUxil(entriesOf({ "a.md": md }));
  const d = diagnostics.find((x) => x.code === "UXIL-005");
  // bodyStartLine 3 + body-relative bullet line 3 − 1 = file line 5.
  // Paragraph column 3 + (diag column 9 − 1) = 11 (body-indent-relative;
  // known dedent wart — see typl/bridge.ts).
  assertEquals(d?.location, { file: "a.md", line: 5, column: 11 });
});

Deno.test("anchoring: root-span parse diagnostic composes the inner column (#727)", () => {
  const md = `- [UXI_A_0001] X

  \`ux:a. : screen\` — trailing dot.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const { diagnostics } = validateUxil(entriesOf({ "a.md": md }));
  const d = diagnostics.find((x) => x.code === "UXIL-008");
  // Span at file (3,3); innerColumn 4; diag column 7 → 4 + 7 − 1 = 10.
  assertEquals(d?.location, { file: "a.md", line: 3, column: 10 });
});

Deno.test("anchoring: semantic diagnostics carry file locations (#727)", () => {
  const md = `- [UXI_A_0001] X

  \`ux:a.b : widget\` — bad kind.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const { diagnostics } = validateUxil(entriesOf({ "a.md": md }));
  const d = diagnostics.find((x) => x.code === "UXIL-009");
  assertEquals(d?.location, { file: "a.md", line: 3, column: 3 });
});

Deno.test("anchoring: UXIL-011 anchors at the body start (#727)", () => {
  const md = `- [UXI_A_0001] X

  Just an element bullet:

  - \`/e : activate\` — no root anywhere.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const { diagnostics } = validateUxil(entriesOf({ "a.md": md }));
  const d = diagnostics.find((x) => x.code === "UXIL-011");
  assertEquals(d?.location, { file: "a.md", line: 3, column: 1 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-read packages/markspec/core/uxil/validator_test.ts`
Expected: FAIL (`location` is undefined — diagnostics carry `position`).

- [ ] **Step 3: Implement in assemble.ts**

- Add imports: `Diagnostic` type from `../model/mod.ts`; `uxilDiagnosticAt` from
  `./diagnostics.ts`; `InlineDeclaration` type from `../decl/mod.ts`.
- Change `UxSurfaceTree.diagnostics` to `readonly Diagnostic[]` (find the
  interface in this file; the `diagnostics: UxilDiagnostic[]` accumulator in
  `assembleUxSurface` becomes `Diagnostic[]`). Update the module doc comment's
  "its diagnostics are still collected" paragraph to note they are file-anchored
  as of S9 (#727).
- Add two anchoring helpers next to `toLocation`:

```ts
/**
 * Anchor a span-relative grammar diagnostic at its inline span's file
 * location (#727). Line always composes; column composes only on the
 * diagnostic's first line (grammar positions currently always carry
 * line 1 — the line math is defensive).
 */
function anchorSpanDiagnostic(
  file: string,
  span: InlineDeclaration,
  d: UxilDiagnostic,
): Diagnostic {
  return {
    code: d.code,
    severity: d.severity,
    message: d.message,
    location: {
      file,
      line: span.location.line + (d.position.line - 1),
      column: d.position.line === 1
        ? span.innerColumn + (d.position.column - 1)
        : d.position.column,
    },
  };
}

/**
 * Anchor a paragraph-relative grammar diagnostic (#781) at its bullet's
 * file location (#727). Columns are body-indent-relative — the same
 * accepted dedent wart typl's bridge documents; line math is exact.
 */
function anchorBulletDiagnostic(
  entry: Entry,
  range: SourceRange,
  d: UxilDiagnostic,
): Diagnostic {
  const base = toLocation(entry, range);
  return {
    code: d.code,
    severity: d.severity,
    message: d.message,
    location: {
      file: base.file,
      line: base.line + (d.position.line - 1),
      column: d.position.line === 1
        ? base.column + (d.position.column - 1)
        : d.position.column,
    },
  };
}
```

- Root-span loop: replace `diagnostics.push(...parseDiags);` with

```ts
diagnostics.push(
  ...parseDiags.map((d) =>
    anchorSpanDiagnostic(entry.location.file, span, d)
  ),
);
```

- UXIL-011 site:

```ts
diagnostics.push(
  uxilDiagnosticAt("UXIL-011", {}, {
    file: entry.location.file,
    line: entry.bodyStartLine ?? 1,
    column: 1,
  }),
);
```

- UXIL-012 site (`extra.location` is already a file-bearing `SourceLocation`):

```ts
diagnostics.push(
  uxilDiagnosticAt("UXIL-012", { first: `ux:${rootPath}` }, extra.location),
);
```

- Both bullet parse sites (child + element) inside the `bulletInfo` map: replace
  `diagnostics.push(...parseDiags);` with

```ts
diagnostics.push(
  ...parseDiags.map((d) => anchorBulletDiagnostic(entry, bullet.range, d)),
);
```

- [ ] **Step 4: Implement in validator.ts**

- Change imports: drop `type UxilDiagnostic, uxilDiagnostic` in favour of
  `uxilDiagnosticAt`; import `Diagnostic` type from `../model/mod.ts`; drop the
  now-unused `Position` import and delete `positionOf`.
- `UxilValidation.diagnostics` becomes `readonly Diagnostic[]`; the local
  accumulator becomes `Diagnostic[]`. Update the module doc comment ("Positions
  are … source-local-safe; S9 owns file-anchoring" → file-anchored as of S9
  #727).
- Convert every emission (the params stay identical; only the factory and the
  location argument change):
  - UXIL-009, UXIL-013 → `uxilDiagnosticAt(code, params, surface.location)`
  - UXIL-010, UXIL-014 → `uxilDiagnosticAt(code, params, element.location)`
  - UXIL-015 → `uxilDiagnosticAt("UXIL-015", { … }, dup.location)`
  - UXIL-016 →
    `uxilDiagnosticAt("UXIL-016", { surface: path, parent }, record.location)`
  - UXIL-017 →
    `uxilDiagnosticAt("UXIL-017", { target: element.navTarget }, element.location)`
  - UXIL-018/019/020/021/022 (Pass 3) →
    `uxilDiagnosticAt(code, params, location)` where `location` is the
    citation's existing `SourceLocation` (delete the `pos` variable).

- [ ] **Step 5: Run the uxil suite; fix expectation drift**

Run: `deno test --allow-read packages/markspec/core/uxil/` Expected: the new
anchoring tests PASS. Any S8 test that referenced `.position` fails — update it
to `.location` (most only check `.code` and need no change).

- [ ] **Step 6: Type-check + commit**

```bash
deno check packages/markspec/main.ts packages/markspec/core/mod.ts packages/markspec/lsp/server.ts packages/markspec/mcp/server.ts
just fmt
git add -A && git commit -m "feat(core): file-anchor uxil diagnostics at assembly and validation (#727)"
```

---

### Task 5: Enforce `visual` (UXIL-025) and `requiresNavTarget` (UXIL-026)

**Files:**

- Modify: `packages/markspec/core/uxil/validator.ts` (Pass 1)
- Test: `packages/markspec/core/uxil/validator_test.ts`

**Interfaces:**

- Consumes: `UX_KINDS` `KindInfo.visual` flag (vocab.ts), `UxElement.verbs` /
  `UxElement.navTarget` (assemble.ts), `uxilDiagnosticAt` (Task 2).

- [ ] **Step 1: Write the failing tests**

```ts
Deno.test("UXIL-025 observe on a non-visual kind (agent)", () => {
  const md = `- [UXI_A_0001] X

  \`ux:voice : agent\` offers:

  - \`/hint : observe\` — a visibility anchor on a non-visual kind.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const { diagnostics } = validateUxil(entriesOf({ "a.md": md }));
  assert(has(diagnostics, "UXIL-025"));
});

Deno.test("UXIL-025 does not fire on a visual kind (screen)", () => {
  const md = `- [UXI_A_0001] X

  \`ux:a.b : screen\` offers:

  - \`/hint : observe\` — a legitimate visibility anchor.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const { diagnostics } = validateUxil(entriesOf({ "a.md": md }));
  assertEquals(has(diagnostics, "UXIL-025"), false);
});

Deno.test("UXIL-026 navigate without a target", () => {
  const md = `- [UXI_A_0001] X

  \`ux:a.b : screen\` offers:

  - \`/go : navigate\` — missing its target.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const { diagnostics } = validateUxil(entriesOf({ "a.md": md }));
  assert(has(diagnostics, "UXIL-026"));
});

Deno.test("UXIL-026 does not fire when a target is declared", () => {
  const md = `- [UXI_A_0001] X

  \`ux:a.b : screen\` offers:

  - \`/go : navigate -> a.b\` — self-target, resolvable.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const { diagnostics } = validateUxil(entriesOf({ "a.md": md }));
  assertEquals(has(diagnostics, "UXIL-026"), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `deno test --allow-read packages/markspec/core/uxil/validator_test.ts`
Expected: the two positive tests FAIL.

- [ ] **Step 3: Implement**

In Pass 1, hoist the kind lookup so the element loop can read it. Replace the
`if (!isKnownKind…) … else …` block's shape with:

```ts
const kindInfo = isKnownKind(surface.kind)
  ? UX_KINDS.get(surface.kind)!
  : undefined;
if (kindInfo === undefined) {
  diagnostics.push(
    uxilDiagnosticAt("UXIL-009", { kind: surface.kind }, surface.location),
  );
} else if (!kindInfo.stateful && surface.states.length > 0) {
  diagnostics.push(
    uxilDiagnosticAt("UXIL-013", { kind: surface.kind }, surface.location),
  );
}
```

In the element loop, after the existing observe-exclusivity check:

```ts
// UXIL-025 (#727): 'observe' anchors a visibility assertion — the
// issue's "visibility of a non-screen". Only when the kind is known
// (an unknown kind is already UXIL-009; don't cascade).
if (
  kindInfo !== undefined && !kindInfo.visual &&
  element.verbs.includes("observe")
) {
  diagnostics.push(
    uxilDiagnosticAt("UXIL-025", {
      element: element.name,
      surface: surface.path,
      kind: surface.kind,
    }, element.location),
  );
}
// UXIL-026 (#727): vocab's requiresNavTarget, previously unenforced.
if (
  element.verbs.includes("navigate") && element.navTarget === undefined
) {
  diagnostics.push(
    uxilDiagnosticAt(
      "UXIL-026",
      { element: element.name },
      element.location,
    ),
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-read packages/markspec/core/uxil/` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
just fmt
git add -A && git commit -m "feat(core): enforce visual/navigability kind rules — UXIL-025/026 (#727)"
```

---

### Task 6: Reserved UXIL-024 mapping at the resolution site

**Files:**

- Modify: `packages/markspec/core/uxil/assemble.ts` (child-resolution loop
  ~line 245)
- Test: `packages/markspec/core/uxil/assemble_test.ts`

**Interfaces:**

- Consumes: `RefResolution`'s `no-base-in-scope` reason (`core/decl`),
  `uxilDiagnosticAt` (Task 2).

- [ ] **Step 1: Write the failing cascade-suppression test**

Append to `packages/markspec/core/uxil/assemble_test.ts` (add
`import { parseMarkdown } from "../parser/markdown.ts";` if the file does not
already import it):

```ts
Deno.test("UXIL-024 stays suppressed when the missing root already reported (#727)", () => {
  const md = `- [UXI_A_0001] X

  No root at all:

  - \`.confirm\` — child surface with nothing to resolve against.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const { entries } = parseMarkdown(md, { file: "a.md" });
  const tree = assembleUxSurface(entries[0]);
  assertEquals(tree.diagnostics.some((d) => d.code === "UXIL-011"), true);
  assertEquals(tree.diagnostics.some((d) => d.code === "UXIL-024"), false);
});
```

- [ ] **Step 2: Run tests — the suppression test PASSES already**

Run: `deno test --allow-read packages/markspec/core/uxil/assemble_test.ts`
Expected: PASS (silent skip today). This test pins the cascade contract so the
Step 3 change cannot regress it. The direct mapping test landed in Task 2 (the
`uxilDiagnosticAt("UXIL-024", …)` test).

- [ ] **Step 3: Implement the guarded mapping**

Replace the resolution tail `if (res.ok) info.resolvedPath = res.ref;` and its
preceding comment with:

```ts
if (res.ok) {
  info.resolvedPath = res.ref;
  continue;
}
// UXIL-024 (S9 #727), reserved: emitted only when a relative ref's
// failure is NOT attributable to a missing/broken root (already
// UXIL-011 or a root parse diagnostic) or a blocked ancestor (its own
// diagnostic) — the cascade suppression S8 chose. With the root as the
// universal fallback base this branch is structurally unreachable
// today; it becomes live when a surface with a non-root base (the
// table caption base, epic §A) lands.
const nearest = nearestAncestorBase(bullets[i].parent);
const blocked = nearest !== undefined && "blocked" in nearest;
if (!blocked && rootCandidates.length > 0) {
  diagnostics.push(uxilDiagnosticAt(
    "UXIL-024",
    { ref: `.${info.childPath.join(".")}` },
    toLocation(entry, bullets[i].range),
  ));
}
```

- [ ] **Step 4: Run the uxil suite**

Run: `deno test --allow-read packages/markspec/core/uxil/` Expected: PASS
(including the suppression test).

- [ ] **Step 5: Commit**

```bash
just fmt
git add -A && git commit -m "feat(core): map no-base-in-scope to reserved UXIL-024 with cascade suppression (#727)"
```

---

### Task 7: `citationEntries` option on `validateUxil`

**Files:**

- Modify: `packages/markspec/core/uxil/validator.ts`
- Test: `packages/markspec/core/uxil/validator_test.ts`

**Interfaces:**

- Produces:
  `validateUxil(entries: readonly Entry[], opts?: UxilValidateOptions)` with
  `UxilValidateOptions.citationEntries?: readonly Entry[]`. Task 8's family
  passes `{ citationEntries: allLocalEntries }` while `entries` carries only
  declaring-type entries.

- [ ] **Step 1: Write the failing test**

```ts
Deno.test("citationEntries: citations resolve from entries outside the declaring set (#727)", () => {
  const contract = `- [UXI_A_0001] Contract

  \`ux:media.home : screen\` offers:

  - \`/play : activate\` — starts playback.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const citing = `- [REQ_0001] Journey step

  Tap \`ux:media.ghost/play!activate\` to start playback.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZB
`;
  const [contractEntry] = entriesOf({ "a.md": contract });
  const [citingEntry] = entriesOf({ "b.md": citing });
  const { diagnostics } = validateUxil([contractEntry], {
    citationEntries: [contractEntry, citingEntry],
  });
  assert(has(diagnostics, "UXIL-018"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-read packages/markspec/core/uxil/validator_test.ts`
Expected: FAIL (extra argument / citation not scanned).

- [ ] **Step 3: Implement**

```ts
/** Options for {@linkcode validateUxil}. */
export interface UxilValidateOptions {
  /**
   * Entries whose `ux:` citations resolve against the registry (Pass 3).
   * Defaults to `entries`. The family orchestrator (S9 #727) passes every
   * non-upstream project entry here while `entries` carries only the
   * declaring-type entries — citations are legal from any entry type;
   * declarations are not.
   */
  readonly citationEntries?: readonly Entry[];
}
```

Change the signature to
`validateUxil(entries: readonly Entry[], opts: UxilValidateOptions = {})`, and
Pass 3's loop header to
`for (const entry of opts.citationEntries ?? entries) {`. Export the options
type from `packages/markspec/core/uxil/mod.ts` alongside `UxilValidation`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `deno test --allow-read packages/markspec/core/uxil/` Expected: PASS.

- [ ] **Step 5: Commit**

```bash
just fmt
git add -A && git commit -m "feat(core): validateUxil gains a citationEntries option (#727)"
```

---

### Task 8: Family orchestrator `validateUxilFamily`

**Files:**

- Create: `packages/markspec/core/validator/uxil_family.ts`
- Test: `packages/markspec/core/validator/uxil_family_test.ts`
- Modify: `packages/markspec/core/uxil/mod.ts` (export `extractUxRootSpans`,
  `uxilDiagnosticAt`, `UxilValidateOptions`)
- Modify: `packages/markspec/core/mod.ts` (export family + uxil namespace)
- Modify: `docs/wip/2026-07-05-uxil-diagnostics-s9-design.md` (§2 heading:
  `core/uxil/family.ts` → `core/validator/uxil_family.ts`)

**Interfaces:**

- Consumes: `classifyEntry(entry, profile): { type, diagnostics }`
  (`./types.ts`), `emittableEntries` (`../model/mod.ts`), `validateUxil` +
  `extractUxRootSpans` + `uxilDiagnosticAt` (`../uxil/mod.ts`),
  `EffectiveTypeDef.declares` (Task 1).
- Produces:
  `uxilDeclaringTypes(profile: EffectiveProfile | null): ReadonlySet<string>`
  and
  `validateUxilFamily(entries: readonly Entry[], profile: EffectiveProfile | null): readonly Diagnostic[]`
  — Task 9 wires both call sites; both exported from `core/mod.ts`.

- [ ] **Step 1: Write the failing tests**

Create `packages/markspec/core/validator/uxil_family_test.ts`:

```ts
import { assert, assertEquals } from "@std/assert";
import { uxilDeclaringTypes, validateUxilFamily } from "./uxil_family.ts";
import { parseMarkdown } from "../parser/markdown.ts";
import type {
  EffectiveProfile,
  EffectiveTypeDef,
  Entry,
  ProvenancedMapEntry,
} from "../model/mod.ts";

function entriesOf(files: Record<string, string>): Entry[] {
  const out: Entry[] = [];
  for (const [file, md] of Object.entries(files)) {
    const { entries } = parseMarkdown(md, { file });
    out.push(...entries);
  }
  return out;
}

function makeProfile(
  types: Record<string, { pattern: string; declares?: string }>,
): EffectiveProfile {
  const origin = "@test/p";
  const map = new Map<string, ProvenancedMapEntry<EffectiveTypeDef>>();
  for (const [name, t] of Object.entries(types)) {
    map.set(name, {
      value: {
        name,
        extends: "Requirement",
        displayIdPattern: { value: t.pattern, origin },
        displayIdPatternEnforcement: { value: "off", origin },
        color: { value: undefined, origin },
        required: { value: [], origin },
        attributes: new Map(),
        traceability: new Map(),
        description: { value: undefined, origin },
        attrDescriptions: new Map(),
        relationDescriptions: new Map(),
        discipline: { value: undefined, origin },
        declares: { value: t.declares, origin },
      },
      origin,
    });
  }
  return {
    attributes: new Map(),
    labels: new Map(),
    conventions: new Map(),
    colors: new Map(),
    types: map,
    documents: { types: new Map(), frontMatter: new Map() },
    delivers: [],
    kinds: new Map(),
    prose: {
      lexicons: {
        "capitalized-allow": { value: [], origin: "" },
        "sentence-abbrev": { value: [], origin: "" },
      },
    },
    disciplineMode: { value: "none", origin: "inferred" },
  };
}

const CONTRACT_BAD_KIND = `- [UXI_0001] Contract

  \`ux:media.home : widget\` — bad kind.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;

const REQ_WITH_ROOT = `- [REQ_0001] Not a contract

  \`ux:rogue.surface : screen\` — declared in the wrong type.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZB
`;

const REQ_WITH_PROSE_BULLETS = `- [REQ_0002] Ordinary prose

  Config files live in bullets:

  - \`.gitignore\` — repository excludes.
  - \`/usr/bin/env\` — a path, not an element.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZC
`;

Deno.test("family: inert when no type declares ux-surface (#727)", () => {
  const profile = makeProfile({
    "ux-contract": { pattern: "UXI_{n:4d}" }, // no declares
  });
  const entries = entriesOf({
    "a.md": CONTRACT_BAD_KIND + "\n" + REQ_WITH_PROSE_BULLETS,
  });
  assertEquals(validateUxilFamily(entries, profile), []);
  assertEquals(validateUxilFamily(entries, null), []);
});

Deno.test("family: declaring entries validate; prose bullets stay opaque (#727)", () => {
  const profile = makeProfile({
    "ux-contract": { pattern: "UXI_{n:4d}", declares: "ux-surface" },
    "requirement": { pattern: "REQ_{n:4d}" },
  });
  const entries = entriesOf({
    "a.md": CONTRACT_BAD_KIND,
    "b.md": REQ_WITH_PROSE_BULLETS,
  });
  const diags = validateUxilFamily(entries, profile);
  assert(diags.some((d) => d.code === "UXIL-009"));
  // The REQ entry's `.gitignore` / path bullets produce nothing.
  assertEquals(diags.some((d) => d.location?.file === "b.md"), false);
});

Deno.test("family: root declaration outside the declaring type is UXIL-023 (#727)", () => {
  const profile = makeProfile({
    "ux-contract": { pattern: "UXI_{n:4d}", declares: "ux-surface" },
    "requirement": { pattern: "REQ_{n:4d}" },
  });
  const diags = validateUxilFamily(entriesOf({ "b.md": REQ_WITH_ROOT }), profile);
  const d = diags.find((x) => x.code === "UXIL-023");
  assertEquals(d?.location, { file: "b.md", line: 3, column: 3 });
  assert(d?.message.includes("'REQ_0001'"));
  assert(d?.message.includes("'requirement'"));
});

Deno.test("family: citations validate corpus-wide (#727)", () => {
  const profile = makeProfile({
    "ux-contract": { pattern: "UXI_{n:4d}", declares: "ux-surface" },
    "requirement": { pattern: "REQ_{n:4d}" },
  });
  const contract = `- [UXI_0001] Contract

  \`ux:media.home : screen\` offers:

  - \`/play : activate\` — starts playback.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`;
  const citing = `- [REQ_0001] Journey step

  Tap \`ux:media.ghost/play!activate\` to start playback.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZB
`;
  const diags = validateUxilFamily(
    entriesOf({ "a.md": contract, "b.md": citing }),
    profile,
  );
  assert(diags.some((d) => d.code === "UXIL-018"));
});

Deno.test("family: upstream entries are uxil-inert (#727)", () => {
  const profile = makeProfile({
    "ux-contract": { pattern: "UXI_{n:4d}", declares: "ux-surface" },
  });
  const [entry] = entriesOf({ "a.md": CONTRACT_BAD_KIND });
  const upstream: Entry = {
    ...entry,
    origin: { kind: "upstream", upstreamId: "acme/reqs", version: "v1.0" },
  };
  assertEquals(validateUxilFamily([upstream], profile), []);
});

Deno.test("family: explicit Type: gates in a non-pattern entry (#727)", () => {
  const profile = makeProfile({
    "ux-contract": { pattern: "UXI_{n:4d}", declares: "ux-surface" },
  });
  const md = `- [CUSTOM_1] Contract by explicit type

  \`ux:media.home : widget\` — bad kind.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
      Type: ux-contract
`;
  const diags = validateUxilFamily(entriesOf({ "a.md": md }), profile);
  assert(diags.some((d) => d.code === "UXIL-009"));
});

Deno.test("uxilDeclaringTypes: names types carrying declares (#727)", () => {
  const profile = makeProfile({
    "ux-contract": { pattern: "UXI_{n:4d}", declares: "ux-surface" },
    "requirement": { pattern: "REQ_{n:4d}" },
  });
  assertEquals([...uxilDeclaringTypes(profile)], ["ux-contract"]);
  assertEquals(uxilDeclaringTypes(null).size, 0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
`deno test --allow-read packages/markspec/core/validator/uxil_family_test.ts`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement the barrel exports**

`packages/markspec/core/uxil/mod.ts`:

- Add to the S8 export block:

```ts
export {
  extractUxBullets,
  extractUxRootSpans,
  stripUxilLeadingSpan,
} from "./surfaces.ts";
```

- Extend the diagnostics export line with `uxilDiagnosticAt`, and the validator
  export line with `type UxilValidateOptions` (if not already done in Task 7).
- Update the module doc comment: the family + LSP wiring lands in S9/S10; the
  compiler is now reachable from `check`/LSP through
  `core/validator/uxil_family.ts`.

- [ ] **Step 4: Implement the family module**

Create `packages/markspec/core/validator/uxil_family.ts`:

```ts
/**
 * @module validator/uxil_family
 *
 * The UXIL-0xx diagnostics family orchestrator (S9 #727). Bridges S8's
 * uxil compiler into the profile-aware validation surfaces (`runPipeline`
 * → `markspec check`; LSP `WorkspaceIndex.validateAll`).
 *
 * Gate: a profile type carrying `declares: ux-surface` (ADR-009: the
 * mechanism is core, the designation is profile policy). With no
 * designation anywhere in the chain the family is fully inert — uxil-
 * looking code spans stay opaque (epic S1's Tier-1 guarantee), so a
 * `.gitignore`-style prose bullet can never draw a diagnostic.
 *
 * With a designation:
 *   - entries of a declaring type run the full S8 validation (structure,
 *     vocabulary, corpus registry);
 *   - `ux:` citations are validated from EVERY non-upstream entry —
 *     journeys, tests, and specs cite surfaces from any type;
 *   - an unambiguous root declaration (`ux:… : kind` span) in a
 *     non-declaring entry is UXIL-023. Element/child bullets (`/`-led,
 *     `.`-led) in non-declaring entries stay opaque — they are ambiguous
 *     with ordinary prose code spans, deliberately.
 *
 * Upstream entries are uxil-inert (the #771 `emittableEntries` partition,
 * mirroring validateTypl). Entries are gated by `entry.type` when the
 * pipeline's Stage 2 already classified them, else by `classifyEntry` —
 * so the LSP path (which never runs Stage 2) gates identically; the
 * classification diagnostics are deliberately dropped here (the pipeline
 * owns emitting those).
 */
import type { Diagnostic, EffectiveProfile, Entry } from "../model/mod.ts";
import { emittableEntries } from "../model/mod.ts";
import {
  extractUxRootSpans,
  uxilDiagnosticAt,
  validateUxil,
} from "../uxil/mod.ts";
import { classifyEntry } from "./types.ts";

/**
 * Names of the profile types designated as uxil declaring entry types
 * (`declares: ux-surface`). Empty when `profile` is `null` or no tier
 * designates one — the family's inertness gate.
 */
export function uxilDeclaringTypes(
  profile: EffectiveProfile | null,
): ReadonlySet<string> {
  const out = new Set<string>();
  if (profile === null) return out;
  for (const [name, td] of profile.types) {
    if (td.value.declares?.value === "ux-surface") out.add(name);
  }
  return out;
}

/**
 * Run the UXIL-0xx family over `entries`. Returns file-anchored core
 * diagnostics; `[]` when the gate is closed (see module doc).
 */
export function validateUxilFamily(
  entries: readonly Entry[],
  profile: EffectiveProfile | null,
): readonly Diagnostic[] {
  const declaring = uxilDeclaringTypes(profile);
  if (declaring.size === 0) return [];

  const local = emittableEntries(entries);
  const declaringEntries: Entry[] = [];
  const otherEntries: Entry[] = [];
  const typeOf = new Map<Entry, string | undefined>();
  for (const e of local) {
    const type = e.type ?? classifyEntry(e, profile!).type;
    typeOf.set(e, type);
    if (type !== undefined && declaring.has(type)) declaringEntries.push(e);
    else otherEntries.push(e);
  }

  const diagnostics: Diagnostic[] = [];

  // UXIL-023 — an unambiguous root declaration outside a declaring type.
  for (const e of otherEntries) {
    for (const span of extractUxRootSpans(e.bodyTokens)) {
      diagnostics.push(uxilDiagnosticAt("UXIL-023", {
        entry: e.displayId,
        type: typeOf.get(e) ?? "unclassified",
      }, span.location));
    }
  }

  const result = validateUxil(declaringEntries, { citationEntries: local });
  diagnostics.push(...result.diagnostics);
  return diagnostics;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run:
`deno test --allow-read packages/markspec/core/validator/uxil_family_test.ts`
Expected: PASS.

- [ ] **Step 6: Export through the library boundary**

In `packages/markspec/core/mod.ts`, next to the existing
`export * as typl from "./typl/mod.ts";` (~line 327):

```ts
export {
  uxilDeclaringTypes,
  validateUxilFamily,
} from "./validator/uxil_family.ts";
export * as uxil from "./uxil/mod.ts";
```

Run: `deno check packages/markspec/main.ts packages/markspec/core/mod.ts`
Expected: clean.

- [ ] **Step 7: Amend the design spec path**

In `docs/wip/2026-07-05-uxil-diagnostics-s9-design.md`, change the §2 heading
`### 2. Family orchestrator: \`core/uxil/family.ts\``to`### 2. Family
orchestrator:
\`core/validator/uxil_family.ts\``and append
this sentence to that section's first paragraph: "Lives in`validator/`(not`uxil/`) so the`pipeline
→ family →
classifyEntry`imports stay
one-directional —`uxil/`must not import from`validator/`."

- [ ] **Step 8: Commit**

```bash
just fmt
git add -A && git commit -m "feat(core): validateUxilFamily orchestrator with declares gate + UXIL-023 (#727)"
```

---

### Task 9: Wire the family into the pipeline and the LSP

**Files:**

- Modify: `packages/markspec/core/validator/pipeline.ts` (after Stage 4,
  ~line 220)
- Modify: `packages/markspec/lsp/workspace.ts` (`validateAll`, ~line 270)
- Test: `packages/markspec/core/validator/pipeline_test.ts`,
  `packages/markspec/lsp/workspace_test.ts`

**Interfaces:**

- Consumes: `validateUxilFamily` (Task 8) — from `./uxil_family.ts` in the
  pipeline, from `../core/mod.ts` in the LSP.

- [ ] **Step 1: Write the failing pipeline test**

Append to `packages/markspec/core/validator/pipeline_test.ts` (copy the
`makeProfile` + `entriesOf` helpers from
`packages/markspec/core/validator/uxil_family_test.ts` if the file has no
equivalent builders):

```ts
Deno.test("pipeline: uxil family fires for a designated profile (#727)", () => {
  const profile = makeProfile({
    "ux-contract": { pattern: "UXI_{n:4d}", declares: "ux-surface" },
  });
  const entries = entriesOf({
    "a.md": `- [UXI_0001] Contract

  \`ux:media.home : widget\` — bad kind.

      Id: 01JZZZZZZZZZZZZZZZZZZZZZZA
`,
  });
  const result = runPipeline(entries, profile);
  assertEquals(result.diagnostics.some((d) => d.code === "UXIL-009"), true);

  // Same corpus, no designation → inert.
  const inertProfile = makeProfile({
    "ux-contract": { pattern: "UXI_{n:4d}" },
  });
  const inert = runPipeline(entries, inertProfile);
  assertEquals(inert.diagnostics.some((d) => d.code.startsWith("UXIL")), false);
});
```

- [ ] **Step 2: Write the failing LSP test**

Append to `packages/markspec/lsp/workspace_test.ts` (mirror the existing
"validateAll suppresses MSL-R010" test's profile literal — full
`EffectiveProfile` with a `types` map; the type entry must carry
`displayIdPattern: { value: "UXI_{n:4d}", origin }` and
`declares: { value: "ux-surface", origin }`; copy the remaining
`EffectiveTypeDef` fields from Task 8's `makeProfile`):

```ts
Deno.test("WorkspaceIndex: validateAll runs the uxil family when designated (#727)", async () => {
  const md = `- [UXI_0001] Contract

  \`ux:media.home : widget\` — bad kind.

      Id: 01HGW2Q8MNP3RSTVWXYZABCDEF
`;
  const parsed = await parseFile(md, { file: "t.md" });
  const index = new WorkspaceIndex();
  index.updateFile("t.md", parsed.entries);

  // No profile → the family is inert.
  const bare = index.validateAll();
  assertEquals(bare.some((d) => d.code === "UXIL-009"), false);

  // Designated profile → UXIL-009 surfaces in the editor path.
  const withProfile = index.validateAll(profile);
  assertEquals(withProfile.some((d) => d.code === "UXIL-009"), true);
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run:
`deno test --allow-read packages/markspec/core/validator/pipeline_test.ts packages/markspec/lsp/workspace_test.ts`
Expected: FAIL (no UXIL codes emitted).

- [ ] **Step 4: Implement**

`packages/markspec/core/validator/pipeline.ts` — add
`import { validateUxilFamily } from "./uxil_family.ts";` and, after the Stage 4
block (immediately before the `valid` computation):

```ts
// Stage 5 — uxil diagnostics family (S9 #727). Inert unless some profile
// tier designates a declaring type (`declares: ux-surface`). Receives the
// FULL classified list on purpose: the family derives its own #771
// partition and its own declaring/citing split — registry scope is the
// module's contract, not this orchestrator's (mirrors validateTypl).
diagnostics.push(...validateUxilFamily(finalEntries, profile));
```

`packages/markspec/lsp/workspace.ts` — add `validateUxilFamily` to the existing
`../core/mod.ts` import list; extend `validateAll`'s return:

```ts
return [
  ...attributeCorpusDiagnostics(
    suppressed,
    allEntries,
    collisions.collidedTokens,
  ),
  ...collisions.diagnostics,
  // uxil diagnostics family (S9 #727) — profile-gated; inert without a
  // `declares: ux-surface` designation, so non-uxil projects pay only
  // a Map scan per validateAll.
  ...validateUxilFamily(allEntries, profile),
];
```

Also extend `validateAll`'s doc comment with one sentence noting the uxil family
runs here when the profile designates a declaring type.

- [ ] **Step 5: Run tests to verify they pass**

Run:
`deno test --allow-read packages/markspec/core/validator/ packages/markspec/lsp/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
just fmt
git add -A && git commit -m "feat(core,lsp): wire the uxil diagnostics family into check and validateAll (#727)"
```

---

### Task 10: LSP `codeDescription` for UXIL codes

**Files:**

- Modify: `packages/markspec/lsp/diagnostics.ts` (~line 54 and ~line 90)
- Test: `packages/markspec/lsp/diagnostics_test.ts`

- [ ] **Step 1: Write the failing test**

```ts
Deno.test("toLspDiagnostic: UXIL codes carry a spec-chapter codeDescription (#727)", () => {
  const lsp = toLspDiagnostic({
    code: "UXIL-009",
    severity: "error",
    message: "Unknown surface kind 'widget' (expected screen, panel, or agent).",
    location: { file: "a.md", line: 3, column: 3 },
  });
  assertEquals(lsp.codeDescription?.href, "https://markspec.dev/spec/uxil#uxil-009");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-read packages/markspec/lsp/diagnostics_test.ts`
Expected: FAIL (`codeDescription` undefined).

- [ ] **Step 3: Implement**

Next to `buildRuleDocUrl`:

```ts
/** Build a spec-chapter anchor URL for UXIL diagnostic codes (#727). */
function buildUxilDocUrl(code: string): string {
  return `https://markspec.dev/spec/uxil#${code.toLowerCase()}`;
}
```

In `toLspDiagnostic`, after the MSL-Q branch:

```ts
if (diagnostic.code.startsWith("UXIL-")) {
  return {
    ...base,
    codeDescription: { href: buildUxilDocUrl(diagnostic.code) },
  };
}
```

Update the `LspDiagnostic.codeDescription` doc comment to "populated for MSL-Q
and UXIL codes".

- [ ] **Step 4: Run tests + commit**

```bash
deno test --allow-read packages/markspec/lsp/diagnostics_test.ts
just fmt
git add -A && git commit -m "feat(lsp): reserve codeDescription spec anchors for UXIL codes (#727)"
```

---

### Task 11: Catalogue registration — `docs/spec/language/uxil.md`

**Files:**

- Create: `docs/spec/language/uxil.md`
- Modify: `docs/spec/language/SUMMARY.md`

- [ ] **Step 1: Create the chapter**

`docs/spec/language/uxil.md` — exact content:

````markdown
# uxil — UX Interaction Language

> **Status:** diagnostics catalogue (S9,
> [#727](https://github.com/driftsys/markspec/issues/727)). The full chapter —
> reference grammar, declaration forms, base resolution, registry, and machine
> projection — lands with the uxil ADR (S12,
> [#730](https://github.com/driftsys/markspec/issues/730)).

uxil is a declaration DSL for typed UI/HMI surfaces and interactions: `ux:` URI
references, one root surface per contract entry, element and child-surface
bullets, and a corpus-wide surface registry. It is the sibling of the
[typl DSL](typl.md) on the shared declaration-surface machinery.

## Activation — the declaring entry type

uxil validation is **profile-gated**. A profile designates the contract entry
type by setting `declares: ux-surface` on a type:

```yaml
profile:
  types:
    ux-contract:
      extends: Contract
      display-id-pattern: "UXI_{n:4d}"
      declares: ux-surface
```
````

With no designation anywhere in the active profile chain, uxil content is inert:
uxil-looking code spans stay opaque and draw no diagnostics.

With a designation:

- entries of a declaring type are compiled and validated in full;
- `ux:` citations are validated from **every** entry, whatever its type;
- a root declaration (`` `ux:… : kind` `` span) in a non-declaring entry is
  UXIL-023. Element (`/`-led) and child-surface (`.`-led) bullets outside a
  declaring entry stay opaque — they are ambiguous with ordinary prose code
  spans.

## Diagnostic catalogue

| Code     | Severity | Description                                                                                              |
| -------- | -------- | -------------------------------------------------------------------------------------------------------- |
| UXIL-001 | error    | Malformed uxil reference.                                                                                |
| UXIL-002 | error    | Reserved character in a uxil reference.                                                                  |
| UXIL-003 | error    | `ux://authority` form is reserved; use a scheme-relative reference.                                      |
| UXIL-004 | error    | Root declaration missing its kind.                                                                       |
| UXIL-005 | error    | Element declaration with an empty verb set.                                                              |
| UXIL-006 | error    | Element declaration missing its trailing event dictionary.                                               |
| UXIL-007 | error    | Malformed key template.                                                                                  |
| UXIL-008 | error    | Malformed surface.                                                                                       |
| UXIL-009 | error    | Unknown surface kind (expected `screen`, `panel`, or `agent`).                                           |
| UXIL-010 | error    | Unknown interaction verb.                                                                                |
| UXIL-011 | error    | Contract entry declares no root surface.                                                                 |
| UXIL-012 | error    | More than one root surface declared in a contract entry.                                                 |
| UXIL-013 | error    | `@` states declared on a stateless kind.                                                                 |
| UXIL-014 | error    | `observe` combined with other verbs (it is exclusive).                                                   |
| UXIL-015 | error    | Surface declared more than once corpus-wide.                                                             |
| UXIL-016 | error    | Dangling namespace parent — a nested surface whose dotted ancestor is declared nowhere.                  |
| UXIL-017 | error    | `navigate ->` target does not resolve to a navigable (`screen`) surface.                                 |
| UXIL-018 | error    | Citation of an undeclared surface.                                                                       |
| UXIL-019 | error    | Citation of an undeclared element.                                                                       |
| UXIL-020 | error    | Cited verb not in the element's declared verb set.                                                       |
| UXIL-021 | error    | Cited state not declared on the surface.                                                                 |
| UXIL-022 | error    | Concrete key cited where the element declares a key template.                                            |
| UXIL-023 | error    | uxil declaration outside the declaring entry type.                                                       |
| UXIL-024 | error    | Relative reference with no base in scope. _Reserved — reachable once the uxil table surface lands (§A)._ |
| UXIL-025 | error    | `observe` declared on a surface whose kind is not visual.                                                |
| UXIL-026 | error    | `navigate` declared without a `-> target` clause.                                                        |

Editor integrations receive each code's documentation link as an LSP
`codeDescription` targeting `https://markspec.dev/spec/uxil#uxil-0xx` anchors in
this chapter.

````
- [ ] **Step 2: Register the chapter**

`docs/spec/language/SUMMARY.md` — append after the typl line:

```markdown
- [uxil DSL](uxil.md)
````

- [ ] **Step 3: Format + commit**

```bash
dprint fmt docs/spec/language/uxil.md docs/spec/language/SUMMARY.md
git add -A && git commit -m "docs(spec): register the UXIL-0xx diagnostic catalogue (#727)"
```

---

### Task 12: E2E blackbox tests

**Files:**

- Create: `tests/e2e/uxil_check_test.ts`

- [ ] **Step 1: Write the e2e suite**

```ts
/**
 * E2E acceptance tests for the UXIL-0xx diagnostics family (S9, #727).
 * Blackbox: drives `markspec check` only. See the design spec
 * docs/wip/2026-07-05-uxil-diagnostics-s9-design.md.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

const PROJECT_YAML = `name: uxil-e2e\nversion: 0.1.0\n`;
const MARKSPEC_YAML = `profiles:\n  - ./profiles/seed\n`;

const PROFILE_YAML = `id: "@seed/uxil-e2e"
version: 0.1.0
markspec-schema: "1"
profile:
  types:
    ux-contract:
      extends: Contract
      display-id-pattern: "UXI_{n:4d}"
      declares: ux-surface
    requirement:
      extends: Requirement
      display-id-pattern: "REQ_{n:4d}"
`;

const PROFILE_YAML_NO_DECLARES = `id: "@seed/uxil-e2e"
version: 0.1.0
markspec-schema: "1"
profile:
  types:
    ux-contract:
      extends: Contract
      display-id-pattern: "UXI_{n:4d}"
    requirement:
      extends: Requirement
      display-id-pattern: "REQ_{n:4d}"
`;

const CONTRACT = `- [UXI_0001] Media home contract

  \`ux:media.home : screen @ loading, ready\` offers:

  - \`/play : activate\` — starts playback.

      Id: 01HZZZ0000000000000000010A
`;

Deno.test("uxil: clean designated corpus passes check", async () => {
  const { code, stderr } = await markspec(["check", "contract.md"], {
    "project.yaml": PROJECT_YAML,
    ".markspec.yaml": MARKSPEC_YAML,
    "profiles/seed/markspec.yaml": PROFILE_YAML,
    "contract.md": CONTRACT,
  });
  assertEquals(code, 0, stderr);
});

Deno.test("uxil: unknown verb in a contract entry is UXIL-010", async () => {
  const bad = `- [UXI_0001] Media home contract

  \`ux:media.home : screen\` offers:

  - \`/play : frobnicate\` — an unknown verb.

      Id: 01HZZZ0000000000000000010A
`;
  const { code, stderr } = await markspec(["check", "contract.md"], {
    "project.yaml": PROJECT_YAML,
    ".markspec.yaml": MARKSPEC_YAML,
    "profiles/seed/markspec.yaml": PROFILE_YAML,
    "contract.md": bad,
  });
  assertEquals(code, 1);
  assertStringIncludes(stderr, "UXIL-010");
});

Deno.test("uxil: root declaration in a requirement entry is UXIL-023", async () => {
  const rogue = `- [REQ_0001] Not a contract

  \`ux:rogue.surface : screen\` — declared in the wrong entry type.

      Id: 01HZZZ0000000000000000020A
`;
  const { code, stderr } = await markspec(
    ["check", "contract.md", "req.md"],
    {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": MARKSPEC_YAML,
      "profiles/seed/markspec.yaml": PROFILE_YAML,
      "contract.md": CONTRACT,
      "req.md": rogue,
    },
  );
  assertEquals(code, 1);
  assertStringIncludes(stderr, "UXIL-023");
});

Deno.test("uxil: dangling citation from a requirement entry is UXIL-018", async () => {
  const citing = `- [REQ_0001] Journey step

  Tap \`ux:media.ghost/play!activate\` to start playback.

      Id: 01HZZZ0000000000000000020A
`;
  const { code, stderr } = await markspec(
    ["check", "contract.md", "req.md"],
    {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": MARKSPEC_YAML,
      "profiles/seed/markspec.yaml": PROFILE_YAML,
      "contract.md": CONTRACT,
      "req.md": citing,
    },
  );
  assertEquals(code, 1);
  assertStringIncludes(stderr, "UXIL-018");
});

Deno.test("uxil: without a declares designation the family is inert", async () => {
  const prose = `- [REQ_0001] Ordinary prose

  Config files live in bullets:

  - \`.gitignore\` — repository excludes.

      Id: 01HZZZ0000000000000000020A
`;
  const { code, stderr } = await markspec(
    ["check", "contract.md", "req.md"],
    {
      "project.yaml": PROJECT_YAML,
      ".markspec.yaml": MARKSPEC_YAML,
      "profiles/seed/markspec.yaml": PROFILE_YAML_NO_DECLARES,
      "contract.md": CONTRACT,
      "req.md": prose,
    },
  );
  assertEquals(code, 0, stderr);
  assertEquals(stderr.includes("UXIL"), false);
});
```

- [ ] **Step 2: Run the suite**

Run:
`deno test --allow-read --allow-write --allow-run --allow-env --allow-ffi tests/e2e/uxil_check_test.ts`
Expected: PASS. If a fixture trips an unrelated gate (e.g. an advisory warning
flips the exit code), fix the FIXTURE (e.g. add the missing field) — do not
weaken assertions from exact `assertEquals(code, …)` to ranges.

- [ ] **Step 3: Commit**

```bash
just fmt
git add -A && git commit -m "test(cli): e2e coverage for the UXIL-0xx family gate and codes (#727)"
```

---

### Task 13: Full verification

- [ ] **Step 1: Full build gate**

Run (from the worktree root): `just build` Expected: lint + full test suite +
type-check + compile all pass, 0 failures.

- [ ] **Step 2: Format gates CI runs separately**

Run: `deno fmt --check && dprint check` Expected: no diffs (`just build` does
NOT cover `deno fmt --check`).

- [ ] **Step 3: Acceptance sweep against #727**

Verify each acceptance item and note the evidence in the task output:

- every code UXIL-001..026 has a template + severity in `UXIL_CODES` and at
  least one triggering test (001–008 grammar tests; 009–022 validator tests;
  023/025/026 new fixtures; 024 direct factory test, documented reserved);
- catalogue registered (`docs/spec/language/uxil.md` + SUMMARY);
- LSP `codeDescription` targets reserved (Task 10 test).

- [ ] **Step 4: Final commit if anything moved**

```bash
git status --short   # expect clean; commit any fmt-only residue as chore
```

**PR (after user approval):** single PR from `story/727-uxil-diagnostics`; title
`story(uxil): UXIL-0xx diagnostics family (#727)`; body starts with
`Closes #727.`; then `/review` per repo workflow.
