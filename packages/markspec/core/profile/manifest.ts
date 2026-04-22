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
  type DocTypeDef,
  type EnforcementMode,
  type EntryShape,
  LIST_VALUE_TYPES,
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
  "description",
  "license",
  "extends",
  "profile",
]);

const ALLOWED_PROFILE_KEYS = new Set([
  "required",
  "attributes",
  "labels",
  "identified",
  "referenced",
  "types",
  "documents",
]);

const ALLOWED_IDENTIFIED_KEYS = new Set([
  "required",
  "attributes",
  "traceability",
]);
const ALLOWED_REFERENCED_KEYS = new Set(["required", "attributes"]);

const ALLOWED_TYPE_KEYS = new Set([
  "shape",
  "display-id-pattern",
  "display-id-pattern-enforcement",
  "required",
  "attributes",
  "traceability",
]);

const ALLOWED_DOC_TYPE_KEYS = new Set(["id", "contains", "description"]);
const ALLOWED_DOCUMENTS_KEYS = new Set(["types", "frontMatter"]);

function parseShapeScope(
  raw: unknown,
  allowedKeys: Set<string>,
  context: string,
  sourcePath: string,
  diagnostics: Diagnostic[],
): Record<string, unknown> | undefined {
  if (raw === undefined) return {};
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${context}: must be a mapping`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!allowedKeys.has(key)) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `${context}: unknown key '${key}'`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
    }
  }
  return r;
}

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
    const m = /^git\+(https?:\/\/[^#]+?\.git)(\/[^#]+)?#(.+)$/.exec(raw);
    if (!m) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message:
          `'extends' git specifier malformed; expected git+https://host/.git[/subpath]#<tag>`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
    const [, repo, rawSubpath, tag] = m;
    const subpath = rawSubpath ? rawSubpath.slice(1) : undefined;
    return { kind: "git", repo, subpath, tag };
  }
  diagnostics.push({
    code: "PROFILE-LOAD-003",
    severity: "error",
    message:
      `'extends' specifier scheme not supported in v1 (use local './path' or git+https URL with #tag)`,
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
    const rawValues = r.values;
    if (
      !Array.isArray(rawValues) ||
      rawValues.some((v) => typeof v !== "string") ||
      rawValues.length === 0
    ) {
      diagnostics.push({
        code: "PROFILE-LOAD-003",
        severity: "error",
        message:
          `${context}: enum attribute '${name}' requires a non-empty 'values' list of strings`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
      return undefined;
    }
    values = rawValues as string[];
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
    if (typeof inv.name !== "string" || typeof inv.category !== "string") {
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

  return { name, type: vtype, required, cardinality, values, inverse };
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
    if (
      typeof r.shape === "string" &&
      (r.shape === "identified" || r.shape === "referenced")
    ) {
      return { shape: r.shape };
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
  return { target: targets, cardinality, required };
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
        code: "PROFILE-LOAD-003",
        severity: "error",
        message: `${ctx}: unknown key '${key}'`,
        location: { file: sourcePath, line: 1, column: 1 },
      });
    }
  }

  const shape = r.shape;
  if (shape !== "identified" && shape !== "referenced") {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message: `${ctx}: 'shape' must be 'identified' or 'referenced'`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }

  if (shape === "referenced" && r.traceability !== undefined) {
    diagnostics.push({
      code: "PROFILE-LOAD-003",
      severity: "error",
      message:
        `${ctx}: referenced types cannot declare traceability (referenced entries don't originate links)`,
      location: { file: sourcePath, line: 1, column: 1 },
    });
    return undefined;
  }

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
  const traceability = shape === "identified"
    ? parseTraceabilityMap(
      r.traceability,
      `${ctx}.traceability`,
      sourcePath,
      diagnostics,
    )
    : new Map<string, TraceRule>();

  return {
    name,
    shape: shape as EntryShape,
    displayIdPattern,
    displayIdPatternEnforcement: enforcement,
    required,
    attributes,
    traceability,
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

  const universalRequired = parseStringList(
    profileSection.required,
    "profile.required",
    sourcePath,
    diagnostics,
  );
  const universalAttributes = parseAttrList(
    profileSection.attributes,
    "profile.attributes",
    sourcePath,
    diagnostics,
  );
  const labels = parseStringList(
    profileSection.labels,
    "profile.labels",
    sourcePath,
    diagnostics,
  );

  if (diagnostics.length > 0) {
    return { manifest: null, diagnostics };
  }

  const idRaw = parseShapeScope(
    profileSection.identified,
    ALLOWED_IDENTIFIED_KEYS,
    "profile.identified",
    sourcePath,
    diagnostics,
  );
  const refRaw = parseShapeScope(
    profileSection.referenced,
    ALLOWED_REFERENCED_KEYS,
    "profile.referenced",
    sourcePath,
    diagnostics,
  );

  if (idRaw === undefined || refRaw === undefined || diagnostics.length > 0) {
    return { manifest: null, diagnostics };
  }

  const identifiedRequired = parseStringList(
    idRaw.required,
    "profile.identified.required",
    sourcePath,
    diagnostics,
  );
  const identifiedAttributes = parseAttrList(
    idRaw.attributes,
    "profile.identified.attributes",
    sourcePath,
    diagnostics,
  );
  const identifiedTraceability = parseTraceabilityMap(
    idRaw.traceability,
    "profile.identified.traceability",
    sourcePath,
    diagnostics,
  );

  const referencedRequired = parseStringList(
    refRaw.required,
    "profile.referenced.required",
    sourcePath,
    diagnostics,
  );
  const referencedAttributes = parseAttrList(
    refRaw.attributes,
    "profile.referenced.attributes",
    sourcePath,
    diagnostics,
  );

  if (diagnostics.length > 0) {
    return { manifest: null, diagnostics };
  }

  const types = parseTypesMap(profileSection.types, sourcePath, diagnostics);
  if (diagnostics.length > 0) {
    return { manifest: null, diagnostics };
  }

  const documents = parseDocumentsSection(
    profileSection.documents,
    sourcePath,
    diagnostics,
  );
  if (diagnostics.length > 0) {
    return { manifest: null, diagnostics };
  }

  const manifest: ProfileManifest = {
    id,
    version,
    description: typeof root.description === "string"
      ? root.description
      : undefined,
    license: typeof root.license === "string" ? root.license : undefined,
    extends: extendsSpec,
    universalRequired,
    universalAttributes,
    labels,
    identified: {
      required: identifiedRequired,
      attributes: identifiedAttributes,
      traceability: identifiedTraceability,
    },
    referenced: {
      required: referencedRequired,
      attributes: referencedAttributes,
    },
    types: types,
    documents: documents,
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
  if (typeof v !== "string" || v.length === 0) {
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
