/**
 * @module core/validator/modal_keywords_test
 *
 * Unit tests for the MSL-M060 / MSL-M061 validator.
 *
 * T14 (ADR-016): tests build entry bodies using explicit `bodyTokens`
 * arrays so the validator is tested in isolation from the scanner.
 * Two integration pins (parseFile-based) remain to validate the full
 * parse → bodyTokens → validate pipeline end-to-end.
 */

import { assertEquals } from "@std/assert";
import type {
  BodyToken,
  EffectiveProfile,
  EffectiveTypeDef,
  Entry,
  ProvenancedMapEntry,
} from "../model/mod.ts";
import { makeDisplayId } from "../model/mod.ts";
import { buildBodyAst } from "../ast/build.ts";
import { validateModalKeywords } from "./modal_keywords.ts";

function makeEntry(
  displayId: string,
  body: string,
  type?: string,
  bodyTokens?: readonly BodyToken[],
): Entry {
  const bodyAst = buildBodyAst(body);
  return {
    displayId: makeDisplayId(displayId),
    title: "Test entry",
    body,
    bodyAst,
    rawAttributes: [],
    id: undefined,
    shape: "Authored",
    location: { file: "test.md", line: 10, column: 1 },
    source: { kind: "markdown" },
    typedAttributes: new Map(type ? [["Type", [type]]] : []),
    type,
    bodyTokens: bodyTokens ?? [],
  };
}

// ---------------------------------------------------------------------------
// MSL-M060 — uppercase modal keywords
// ---------------------------------------------------------------------------

Deno.test("validateModalKeywords: lowercase shall — no MSL-M060", () => {
  const entry = makeEntry(
    "REQ-001",
    "The system shall handle all requests.",
    undefined,
    [
      {
        kind: "modal",
        text: "shall",
        case: "lower",
        location: { file: "test.md", line: 11, column: 12 },
      },
    ],
  );
  const diags = validateModalKeywords(entry);
  const m060 = diags.filter((d) => d.code === "MSL-M060");
  assertEquals(m060, []);
});

Deno.test("validateModalKeywords: uppercase SHALL — fires MSL-M060", () => {
  const entry = makeEntry(
    "REQ-001",
    "The system SHALL handle all requests.",
    undefined,
    [
      {
        kind: "modal",
        text: "SHALL",
        case: "upper",
        location: { file: "test.md", line: 11, column: 12 },
      },
    ],
  );
  const diags = validateModalKeywords(entry);
  const m060 = diags.filter((d) => d.code === "MSL-M060");
  assertEquals(m060.length, 1);
  assertEquals(m060[0].severity, "warning");
  assertEquals(m060[0].message.includes("SHALL"), true);
});

Deno.test("validateModalKeywords: preserve casing suppresses only the casing warning", () => {
  const entry = makeEntry("REQ-001", "The system SHALL act.", undefined, [{
    kind: "modal",
    text: "SHALL",
    case: "upper",
    location: { file: "test.md", line: 11, column: 12 },
  }]);
  for (const casing of ["preserve", "iso", "rfc2119"]) {
    const conventions = new Map([
      ["modal-keywords", {
        value: { name: "modal-keywords", settings: { casing } },
        origin: "@test/legacy",
      }],
    ]);
    assertEquals(
      validateModalKeywords(entry, conventions).length,
      casing === "preserve" ? 0 : 1,
    );
    const missingModal = makeEntry(
      "REQ-002",
      "No obligation verb.",
      "Requirement",
    );
    assertEquals(
      validateModalKeywords(missingModal, conventions)[0]?.code,
      "MSL-M061",
    );
  }
});

Deno.test("validateModalKeywords: uppercase keyword in code fence — NOT flagged", () => {
  // MSL-M060 — keywords inside verbatim code blocks must be excluded.
  // extractBodyTokens skips verbatim lines, so no modal tokens appear.
  const body = [
    "Prose before the fence.",
    "",
    "```",
    "SHALL_CONSTANT = 42",
    "```",
    "",
    "Prose after the fence.",
  ].join("\n");
  // bodyTokens has no modal entries because the scanner skips the fence.
  const entry = makeEntry("REQ-001", body, undefined, []);
  const diags = validateModalKeywords(entry);
  const m060 = diags.filter((d) => d.code === "MSL-M060");
  assertEquals(m060, []);
});

