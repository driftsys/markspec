import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import {
  type Diagnostic,
  loadMarkdownFormatter,
  type ProseFormatter,
  readEntryBody,
  replaceEntryBody,
} from "../core/mod.ts";
import {
  applyBody,
  isTargetF900,
  MAX_PROPOSAL_CHARS,
  previewBody,
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
  const atLimit = "a ".repeat(MAX_PROPOSAL_CHARS / 2);
  assertEquals(atLimit.length, MAX_PROPOSAL_CHARS);
  const r = await previewBody(SYSTEM, FILE, "SYS_BRK_0001", atLimit, prose);
  assert(r.ok || r.refusal !== "proposal-too-large");
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
  assertEquals(
    await applyBody(SYSTEM, FILE, "SYS_BRK_0001", "", prose),
    { ok: false, refusal: "proposal-empty" },
  );
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
