/**
 * @module lsp/typl
 *
 * LSP-side typl helpers — pure functions that compute hover content
 * and completion items for typl `$Name` identifiers and typedef
 * references. Consume the corpus TypeRegistry from
 * core/typl/registry.ts.
 *
 * Published tier (#723/#750): dotted names (`$powertrain.brake.pedal_position`)
 * are declared exactly once corpus-wide and citable from any entry; relative
 * refs (`$.pedal_position`) keep the `$` sigil and resolve against the
 * enclosing entry's root namespace. This module recognizes both token shapes
 * and resolves relative refs against the entry **root** only (nested-namespace
 * bases are not persisted per line — see the S5 LSP-alignment design record).
 *
 * See ADR-019.
 */
import type { RegistryBinding, Shape, TypeRegistry } from "../core/typl/mod.ts";
import {
  isPublishedTyplName,
  isRelativeTyplName,
  TYPL_REF_OPS,
} from "../core/typl/mod.ts";

/** Token continuation set for typl refs: identifier chars plus the `.`
 * segment separator (dotted published paths + relative `$.x`). */
const TOKEN_CHAR_RE = /[A-Za-z0-9_.]/;

/**
 * Return the typl reference token at the given column on `line`, or
 * `undefined` when the column lies on whitespace, past the line end, on a
 * bare `.` separator, or outside a `$`-anchored token.
 *
 * A token starts with `$` and continues through `[A-Za-z0-9_.]`, so it spans
 * dotted published names (`$powertrain.brake.pedal_position`) and the
 * relative form (`$.pedal_position`). The `$` sigil breaks the left scan, so
 * a `$` embedded after prose dots still yields just the sigil-led token
 * (`path.to.$sig` → `$sig`). A trailing dot (a sentence period, or a dangling
 * separator) is trimmed, and a bare `$` / `$.` returns `undefined`.
 */
export function dollarNameAtPosition(
  line: string,
  column: number,
): string | undefined {
  if (column < 0 || column >= line.length) return undefined;
  const ch = line[column];
  if (/\s/.test(ch)) return undefined;

  let start: number;
  let end: number;
  if (ch === "$") {
    start = column;
    end = column + 1;
    while (end < line.length && TOKEN_CHAR_RE.test(line[end])) end++;
  } else {
    // Cursor on a token char. A lone `.` separator is not an anchor — reject
    // it so the cursor sitting on a sentence period never yields a token.
    if (!TOKEN_CHAR_RE.test(ch) || ch === ".") return undefined;
    start = column;
    while (start > 0 && TOKEN_CHAR_RE.test(line[start - 1])) start--;
    if (start === 0 || line[start - 1] !== "$") return undefined;
    start--; // include the `$`
    end = column + 1;
    while (end < line.length && TOKEN_CHAR_RE.test(line[end])) end++;
  }
  // A typl ref never ends in a dot — trim a trailing sentence period or
  // dangling separator so `$a.b.` in prose resolves to `$a.b`.
  const token = line.slice(start, end).replace(/\.+$/, "");
  if (token.length < 2) return undefined; // bare `$` (or `$.` after trim)
  return token;
}

/**
 * Context for {@linkcode formatTyplHoverContent}, supplied by the server from
 * the entry enclosing the cursor.
 */
export interface TyplHoverContext {
  /** Display ID of the enclosing entry — used to mark "declared in this
   * entry" and to pick the relevant declaration of an entry-local name. */
  readonly entryDisplayId?: string;
  /** The enclosing entry's root namespace path (no `$`), when it declares one
   * — the base a relative `$.x` ref resolves against. */
  readonly rootNamespace?: string;
}

/**
 * Format the hover content for a typl reference from the corpus registry.
 *
 * Branches by token shape:
 *
 *   - **relative `$.x`** — resolved against `context.rootNamespace` (root
 *     only) and rendered as the published symbol it names; `undefined` when
 *     no root namespace is in scope (nothing to resolve against).
 *   - **published `$a.b`** — the declared-once dotted symbol: full path,
 *     kind, shape, and its declaring entry/file (or "this entry" when the
 *     cursor is inside the declaring entry).
 *   - **plain `$Name`** — an entry-local symbol; kind/shape/declaration with
 *     no cross-entry collision framing (TYPL-002/003 are retired — two
 *     entries declaring the same plain name are independent symbols).
 *
 * Returns `undefined` when the resolved name isn't declared anywhere.
 */
