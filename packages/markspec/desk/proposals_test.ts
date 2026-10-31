import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import {
  type Diagnostic,
  format,
  loadMarkdownFormatter,
  type ProseFormatter,
  readEntryBody,
  replaceEntryBody,
} from "../core/mod.ts";
import {
  applyBody,
  type DocumentFormatter,
  isTargetF900,
  MAX_PROPOSAL_CHARS,
  previewBody,
  type ProposalRefusal,
} from "./proposals.ts";

const FIXTURE_ROOT = fromFileUrl(
  new URL("../../../tests/fixtures/desk-project", import.meta.url),
);
const FILE = join(FIXTURE_ROOT, "docs/system.md");
const SYSTEM = await Deno.readTextFile(FILE);
const prose = await loadMarkdownFormatter();

const CURRENT_BODY =
  "The braking system shall apply full braking torque within 200 ms of a\nconfirmed obstacle.";

Deno.test("previewBody: returns the formatted proposal and current body", async () => {
  const r = await previewBody(
    SYSTEM,
    FILE,
    "SYS_BRK_0001",
    "The braking system shall apply full torque within 150 ms.\n",
    prose,
  );
  assert(r.ok);
  assertEquals(
    r.value.body,
    "The braking system shall apply full torque within 150 ms.",
  );
  assertEquals(r.value.currentBody, CURRENT_BODY);
});

Deno.test("previewBody: returns the current body in its formatted form", async () => {
  const unwrapped = SYSTEM.replace(
    "within 200 ms of a\n  confirmed",
    "within 200 ms of a confirmed",
  );
  assert(unwrapped !== SYSTEM);
  const raw = await readEntryBody(unwrapped, FILE, "SYS_BRK_0001");
  assert(raw !== undefined && !raw.includes("\n"));
  const r = await previewBody(
    unwrapped,
    FILE,
    "SYS_BRK_0001",
    "New body.",
    prose,
  );
  assert(r.ok);
  assertEquals(r.value.currentBody, CURRENT_BODY);
});

Deno.test("previewBody: wraps a long line at the body width", async () => {
  const words: string[] = [];
  for (let i = 0; words.join(" ").length < 200; i++) words.push(`word${i}`);
  const sentence = `The system shall ${words.join(" ")}.`;
  assert(sentence.length >= 200);
  const r = await previewBody(SYSTEM, FILE, "SYS_BRK_0001", sentence, prose);
  assert(r.ok);
  const lines = r.value.body.split("\n");
  assert(lines.length > 1);
  for (const line of lines) assert(line.length <= 78, line);
  assertEquals(r.value.body.split(/\s+/), sentence.split(/\s+/));
});

Deno.test("previewBody: refuses a body over 20 000 characters", async () => {
  const proposed = "a ".repeat(10_001);
  assert(proposed.length > MAX_PROPOSAL_CHARS);
  assertEquals(
    await previewBody(SYSTEM, FILE, "SYS_BRK_0001", proposed, prose),
    { ok: false, refusal: "proposal-too-large" },
  );
});

Deno.test("previewBody: accepts a body of exactly 20 000 characters", async () => {
  const atLimit = "word ".repeat(MAX_PROPOSAL_CHARS / 5 - 1) + "ends.";
  assertEquals(atLimit.length, MAX_PROPOSAL_CHARS);
  const r = await previewBody(SYSTEM, FILE, "SYS_BRK_0001", atLimit, prose);
  assert(r.ok);
  assertEquals(
    await previewBody(SYSTEM, FILE, "SYS_BRK_0001", `${atLimit}a`, prose),
    { ok: false, refusal: "proposal-too-large" },
  );
});

Deno.test("previewBody: refuses an empty proposal", async () => {
  assertEquals(
    await previewBody(SYSTEM, FILE, "SYS_BRK_0001", "  \n\n", prose),
    { ok: false, refusal: "proposal-empty" },
  );
});

