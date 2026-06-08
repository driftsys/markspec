/**
 * @module core/validator/value_types
 *
 * Per-type value validators for profile-declared attributes. Each validator
 * takes a string value and the attribute's declaration, returns `null` when
 * valid or a short error message explaining why it's invalid.
 *
 * The top-level {@linkcode validateValue} dispatches on the declared type.
 */

import type { AttrDecl, ValueType } from "../model/mod.ts";
import { DISPLAY_ID_RE, ULID_RE, URI_SCHEME_RE } from "../model/mod.ts";

/**
 * Validate one string value against an attribute's declared value type.
 * Returns `null` when the value is valid, or a short human-readable detail
 * string (without the attribute name or display ID — the caller composes the
 * full diagnostic message).
 */
export function validateValue(value: string, decl: AttrDecl): string | null {
  const fn = VALIDATORS[decl.type];
  return fn(value, decl);
}

/** Signature for a single value-type validator. */
export type ValueValidator = (value: string, decl: AttrDecl) => string | null;

// ---------------------------------------------------------------------------
// Individual validators (Task 6.3 simple types)
// ---------------------------------------------------------------------------

const validateText: ValueValidator = (_value, _decl) => {
  return null;
};

const INTEGER_RE = /^-?\d+$/;
const validateInteger: ValueValidator = (value, _decl) => {
  return INTEGER_RE.test(value)
    ? null
    : `not a valid integer: '${value}' (expected digits optionally prefixed with '-')`;
};

const validateBoolean: ValueValidator = (value, _decl) => {
  return value === "true" || value === "false"
    ? null
    : `not a valid boolean: '${value}' (expected 'true' or 'false')`;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validateDate: ValueValidator = (value, _decl) => {
  return DATE_RE.test(value)
    ? null
    : `not a valid ISO 8601 date: '${value}' (expected YYYY-MM-DD)`;
};

const validateEnum: ValueValidator = (value, decl) => {
  const values = decl.values ?? [];
  if (values.includes(value)) return null;
  const base = `value '${value}' is not in declared enum [${
    values.join(", ")
  }]`;
  // Case-only mismatch: the author most likely title/upper-cased a valid
  // member (e.g. `Approved` → `approved`). Suggest the declared spelling
  // (#215). A genuine unknown value falls through with no hint.
  const match = values.find((v) => v.toLowerCase() === value.toLowerCase());
  return match !== undefined ? `${base}; did you mean '${match}'?` : base;
};

// ---------------------------------------------------------------------------
// Individual validators (Task 6.4 ID/URI types)
// ---------------------------------------------------------------------------

const validateId: ValueValidator = (value, _decl) => {
  if (ULID_RE.test(value)) return null;
  if (URI_SCHEME_RE.test(value)) return null;
  if (DISPLAY_ID_RE.test(value)) return null;
  return `not a valid id: '${value}' (expected a display ID, 26-char ULID, or scheme-qualified URI)`;
};

/**
 * HTTP(S) URL prefix used by the `url` value type (spec §1.8). The
 * spec specifies HTTPS but `http://` is accepted for compatibility
 * with existing fixtures; tightening to HTTPS-only is a future
 * config-driven slice. Exported so other validator passes (e.g.,
 * file-local `Reference-url` checks) can share one regex.
 */
export const HTTP_URL_RE = /^https?:\/\//;
const validateUrl: ValueValidator = (value, _decl) => {
  return HTTP_URL_RE.test(value) ? null : `not a valid http(s) URL: '${value}'`;
};

const validateUri: ValueValidator = (value, _decl) => {
  return URI_SCHEME_RE.test(value)
    ? null
    : `not a valid URI: '${value}' (expected scheme-qualified per RFC 3986)`;
};

const validateExternalId: ValueValidator = (value, _decl) => {
  return value.trim().length > 0
    ? null
    : `external-id cannot be empty or whitespace-only`;
};

// ---------------------------------------------------------------------------
// Individual validators (Task 6.5 path / list / citation types)
// ---------------------------------------------------------------------------

// `/absolute` (POSIX) or `C:` / `C:\` / `C:/` (Windows) → absolute.
const ABSOLUTE_RE = /^(\/|[A-Za-z]:[\\/]?)/;
const validatePath: ValueValidator = (value, _decl) => {
  if (value.length === 0) return `path cannot be empty`;
  if (ABSOLUTE_RE.test(value)) {
    return `absolute paths are not allowed: '${value}' (use a relative path)`;
  }
  return null;
};

const validatePathOrId: ValueValidator = (value, decl) => {
  if (ULID_RE.test(value)) return null;
  if (URI_SCHEME_RE.test(value)) return null;
  return validatePath(value, decl);
};

const TAG_RE = /^[A-Za-z0-9_\-.]+$/;
const validateTagList: ValueValidator = (value, _decl) => {
  if (value.length === 0) return `tag cannot be empty`;
  return TAG_RE.test(value)
    ? null
    : `invalid tag '${value}' (expected bareword of letters, digits, '_', '-', '.')`;
};

const validateCitation: ValueValidator = (value, _decl) => {
  return value.trim().length > 0
    ? null
    : `citation cannot be empty or whitespace-only`;
};

// ---------------------------------------------------------------------------
// Registry — all 14 value types are now implemented.
// ---------------------------------------------------------------------------

/** Registry of per-type validators. */
const VALIDATORS: Record<ValueType, ValueValidator> = {
  text: validateText,
  integer: validateInteger,
  boolean: validateBoolean,
  date: validateDate,
  enum: validateEnum,
  id: validateId,
  "id-list": validateId,
  uri: validateUri,
  url: validateUrl,
  "external-id": validateExternalId,
  path: validatePath,
  "path-or-id": validatePathOrId,
  "tag-list": validateTagList,
  citation: validateCitation,
};
