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
import type { Binding, Typedef, TyplBlock } from "./ast.ts";
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
      diagnostics.push(
        bridgeTyplDiagnostic(td, inline.location.file, lineOffset),
      );
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