Deno.test("previewBody: refuses an unknown display ID", async () => {
  assertEquals(
    await previewBody(SYSTEM, FILE, "SYS_BRK_9999", "New body.", prose),
    { ok: false, refusal: "entry-not-found" },
  );
});

Deno.test("previewBody: refuses an entry with no body", async () => {
  const text =
    `${SYSTEM}\n- [SYS_BRK_0003] No body yet\n\n      Satisfies: STK_BRK_0001\n`;
  assertEquals(
    await previewBody(text, FILE, "SYS_BRK_0003", "New body.", prose),
    { ok: false, refusal: "entry-body-empty" },
  );
});

Deno.test("previewBody: refuses a proposal that adds an entry", async () => {
  assertEquals(
    await previewBody(
      SYSTEM,
      FILE,
      "SYS_BRK_0001",
      "Text.\n\n- [SYS_BRK_0099] Sneaky\n\n      Id: 01JBRK00000000000000000099",
      prose,
    ),
    { ok: false, refusal: "proposal-changes-entries" },
  );
});

Deno.test("previewBody: a prose formatter failure is not a refusal", async () => {
  const throwing: ProseFormatter = () => {
    throw new Error("boom");
  };
  const r = await previewBody(
    SYSTEM,
    FILE,
    "SYS_BRK_0001",
    "New body.",
    throwing,
  );
  assert(r.ok);
  assertEquals(r.value.body, "New body.");
});

Deno.test("applyBody: splices the formatted body and keeps every other byte", async () => {
  const r = await applyBody(SYSTEM, FILE, "SYS_BRK_0001", "New body.", prose);
  assert(r.ok);
  assertEquals(
    r.value,
    SYSTEM.replace(
      / {2}The braking system shall apply full braking torque[^]*?obstacle\./,
      "  New body.",
    ),
  );
});

Deno.test("applyBody: writes the formatted body, not the raw proposal", async () => {
  const words: string[] = [];
  for (let i = 0; i < 40; i++) words.push(`word${i}`);
  const proposed = `The system shall ${words.join(" ")}.`;
  const preview = await previewBody(
    SYSTEM,
    FILE,
    "SYS_BRK_0001",
    proposed,
    prose,
  );
  assert(preview.ok);
  const r = await applyBody(SYSTEM, FILE, "SYS_BRK_0001", proposed, prose);
  assert(r.ok);
  const written = await readEntryBody(r.value, FILE, "SYS_BRK_0001");
  assertEquals(written, preview.value.body);
  const lines = preview.value.body.split("\n");
  assert(lines.length > 1);
  for (const line of lines) assert(line.length <= 78, line);
  const expected = await replaceEntryBody(
    SYSTEM,
    FILE,
    "SYS_BRK_0001",
    preview.value.body,
  );
  assert(expected.ok);
  assertEquals(r.value, expected.text);
});

Deno.test("applyBody: refuses what previewBody refuses", async () => {
  const noBody =
    `${SYSTEM}\n- [SYS_BRK_0003] No body yet\n\n      Satisfies: STK_BRK_0001\n`;
  const cases: Array<[string, string, string, ProposalRefusal]> = [
    [SYSTEM, "SYS_BRK_0001", "", "proposal-empty"],
    [SYSTEM, "SYS_BRK_0001", "a ".repeat(10_001), "proposal-too-large"],
    [SYSTEM, "SYS_BRK_9999", "New body.", "entry-not-found"],
    [noBody, "SYS_BRK_0003", "New body.", "entry-body-empty"],
    [
      SYSTEM,
      "SYS_BRK_0001",
      "Text.\n\n- [SYS_BRK_0099] Sneaky\n\n      Id: 01JBRK00000000000000000099",
      "proposal-changes-entries",
    ],
    [
      SYSTEM.replace(
        "      Satisfies: STK_BRK_0001\n\n- [SYS_BRK_0002]",
        "      Satisfies: STK_BRK_0001\n      Labels:\n\n- [SYS_BRK_0002]",
      ),
      "SYS_BRK_0001",
      "New body.",
      "entry-trailer-invalid",
    ],
  ];
  for (const [text, id, proposed, refusal] of cases) {
    const expected = { ok: false, refusal } as const;
    assertEquals(await previewBody(text, FILE, id, proposed, prose), expected);
    assertEquals(await applyBody(text, FILE, id, proposed, prose), expected);
  }
});

