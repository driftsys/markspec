/**
 * @module uxil/assemble
 *
 * Per-entry uxil assembly (S8 #726): walks an entry's root/element/child
 * declarations, resolves child-surface paths against the entry-local base
 * chain (root ← child-surface ancestors, innermost wins — core/decl/resolve),
 * and stitches the result into a {@linkcode UxSurfaceTree}. Mirrors
 * typl/assemble.ts's pass structure, simplified: uxil child surfaces are
 * always relative joins (the leading-dot grammar has no absolute form), and
 * kind is declared once at the root and inherited by every descendant
 * surface (`ChildSurfaceDecl` carries no `kind` field).
 *
 * Vocabulary validation (unknown kind/verb, state rules, exclusivity) is
 * NOT this module's concern — it runs over the assembled tree in
 * validator.ts (Pass 1). This module is purely structural: extraction,
 * base resolution, and tree-building.
 *
 * A declaration whose parse produced any diagnostic is never registered
 * (gated on a clean parse, never on decl truthiness — grammar.ts #780);
 * its diagnostics are still collected and returned.
 */
import type { SourceRange } from "../ast/nodes.ts";
import type { Entry, SourceLocation } from "../model/mod.ts";
import type { UxKey } from "./ast.ts";
import {
  type BaseScope,
  checkSingleRoot,
  type RefOps,
  resolveRef,
} from "../decl/mod.ts";
import { type UxilDiagnostic, uxilDiagnostic } from "./diagnostics.ts";
import {
  parseChildSurfaceDecl,
  parseElementBullet,
  parseRootDecl,
} from "./grammar.ts";
import { classifyUxilForm } from "./recognize.ts";
import {
  extractUxBullets,
  extractUxRootSpans,
  stripUxilLeadingSpan,
} from "./surfaces.ts";

/** Reference operations for uxil's dotted internal surface paths. Child
 * surfaces are always relative (the leading-dot grammar has no absolute
 * form), so `isAbsolute` never fires in practice for a child-surface join —
 * kept for API symmetry with the DSL-agnostic `core/decl` engine. */
export const UX_REF_OPS: RefOps = {
  isAbsolute: (r) => r.startsWith("ux:"),
  join: (b, r) => `${b}.${r}`,
};

/** One declared interaction element on a surface. */
export interface UxElement {
  readonly name: string;
  readonly verbs: readonly string[];
  readonly keyTemplate?: UxKey;
  readonly navTarget?: string;
  readonly states: readonly string[];
  readonly eventDictionary: string;
  readonly location: SourceLocation;
}

/** One declared surface (root or child), with its elements. */
export interface UxSurface {
  readonly path: string;
  readonly kind: string;
  readonly states: readonly string[];
  readonly elements: readonly UxElement[];
  readonly location: SourceLocation;
}

/** Result of assembling one entry's uxil declarations. */
export interface UxSurfaceTree {
  readonly surfaces: readonly UxSurface[];
  readonly diagnostics: readonly UxilDiagnostic[];
}

/** Per-bullet parse state, indexed in parallel with the filtered bullet list. */
interface BulletInfo {
  readonly form: "element" | "child";
  readonly verbs?: readonly string[];
  readonly keyTemplate?: UxKey;
  readonly navTarget?: string;
  readonly elementStates?: readonly string[];
  readonly eventDictionary?: string;
  readonly elementName?: string;
  readonly childPath?: readonly string[];
  readonly childStates?: readonly string[];
  resolvedPath?: string;
}

function toLocation(entry: Entry, range: SourceRange): SourceLocation {
  return {
    file: entry.location.file,
    line: (entry.bodyStartLine ?? 1) + range.start.line - 1,
    column: range.start.column,
  };
}

/**
 * Assemble one entry's uxil declarations into its surface tree. Reads
 * `entry.bodyTokens` (root spans) and `entry.bodyAst` (element/child
 * bullets) — no parser or model change; S8 is a pure downstream reader.
 */
