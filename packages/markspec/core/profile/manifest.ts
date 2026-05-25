/**
 * @module core/profile/manifest
 *
 * Parse a markspec.yaml manifest string into a validated ProfileManifest.
 * Emits PROFILE-LOAD-002 for YAML parse errors and PROFILE-LOAD-003 for
 * schema violations.
 */

import { parse as parseYaml } from "@std/yaml";
import type { Diagnostic, ProfileManifest } from "../model/mod.ts";
import {
  type AttrDecl,
  type Cardinality,
  COLOR_NAME_RE,
  CORE_TYPES,
  type DocTypeDef,
  type EnforcementMode,
  type LabelConcern,
  type LabelConcernKind,
  type LabelValue,
  LIST_VALUE_TYPES,
  PALETTE_HUES,
  type ProfileConvention,
  type ProfileSpecifier,
  type TargetMatcher,
  type TraceRule,
  type TypeDef,
  VALUE_TYPES,
  type ValueType,
} from "../model/mod.ts";

const VALUE_TYPE_SET: ReadonlySet<string> = new Set(VALUE_TYPES);

const ALLOWED_ROOT_KEYS = new Set([
  "id",
  "version",
  "markspec-schema",
  "description",
  "license",
  "extends",
  "profile",
]);

const ALLOWED_PROFILE_KEYS = new Set([
  "attributes",
  "labels",
  "colors",
  "conventions",
  "types",
  "documents",
  "prose",
]);

const ALLOWED_TYPE_KEYS = new Set([
  "extends",
  "description",
  "display-id-pattern",
  "display-id-pattern-enforcement",
  "required",
  "attributes",
  "traceability",
  "color",
]);

const ALLOWED_DOC_TYPE_KEYS = new Set(["id", "contains", "description"]);
const ALLOWED_DOCUMENTS_KEYS = new Set(["types", "frontMatter"]);

const ALLOWED_ATTR_KEYS = new Set([
  "name",
  "type",
  "required",
  "cardinality",
  "values",
  "inverse",
  "description",
]);

const ALLOWED_INVERSE_KEYS = new Set(["name", "category"]);

const ALLOWED_TRACE_RULE_KEYS = new Set([
  "target",
  "cardinality",
  "required",
  "description",
]);

/** Result of parsing a profile manifest. */
export interface ParseManifestResult {
  readonly manifest: ProfileManifest | null;
  readonly diagnostics: readonly Diagnostic[];
}

function parseStringList(
  raw: unknown,
  key: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every((v) => typeof v === "string")) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `'${key}' must be a list of strings`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return [];
  }
  return raw as string[];
}