Deno.test("validateModalKeywords: uppercase modal in list item — fires MSL-M060", () => {
  const body = [
    "Conditions:",
    "",
    "- The sensor SHOULD report every 10 ms.",
  ].join("\n");
  const entry = makeEntry("REQ-001", body, undefined, [
    {
      kind: "modal",
      text: "SHOULD",
      case: "upper",
      location: { file: "test.md", line: 13, column: 17 },
    },
  ]);
  const diags = validateModalKeywords(entry);
  const m060 = diags.filter((d) => d.code === "MSL-M060");
  assertEquals(m060.length, 1);
  assertEquals(m060[0].message.includes("SHOULD"), true);
});

Deno.test("validateModalKeywords: EARS trigger tokens are not flagged as MSL-M060", () => {
  // ears-trigger tokens are a separate kind; the validator ignores them.
  const entry = makeEntry("REQ-001", "When the sensor fires.", undefined, [
    {
      kind: "ears-trigger",
      text: "When",
      trigger: "When",
      location: { file: "test.md", line: 11, column: 1 },
    },
  ]);
  const diags = validateModalKeywords(entry);
  const m060 = diags.filter((d) => d.code === "MSL-M060");
  assertEquals(m060, []);
});

// ---------------------------------------------------------------------------
// MSL-M061 — Requirement entry with no modal keyword
// ---------------------------------------------------------------------------

Deno.test("validateModalKeywords: Requirement type with no modal → MSL-M061", () => {
  // bodyTokens is empty → no modal token → MSL-M061 fires.
  const entry = makeEntry(
    "REQ-001",
    "The system handles requests.",
    "Requirement",
    [],
  );
  const diags = validateModalKeywords(entry);
  const m061 = diags.filter((d) => d.code === "MSL-M061");
  assertEquals(m061.length, 1);
  assertEquals(m061[0].severity, "info");
});

Deno.test("validateModalKeywords: non-Requirement type with no modal → no MSL-M061", () => {
  const entry = makeEntry(
    "TST-001",
    "Verify that the system handles all requests.",
    "Test",
    [],
  );
  const diags = validateModalKeywords(entry);
  const m061 = diags.filter((d) => d.code === "MSL-M061");
  assertEquals(m061, []);
});

Deno.test("validateModalKeywords: Requirement with lowercase modal → no MSL-M061", () => {
  // A lower-case modal token counts as "any modal seen" → no MSL-M061.
  const entry = makeEntry(
    "REQ-001",
    "The system shall handle all requests.",
    "Requirement",
    [
      {
        kind: "modal",
        text: "shall",
        case: "lower",
        location: { file: "test.md", line: 11, column: 12 },
      },
    ],
  );
  const diags = validateModalKeywords(entry);
  const m061 = diags.filter((d) => d.code === "MSL-M061");
  assertEquals(m061, []);
});

// ---------------------------------------------------------------------------
// SP2 Task 7 — verbatim-content.text regression pin (updated for ADR-016).
//
// The old AST-based marker path flattened `_SHALL_` (emphasis) to `SHALL`
// before matching, so it detected it as uppercase. The bodyTokens scanner
// uses raw-text regex (`\b(shall|…)\b`) where `_` is a word character in
// JavaScript, so `_SHALL_` does NOT produce a word boundary on either side
// and is NOT matched. This is an accepted behavioral difference: emphatic
// modals written as `_SHALL_` are not flagged; authors should write `SHALL`
// in plain prose. The integration pin below confirms the scanner behaviour.
// ---------------------------------------------------------------------------

Deno.test("MSL-M060: emphasised _SHALL_ not detected by bodyTokens scanner", async () => {
  const { parseFile } = await import("../mod.ts");
  const { validateModalKeywords } = await import("./modal_keywords.ts");
  const doc =
    "- [TST_MK_0001] Probe\n\n  The driver _SHALL_ act.\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const { entries } = await parseFile(doc, { file: "t.md" });
  // _SHALL_ is not matched by \b…\b because `_` is a word character in JS.
  // bodyTokens is empty → no MSL-M060 emitted.
  const m060 = validateModalKeywords(entries[0]).filter((d) =>
    d.code === "MSL-M060"
  );
  assertEquals(m060.length, 0);
});

