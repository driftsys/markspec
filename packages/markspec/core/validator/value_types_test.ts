/**
 * @module core/validator/value_types_test
 *
 * Unit tests for per-type value validators.
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import { validateValue } from "./value_types.ts";
import type { AttrDecl } from "../model/mod.ts";

function decl(type: AttrDecl["type"], opts: Partial<AttrDecl> = {}): AttrDecl {
  return {
    name: opts.name ?? "X",
    type,
    required: opts.required ?? false,
    cardinality: opts.cardinality ?? { lower: 0, upper: 1 },
    values: opts.values,
    inverse: opts.inverse,
  };
}

// text
Deno.test("validateValue: text accepts any string", () => {
  const d = decl("text");
  assertEquals(validateValue("hello", d), null);
  assertEquals(validateValue("", d), null);
  assertEquals(validateValue("multiline\nstring", d), null);
});

// integer
Deno.test("validateValue: integer accepts digits (positive + negative)", () => {
  const d = decl("integer");
  assertEquals(validateValue("0", d), null);
  assertEquals(validateValue("42", d), null);
  assertEquals(validateValue("-42", d), null);
  assertEquals(validateValue("1000000", d), null);
});

Deno.test("validateValue: integer rejects non-integer formats", () => {
  const d = decl("integer");
  for (const v of ["42.5", "abc", "", "1e10"]) {
    if (validateValue(v, d) === null) {
      throw new Error(`expected '${v}' to be invalid integer`);
    }
  }
});

// boolean
Deno.test("validateValue: boolean accepts true/false", () => {
  const d = decl("boolean");
  assertEquals(validateValue("true", d), null);
  assertEquals(validateValue("false", d), null);
});

Deno.test("validateValue: boolean rejects other strings", () => {
  const d = decl("boolean");
  for (const v of ["True", "yes", "1"]) {
    if (validateValue(v, d) === null) {
      throw new Error(`expected '${v}' to be invalid boolean`);
    }
  }
});

// date
Deno.test("validateValue: date accepts ISO 8601 YYYY-MM-DD", () => {
  const d = decl("date");
  assertEquals(validateValue("2024-01-15", d), null);
  assertEquals(validateValue("2026-04-22", d), null);
  assertEquals(validateValue("1999-12-31", d), null);
});

Deno.test("validateValue: date rejects other formats", () => {
  const d = decl("date");
  const bad = [
    "2024/01/15",
    "01-15-2024",
    "2024-1-15",
    "2024-01-15T00:00:00",
    "not a date",
    "",
  ];
  for (const v of bad) {
    if (validateValue(v, d) === null) {
      throw new Error(`expected '${v}' to be invalid date`);
    }
  }
});

// enum
Deno.test("validateValue: enum accepts declared values", () => {
  const d = decl("enum", { values: ["draft", "approved", "deprecated"] });
  assertEquals(validateValue("draft", d), null);
  assertEquals(validateValue("approved", d), null);
  assertEquals(validateValue("deprecated", d), null);
});

Deno.test("validateValue: enum rejects undeclared values", () => {
  const d = decl("enum", { values: ["draft", "approved"] });
  const r1 = validateValue("pending", d);
  if (r1 === null) throw new Error("expected 'pending' to be invalid enum");
  if (!r1.includes("pending")) {
    throw new Error(`expected value in error message: ${r1}`);
  }
});

Deno.test("validateValue: enum is case-sensitive", () => {
  const d = decl("enum", { values: ["Draft"] });
  assertEquals(validateValue("Draft", d), null);
  const r = validateValue("draft", d);
  if (r === null) throw new Error("expected lowercase 'draft' to be invalid");
});

Deno.test("validateValue: enum case-only mismatch suggests the declared spelling (#215)", () => {
  const d = decl("enum", { values: ["draft", "approved", "deprecated"] });
  const r = validateValue("Approved", d);
  if (r === null) throw new Error("expected 'Approved' to be invalid enum");
  assertStringIncludes(r, "did you mean 'approved'?");
});

Deno.test("validateValue: enum suggests the declared mixed-case spelling", () => {
  const d = decl("enum", { values: ["InProgress"] });
  const r = validateValue("inprogress", d);
  if (r === null) throw new Error("expected 'inprogress' to be invalid enum");
  assertStringIncludes(r, "did you mean 'InProgress'?");
});

Deno.test("validateValue: enum genuine unknown value gets no suggestion", () => {
  const d = decl("enum", { values: ["draft", "approved"] });
  const r = validateValue("pending", d);
  if (r === null) throw new Error("expected 'pending' to be invalid enum");
  assertEquals(r.includes("did you mean"), false);
});

// id
Deno.test("validateValue: id accepts ULID", () => {
  const d = decl("id");
  assertEquals(validateValue("01HGW2Q8MNP3RSTVWXYZABCDEF", d), null);
});

Deno.test("validateValue: id accepts URI with scheme", () => {
  const d = decl("id");
  assertEquals(validateValue("doi:10.1234/xyz", d), null);
  assertEquals(validateValue("urn:iso:std:iso:26262", d), null);
  assertEquals(validateValue("https://example.com/thing", d), null);
  assertEquals(validateValue("pkg:cargo/serde@1.0.0", d), null);
});

Deno.test("validateValue: id accepts a display-ID-shaped token", () => {
  const d = decl("id");
  assertEquals(validateValue("REQ-0001", d), null);
  assertEquals(validateValue("XREQ_TEST_0001", d), null);
  assertEquals(validateValue("SYS_BRK_0042", d), null);
  assertEquals(validateValue("a/b.c", d), null);
});

Deno.test("validateValue: id rejects empty, digit-leading, and punctuation-leading tokens", () => {
  const d = decl("id");
  // "" empty; "01HGW2Q8MN" digit-leading and not a 26-char ULID;
  // "-x"/"9x" do not start with a letter; "@x" has no URI scheme colon.
  const bad = ["", "01HGW2Q8MN", "-leading", "9digit", "@x"];
  for (const v of bad) {
    if (validateValue(v, d) === null) {
      throw new Error(`expected '${v}' to be invalid id`);
    }
  }
});

// id-list
Deno.test("validateValue: id-list applies per-element id validation", () => {
  const d = decl("id-list", { cardinality: { lower: 0, upper: Infinity } });
  assertEquals(validateValue("01HGW2Q8MNP3RSTVWXYZABCDEF", d), null);
  assertEquals(validateValue("doi:10.1/xyz", d), null);
  assertEquals(validateValue("REQ-0001", d), null); // display ID now valid
  const bad = validateValue("@nope", d);
  if (bad === null) throw new Error("expected '@nope' to be invalid");
});

// uri
Deno.test("validateValue: uri accepts any scheme-qualified URI", () => {
  const d = decl("uri");
  const good = [
    "https://example.com",
    "http://example.com",
    "urn:example",
    "doi:10.1234/abc",
    "file:///path/to/thing",
    "git+https://github.com/acme/repo.git",
  ];
  for (const v of good) {
    if (validateValue(v, d) !== null) {
      throw new Error(`expected '${v}' to be valid uri`);
    }
  }
});

Deno.test("validateValue: uri rejects missing scheme", () => {
  const d = decl("uri");
  for (const v of ["no-scheme", "/absolute/path", ""]) {
    if (validateValue(v, d) === null) {
      throw new Error(`expected '${v}' to be invalid uri`);
    }
  }
});

// url
Deno.test("validateValue: url accepts http(s) only", () => {
  const d = decl("url");
  assertEquals(validateValue("http://example.com", d), null);
  assertEquals(validateValue("https://example.com/path?q=1", d), null);
});

Deno.test("validateValue: url rejects non-http schemes", () => {
  const d = decl("url");
  for (
    const v of [
      "urn:example",
      "file:///path",
      "doi:10.1/abc",
      "ftp://example.com",
      "no-scheme",
      "",
    ]
  ) {
    if (validateValue(v, d) === null) {
      throw new Error(`expected '${v}' to be invalid url`);
    }
  }
});

// external-id
Deno.test("validateValue: external-id accepts non-empty opaque strings", () => {
  const d = decl("external-id");
  assertEquals(validateValue("JIRA-1234", d), null);
  assertEquals(validateValue("anything-goes", d), null);
  assertEquals(validateValue("contains spaces", d), null);
});

Deno.test("validateValue: external-id rejects empty / whitespace-only", () => {
  const d = decl("external-id");
  if (validateValue("", d) === null) {
    throw new Error("expected empty string to be invalid external-id");
  }
  if (validateValue("   ", d) === null) {
    throw new Error("expected whitespace-only to be invalid external-id");
  }
});

// path
Deno.test("validateValue: path accepts relative paths", () => {
  const d = decl("path");
  for (
    const v of [
      "docs/spec.md",
      "./docs/spec.md",
      "../sibling/file.txt",
      "deep/nested/path/file.ts",
      "a",
    ]
  ) {
    if (validateValue(v, d) !== null) {
      throw new Error(`expected '${v}' to be valid path`);
    }
  }
});

Deno.test("validateValue: path rejects POSIX absolute", () => {
  const d = decl("path");
  for (const v of ["/absolute", "/usr/local/bin"]) {
    if (validateValue(v, d) === null) {
      throw new Error(`expected '${v}' to be invalid`);
    }
  }
});

Deno.test("validateValue: path rejects Windows absolute (drive letter)", () => {
  const d = decl("path");
  for (const v of ["C:\\Users\\foo", "C:/Users/foo"]) {
    if (validateValue(v, d) === null) {
      throw new Error(`expected '${v}' to be invalid`);
    }
  }
});

Deno.test("validateValue: path rejects empty", () => {
  const d = decl("path");
  if (validateValue("", d) === null) {
    throw new Error("expected empty to be invalid");
  }
});

// path-or-id
Deno.test("validateValue: path-or-id accepts ULID", () => {
  const d = decl("path-or-id");
  assertEquals(validateValue("01HGW2Q8MNP3RSTVWXYZABCDEF", d), null);
});

Deno.test("validateValue: path-or-id accepts URI", () => {
  const d = decl("path-or-id");
  assertEquals(validateValue("doi:10.1/abc", d), null);
  assertEquals(validateValue("urn:example", d), null);
});

Deno.test("validateValue: path-or-id accepts relative paths", () => {
  const d = decl("path-or-id");
  assertEquals(validateValue("docs/spec.md", d), null);
  assertEquals(validateValue("../sibling", d), null);
});

Deno.test("validateValue: path-or-id rejects absolute path", () => {
  const d = decl("path-or-id");
  if (validateValue("/absolute", d) === null) {
    throw new Error("expected '/absolute' to be invalid path-or-id");
  }
});

Deno.test("validateValue: path-or-id rejects empty", () => {
  const d = decl("path-or-id");
  if (validateValue("", d) === null) {
    throw new Error("expected empty to be invalid path-or-id");
  }
});

// tag-list (per element)
Deno.test("validateValue: tag-list accepts bareword tokens (per element)", () => {
  const d = decl("tag-list", { cardinality: { lower: 0, upper: Infinity } });
  for (const v of ["ASIL-B", "DRAFT", "v1.2.0", "under_score", "a", "A-B-C"]) {
    if (validateValue(v, d) !== null) {
      throw new Error(`expected '${v}' to be valid tag`);
    }
  }
});

Deno.test("validateValue: tag-list rejects whitespace / empty / special chars", () => {
  const d = decl("tag-list", { cardinality: { lower: 0, upper: Infinity } });
  for (
    const v of [
      "",
      "with space",
      "symbol!",
      "comma,sep",
      'quote"ed',
      "tab\there",
    ]
  ) {
    if (validateValue(v, d) === null) {
      throw new Error(`expected '${v}' to be invalid tag`);
    }
  }
});

// citation
Deno.test("validateValue: citation accepts non-empty trimmed string", () => {
  const d = decl("citation");
  assertEquals(validateValue("Smith 2021", d), null);
  assertEquals(validateValue("ISO-26262-6 §5.3", d), null);
  assertEquals(validateValue("Multiple\nlines\nallowed", d), null);
});

Deno.test("validateValue: citation rejects empty / whitespace-only", () => {
  const d = decl("citation");
  if (validateValue("", d) === null) {
    throw new Error("expected empty to be invalid citation");
  }
  if (validateValue("   \n\t   ", d) === null) {
    throw new Error("expected whitespace-only to be invalid citation");
  }
});
