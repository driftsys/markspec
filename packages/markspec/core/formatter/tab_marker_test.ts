import { assertEquals, assertStringIncludes } from "@std/assert";
import { parseMarkdown } from "../parser/markdown.ts";
import { loadMarkdownFormatter } from "./dprint.ts";
import { markdownSemanticallyEquivalent } from "./md_equiv.ts";
import { format } from "./mod.ts";

const ID = "01HGW2Q8MNP3RSTVWXYZABCDEF";
const options = { file: "test.md", generateUlid: () => ID };

Deno.test("tab marker: normalizes and stamps without moving body or trailer", () => {
  const input = "-\t[REQ-001] Title\n\n    Body.\n\n        Labels: DRAFT\n";
  const result = format(input, options);
  const expected =
    `- [REQ-001] Title\n\n  Body.\n\n      Id: ${ID}\n      Labels: DRAFT\n`;
  assertEquals(result.output, expected);
  const { entries } = parseMarkdown(result.output);
  assertEquals(entries.length, 1);
  assertEquals(entries[0].body, "Body.");
  assertEquals(entries[0].id, ID);
  assertEquals(entries[0].rawAttributes.map((a) => a.key), ["Id", "Labels"]);
});

Deno.test("tab marker: adjacent entries retain both bodies and identities", () => {
  const input = "-\t[REQ-001] First\n\n    First body.\n\n" +
    "-\t[REQ-002] Second\n\n    Second body.\n";
  let calls = 0;
  const result = format(input, {
    ...options,
    generateUlid: () => ID.slice(0, -1) + calls++,
  });
  assertEquals(result.output.includes("\t"), false);
  const { entries } = parseMarkdown(result.output);
  assertEquals(entries.map((e) => [e.displayId, e.body, !!e.id]), [
    ["REQ-001", "First body.", true],
    ["REQ-002", "Second body.", true],
  ]);
  assertEquals(new Set(entries.map((e) => e.id)).size, 2);
});

Deno.test("tab marker: nested entry keeps the enclosing list hierarchy", async () => {
  const input =
    "- Parent\n\n  -\t[REQ-001] Nested\n\n    Body.\n\n        Labels: DRAFT\n\n- Sibling\n";
  const result = format(input, {
    ...options,
    formatMarkdownProse: await loadMarkdownFormatter(),
  });
  const expected =
    `- Parent\n\n  - [REQ-001] Nested\n\n    Body.\n\n        Id: ${ID}\n        Labels: DRAFT\n\n- Sibling\n`;
  assertEquals(result.output.includes("\t"), false);
  assertEquals(markdownSemanticallyEquivalent(result.output, expected), true);
  assertStringIncludes(result.output, `Id: ${ID}`);
});

Deno.test("tab marker: nested tab normalization keeps enclosing entry extents valid", () => {
  const input = "-\t[REQ-001] Outer\n\n    Body.\n\n" +
    "    -\t[REQ-002] Inner\n\n        Inner body.\n";
  const result = format(input, options);
  assertEquals(result.output.includes("\t"), false);
  assertEquals(
    result.output,
    `- [REQ-001] Outer\n\n  Body.\n\n  - [REQ-002] Inner\n\n    Inner body.\n\n      Id: ${ID}\n`,
  );
  assertEquals(result.diagnostics.some((d) => d.code === "MSL-F013"), false);
  assertEquals(format(result.output, options).output, result.output);
});