// ---------------------------------------------------------------------------
// SP3 Task 6 — validator-safety pin: formatter-only normalization.
//
// `normalizeBodyAst` is called ONLY from `core/formatter/mod.ts`; the
// parse/validate path uses `buildBodyAst` (no normalization). This pin
// asserts MSL-M060 still fires on an uppercase `SHALL` when the entry is
// produced by `parseFile` alone — proving the validate path never runs
// the formatter's normalization pass.
// ---------------------------------------------------------------------------

Deno.test("MSL-M060: uppercase modal still flagged (validate does not normalize)", async () => {
  const { parseFile } = await import("../mod.ts");
  const { validateModalKeywords } = await import("./modal_keywords.ts");
  const doc =
    "- [TST_MK_0002] Probe\n\n  The driver SHALL act.\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const { entries } = await parseFile(doc, { file: "t.md" });
  const m060 = validateModalKeywords(entries[0]).filter((d) =>
    d.code === "MSL-M060"
  );
  assertEquals(m060.length, 1);
});

Deno.test("MSL-M061: a keyword in a link URL is not the entry's modal (#1017)", async () => {
  const { parseFile } = await import("../mod.ts");
  const { validateModalKeywords } = await import("./modal_keywords.ts");
  const doc =
    "- [TST_MK_0003] Probe\n\n  The driver follows [the rule](http://x.example/shall).\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n      Type: Requirement\n";
  const { entries } = await parseFile(doc, { file: "t.md" });
  const codes = validateModalKeywords(entries[0]).map((d) => d.code);
  assertEquals(codes, ["MSL-M061"]);
});

Deno.test("MSL-M060: no warning for keywords that fmt keeps (#1017)", async () => {
  const { parseFile } = await import("../mod.ts");
  const { validateModalKeywords } = await import("./modal_keywords.ts");
  const doc = "- [TST_MK_0004] Probe\n\n" +
    "  The system shall use `SHALL` here and follow [shall](http://x.example/SHALL).\n\n" +
    '  See [the rule](http://a.example/p "MAY") and ![SHALL](img/SHALL.png).\n\n' +
    "      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const { entries } = await parseFile(doc, { file: "t.md" });
  const m060 = validateModalKeywords(entries[0]).filter((d) =>
    d.code === "MSL-M060"
  );
  assertEquals(m060, []);
});

// ---------------------------------------------------------------------------
// MSL-M062 — lowercase modal keyword under `casing: rfc8174`
// ---------------------------------------------------------------------------

function casingConventions(casing: string) {
  return new Map([
    ["modal-keywords", {
      value: { name: "modal-keywords", settings: { casing } },
      origin: "@test/rfc8174",
    }],
  ]);
}

function modalToken(text: string, kind: "upper" | "lower"): BodyToken {
  return {
    kind: "modal",
    text,
    case: kind,
    location: { file: "test.md", line: 11, column: 12 },
  };
}

Deno.test("validateModalKeywords: rfc8174 emits no MSL-M060 for uppercase", () => {
  const entry = makeEntry(
    "REQ-001",
    "The system SHALL act.",
    "Requirement",
    [modalToken("SHALL", "upper")],
  );
  const diags = validateModalKeywords(entry, casingConventions("rfc8174"));
  assertEquals(diags.length, 0);
});

Deno.test("validateModalKeywords: rfc8174 emits MSL-M062 (info) for lowercase in a Requirement", () => {
  const entry = makeEntry(
    "REQ-001",
    "The system shall act.",
    "Requirement",
    [modalToken("shall", "lower")],
  );
  const diags = validateModalKeywords(entry, casingConventions("rfc8174"));
  assertEquals(diags.map((d) => d.code), ["MSL-M062"]);
  assertEquals(diags[0].severity, "info");
  assertEquals(
    diags[0].message,
    "modal keyword 'shall' is lowercase; under RFC 8174 only uppercase " +
      "keywords are normative",
  );
  assertEquals(diags[0].location, { file: "test.md", line: 11, column: 12 });
});