Deno.test("applyBody: a preview body applies unchanged", async () => {
  const words: string[] = [];
  for (let i = 0; i < 40; i++) words.push(`word${i}`);
  const proposed = `The system shall ${words.join(" ")}.`;
  const preview = await previewBody(
    SYSTEM,
    FILE,
    "SYS_BRK_0001",
    proposed,
    prose,
  );
  assert(preview.ok);
  const applied = await applyBody(
    SYSTEM,
    FILE,
    "SYS_BRK_0001",
    preview.value.body,
    prose,
  );
  assert(applied.ok);
  assertEquals(
    await readEntryBody(applied.value, FILE, "SYS_BRK_0001"),
    preview.value.body,
  );
  const direct = await applyBody(SYSTEM, FILE, "SYS_BRK_0001", proposed, prose);
  assert(direct.ok);
  assertEquals(applied.value, direct.value);
  const again = await previewBody(
    applied.value,
    FILE,
    "SYS_BRK_0001",
    preview.value.body,
    prose,
  );
  assert(again.ok);
  assertEquals(again.value.currentBody, preview.value.body);
});

function diag(code: string, message: string): Diagnostic {
  return { code, severity: "warning", message, location: undefined };
}

Deno.test("isTargetF900: matches only MSL-F900 naming the target entry", () => {
  assert(
    isTargetF900([diag("MSL-F900", "SYS_BRK_0001: body kept")], "SYS_BRK_0001"),
  );
  assert(
    !isTargetF900(
      [diag("MSL-F900", "SYS_BRK_00011: body kept")],
      "SYS_BRK_0001",
    ),
  );
  assert(
    !isTargetF900([diag("MSL-F012", "SYS_BRK_0001: kept")], "SYS_BRK_0001"),
  );
  assert(!isTargetF900([], "SYS_BRK_0001"));
});

Deno.test("applyBody: keeps an unformatted neighbour entry byte for byte", async () => {
  // SYS_BRK_0002 is deliberately unformatted: trailing spaces, trailers
  // out of the formatter's order, a short odd wrap, and an Id indented
  // by 4 spaces instead of 6. Writing the formatter's whole output would
  // change these lines; the splice must not.
  const unformatted = SYSTEM.replace(
    /- \[SYS_BRK_0002\][^]*?Satisfies: STK_BRK_0001\n/,
    "- [SYS_BRK_0002] Redundant brake actuation   \n\n" +
      "  The braking system shall apply\n" +
      "  braking torque through a second,   \n" +
      "  independent actuation path when the primary path fails.\n\n" +
      "      Satisfies: STK_BRK_0001  \n" +
      "    Id: 01JBRK00000000000000000004\n" +
      "      Derived-from: HAZ_BRK_0001\n",
  );
  assert(unformatted !== SYSTEM);
  const formatted = format(unformatted, {
    file: FILE,
    formatMarkdownProse: prose,
  });
  assert(formatted.output !== unformatted, "fixture must be unformatted");

  const preview = await previewBody(
    unformatted,
    FILE,
    "SYS_BRK_0001",
    "New body.",
    prose,
  );
  assert(preview.ok);
  const r = await applyBody(
    unformatted,
    FILE,
    "SYS_BRK_0001",
    "New body.",
    prose,
  );
  assert(r.ok);
  const expected = await replaceEntryBody(
    unformatted,
    FILE,
    "SYS_BRK_0001",
    preview.value.body,
  );
  assert(expected.ok);
  assertEquals(r.value, expected.text);

  // Every line outside the SYS_BRK_0001 body (input lines 5 and 6) is
  // unchanged; the new body is one line, so later lines shift by one.
  const inLines = unformatted.split("\n");
  const outLines = r.value.split("\n");
  assertEquals(outLines.slice(0, 4), inLines.slice(0, 4));
  assertEquals(outLines[4], "  New body.");
  assertEquals(outLines.slice(5), inLines.slice(6));
});