Deno.test("tab marker: unsafe normalization preserves bytes and does not stamp", async () => {
  // The two-space child is a sibling of the four-column tab item. Replacing
  // the tab would put it inside the entry, changing the list hierarchy.
  const refused = "*\t[REQ-001] Unsafe\n\n    Body SHALL stay.\n\n\n";
  const input = refused +
    "  - child\n\n- [REQ-002] Safe\n\n  Body SHALL change.\n";
  const result = format(input, {
    ...options,
    formatMarkdownProse: await loadMarkdownFormatter(),
  });
  assertEquals(result.output.slice(0, refused.length), refused);
  const { entries } = parseMarkdown(result.output);
  assertEquals(entries.map((e) => [e.displayId, !!e.id]), [["REQ-001", false], [
    "REQ-002",
    true,
  ]]);
  assertEquals(entries[1].body, "Body shall change.");
  assertEquals(
    result.diagnostics.filter((d) => d.code === "MSL-F013").map((
      d,
    ) => [d.severity, d.location?.line]),
    [["warning", 1]],
  );
  assertEquals(
    result.diagnostics.some((d) =>
      d.code === "MSL-F001" && d.message.includes("REQ-001")
    ),
    false,
  );
  assertStringIncludes(result.output, "  - child");
});

Deno.test("tab marker: unsafe entry retains its existing Id and trailer", () => {
  const refused =
    `-\t[REQ-001] Unsafe\n\n    Body.\n\n        Labels: DRAFT\n        Id: ${ID}\n`;
  const input = refused + "\n  - child\n";
  const result = format(input, options);
  assertEquals(result.output, input);
  assertEquals(result.changed, false);
  assertEquals(parseMarkdown(result.output).entries[0].id, ID);
  assertEquals(
    result.diagnostics.filter((d) => d.code === "MSL-F013").length,
    1,
  );
});

Deno.test("tab marker: accepted and refused entries are idempotent", async () => {
  const prose = await loadMarkdownFormatter();
  for (
    const input of [
      "-\t[REQ-001] First\n\n    Body.\n\n-\t[REQ-002] Second\n\n    Body.\n",
      "-\t[REQ-001] Unsafe\n\n    Body.\n\n\n  - child\n\n- [REQ-002] Safe\n\n  Body.\n",
      "- Parent\n\n  -\t[REQ-001] Nested\n\n    Body.\n",
    ]
  ) {
    const first = format(input, { ...options, formatMarkdownProse: prose });
    const second = format(first.output, {
      ...options,
      formatMarkdownProse: prose,
    });
    assertEquals(second.output, first.output);
    assertEquals(second.changed, false);
    assertEquals(second.diagnostics.some((d) => d.code === "MSL-F001"), false);
  }
});

for (
  const { name, input, locations } of [
    {
      name: "paragraph outside the entry",
      input: "# T\n\n-\t[REQ-001] Title one\n\n  The system shall do X.\n",
      locations: [[3, 1]],
    },
    {
      name: "adjacent refused entries",
      input: "# T\n\n-\t[REQ-001] Title one\n\n  The system shall do X.\n\n" +
        "-\t[REQ-002] Title two\n\n  The system shall do Y.\n",
      locations: [[7, 1], [3, 1]],
    },
    {
      name: "nested list outside the entry",
      input:
        "-\t[REQ-001] Title one\n\n  - child\n\n  The system shall do X.\n",
      locations: [[1, 1]],
    },
    {
      name: "refused entry inside a nested list",
      input:
        "- Parent\n\n    -\t[REQ-001] Title one\n\n      The system shall do X.\n",
      locations: [[3, 5]],
    },
    {
      name: "multiple outside paragraphs with a lazy continuation",
      input:
        "-\t[REQ-001] Title one\n\n  First paragraph.\nContinued.\n\n  Second paragraph.\n",
      locations: [[1, 1]],
    },
  ]
) {
  Deno.test(`tab marker: refusal stays unchanged twice with ${name}`, async () => {
    const formatOptions = {
      ...options,
      formatMarkdownProse: await loadMarkdownFormatter(),
    };
    const first = format(input, formatOptions);
    const second = format(first.output, formatOptions);
    for (const result of [first, second]) {
      assertEquals(
        result.diagnostics.map((
          d,
        ) => [d.code, d.severity, d.location?.line, d.location?.column]),
        locations.map((
          [line, column],
        ) => ["MSL-F013", "warning", line, column]),
      );
      assertEquals(result.output, input);
      assertEquals(result.changed, false);
    }
  });
}