Deno.test("validateModalKeywords: rfc8174 emits no MSL-M062 outside a Requirement", () => {
  const entry = makeEntry(
    "TST-001",
    "The tester may retry.",
    "Test",
    [modalToken("may", "lower")],
  );
  assertEquals(
    validateModalKeywords(entry, casingConventions("rfc8174")).length,
    0,
  );
});

Deno.test("validateModalKeywords: MSL-M062 only under rfc8174", () => {
  const entry = makeEntry(
    "REQ-001",
    "The system shall act.",
    "Requirement",
    [modalToken("shall", "lower")],
  );
  for (const casing of ["preserve", "iso", "rfc2119"]) {
    assertEquals(
      validateModalKeywords(entry, casingConventions(casing)).length,
      0,
      casing,
    );
  }
  assertEquals(validateModalKeywords(entry).length, 0);
});

Deno.test("validateModalKeywords: rfc8174 keeps MSL-M061 for a Requirement without a modal", () => {
  const entry = makeEntry("REQ-002", "No obligation verb.", "Requirement");
  assertEquals(
    validateModalKeywords(entry, casingConventions("rfc8174")).map((d) =>
      d.code
    ),
    ["MSL-M061"],
  );
});

// MSL-M062 for profile types (classification needs the profile).

function profileType(
  name: string,
  extendsType: string,
  displayIdPattern: string,
): ProvenancedMapEntry<EffectiveTypeDef> {
  const origin = "@test/profile";
  return {
    value: {
      name,
      extends: extendsType,
      displayIdPattern: { value: displayIdPattern, origin },
      displayIdPatternEnforcement: { value: "off", origin },
      color: { value: undefined, origin },
      required: { value: [], origin },
      attributes: new Map(),
      traceability: new Map(),
      description: { value: undefined, origin },
      attrDescriptions: new Map(),
      relationDescriptions: new Map(),
      discipline: { value: undefined, origin },
    },
    origin,
  };
}

function rfc8174Profile(): EffectiveProfile {
  const types = new Map([
    [
      "stakeholder-requirement",
      profileType(
        "stakeholder-requirement",
        "Requirement",
        "STK_{n:04d}",
      ),
    ],
    ["design-record", profileType("design-record", "Record", "DRC_{n:04d}")],
  ]);
  return {
    attributes: new Map(),
    labels: new Map(),
    colors: new Map(),
    conventions: casingConventions("rfc8174"),
    types,
    documents: { types: new Map(), frontMatter: new Map() },
    delivers: [],
    kinds: new Map(),
    prose: {
      lexicons: {
        "capitalized-allow": { value: [], origin: "" },
        "sentence-abbrev": { value: [], origin: "" },
      },
    },
    disciplineMode: { value: "none", origin: "inferred" },
  } as EffectiveProfile;
}

function m062Codes(entry: Entry): string[] {
  const profile = rfc8174Profile();
  return validateModalKeywords(entry, profile.conventions, profile)
    .map((d) => d.code);
}

Deno.test("validateModalKeywords: M062 fires for a profile Requirement subtype with explicit Type", () => {
  const base = makeEntry(
    "STK_0001",
    "The system shall act.",
    undefined,
    [modalToken("shall", "lower")],
  );
  const entry: Entry = {
    ...base,
    rawAttributes: [{ key: "Type", value: "stakeholder-requirement" }],
  };
  assertEquals(m062Codes(entry), ["MSL-M062"]);
});

Deno.test("validateModalKeywords: M062 fires when only the profile display-ID pattern classifies", () => {
  const entry = makeEntry(
    "STK_0001",
    "The system shall act.",
    undefined,
    [modalToken("shall", "lower")],
  );
  assertEquals(m062Codes(entry), ["MSL-M062"]);
});

Deno.test("validateModalKeywords: no M062 for a profile type that is not a Requirement", () => {
  const entry = makeEntry(
    "DRC_0001",
    "The team may revisit this.",
    undefined,
    [modalToken("may", "lower")],
  );
  assertEquals(m062Codes(entry), []);
});

