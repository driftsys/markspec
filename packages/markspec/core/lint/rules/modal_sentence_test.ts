/**
 * @module core/lint/rules/modal_sentence_test
 *
 * Unit tests for modal sentence rules MSL-Q200 and MSL-Q201.
 */

import { assertEquals } from "@std/assert";
import type { BodyBlock } from "../../ast/nodes.ts";
import type {
  EffectiveProfile,
  EffectiveTypeDef,
  Entry,
  ProvenancedMapEntry,
} from "../../model/mod.ts";
import { makeDisplayId } from "../../model/mod.ts";
import { runModalSentenceRules } from "./modal_sentence.ts";

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

function makeParagraph(text: string, line = 1, column = 1): BodyBlock {
  return {
    kind: "paragraph",
    content: { text },
    range: {
      start: { line, column },
      end: { line, column: column + text.length },
    },
  };
}

interface MakeEntryOpts {
  /** Resolved core type string (e.g. "Requirement", "Test"). */
  type?: string;
  /** Display ID of the entry. Defaults to `STK_0001`. */
  displayId?: string;
  /** `Entry.type` set by profile classification, with no `Type:` trailer. */
  classifiedAs?: string;
  location?: { file: string; line: number; column: number };
  bodyStartLine?: number;
}

function makeEntry(
  body: string,
  opts: MakeEntryOpts = {},
): Entry {
  const bodyAst: BodyBlock[] = [makeParagraph(body)];
  const location = opts.location ?? { file: "test.md", line: 1, column: 1 };
  const entryType = opts.type;
  return {
    displayId: makeDisplayId(opts.displayId ?? "STK_0001"),
    title: "Test requirement",
    body,
    bodyAst,
    rawAttributes: [
      { key: "Id", value: "01HGW2Q8MNP3RSTVWXYZABCDEF" },
      ...(entryType ? [{ key: "Type", value: entryType }] : []),
    ],
    typedAttributes: new Map([
      ["Id", ["01HGW2Q8MNP3RSTVWXYZABCDEF"]],
      ...(entryType ? [["Type", [entryType]] as [string, string[]]] : []),
    ]),
    id: "01HGW2Q8MNP3RSTVWXYZABCDEF",
    type: entryType ?? opts.classifiedAs,
    shape: "Authored",
    location,
    ...(opts.bodyStartLine !== undefined
      ? { bodyStartLine: opts.bodyStartLine }
      : {}),
    source: { kind: "markdown" },
    bodyTokens: [],
  };
}

// ---------------------------------------------------------------------------
// MSL-Q200: modal-multiple
// ---------------------------------------------------------------------------

Deno.test("Q200: fires when ≥2 modals in one sentence", () => {
  const entry = makeEntry(
    "The system shall apply pressure and shall log the event.",
  );
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q200"), true);
});

Deno.test("Q200: silent when modals split across sentences", () => {
  const entry = makeEntry("The system shall apply. The logger shall record.");
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q200"), false);
});

Deno.test("Q200: silent on single modal", () => {
  const entry = makeEntry("The system shall apply pressure.");
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q200"), false);
});

Deno.test("Q200: 3 modals in one sentence still fires once", () => {
  const entry = makeEntry(
    "The brake shall apply, shall log, and shall release.",
  );
  const diags = runModalSentenceRules(entry);
  const q200 = diags.filter((d) => d.code === "MSL-Q200");
  assertEquals(q200.length, 1); // one diagnostic per offending sentence
});

Deno.test("Q200: 'shall not' counts as one modal, not two", () => {
  const entry = makeEntry(
    "The system shall not retry on failure.",
  );
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q200"), false);
});

Deno.test("Q200: 'shall not' + 'shall' counts as two modals", () => {
  // Two distinct modal tokens: "shall not" and "shall".
  const entry = makeEntry(
    "The system shall not retry on failure and shall log the event.",
  );
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q200"), true);
});

// ---------------------------------------------------------------------------
// MSL-Q201: modal-soft-in-normative
// ---------------------------------------------------------------------------

Deno.test("Q201: fires for 'should' in Requirement-typed entry", () => {
  const entry = makeEntry("The system should retry on failure.", {
    type: "Requirement",
  });
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q201"), true);
});

Deno.test("Q201: fires for 'may' in Requirement-typed entry", () => {
  const entry = makeEntry("The driver may override the alert.", {
    type: "Requirement",
  });
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q201"), true);
});

Deno.test("Q201: silent for 'shall' in Requirement-typed entry", () => {
  const entry = makeEntry("The system shall retry on failure.", {
    type: "Requirement",
  });
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q201"), false);
});

