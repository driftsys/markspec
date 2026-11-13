/**
 * @module formatter/trailer_agreement_test
 *
 * The parser and `markspec fmt` must agree on which lines of an entry are
 * the trailer (#916). For every trailer shape below, the lines that
 * `findAttributeBlockRange` gives the formatter parse to the same
 * attributes the parser read, and `format` keeps the entry's Id and every
 * attribute.
 */

import { assertEquals } from "@std/assert";
import { findAttributeBlockRange, format } from "./mod.ts";
import { parseAttributes } from "../parser/attributes.ts";
import { parseFile } from "../parser/mod.ts";
import type { Entry } from "../model/mod.ts";

const ULID = "01HGW2Q8MNP3RSTVWXYZABCDEF";

/** Entry content below the title line, with the 2-space list indent. */
const SHAPES: Record<string, string> = {
  "canonical indented trailer":
    `  Body.\n\n      Id: ${ULID}\n      Satisfies: SYS_0001`,
  "indented trailer under prose": "  Body.\n      Satisfies: SYS_0001",
  "Id run under prose": `  Body.\n  Id: ${ULID}\n  Satisfies: SYS_0001`,
  "unknown key under prose": "  Body.\n  Status: draft",
  "paragraph of unknown keys": "  Body.\n\n  Rationale: a.\n  Note: b.",
  "paragraph of only profile keys": "  Body.\n\n  Note: a.\n  Assumption: b.",
  "paragraph of core keys": "  Body.\n\n  Satisfies: SYS_0001\n  Labels: L",
  "lone Rationale paragraph": "  Body.\n\n  Rationale: a.",
  "Id paragraph with a profile key":
    `  Body.\n\n  Status: draft\n  Id: ${ULID}`,
  "continuation line": "  Body.\n\n  Satisfies: SYS_0001\\\n    SYS_0002",
  "body-less indented profile keys":
    "      Status: draft\n      Id: urn:example:req-1",
  "body-less indented core keys": `      Id: ${ULID}\n      Labels: L`,
  "mixed space and tab indent": `  Body.\n\n \t  Id: ${ULID}`,
  "indented run below an unindented key line":
    `  Status: draft\n      Id: ${ULID}\n      Satisfies: SYS_0001`,
  "Id trailer with a backslash continuation":
    `  Body.\n\n  Id: ${ULID}\n  Satisfies: A\\\n    B`,
  "canonical trailer with a comma continuation":
    `  Body.\n\n      Id: ${ULID}\n      Satisfies: A,\n        B`,
  "indented Id under prose, then an unindented key":
    `  Body.\n      Id: ${ULID}\n  Status: draft`,
  "core key under prose": "  Body.\n  Satisfies: SYS_0001",
  "prose, unknown key, indented Id":
    `  Body.\n  Status: draft\n      Id: ${ULID}`,
};

function doc(shape: string): string {
  return `- [REQ_0001] Title\n\n${shape}\n`;
}

async function entryOf(text: string): Promise<Entry> {
  const { entries } = await parseFile(text, { file: "a.md" });
  assertEquals(entries.length, 1);
  return entries[0];
}

for (const [name, shape] of Object.entries(SHAPES)) {
  Deno.test(`trailer agreement: ${name}`, async () => {
    const text = doc(shape);
    const entry = await entryOf(text);

    // The formatter's attribute block holds exactly the parsed attributes.
    // `format` expands tab indents before it looks for the block, so a
    // shape with a tab is checked through `format` below only.
    if (!text.includes("\t")) {
      const lines = text.split("\n");
      const range = findAttributeBlockRange(lines, entry.location.line, 2);
      const formatterAttrs = range
        ? parseAttributes(lines.slice(range.start, range.end))
        : [];
      assertEquals(formatterAttrs, [...entry.rawAttributes]);
    }

    // fmt keeps the Id and every attribute, and is idempotent.
    const output = format(text, { file: "a.md" }).output;
    const after = await entryOf(output);
    // Whenever the input holds an `Id:` line, the parser reads it as the
    // entry's Id and fmt keeps it.
    const authoredId = /^\s*Id: (\S+)$/m.exec(text)?.[1];
    if (authoredId !== undefined) {
      assertEquals(entry.id, authoredId);
      assertEquals(after.id, authoredId);
    }
    for (const attr of entry.rawAttributes) {
      assertEquals(
        after.rawAttributes.some((a) =>
          a.key === attr.key && a.value === attr.value
        ),
        true,
        `lost ${attr.key}: ${attr.value}\n${output}`,
      );
    }
    assertEquals(
      after.body.replace(/\s+/g, " "),
      entry.body.replace(/\s+/g, " "),
    );
    assertEquals(format(output, { file: "a.md" }).output, output);
  });
}

Deno.test("fmt: an Id run under prose moves below a blank line with its Id", () => {
  const output = format(doc(SHAPES["Id run under prose"]), { file: "a.md" })
    .output;
  assertEquals(
    output,
    `- [REQ_0001] Title\n\n  Body.\n\n      Id: ${ULID}\n      Satisfies: SYS_0001\n`,
  );
});

Deno.test("fmt: leaves a trailer with a continuation line unchanged", () => {
  for (
    const name of [
      "Id trailer with a backslash continuation",
      "canonical trailer with a comma continuation",
    ]
  ) {
    const text = doc(SHAPES[name]);
    assertEquals(format(text, { file: "a.md" }).output, text, name);
  }
});

Deno.test("fmt: a canonical trailer under prose gets only a blank line", () => {
  const text =
    `- [REQ_0001] Title\n\n  Body.\n      Id: ${ULID}\n      Satisfies: SYS_0001\n`;
  assertEquals(
    format(text, { file: "a.md" }).output,
    `- [REQ_0001] Title\n\n  Body.\n\n      Id: ${ULID}\n      Satisfies: SYS_0001\n`,
  );
});

Deno.test("fmt: an indented trailer under prose gets a blank line above it", () => {
  const output = format(doc(SHAPES["indented trailer under prose"]), {
    file: "a.md",
  }).output;
  assertEquals(output.includes("  Body.\n\n      Id: "), true, output);
  assertEquals(output.includes("      Satisfies: SYS_0001\n"), true, output);
});