Deno.test("validateModalKeywords: M062 fires once per lowercase token", () => {
  const entry = makeEntry(
    "STK_0001",
    "The system shall act and may retry; it MUST log.",
    undefined,
    [
      modalToken("shall", "lower"),
      modalToken("may", "lower"),
      modalToken("MUST", "upper"),
    ],
  );
  assertEquals(m062Codes(entry), ["MSL-M062", "MSL-M062"]);
});

Deno.test("validateModalKeywords: M061 scope is unchanged by the profile", () => {
  // A profile Requirement subtype with no modal keyword: M061 stays core-only.
  const entry = makeEntry("STK_0002", "No obligation verb.", undefined);
  assertEquals(m062Codes(entry), []);
});

Deno.test("validateModalKeywords: a classified entry.type that extends Requirement counts for MSL-M062", () => {
  // The display ID matches no pattern, so only `entry.type` (set by an
  // earlier classification) makes this a Requirement.
  const entry = makeEntry(
    "ZZZ_0001",
    "The system shall act.",
    "stakeholder-requirement",
    [modalToken("shall", "lower")],
  );
  assertEquals(m062Codes(entry), ["MSL-M062"]);
  const other = makeEntry(
    "ZZZ_0002",
    "The system shall act.",
    "design-record",
    [modalToken("shall", "lower")],
  );
  assertEquals(m062Codes(other), []);
});

Deno.test("validateModalKeywords: a compound `shall not` gives exactly one MSL-M062", async () => {
  const { parseFile } = await import("../mod.ts");
  const doc =
    "- [STK_0001] Probe\n\n  The system shall not fail.\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const { entries } = await parseFile(doc, { file: "t.md" });
  assertEquals(m062Codes(entries[0]), ["MSL-M062"]);
});

// The body tokens leave out keywords that fmt keeps (#1017), so MSL-M062
// does not report them; the lowercase `shall` in the prose still counts.
Deno.test("validateModalKeywords: MSL-M062 does not report a keyword inside inline code", async () => {
  const { parseFile } = await import("../mod.ts");
  const doc =
    "- [STK_0001] Probe\n\n  The system shall write `shall` in code.\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const { entries } = await parseFile(doc, { file: "t.md" });
  const m062 = validateModalKeywords(
    entries[0],
    rfc8174Profile().conventions,
    rfc8174Profile(),
  ).filter((d) => d.code === "MSL-M062");
  assertEquals(m062.map((d) => d.location?.column), [14]);
});

for (
  const [name, prose] of [
    ["a link URL", "See [the page](https://example.com/shall) here."],
    ["a link title", 'See [the page](https://example.com "shall") here.'],
    ["an autolink", "See <https://example.com/shall> here."],
    ["an image", "See ![a shall picture](https://example.com/a.png) here."],
  ] as const
) {
  Deno.test(`validateModalKeywords: MSL-M062 does not report a keyword inside ${name}`, async () => {
    const { parseFile } = await import("../mod.ts");
    const doc =
      `- [STK_0001] Probe\n\n  ${prose}\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n`;
    const { entries } = await parseFile(doc, { file: "t.md" });
    assertEquals(m062Codes(entries[0]), []);
  });
}

Deno.test("validateModalKeywords: MSL-M062 fires for the built-in REQ prefix without Type", async () => {
  const { parseFile } = await import("../mod.ts");
  const doc =
    "- [REQ-001] Probe\n\n  The system shall act.\n\n      Id: 01ARZ3NDEKTSV4RRFFQ69G5FAV\n";
  const { entries } = await parseFile(doc, { file: "t.md" });
  assertEquals(entries[0].rawAttributes.some((a) => a.key === "Type"), false);
  assertEquals(m062Codes(entries[0]), ["MSL-M062"]);
});

Deno.test("validateModalKeywords: MSL-M062 fires for a `.feature` Feature entry", async () => {
  const { parseFile } = await import("../mod.ts");
  const text = [
    "# [ZZZ_0001] Probe",
    "Feature: F",
    "  The system shall stop.",
    "",
    "  Scenario: S",
    "    Then a",
    "",
  ].join("\n");
  const { entries } = await parseFile(text, { file: "t.feature" });
  assertEquals(m062Codes(entries[0]), ["MSL-M062"]);
});