function parseSpecifier(
  raw: unknown,
  sourcePath: string,
  diagnostics: Diagnostic[],
): ProfileSpecifier | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.length === 0) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `'extends' must be a non-empty string specifier`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  if (raw.startsWith("./") || raw.startsWith("../")) {
    return { kind: "local", path: raw };
  }
  if (raw.startsWith("git+")) {
    const m = /^git\+((?:https?|file):\/\/[^#]+?\.git)(\/[^#]+)?#(.+)$/.exec(
      raw,
    );
    if (!m) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message:
          `'extends' git specifier malformed; expected git+<https|file>://host/.git[/subpath]#<tag>`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
    const [, repo, rawSubpath, tag] = m;
    const subpath = rawSubpath ? rawSubpath.slice(1) : undefined;
    return { kind: "git", repo, subpath, tag };
  }
  if (raw.startsWith("npm:")) {
    const body = raw.slice(4);
    const scopedMatch = /^(@[a-z0-9-]+\/[a-z0-9-]+)@(.+)$/.exec(body);
    if (scopedMatch) {
      const [, fullName, range] = scopedMatch;
      const slashIdx = fullName.indexOf("/");
      return {
        kind: "npm",
        scope: fullName.slice(0, slashIdx),
        name: fullName.slice(slashIdx + 1),
        range,
      };
    }
    const unscopedMatch = /^([a-z0-9-]+)@(.+)$/.exec(body);
    if (unscopedMatch) {
      const [, name, range] = unscopedMatch;
      return { kind: "npm", scope: undefined, name, range };
    }
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message:
        `'extends' npm specifier malformed; expected npm:[@scope/]name@<version-range>`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  diagnostics.push({
    code: "PROFILE-LOAD-003",
    severity: "error",
    message:
      `'extends' specifier scheme not supported (use './path', 'git+<https|file>://…#<tag>', or 'npm:[@scope/]name@<range>')`,
    location: { file: sourcePath, line: 1, column: 1 },
  });
  return undefined;
}

function defaultCardinality(type: ValueType): Cardinality {
  return LIST_VALUE_TYPES.has(type)
    ? { lower: 0, upper: Infinity }
    : { lower: 0, upper: 1 };
}

function parseCardinality(
  raw: unknown,
  fallback: Cardinality,
  context: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): Cardinality {
  if (raw === undefined) return fallback;
  if (typeof raw !== "string") {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: cardinality must be a string like '1..N'`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return fallback;
  }
  const m = /^(\d+)\.\.(\d+|N)$/.exec(raw);
  if (!m) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: invalid cardinality '${raw}'`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return fallback;
  }
  const lower = Number(m[1]);
  const upper = m[2] === "N" ? Infinity : Number(m[2]);
  if (upper < lower) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: cardinality upper (${
        m[2]
      }) less than lower (${lower})`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return fallback;
  }
  return { lower, upper };
}

/**
 * Flatten a (possibly grouped) value list to its leaf value names. Accepts
 * items that are bare strings, `{name, description?}` objects, or
 * `{group, description?, values: [...]}` group objects (recursed). Group
 * labels and descriptions are documentation-only and dropped — markspec
 * validates against the value names. Returns `null` when any item matches
 * none of these shapes.
 */
function flattenGroupedNames(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    if (item == null || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }
    const o = item as Record<string, unknown>;
    if (typeof o.name === "string") {
      out.push(o.name);
    } else if (Array.isArray(o.values)) {
      const nested = flattenGroupedNames(o.values);
      if (nested === null) return null;
      out.push(...nested);
    } else {
      return null;
    }
  }
  return out;
}

function parseAttrDecl(
  raw: unknown,
  context: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): AttrDecl | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: attribute entry must be a mapping`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!ALLOWED_ATTR_KEYS.has(key)) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `${context}: attribute entry has unknown key '${key}'`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
  }
  const name = r.name;
  const type = r.type;
  if (typeof name !== "string" || name.length === 0) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: attribute missing 'name'`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  if (typeof type !== "string" || !VALUE_TYPE_SET.has(type)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: attribute '${name}' has invalid type '${type}'`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  const vtype = type as ValueType;
  const required = r.required === true;
  const cardinality = parseCardinality(
    r.cardinality,
    defaultCardinality(vtype),
    `${context}/${name}`,
    sourcePath,
    diagnostics,
  );
  let values: readonly string[] | undefined;
  if (vtype === "enum") {
    const flat = flattenGroupedNames(r.values);
    if (flat === null || flat.length === 0) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message:
          `${context}: enum attribute '${name}' requires a non-empty 'values' list ` +
          `(strings, {name, description?}, or {group, values: [...]})`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
    values = flat;
  }
  let inverse: { name: string; category: string } | undefined;
  if (r.inverse !== undefined) {
    if (vtype !== "id" && vtype !== "id-list") {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message:
          `${context}/${name}: 'inverse' only valid on id or id-list attributes`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
    if (
      r.inverse == null || typeof r.inverse !== "object" ||
      Array.isArray(r.inverse)
    ) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `${context}/${name}: 'inverse' must be a mapping`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
    const inv = r.inverse as Record<string, unknown>;
    for (const key of Object.keys(inv)) {
      if (!ALLOWED_INVERSE_KEYS.has(key)) {
        diagnostics.push({
          code: "PROFILE-LOAD-003",
          severity: "error",
          message: `${context}/${name}: 'inverse' has unknown key '${key}'`,
          location: { file: sourcePath, line: 1, column: 1 },
        });
        return undefined;
      }
    }
    if (
      typeof inv.name !== "string" || inv.name.length === 0 ||
      typeof inv.category !== "string" || inv.category.length === 0
    ) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message:
          `${context}/${name}: 'inverse' requires string 'name' and 'category'`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
    inverse = { name: inv.name, category: inv.category };
  }

  const description = typeof r.description === "string"
    ? r.description
    : undefined;

  return {
    name,
    type: vtype,
    required,
    cardinality,
    values,
    inverse,
    description,
  };
}