Deno.test("Q201: silent for 'should' in a non-Requirement entry (e.g. Test)", () => {
  const entry = makeEntry("The test should verify the brake actuation.", {
    type: "Test",
  });
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q201"), false);
});

Deno.test("Q201: silent for 'should' in entry with no resolved type", () => {
  // Profile-less project: entry type is undefined. Q201 conservatively skips.
  const entry = makeEntry("The system should retry on failure.");
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q201"), false);
});

// MSL-Q201 for profile types (#1039): the profile classifies the entry.

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

/** A profile with a Requirement subtype (`STK_`) and a Record subtype. */
function subtypeProfile(): EffectiveProfile {
  const types = new Map([
    [
      "stakeholder-requirement",
      profileType("stakeholder-requirement", "Requirement", "STK_{n:04d}"),
    ],
    ["design-record", profileType("design-record", "Record", "DRC_{n:04d}")],
  ]);
  return {
    attributes: new Map(),
    labels: new Map(),
    colors: new Map(),
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
  } as unknown as EffectiveProfile;
}

function hasQ201(entry: Entry, profile?: EffectiveProfile): boolean {
  return runModalSentenceRules(entry, profile).some((d) =>
    d.code === "MSL-Q201"
  );
}

Deno.test("Q201: fires for a profile Requirement subtype with explicit Type (#1039)", () => {
  const entry = makeEntry("The system should log faults.", {
    displayId: "STK_0001",
    type: "stakeholder-requirement",
  });
  assertEquals(hasQ201(entry, subtypeProfile()), true);
});

Deno.test("Q201: fires when only the profile display-ID pattern classifies (#1039)", () => {
  const entry = makeEntry("The system should log faults.", {
    displayId: "STK_0001",
  });
  assertEquals(hasQ201(entry, subtypeProfile()), true);
});

Deno.test("Q201: fires for an entry the pipeline classified as a profile Requirement subtype (#1039)", () => {
  // `markspec lint` passes entries that classification already typed.
  const entry = makeEntry("The system should log faults.", {
    displayId: "STK_0001",
    classifiedAs: "stakeholder-requirement",
  });
  assertEquals(hasQ201(entry, subtypeProfile()), true);
});

Deno.test("Q201: fires for a profile `Type:` raw attribute when Entry.type is unset (#1039)", () => {
  // A profile type name, so only the profile maps it to `Requirement`.
  const entry = makeEntry("The system should log faults.", {
    displayId: "ZZZ_0001",
    type: "stakeholder-requirement",
  });
  // The parser output before classification: the trailer holds `Type:`, and
  // `Entry.type` is not set.
  const unclassified: Entry = { ...entry, type: undefined };
  assertEquals(unclassified.type, undefined);
  assertEquals(hasQ201(unclassified, subtypeProfile()), true);
});

Deno.test("Q201: fires for an explicit profile Type when the display ID matches no pattern (#1039)", () => {
  const entry = makeEntry("The system should log faults.", {
    displayId: "ZZZ_0001",
    type: "stakeholder-requirement",
  });
  assertEquals(hasQ201(entry, subtypeProfile()), true);
});

Deno.test("Q201: an explicit non-Requirement profile Type wins over a Requirement display-ID pattern (#1039)", () => {
  const entry = makeEntry("The team should record the decision.", {
    displayId: "STK_0009",
    type: "design-record",
  });
  assertEquals(hasQ201(entry, subtypeProfile()), false);
});

Deno.test("Q201: with a profile, still fires for the built-in REQ prefix (#1039)", () => {
  const entry = makeEntry("The system should log faults.", {
    displayId: "REQ-0001",
  });
  assertEquals(hasQ201(entry, subtypeProfile()), true);
});

Deno.test("Q201: without a profile, ignores a profile display-ID prefix (#1039)", () => {
  const entry = makeEntry("The system should log faults.", {
    displayId: "STK_0001",
  });
  assertEquals(hasQ201(entry), false);
});

// ---------------------------------------------------------------------------
// Co-firing
// ---------------------------------------------------------------------------

Deno.test("Q200+Q201: can co-fire on 'The system should retry and should log.' in Requirement", () => {
  // Both: ≥2 modals (Q200) AND soft modal in Requirement (Q201).
  const entry = makeEntry(
    "The system should retry and should log.",
    { type: "Requirement" },
  );
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q200"), true);
  assertEquals(diags.some((d) => d.code === "MSL-Q201"), true);
});

