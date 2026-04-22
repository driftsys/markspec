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
import { ULID_RE, URI_SCHEME_RE } from "../model/mod.ts";

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
  return `value '${value}' is not in declared enum [${values.join(", ")}]`;
};

// ---------------------------------------------------------------------------
// Individual validators (Task 6.4 ID/URI types)
// ---------------------------------------------------------------------------

const validateId: ValueValidator = (value, _decl) => {
  if (ULID_RE.test(value)) return null;
  if (URI_SCHEME_RE.test(value)) return null;
  return `not a valid id: '${value}' (expected 26-char ULID or scheme-qualified URI)`;
};

const HTTP_URL_RE = /^https?:\/\//;
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
// Registry — Task 6.3 installs 5 validators; subsequent tasks extend.
// ---------------------------------------------------------------------------

/** Placeholder for Tasks 6.4 and 6.5 to override. */
const notYetImplemented: ValueValidator = (_value, decl) => {
  return `value-type '${decl.type}' not yet implemented (coming in Task 6.4 or 6.5)`;
};

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
  path: notYetImplemented,
  "path-or-id": notYetImplemented,
  "tag-list": notYetImplemented,
  citation: notYetImplemented,
};