/** A copy of SYSTEM whose SYS_BRK_0001 trailer has `badLine` added. */
function withBadTrailer(badLine: string): string {
  const out = SYSTEM.replace(
    "      Satisfies: STK_BRK_0001\n\n- [SYS_BRK_0002]",
    `      Satisfies: STK_BRK_0001\n${badLine}\n\n- [SYS_BRK_0002]`,
  );
  assert(out !== SYSTEM);
  return out;
}

for (
  const [name, badLine] of [
    ["an empty-valued trailer line", "      Labels:"],
    ["a trailer line without a colon", "      Labels ASIL-B"],
    ["a lowercase trailer key", "      labels: ASIL-B"],
    ["an empty Id line", "      Id:"],
    ["a trailer key with an underscore", "      Verified_by: TST_X"],
  ]
) {
  Deno.test(`previewBody and applyBody: refuse an entry with ${name}`, async () => {
    const text = withBadTrailer(badLine);
    const refused = { ok: false, refusal: "entry-trailer-invalid" } as const;
    assertEquals(
      await previewBody(text, FILE, "SYS_BRK_0001", "New body.", prose),
      refused,
    );
    assertEquals(
      await applyBody(text, FILE, "SYS_BRK_0001", "New body.", prose),
      refused,
    );
  });
}

Deno.test("previewBody and applyBody: a bad trailer on another entry does not refuse", async () => {
  const text = SYSTEM.replace(
    "      Verifies: SYS_BRK_0001",
    "      Verifies: SYS_BRK_0001\n      Labels:",
  );
  assert(text !== SYSTEM);
  assert(
    (await previewBody(text, FILE, "SYS_BRK_0001", "New body.", prose)).ok,
  );
  const r = await applyBody(text, FILE, "SYS_BRK_0001", "New body.", prose);
  assert(r.ok);
  assert(r.value.includes("      Verifies: SYS_BRK_0001\n      Labels:"));
});

Deno.test("previewBody: shows every current line apply replaces", async () => {
  // A lazy continuation line: the parser reads `lazy.` as body, but the
  // whole-document formatter moves it out of the entry. The preview must
  // still show it, because apply replaces it.
  const text = "- [SYS_BRK_0001] Brake\n\n  Old body\nlazy.\n\n" +
    "      Id: 01JBRK00000000000000000003\n      Satisfies: STK_BRK_0001\n";
  assertEquals(
    await readEntryBody(text, FILE, "SYS_BRK_0001"),
    "Old body\nlazy.",
  );
  const preview = await previewBody(text, FILE, "SYS_BRK_0001", "New.", prose);
  assert(preview.ok);
  assertEquals(preview.value.currentBody, "Old body\nlazy.");
  const applied = await applyBody(text, FILE, "SYS_BRK_0001", "New.", prose);
  assert(applied.ok);
  assert(!applied.value.includes("lazy."));
});

Deno.test("previewBody: the limit counts UTF-16 code units", async () => {
  // U+1F600 is one character but two UTF-16 code units.
  const emoji = "\u{1F600}";
  const over = emoji.repeat(MAX_PROPOSAL_CHARS / 2 + 1);
  assertEquals(
    await previewBody(SYSTEM, FILE, "SYS_BRK_0001", over, prose),
    { ok: false, refusal: "proposal-too-large" },
  );
  const at = emoji.repeat(MAX_PROPOSAL_CHARS / 2);
  assertEquals(at.length, MAX_PROPOSAL_CHARS);
  assert((await previewBody(SYSTEM, FILE, "SYS_BRK_0001", at, prose)).ok);
});