export function assembleUxSurface(entry: Entry): UxSurfaceTree {
  const diagnostics: UxilDiagnostic[] = [];

  // ── Root ──────────────────────────────────────────────────────────────
  const rootSpans = extractUxRootSpans(entry.bodyTokens);
  const rootCandidates: {
    surface: readonly string[];
    kind: string;
    states: readonly string[];
    location: SourceLocation;
  }[] = [];
  for (const span of rootSpans) {
    const { decl, diagnostics: parseDiags } = parseRootDecl(span.source);
    diagnostics.push(...parseDiags);
    if (decl && parseDiags.length === 0) {
      rootCandidates.push({
        surface: decl.surface,
        kind: decl.kind,
        states: decl.states,
        location: span.location,
      });
    }
  }

  let rootPath: string | undefined;
  let rootKind: string | undefined;
  let rootStates: readonly string[] = [];
  let rootLocation: SourceLocation | undefined;

  const bullets = extractUxBullets(entry.bodyAst ?? []);

  if (rootCandidates.length === 0) {
    // A malformed root span already reports its own specific parse
    // diagnostic (e.g. UXIL-004) — adding "no root found" on top would be
    // redundant noise for the same defect. UXIL-011 is reserved for the
    // distinct case: uxil content exists (bullets) but no root span was
    // ever written at all. An entry with no uxil content whatsoever is not
    // this module's concern (ADR-009: entry-type policy is S9/profile's).
    if (rootSpans.length === 0 && bullets.length > 0) {
      diagnostics.push(
        uxilDiagnostic("UXIL-011", {}, {
          line: entry.bodyStartLine ?? 1,
          column: 1,
        }),
      );
    }
  } else {
    const check = checkSingleRoot(rootCandidates);
    const first = rootCandidates[0];
    rootPath = first.surface.join(".");
    rootKind = first.kind;
    rootStates = first.states;
    rootLocation = first.location;
    if (!check.ok) {
      // multiple-roots: first wins (source order); every extra is UXIL-012.
      for (let k = 1; k < check.roots.length; k++) {
        const extra = check.roots[k];
        diagnostics.push(
          uxilDiagnostic("UXIL-012", { first: `ux:${rootPath}` }, {
            line: extra.location.line,
            column: extra.location.column,
          }),
        );
      }
    }
  }

  // ── Element / child-surface bullets ─────────────────────────────────────
  const bulletInfo: BulletInfo[] = bullets.map((bullet) => {
    const span = stripUxilLeadingSpan(bullet.source);
    const form = span !== undefined ? classifyUxilForm(span) : undefined;
    if (form === "child") {
      const { decl, diagnostics: parseDiags } = parseChildSurfaceDecl(span!);
      diagnostics.push(...parseDiags);
      if (decl && parseDiags.length === 0) {
        return {
          form: "child",
          childPath: decl.path,
          childStates: decl.states,
        };
      }
      return { form: "child" };
    }
    // form === "element" (extractUxBullets only returns element/child spans).
    const { decl, diagnostics: parseDiags } = parseElementBullet(
      bullet.source,
    );
    diagnostics.push(...parseDiags);
    if (decl && parseDiags.length === 0) {
      return {
        form: "element",
        elementName: decl.element,
        verbs: decl.verbs,
        keyTemplate: decl.keyTemplate,
        navTarget: decl.nav ? decl.nav.surface.join(".") : undefined,
        elementStates: decl.states,
        eventDictionary: decl.eventDictionary,
      };
    }
    return { form: "element" };
  });

  // Base-resolution scope for bulletInfo[i]: walk the `.parent` chain,
  // collecting resolved child-surface ancestor bases (innermost first),
  // terminated by the root base. Elements never establish a base — the
  // walk passes over them without pushing, matching "only declarations
  // create bases; citations/leaves never do" (core/decl/resolve rule 1).
  const scopeFor = (parent: number | undefined): BaseScope | undefined => {
    const chain: string[] = [];
    let p = parent;
    while (p !== undefined) {
      const info = bulletInfo[p];
      if (info.form === "child" && info.resolvedPath !== undefined) {
        chain.push(info.resolvedPath);
      }
      p = bullets[p].parent;
    }
    let scope: BaseScope | undefined = rootPath !== undefined
      ? { base: rootPath }
      : undefined;
    for (let k = chain.length - 1; k >= 0; k--) {
      scope = { base: chain[k], parent: scope };
    }
    return scope;
  };

  // Resolve child-surface paths in source order. Parents always precede
  // children in the depth-first extraction order (core/decl/surfaces.ts
  // guarantee), so a single forward pass suffices — no fixpoint needed.
  for (let i = 0; i < bullets.length; i++) {
    const info = bulletInfo[i];
    if (info.form !== "child" || info.childPath === undefined) continue;
    const res = resolveRef(
      info.childPath.join("."),
      scopeFor(bullets[i].parent),
      UX_REF_OPS,
    );
    // A relative child-surface ref only fails to resolve when there is no
    // root anywhere in its ancestor chain — already reported once via
    // UXIL-011 above (or an already-reported malformed root). Skip
    // silently rather than emit a second, cascading diagnostic.
    if (res.ok) info.resolvedPath = res.ref;
  }

  // Nearest enclosing surface path for a bullet's `.parent` — the closest
  // resolved child-surface ancestor, or the root when there is none.
  const enclosingSurfacePath = (
    parent: number | undefined,
  ): string | undefined => {
    let p = parent;
    while (p !== undefined) {
      const info = bulletInfo[p];
      if (info.form === "child" && info.resolvedPath !== undefined) {
        return info.resolvedPath;
      }
      p = bullets[p].parent;
    }
    return rootPath;
  };

  // ── Group elements under their enclosing surface ────────────────────────
  const elementsByPath = new Map<string, UxElement[]>();
  for (let i = 0; i < bullets.length; i++) {
    const info = bulletInfo[i];
    if (info.form !== "element" || info.elementName === undefined) continue;
    const path = enclosingSurfacePath(bullets[i].parent);
    if (path === undefined) continue; // no root in scope — see note above
    const element: UxElement = {
      name: info.elementName,
      verbs: info.verbs ?? [],
      ...(info.keyTemplate ? { keyTemplate: info.keyTemplate } : {}),
      ...(info.navTarget !== undefined ? { navTarget: info.navTarget } : {}),
      states: info.elementStates ?? [],
      eventDictionary: info.eventDictionary ?? "",
      location: toLocation(entry, bullets[i].range),
    };
    const list = elementsByPath.get(path);
    if (list) list.push(element);
    else elementsByPath.set(path, [element]);
  }

  // ── Build the surface list ───────────────────────────────────────────────
  const surfaces: UxSurface[] = [];
  if (
    rootPath !== undefined && rootKind !== undefined &&
    rootLocation !== undefined
  ) {
    surfaces.push({
      path: rootPath,
      kind: rootKind,
      states: rootStates,
      elements: elementsByPath.get(rootPath) ?? [],
      location: rootLocation,
    });
  }
  for (let i = 0; i < bullets.length; i++) {
    const info = bulletInfo[i];
    if (info.form !== "child" || info.resolvedPath === undefined) continue;
    surfaces.push({
      path: info.resolvedPath,
      // A resolved child-surface implies rootPath (hence rootKind) is
      // defined — the only source of a base in this model is the root
      // fallback (see scopeFor); every resolved path traces back to it.
      kind: rootKind!,
      states: info.childStates ?? [],
      elements: elementsByPath.get(info.resolvedPath) ?? [],
      location: toLocation(entry, bullets[i].range),
    });
  }

  return { surfaces, diagnostics };
}