function parseAttrList(
  raw: unknown,
  context: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): AttrDecl[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: 'attributes' must be a list`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return [];
  }
  const out: AttrDecl[] = [];
  for (const item of raw) {
    const attr = parseAttrDecl(item, context, sourcePath, diagnostics);
    if (attr) out.push(attr);
  }
  return out;
}

function parseTargetMatcher(
  raw: unknown,
  context: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): TargetMatcher | undefined {
  if (typeof raw === "string" && raw.length > 0) return raw;
  if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    if (typeof r.shape === "string") {
      // The profile-manifest `shape:` vocabulary is the authored
      // `identified`/`referenced` surface (profile-schema §1.3 marks it
      // obsolete — its removal is the profile-schema reconciliation
      // slice, not this one). Map it one-directionally onto the internal
      // EntryShape. NOT a backward-compat dual-accept: the new names are
      // deliberately not accepted in authored YAML.
      const shape = r.shape === "identified"
        ? "Authored"
        : r.shape === "referenced"
        ? "Reference"
        : undefined;
      if (shape !== undefined) {
        return { shape };
      }
    }
  }
  diagnostics.push({
    code: "PROFILE-LOAD-003",
    severity: "error",
    message:
      `${context}: target matcher must be a type-name string or {shape: identified|referenced}`,
    location: { file: sourcePath, line: 1, column: 1 },
  });
  return undefined;
}

function parseTraceRule(
  raw: unknown,
  context: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): TraceRule | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: trace rule must be a mapping`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!ALLOWED_TRACE_RULE_KEYS.has(key)) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `${context}: trace rule has unknown key '${key}'`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
  }
  if (!Array.isArray(r.target) || r.target.length === 0) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: trace rule requires non-empty 'target' list`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  const targets: TargetMatcher[] = [];
  for (const item of r.target) {
    const m = parseTargetMatcher(
      item,
      `${context}.target`,
      sourcePath,
      diagnostics,
    );
    if (m !== undefined) targets.push(m);
  }
  if (targets.length === 0) return undefined;
  const cardinality = r.cardinality !== undefined
    ? parseCardinality(
      r.cardinality,
      { lower: 0, upper: Infinity },
      `${context}.cardinality`,
      sourcePath,
      diagnostics,
    )
    : undefined;
  const required = r.required === true;
  const description = typeof r.description === "string"
    ? r.description
    : undefined;
  return { target: targets, cardinality, required, description };
}

function parseTraceabilityMap(
  raw: unknown,
  context: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): Map<string, TraceRule> {
  const out = new Map<string, TraceRule>();
  if (raw === undefined) return out;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: 'traceability' must be a mapping`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return out;
  }
  for (
    const [linkName, ruleRaw] of Object.entries(raw as Record<string, unknown>)
  ) {
    const rule = parseTraceRule(
      ruleRaw,
      `${context}.${linkName}`,
      sourcePath,
      diagnostics,
    );
    if (rule) out.set(linkName, rule);
  }
  return out;
}

/**
 * Parse the `profile.colors:` block. Each key must match COLOR_NAME_RE;
 * each value must be one of PALETTE_HUES. Unknown hues emit
 * MSL-PROFILE-COLOR-002 (error). Returns an empty map when the block is
 * absent.
 */