export function formatTyplHoverContent(
  name: string,
  registry: TypeRegistry,
  context?: TyplHoverContext,
): string | undefined {
  // Resolve a relative ref against the entry root (root-only — see module
  // doc). Absolute names (plain or dotted) are looked up as-is.
  let lookupName = name;
  if (isRelativeTyplName(name)) {
    const root = context?.rootNamespace;
    if (root === undefined) return undefined;
    lookupName = TYPL_REF_OPS.join(root, name);
  }

  const decls = registry.bindings.get(lookupName);
  if (!decls || decls.length === 0) return undefined;

  const published = isPublishedTyplName(lookupName);
  const primary = pickPrimaryDecl(decls, context?.entryDisplayId);

  const lines: string[] = [`### ${lookupName}`, ""];
  lines.push(
    published
      ? `**Kind:** ${primary.binding.kind} · **Published**`
      : `**Kind:** ${primary.binding.kind}`,
  );
  const shapeStr = formatShape(primary.binding.shape);
  if (shapeStr) lines.push(`**Shape:** \`${shapeStr}\``);

  if (published) {
    if (decls.length > 1) {
      // Declared-once violated (TYPL-009) — surface every declaring site.
      lines.push(`**Declared ${decls.length} times** (TYPL-009):`);
      for (const d of decls) {
        lines.push(`- ${d.entryDisplayId} (${d.entryFile})`);
      }
    } else if (
      context?.entryDisplayId !== undefined &&
      context.entryDisplayId === primary.entryDisplayId
    ) {
      lines.push(`**Declared in this entry** (${primary.entryDisplayId})`);
    } else {
      lines.push(
        `**Declared in:** ${primary.entryDisplayId} (${primary.entryFile})`,
      );
    }
  } else if (decls.length === 1) {
    lines.push(
      `**Declared in:** ${primary.entryDisplayId} (${primary.entryFile})`,
    );
  } else {
    // Entry-local names have no cross-entry identity — list the independent
    // declarations without the retired collision framing.
    lines.push(
      `**Entry-local** — declared independently in ${decls.length} entries:`,
    );
    for (const d of decls) {
      lines.push(`- ${d.entryDisplayId} (${d.entryFile})`);
    }
  }

  return lines.join("\n");
}

/** Pick the declaration to feature: the one in the cursor's entry when it
 * declares the name (entry-local relevance), else the first. */
function pickPrimaryDecl(
  decls: readonly RegistryBinding[],
  entryDisplayId: string | undefined,
): RegistryBinding {
  if (entryDisplayId !== undefined) {
    const own = decls.find((d) => d.entryDisplayId === entryDisplayId);
    if (own) return own;
  }
  return decls[0];
}

/**
 * Compact one-line rendering of a typl Shape for hover and completion
 * details. Returns undefined for absent shape.
 */
export function formatShape(shape: Shape | undefined): string | undefined {
  if (!shape) return undefined;
  switch (shape.kind) {
    case "primitive":
      return shape.type;
    case "range": {
      const lo = shape.min ?? "";
      const hi = shape.max ?? "";
      if (shape.exact !== undefined) return `${shape.type}[${shape.exact}]`;
      return `${shape.type}[${lo}..${hi}]`;
    }
    case "length": {
      if (shape.exact !== undefined) return `${shape.type}[${shape.exact}]`;
      const lo = shape.min ?? "";
      const hi = shape.max ?? "";
      return `${shape.type}[${lo}..${hi}]`;
    }
    case "pattern":
      return `/${shape.regex}/${shape.flags ?? ""}`;
    case "array": {
      const inner = formatShape(shape.element);
      if (shape.exact !== undefined) return `${inner}[${shape.exact}]`;
      if (shape.min !== undefined || shape.max !== undefined) {
        return `${inner}[](${shape.min ?? ""}..${shape.max ?? ""})`;
      }
      return `${inner}[]`;
    }
    case "enum":
      return shape.values.map((v) => JSON.stringify(v)).join(" | ");
    case "record": {
      const fields = Object.entries(shape.fields).map(([k, v]) =>
        `${k}: ${formatShape(v)}`
      );
      return `{ ${fields.join(", ")} }`;
    }
    case "literal":
      return JSON.stringify(shape.value);
    case "ref":
      return shape.name;
    case "optional":
      return `${formatShape(shape.inner)}?`;
  }
}