// ---------------------------------------------------------------------------
// File-absolute range
// ---------------------------------------------------------------------------

Deno.test("Q200: range is file-absolute, sentence-span", () => {
  // Use bodyStartLine to verify file-absolute emission.
  const entry = makeEntry(
    "The system shall apply and shall log.",
    {
      location: { file: "/x.md", line: 30, column: 1 },
      bodyStartLine: 32,
    },
  );
  const diags = runModalSentenceRules(entry);
  const q200 = diags.find((d) => d.code === "MSL-Q200");
  assertEquals(q200?.range?.start.line, 32);
});

// ---------------------------------------------------------------------------
// Metadata fields
// ---------------------------------------------------------------------------

Deno.test("Q200: carries correct slug, group, scoreContribution, severity", () => {
  const entry = makeEntry(
    "The system shall apply pressure and shall log the event.",
  );
  const diags = runModalSentenceRules(entry);
  const q200 = diags.find((d) => d.code === "MSL-Q200");
  assertEquals(q200?.slug, "modal-multiple");
  assertEquals(q200?.group, "modal");
  assertEquals(q200?.scoreContribution, 3);
  assertEquals(q200?.severity, "warning");
});

Deno.test("Q201: carries correct slug, group, scoreContribution, severity", () => {
  const entry = makeEntry("The system should retry on failure.", {
    type: "Requirement",
  });
  const diags = runModalSentenceRules(entry);
  const q201 = diags.find((d) => d.code === "MSL-Q201");
  assertEquals(q201?.slug, "modal-soft-in-normative");
  assertEquals(q201?.group, "modal");
  assertEquals(q201?.scoreContribution, 1);
  assertEquals(q201?.severity, "info");
});

// ---------------------------------------------------------------------------
// Silent on non-normative sentences (no modals)
// ---------------------------------------------------------------------------

Deno.test("modal: silent on non-normative sentences", () => {
  const entry = makeEntry("The brake is a critical safety component.", {
    type: "Requirement",
  });
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.length, 0);
});

// ---------------------------------------------------------------------------
// Inline code and link syntax are not prose (#1029)
// ---------------------------------------------------------------------------

Deno.test("Q200: ignores modals in inline code, link destinations and titles (#1029)", () => {
  const entry = makeEntry(
    'The system shall use `SHALL` here and follow [the guide](http://x.example/SHALL "must").',
  );
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q200"), false);
});

Deno.test("Q200: still counts a modal in visible link text (#1029)", () => {
  // Visible link text is prose: nonProseRanges keeps it.
  const entry = makeEntry(
    "The system shall use `SHALL` here and follow [shall](http://x.example/SHALL).",
  );
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q200"), true);
});

Deno.test("Q200: positive control, the same modals outside code fire (#1029)", () => {
  const entry = makeEntry("The system shall use SHALL here.");
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q200"), true);
});

Deno.test("Q200: a range after an inline code span keeps its column (#1029)", () => {
  const entry = makeEntry("Use `x`. The system shall log and must store.");
  const d = runModalSentenceRules(entry).find((x) => x.code === "MSL-Q200");
  assertEquals(d?.range?.start.column, 10);
  assertEquals(d?.range?.end.column, 46);
});

Deno.test("Q201: ignores a soft modal in inline code (#1029)", () => {
  const entry = makeEntry("The system shall accept `may` as a value.", {
    type: "Requirement",
  });
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q201"), false);
});

Deno.test("Q201: positive control, a soft modal outside code fires (#1029)", () => {
  const entry = makeEntry("The system may accept a value.", {
    type: "Requirement",
  });
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q201"), true);
});

/** An entry whose body also holds a link reference definition block. */
function withDefinition(entry: Entry, raw: string): Entry {
  const definition: BodyBlock = {
    kind: "unknown",
    raw,
    range: {
      start: { line: 3, column: 1 },
      end: { line: 3, column: 1 + raw.length },
    },
  };
  return { ...entry, bodyAst: [...(entry.bodyAst ?? []), definition] };
}

Deno.test("Q200: ignores a keyword in a full reference label that has a definition (#1029)", () => {
  const entry = withDefinition(
    makeEntry("The system shall log faults, see [the list][shall]."),
    "[shall]: http://x.example/",
  );
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q200"), false);
});

Deno.test("Q200: reads the label keyword when no definition exists (#1029)", () => {
  const entry = makeEntry(
    "The system shall log faults, see [the list][shall].",
  );
  const diags = runModalSentenceRules(entry);
  assertEquals(diags.some((d) => d.code === "MSL-Q200"), true);
});
