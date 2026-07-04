/**
 * @module typl/assemble
 *
 * Entry-level typl assembly (#723, #724): extracts declarations from the four
 * surfaces (fence / bullet / inline / table), resolves published names through
 * the base-resolution engine (core/decl/resolve), and aggregates the
 * result into the `Entry.types` TyplBlock. Moved out of parser/markdown.ts
 * so the parser calls one function.
 *
 * Resolution rules (design spec D5):
 *   - a `: namespace` binding establishes a base; nested-bullet namespaces
 *     scope their subtree (innermost wins); the root namespace (no
 *     namespace ancestor) scopes the whole entry body, order-independent;
 *   - a table's `Table:` caption may carry a base (#724); a table row
 *     resolves against that caption base first (innermost, #722 rule 3),
 *     then the root — the caption base is not itself a root and never sets
 *     `rootNamespace`;
 *   - relative names (`$.x`) resolve to absolute dotted names before
 *     aggregation — Entry.types carries absolute names only;
 *   - namespace bindings are scaffolding: excluded from bindings;
 *   - a relative name with no base is TYPL-010 (binding dropped);
 *   - a second root is TYPL-012 (first root wins);
 *   - inline/fence relative refs resolve against the root base only.
 */
import type { BodyBlock } from "../ast/nodes.ts";
import type { BodyToken, Diagnostic } from "../model/mod.ts";
import type { Binding, Typedef, TyplBlock } from "./ast.ts";
import { type BaseScope, checkSingleRoot, resolveRef } from "../decl/mod.ts";
import { bridgeTyplDiagnostic } from "./bridge.ts";
import { typlDiagnostic } from "./diagnostics.ts";
import { extractTyplFences } from "./fence.ts";
import { extractTyplBulletsNested } from "./bullet.ts";
import { extractTyplInlines } from "./inline.ts";
import { extractTyplTable, typlTableCaptionBase } from "./table.ts";
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
  /** Base path parsed from the enclosing table's `Table:` caption (#724);
   * `scopeFor` uses it as the innermost scope for a table row's own
   * bindings. Always undefined for fence, bullet, and inline blocks. */
  readonly captionBase?: string;
}

/** One root-candidate namespace binding, for {@linkcode checkSingleRoot}. */
interface RootCandidate {
  readonly path: string;
  readonly blockIndex: number;
  readonly position: { line: number; column: number };
}

/**
 * Assemble one entry's typl declarations into its `Entry.types` block.
 *
 * Extracts declarations from the four embedding surfaces (fenced code,
 * bullet glossary, inline code spans, table rows), resolves every relative
 * `$.x` name against the caption/root/nested-namespace bases in scope (see
 * the module doc's resolution rules), and aggregates the result.
 *
 * @param bodyAst - The entry body's parsed block AST (fence + bullet + table
 *   surfaces walk this).
 * @param bodyTokens - The entry body's flat token stream (the inline
 *   surface walks this).
 * @param file - Source file path, for bridging diagnostics back to
 *   file-relative positions.
 * @param bodyStartLine - 1-based line the entry body starts on, added to
 *   each surface's body-relative range to get a file-relative line.
 * @returns `types` — the assembled `TyplBlock`, omitted when the entry
 *   declares nothing (no bindings, no typedefs, no root namespace) — plus
 *   any diagnostics raised during extraction or resolution (TYPL-010,
 *   TYPL-012, and bridged parse diagnostics).
 */
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
      diagnostics.push(
        bridgeTyplDiagnostic(td, inline.location.file, lineOffset),
      );
    }
    blocks.push({ ...result.ast, file: inline.location.file, lineOffset });
  }

  // Table rows (#724): each recognized data row is one binding. Its range is
  // line-precise, so the diagnostic offset mirrors the fence surface. A
  // `Table:` caption base — when the caption text is an absolute typl name —
  // scopes the row's relative refs (see `scopeFor`); it is not a namespace
  // binding, so it takes no part in Pass A root detection or Pass B.
  for (const row of extractTyplTable(bodyAst)) {
    const result = parseTyplBlock(row.source);
    const lineOffset = bodyStartLine + row.range.start.line - 1;
    for (const td of result.diagnostics) {
      diagnostics.push(bridgeTyplDiagnostic(td, file, lineOffset));
    }
    const captionBase = row.captionText !== undefined
      ? typlTableCaptionBase(row.captionText)
      : undefined;
    blocks.push({
      ...result.ast,
      file,
      lineOffset,
      ...(captionBase !== undefined ? { captionBase } : {}),
    });
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
  // root — it needs a base itself). checkSingleRoot (core/decl) enforces
  // the one-root invariant; its bare contract also flags zero candidates
  // as a failure ("no-root"), but an entry with no namespace binding at
  // all is a normal, error-free shape here — only "multiple-roots"
  // produces diagnostics, first candidate in source order wins (order-
  // independent for authors: the root scopes the whole body).
  const rootCandidates: RootCandidate[] = [];
  for (let i = 0; i < blocks.length; i++) {
    for (const binding of blocks[i].bindings) {
      if (binding.kind !== "namespace") continue;
      if (!TYPL_REF_OPS.isAbsolute(binding.name)) continue;
      if (hasNamespaceAncestor(i)) continue;
      rootCandidates.push({
        path: typlPathOf(binding.name),
        blockIndex: i,
        position: binding.position,
      });
    }
  }
  const rootCheck = checkSingleRoot(rootCandidates);
  let rootPath: string | undefined;
  if (rootCheck.ok) {
    rootPath = rootCheck.root.path;
  } else if (rootCheck.reason === "multiple-roots") {
    rootPath = rootCheck.roots[0].path;
    for (let k = 1; k < rootCheck.roots.length; k++) {
      const extra = rootCheck.roots[k];
      emit(
        "TYPL-012",
        { first: `$${rootPath}` },
        extra.blockIndex,
        extra.position,
      );
    }
  }
  // "no-root" → rootPath stays undefined; not an error.

  // basePathOfBlock[i] = the base path blocks[i] provides to its bullet
  // subtree, or undefined. One base slot per block: a block with several
  // namespace bindings keeps the last (bullet blocks hold a single
  // declaration in practice).
  const basePathOfBlock: (string | undefined)[] = blocks.map(() => undefined);

  /**
   * Scope chain for blocks[i]: a table-row block's `Table:` caption base
   * innermost (#724), then bullet-ancestor bases innermost-first, terminated
   * by the root base. Built immutably per call; fence/inline blocks have
   * neither a caption base nor a bullet chain and see the root only.
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
    // A table row resolves against its caption base first (#722 rule 3):
    // innermost, above the bullet chain and the root.
    const captionBase = blocks[i].captionBase;
    if (captionBase !== undefined) scope = { base: captionBase, parent: scope };
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