function parseColorsMap(
  raw: unknown,
  sourcePath: string,
  diagnostics: Diagnostic[],
): Map<string, string> {
  const out = new Map<string, string>();
  if (raw === undefined) return out;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: "profile.colors: must be a mapping",
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return out;
  }
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!COLOR_NAME_RE.test(name)) {
      diagnostics.push({
        code: "MSL-PROFILE-COLOR-004",
        severity: "error",
        message:
          `profile.colors: '${name}' is not a valid semantic name (lowercase letters, digits, hyphens; must start with a letter)`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      continue;
    }
    if (typeof value !== "string") {
      diagnostics.push({
        code: "MSL-PROFILE-COLOR-002",
        severity: "error",
        message:
          `profile.colors.${name}: value must be a string palette hue name`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      continue;
    }
    if (!(PALETTE_HUES as readonly string[]).includes(value)) {
      diagnostics.push({
        code: "MSL-PROFILE-COLOR-002",
        severity: "error",
        message:
          `profile.colors.${name}: '${value}' is not a palette hue (allowed: ${
            PALETTE_HUES.join(", ")
          })`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      continue;
    }
    out.set(name, value);
  }
  return out;
}

const KNOWN_CONVENTIONS = new Set(["modal-keywords"]);
const MODAL_KEYWORDS_CASING_VALUES = new Set(["rfc2119", "iso", "preserve"]);

function parseLabelConcerns(
  raw: unknown,
  sourcePath: string,
  diagnostics: Diagnostic[],
): LabelConcern[] {
  if (raw === undefined) return [];

  // Form A: sequence of label names → each becomes a flag concern. Entries
  // may be bare strings or grouped objects ({group, values: [{name}, ...]});
  // groups and descriptions are documentation-only and flattened away.
  if (Array.isArray(raw)) {
    const names = flattenGroupedNames(raw);
    if (names === null) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message:
          "profile.labels: list entries must be strings, {name, description?}, " +
          "or {group, values: [...]}",
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return [];
    }
    return names.map((name) => ({ name, kind: "flag" as const, values: [] }));
  }

  // Form B: mapping — each key is a concern name.
  if (raw === null || typeof raw !== "object") {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: "profile.labels: must be a list of strings or a mapping",
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return [];
  }

  const concerns: LabelConcern[] = [];
  for (
    const [name, value] of Object.entries(raw as Record<string, unknown>)
  ) {
    const concern = parseLabelConcernEntry(
      name,
      value,
      sourcePath,
      diagnostics,
    );
    if (concern) concerns.push(concern);
  }
  return concerns;
}

function parseLabelConcernEntry(
  name: string,
  raw: unknown,
  sourcePath: string,
  diagnostics: Diagnostic[],
): LabelConcern | undefined {
  const ctx = `profile.labels.${name}`;

  // Bare string → description shorthand, implies flag.
  if (typeof raw === "string") {
    return { name, kind: "flag", description: raw, values: [] };
  }

  // null/undefined → flag, no description.
  if (raw === null || raw === undefined) {
    return { name, kind: "flag", values: [] };
  }

  if (typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${ctx}: value must be null, a string, or a mapping`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }

  const r = raw as Record<string, unknown>;
  const description = typeof r.description === "string"
    ? r.description
    : undefined;

  let kind: LabelConcernKind = "flag";
  if (r.kind !== undefined) {
    if (r.kind !== "enum" && r.kind !== "set" && r.kind !== "flag") {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `${ctx}: 'kind' must be 'enum', 'set', or 'flag'`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
    kind = r.kind as LabelConcernKind;
  }

  if (r.values !== undefined && kind === "flag") {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${ctx}: 'values' is not valid for kind 'flag'`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }

  const values: LabelValue[] = [];
  if (r.values !== undefined) {
    if (typeof r.values !== "object" || Array.isArray(r.values)) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `${ctx}: 'values' must be a mapping of value names`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
    for (
      const [vName, vRaw] of Object.entries(
        r.values as Record<string, unknown>,
      )
    ) {
      if (vRaw === null || vRaw === undefined) {
        values.push({ name: vName });
      } else if (typeof vRaw === "string") {
        values.push({ name: vName, description: vRaw });
      } else if (typeof vRaw === "object" && !Array.isArray(vRaw)) {
        const vr = vRaw as Record<string, unknown>;
        const vDesc = typeof vr.description === "string"
          ? vr.description
          : undefined;
        values.push({ name: vName, description: vDesc });
      } else {
        diagnostics.push({
          code: "PROFILE-LOAD-003",
          severity: "error",
          message:
            `${ctx}.values.${vName}: must be null, a string, or {description: string}`,
          location: { file: sourcePath, line: 1, column: 1 },
        });
      }
    }
  }

  return { name, kind, description, values };
}

function parseConventions(
  raw: unknown,
  sourcePath: string,
  diagnostics: Diagnostic[],
): ProfileConvention[] {
  if (raw === undefined) return [];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: "profile.conventions: must be a mapping",
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return [];
  }
  const out: ProfileConvention[] = [];
  for (
    const [name, value] of Object.entries(raw as Record<string, unknown>)
  ) {
    if (!KNOWN_CONVENTIONS.has(name)) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "warning",
        message:
          `profile.conventions: unknown convention '${name}' (accepted for forward compatibility)`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `profile.conventions.${name}: must be a mapping`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      continue;
    }
    const r = value as Record<string, unknown>;
    const description = typeof r.description === "string"
      ? r.description
      : undefined;
    const settings: Record<string, string> = {};
    let valid = true;
    for (const [k, v] of Object.entries(r)) {
      if (k === "description") continue;
      if (typeof v !== "string") {
        diagnostics.push({
          code: "PROFILE-LOAD-003",
          severity: "error",
          message:
            `profile.conventions.${name}.${k}: setting value must be a string`,
          location: { file: sourcePath, line: 1, column: 1 },
        });
        valid = false;
        continue;
      }
      if (name === "modal-keywords" && k === "casing") {
        if (!MODAL_KEYWORDS_CASING_VALUES.has(v)) {
          diagnostics.push({
            code: "PROFILE-LOAD-003",
            severity: "error",
            message:
              `profile.conventions.modal-keywords.casing: '${v}' not valid (expected: rfc2119, iso, preserve)`,
            location: { file: sourcePath, line: 1, column: 1 },
          });
          valid = false;
          continue;
        }
      }
      settings[k] = v;
    }
    if (valid) out.push({ name, settings, description });
  }
  return out;
}

/**
 * Parse the `profile.prose:` section. Returns a normalized object with
 * the two lexicon lists; absent lists default to `[]`.
 */
function parseProse(
  raw: unknown,
  sourcePath: string,
  diagnostics: Diagnostic[],
): ProfileManifest["prose"] {
  const empty: ProfileManifest["prose"] = {
    lexicons: { "capitalized-allow": [], "sentence-abbrev": [] },
  };
  if (raw === undefined || raw === null) return empty;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: "'profile.prose' must be a mapping",
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return empty;
  }
  const r = raw as Record<string, unknown>;
  const lexRaw = r.lexicons;
  if (lexRaw === undefined || lexRaw === null) {
    return empty;
  }
  if (typeof lexRaw !== "object" || Array.isArray(lexRaw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: "'profile.prose.lexicons' must be a mapping",
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return empty;
  }
  const lex = lexRaw as Record<string, unknown>;
  const capAllow = parseStringList(
    lex["capitalized-allow"],
    "profile.prose.lexicons.capitalized-allow",
    sourcePath,
    diagnostics,
  );
  const sentAbbrev = parseStringList(
    lex["sentence-abbrev"],
    "profile.prose.lexicons.sentence-abbrev",
    sourcePath,
    diagnostics,
  );
  return {
    lexicons: { "capitalized-allow": capAllow, "sentence-abbrev": sentAbbrev },
  };
}

function parseTypeDef(
  name: string,
  raw: unknown,
  sourcePath: string,
  diagnostics: Diagnostic[],
): TypeDef | undefined {
  const ctx = `profile.types.${name}`;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${ctx}: must be a mapping`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!ALLOWED_TYPE_KEYS.has(key)) {
      diagnostics.push({
        code: "PROFILE-TYPE-005",
        severity: "error",
        message: `${ctx}: unknown key '${key}'`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
    }
  }

  const rawExtends = r.extends;
  if (rawExtends === undefined) {
    diagnostics.push({
      code: "PROFILE-TYPE-001",
      severity: "error",
      message:
        `${ctx}: missing required field 'extends' (must be a core type name)`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  if (typeof rawExtends !== "string" || !CORE_TYPES.has(rawExtends)) {
    diagnostics.push({
      code: "PROFILE-TYPE-002",
      severity: "error",
      message:
        `${ctx}: 'extends' value '${rawExtends}' is not a recognised core type`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  const extendsValue = rawExtends;

  let displayIdPattern: string | undefined;
  if (r["display-id-pattern"] !== undefined) {
    if (typeof r["display-id-pattern"] !== "string") {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `${ctx}: 'display-id-pattern' must be a string`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
    displayIdPattern = r["display-id-pattern"];
  }

  let enforcement: EnforcementMode = "off";
  const rawEnf = r["display-id-pattern-enforcement"];
  if (rawEnf !== undefined) {
    if (rawEnf !== "off" && rawEnf !== "warn" && rawEnf !== "error") {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message:
          `${ctx}: 'display-id-pattern-enforcement' must be off|warn|error`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
    enforcement = rawEnf;
  }

  let color: string | undefined;
  if (r.color !== undefined) {
    if (typeof r.color !== "string") {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `${ctx}: 'color' must be a string`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
    color = r.color;
  }

  const description = typeof r.description === "string"
    ? r.description
    : undefined;

  const required = parseStringList(
    r.required,
    `${ctx}.required`,
    sourcePath,
    diagnostics,
  );
  const attributes = parseAttrList(
    r.attributes,
    `${ctx}.attributes`,
    sourcePath,
    diagnostics,
  );
  const traceability = parseTraceabilityMap(
    r.traceability,
    `${ctx}.traceability`,
    sourcePath,
    diagnostics,
  );

  return {
    name,
    extends: extendsValue,
    displayIdPattern,
    displayIdPatternEnforcement: enforcement,
    required,
    attributes,
    traceability,
    color,
    description,
  };
}

function parseTypesMap(
  raw: unknown,
  sourcePath: string,
  diagnostics: Diagnostic[],
): Map<string, TypeDef> {
  const out = new Map<string, TypeDef>();
  if (raw === undefined) return out;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `profile.types: must be a mapping`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return out;
  }
  for (
    const [name, rawType] of Object.entries(raw as Record<string, unknown>)
  ) {
    const td = parseTypeDef(name, rawType, sourcePath, diagnostics);
    if (td) out.set(name, td);
  }
  return out;
}

function parseDocTypeDef(
  raw: unknown,
  sourcePath: string,
  diagnostics: Diagnostic[],
): DocTypeDef | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `profile.documents.types: each entry must be a mapping`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!ALLOWED_DOC_TYPE_KEYS.has(key)) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `profile.documents.types: unknown key '${key}'`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
    }
  }
  if (typeof r.id !== "string" || r.id.length === 0) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `profile.documents.types: entry missing 'id'`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  const contains = parseStringList(
    r.contains,
    `profile.documents.types.${r.id}.contains`,
    sourcePath,
    diagnostics,
  );
  const description = typeof r.description === "string"
    ? r.description
    : undefined;
  return { id: r.id, contains, description };
}

function parseDocumentsSection(
  raw: unknown,
  sourcePath: string,
  diagnostics: Diagnostic[],
): { types: DocTypeDef[]; frontMatter: AttrDecl[] } {
  if (raw === undefined) return { types: [], frontMatter: [] };
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `profile.documents: must be a mapping`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return { types: [], frontMatter: [] };
  }
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!ALLOWED_DOCUMENTS_KEYS.has(key)) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `profile.documents: unknown key '${key}'`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
    }
  }
  const types: DocTypeDef[] = [];
  if (r.types !== undefined) {
    if (!Array.isArray(r.types)) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `profile.documents.types: must be a list`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
    } else {
      for (const item of r.types) {
        const dt = parseDocTypeDef(item, sourcePath, diagnostics);
        if (dt) types.push(dt);
      }
    }
  }
  const frontMatter = parseAttrList(
    r.frontMatter,
    "profile.documents.frontMatter",
    sourcePath,
    diagnostics,
  );
  return { types, frontMatter };
}

/**
 * Parse and validate a raw markspec.yaml string.
 *
 * @param rawYaml - File contents as a UTF-8 string
 * @param sourcePath - Optional file path for diagnostic location
 */
export function parseManifest(
  rawYaml: string,
  sourcePath = "<markspec.yaml>",
): ParseManifestResult {
  const diagnostics: Diagnostic[] = [];

  let parsed: unknown;
  try {
    parsed = parseYaml(rawYaml);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    diagnostics.push({
      code: "PROFILE-LOAD-002",
      severity: "error",
      message: `YAML parse error: ${message}`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return { manifest: null, diagnostics };
  }

  if (parsed == null || typeof parsed !== "object") {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: "manifest must be a YAML mapping",
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return { manifest: null, diagnostics };
  }

  const root = parsed as Record<string, unknown>;

  for (const key of Object.keys(root)) {
    if (!ALLOWED_ROOT_KEYS.has(key)) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `unknown top-level manifest key '${key}'`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
    }
  }
  // if any unknown key, bail out now before further parsing
  if (diagnostics.length > 0) {
    return { manifest: null, diagnostics };
  }

  const id = requireString(root, "id", sourcePath, diagnostics);
  const version = requireString(root, "version", sourcePath, diagnostics);

  if (id === undefined || version === undefined) {
    return { manifest: null, diagnostics };
  }

  // Parse markspec-schema: early so PROFILE-SCHEMA-001 errors out before
  // deeper parsing. PROFILE-SCHEMA-002 (absent) is emitted later, on the
  // completed manifest, so it doesn't clutter error-case output.
  const rawSchema = root["markspec-schema"];
  const markspecSchema = typeof rawSchema === "string" ? rawSchema : undefined;
  if (rawSchema !== undefined && markspecSchema !== "1") {
    diagnostics.push({
      code: "PROFILE-SCHEMA-001",
      severity: "error",
      message:
        `profile targets core schema "${rawSchema}"; this MarkSpec implements "1"`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return { manifest: null, diagnostics };
  }

  const extendsSpec = parseSpecifier(root.extends, sourcePath, diagnostics);
  if (root.extends !== undefined && extendsSpec === undefined) {
    return { manifest: null, diagnostics };
  }

  const rawProfile = root.profile;
  if (rawProfile !== undefined) {
    if (
      rawProfile == null || typeof rawProfile !== "object" ||
      Array.isArray(rawProfile)
    ) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: "'profile' must be a mapping",
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return { manifest: null, diagnostics };
    }
    for (const key of Object.keys(rawProfile as Record<string, unknown>)) {
      if (!ALLOWED_PROFILE_KEYS.has(key)) {
        diagnostics.push({
          code: "PROFILE-LOAD-003",
          severity: "error",
          message: `unknown key under 'profile': '${key}'`,
          location: { file: sourcePath, line: 1, column: 1 },
        });
      }
    }
    if (diagnostics.length > 0) {
      return { manifest: null, diagnostics };
    }
  }

  const profileSection = (rawProfile ?? {}) as Record<string, unknown>;

  const universalAttributes = parseAttrList(
    profileSection.attributes,
    "profile.attributes",
    sourcePath,
    diagnostics,
  );
  const labels = parseLabelConcerns(
    profileSection.labels,
    sourcePath,
    diagnostics,
  );
  const colors = parseColorsMap(
    profileSection.colors,
    sourcePath,
    diagnostics,
  );
  const conventions = parseConventions(
    profileSection.conventions,
    sourcePath,
    diagnostics,
  );

  if (diagnostics.some((d) => d.severity === "error")) {
    return { manifest: null, diagnostics };
  }

  const types = parseTypesMap(profileSection.types, sourcePath, diagnostics);
  if (diagnostics.some((d) => d.severity === "error")) {
    return { manifest: null, diagnostics };
  }

  const documents = parseDocumentsSection(
    profileSection.documents,
    sourcePath,
    diagnostics,
  );
  if (diagnostics.some((d) => d.severity === "error")) {
    return { manifest: null, diagnostics };
  }

  const prose = parseProse(profileSection.prose, sourcePath, diagnostics);
  if (diagnostics.some((d) => d.severity === "error")) {
    return { manifest: null, diagnostics };
  }

  // PROFILE-SCHEMA-002: emitted on the otherwise-complete manifest so it
  // doesn't add noise to error-case output.
  if (rawSchema === undefined) {
    diagnostics.push({
      code: "PROFILE-SCHEMA-002",
      severity: "warning",
      message:
        'profile is missing markspec-schema pin; add `markspec-schema: "1"` to declare the core schema version this profile targets',
      location: { file: sourcePath, line: 1, column: 1 },
    });
  }

  const manifest: ProfileManifest = {
    id,
    version,
    markspecSchema,
    description: typeof root.description === "string"
      ? root.description
      : undefined,
    license: typeof root.license === "string" ? root.license : undefined,
    extends: extendsSpec,
    universalAttributes,
    labels,
    conventions,
    colors,
    types: types,
    documents: documents,
    prose,
  };

  return { manifest, diagnostics };
}

function requireString(
  root: Record<string, unknown>,
  key: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): string | undefined {
  const v = root[key];
  if (typeof v !== "string" || v.trim().length === 0) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `manifest missing required field '${key}' (string)`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  return v;
}