/** Assert that previewBody and applyBody both refuse with `refusal`. */
async function assertBothRefuse(
  formatDocument: DocumentFormatter,
  refusal: ProposalRefusal,
): Promise<void> {
  const expected = { ok: false, refusal } as const;
  assertEquals(
    await previewBody(
      SYSTEM,
      FILE,
      "SYS_BRK_0001",
      "New body.",
      prose,
      formatDocument,
    ),
    expected,
  );
  assertEquals(
    await applyBody(
      SYSTEM,
      FILE,
      "SYS_BRK_0001",
      "New body.",
      prose,
      formatDocument,
    ),
    expected,
  );
}

Deno.test("previewBody and applyBody: refuse when the formatter throws", async () => {
  await assertBothRefuse(() => {
    throw new Error("boom");
  }, "format-failed");
});

Deno.test("previewBody and applyBody: refuse a target MSL-F900", async () => {
  await assertBothRefuse(
    (text, options) => {
      const result = format(text, options);
      return {
        output: result.output,
        diagnostics: [
          ...result.diagnostics,
          diag("MSL-F900", "SYS_BRK_0001: body kept as written"),
        ],
      };
    },
    "format-failed",
  );
});

Deno.test("previewBody and applyBody: refuse when the formatted body loses the entry", async () => {
  await assertBothRefuse(
    (text) => ({
      output: text.replace("- [SYS_BRK_0001]", "- "),
      diagnostics: [],
    }),
    "format-failed",
  );
});

Deno.test("previewBody and applyBody: refuse a formatted body that fails the second splice", async () => {
  // The stand-in output puts an indented trailer-like line in the target
  // body. Read back from that output it is body, but spliced into the
  // original text it changes the entry's trailer.
  await assertBothRefuse(
    (text) => ({
      output: text.replace(
        "  New body.\n",
        "  New body.\n\n      Satisfies: STK_BRK_0002\n",
      ),
      diagnostics: [],
    }),
    "proposal-changes-entries",
  );
});

Deno.test("previewBody: a current body the formatter rewrites is shown formatted", async () => {
  // The formatter changes `*shall*` to `_shall_` and wraps the long line.
  // Those are not lost words, so currentBody is the formatted body.
  const text = SYSTEM.replace(
    "The braking system shall apply full braking torque within 200 ms of a\n  confirmed obstacle.",
    "The braking system *shall* apply full braking torque within 200 ms of a confirmed obstacle.",
  );
  assert(text !== SYSTEM);
  const r = await previewBody(text, FILE, "SYS_BRK_0001", "New body.", prose);
  assert(r.ok);
  assertEquals(
    r.value.currentBody,
    "The braking system _shall_ apply full braking torque within 200 ms of a\nconfirmed obstacle.",
  );
});

Deno.test("previewBody: refuses a proposal at the limit that formatting lengthens", async () => {
  // Formatting turns the indented code block into a fenced one, which adds
  // characters. The raw proposal is exactly at the limit, so only the
  // check on the formatted body refuses it. A preview body over the limit
  // is refused at preview time, so a preview the author sees always applies.
  const head = "Intro.\n\n    code line\n\n";
  const short = await previewBody(
    SYSTEM,
    FILE,
    "SYS_BRK_0001",
    head + "Tail.",
    prose,
  );
  assert(short.ok);
  assert(short.value.body.length > (head + "Tail.").length);
  const filler = "word ".repeat(
    Math.floor((MAX_PROPOSAL_CHARS - head.length) / 5),
  );
  const proposed = (head + filler).padEnd(MAX_PROPOSAL_CHARS, "x");
  assertEquals(proposed.length, MAX_PROPOSAL_CHARS);
  // The same length without the code block is accepted.
  const plain = ("Intro.\n\n" + filler).padEnd(MAX_PROPOSAL_CHARS, "x");
  assertEquals(plain.length, MAX_PROPOSAL_CHARS);
  assert((await previewBody(SYSTEM, FILE, "SYS_BRK_0001", plain, prose)).ok);
  assertEquals(
    await previewBody(SYSTEM, FILE, "SYS_BRK_0001", proposed, prose),
    { ok: false, refusal: "proposal-too-large" },
  );
});
