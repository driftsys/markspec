/**
 * @module lsp/typl
 *
 * LSP-side typl helpers — pure functions that compute hover content
 * and completion items for typl `$Name` identifiers and typedef
 * references. Consume the corpus TypeRegistry from
 * core/typl/registry.ts.
 *
 * See ADR-019.
 */
import type { Shape } from "../core/typl/mod.ts";
import type { TypeRegistry } from "../core/typl/mod.ts";

/**
 * Return the `$Name` token at the given column on `line`, or
 * `undefined` when the column lies on whitespace, past the line end,
 * or outside a `$Name` token. The token starts with `$` and continues
 * through `[A-Za-z0-9_]` characters.
 */
export function dollarNameAtPosition(
  line: string,
  column: number,
): string | undefined {
  if (column < 0 || column >= line.length) return undefined;
  if (/\s/.test(line[column])) return undefined;

  // Handle case where cursor is on the `$` itself.
  if (line[column] === "$") {
    let e = column + 1;
    while (e < line.length && /[A-Za-z0-9_]/.test(line[e])) e++;
    if (e - column < 2) return undefined; // bare `$` with no name
    return line.slice(column, e);
  }

  // Cursor is on an identifier char — scan left for `$`.
  if (!/[A-Za-z0-9_]/.test(line[column])) return undefined;
  let start = column;
  while (start > 0 && /[A-Za-z0-9_]/.test(line[start - 1])) start--;
  if (start === 0 || line[start - 1] !== "$") return undefined;
  start--; // include the `$`
  // Scan right for token end.
  let end = column + 1;
  while (end < line.length && /[A-Za-z0-9_]/.test(line[end])) end++;
  const token = line.slice(start, end);
  if (token.length < 2) return undefined; // bare `$`
  return token;
}

/**
 * Format the hover content for a `$Name` from the corpus registry.
 * Returns a short Markdown block describing the kind, the shape (if
 * any), and the entries that declare this name.
 *
 * Returns `undefined` if the name isn't declared anywhere.
 */
export function formatTyplHoverContent(
  name: string,
  registry: TypeRegistry,
): string | undefined {
  const decls = registry.bindings.get(name);
  if (!decls || decls.length === 0) return undefined;
  const lines: string[] = [];
  lines.push(`### ${name}`);
  // Aggregate kinds — usually one, but cross-entry collisions can show
  // multiple. The validator surfaces TYPL-002/003 separately.
  const kinds = new Set(decls.map((d) => d.binding.kind));
  const kindLabel = kinds.size === 1
    ? [...kinds][0]
    : `${[...kinds].join(" / ")} (collision)`;
  lines.push("");
  lines.push(`**Kind:** ${kindLabel}`);
  // Show the first declaration's shape; if multiple shapes, note it.
  const shapes = new Set(
    decls.map((d) => JSON.stringify(d.binding.shape ?? null)),
  );
  if (shapes.size === 1) {
    const shapeStr = formatShape(decls[0].binding.shape);
    if (shapeStr) {
      lines.push(`**Shape:** \`${shapeStr}\``);
    }
  } else {
    lines.push(`**Shape:** _multiple, see TYPL-003_`);
  }
  // List declaration sites.
  if (decls.length === 1) {
    const d = decls[0];
    lines.push(`**Declared in:** ${d.entryDisplayId} (${d.entryFile})`);
  } else {
    lines.push(`**Declared in ${decls.length} entries:**`);
    for (const d of decls) {
      lines.push(`- ${d.entryDisplayId} (${d.entryFile})`);
    }
  }
  return lines.join("\n");
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

/**
 * Build completion items for `$Name` triggers. Returns one item per
 * unique name in the registry. `detail` shows the kind + shape;
 * `documentation` shows where it's declared.
 */
export function buildDollarNameCompletions(
  registry: TypeRegistry,
): readonly TyplCompletionItem[] {
  const items: TyplCompletionItem[] = [];
  for (const [name, decls] of registry.bindings) {
    if (decls.length === 0) continue;
    const first = decls[0];
    const shape = formatShape(first.binding.shape);
    const detail = shape
      ? `${first.binding.kind} ${shape}`
      : first.binding.kind;
    const docLine = decls.length === 1
      ? `Declared in ${first.entryDisplayId}`
      : `Declared in ${decls.length} entries`;
    items.push({ label: name, detail, documentation: docLine });
  }
  return items;
}

/**
 * Return true when the text before the cursor ends with a `$`-prefixed
 * partial identifier — the trigger for `$Name` completion.
 *
 * Matches `$` optionally followed by word characters (letters, digits,
 * underscore). Preceded by a non-identifier char or at line start.
 */
export function isDollarNameTrigger(textBefore: string): boolean {
  return /(?:^|[^A-Za-z0-9_$])\$[A-Za-z0-9_]*$/.test(textBefore);
}