/** Completion-item info for a `$Name` from the registry. */
export interface TyplCompletionItem {
  readonly label: string;
  readonly detail: string;
  readonly documentation: string;
}

/** Options for {@linkcode buildDollarNameCompletions}. */
export interface DollarCompletionOptions {
  /** The enclosing entry's root namespace path (no `$`), when it declares
   * one. Enables relative `$.tail` shorthands for leaves under the root. */
  readonly rootNamespace?: string;
  /** `true` when the trigger is a relative partial (`$.` / `$.ped`): offer
   * only relative shorthands. `false`/absent: flat corpus list plus this
   * entry's relative shorthands. */
  readonly relative?: boolean;
}

/**
 * Build completion items for `$Name` triggers.
 *
 * - Relative mode (`opts.relative`) offers only `$.tail` shorthands for
 *   published leaves under the entry's root namespace; empty when the entry
 *   has no root namespace (a relative ref is illegal without a base).
 * - Absolute mode offers the flat corpus list — every entry-local and
 *   published name — plus this entry's `$.tail` shorthands when it declares a
 *   root namespace.
 *
 * `detail` shows kind + shape; `documentation` shows where the name is
 * declared (or, for a relative shorthand, what it resolves to).
 */
export function buildDollarNameCompletions(
  registry: TypeRegistry,
  opts: DollarCompletionOptions = {},
): readonly TyplCompletionItem[] {
  const { rootNamespace, relative = false } = opts;
  const rootPrefix = rootNamespace !== undefined
    ? `$${rootNamespace}.`
    : undefined;

  const relativeShorthands = (): TyplCompletionItem[] => {
    const out: TyplCompletionItem[] = [];
    if (rootPrefix === undefined) return out;
    for (const [name, decls] of registry.bindings) {
      if (decls.length === 0) continue;
      if (!name.startsWith(rootPrefix)) continue;
      const tail = name.slice(rootPrefix.length);
      out.push({
        label: `$.${tail}`,
        detail: detailOf(decls[0]),
        documentation: `Resolves to ${name}`,
      });
    }
    return out;
  };

  if (relative) return relativeShorthands();

  const items: TyplCompletionItem[] = [];
  for (const [name, decls] of registry.bindings) {
    if (decls.length === 0) continue;
    const first = decls[0];
    const documentation = decls.length === 1
      ? `Declared in ${first.entryDisplayId}`
      : name.includes(".")
      ? `Declared in ${decls.length} entries`
      : `Entry-local; declared independently in ${decls.length} entries`;
    items.push({ label: name, detail: detailOf(first), documentation });
  }
  items.push(...relativeShorthands());
  return items;
}

/** One-line "kind shape" detail for a binding declaration. */
function detailOf(rb: RegistryBinding): string {
  const shape = formatShape(rb.binding.shape);
  return shape ? `${rb.binding.kind} ${shape}` : rb.binding.kind;
}

/**
 * Return true when the text before the cursor ends with a `$`-prefixed
 * partial — the trigger for `$Name` completion. Fires on a plain name
 * (`$Sp`), a bare sigil (`$`), a relative partial (`$.` / `$.ped`), and a
 * dotted absolute partial (`$a.b`). Preceded by a non-identifier char or at
 * line start.
 */
export function isDollarNameTrigger(textBefore: string): boolean {
  return /(?:^|[^A-Za-z0-9_$])\$[A-Za-z0-9_.]*$/.test(textBefore);
}

/**
 * Return true when the `$`-prefixed partial before the cursor is a relative
 * ref (begins `$.`) — the discriminator that switches
 * {@linkcode buildDollarNameCompletions} into relative mode.
 */
export function isRelativeDollarTrigger(textBefore: string): boolean {
  return /(?:^|[^A-Za-z0-9_$])\$\.[A-Za-z0-9_.]*$/.test(textBefore);
}
