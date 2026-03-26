import { assertEquals, assertStringIncludes } from "@std/assert";
import { markspec } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Story #8 — Markdown entry extraction
// ---------------------------------------------------------------------------

Deno.test("compile: extracts typed entries with display IDs, titles, bodies, and attributes", async () => {
  const input = `# Braking System — Software Requirements

## Sensor Processing

- [SRS_BRK_0001] Sensor input debouncing

  The sensor driver shall debounce raw inputs to eliminate electrical noise
  before processing.

  The debounce window shall be configurable per sensor type.

  > [!WARNING]
  > Failure to debounce may lead to spurious brake activation.

  Id: SRS_01HGW2Q8MNP3\\
  Satisfies: SYS_BRK_0042\\
  Labels: ASIL-B

- [SRS_BRK_0002] Sensor plausibility check

  The sensor driver shall reject readings outside the physically plausible range
  for each sensor type.

  Id: SRS_01HGW2R9QLP4\\
  Satisfies: SYS_BRK_0042\\
  Labels: ASIL-B

- [SRS_BRK_0003] Brake force computation

  The controller shall compute the required brake force from the validated
  sensor inputs.

  Id: SRS_01HGW2S0RMQ5\\
  Satisfies: SYS_BRK_0050\\
  Labels: ASIL-B
`;

  const { code, stdout } = await markspec(
    ["compile", "--format", "json", "requirements.md"],
    { "project.yaml": "name: test-project\n", "requirements.md": input },
  );

  assertEquals(code, 0);
  const result = JSON.parse(stdout);
  assertEquals(result.entries.length, 3);

  // First entry
  assertEquals(result.entries[0].displayId, "SRS_BRK_0001");
  assertEquals(result.entries[0].title, "Sensor input debouncing");
  assertEquals(result.entries[0].id, "SRS_01HGW2Q8MNP3");
  assertEquals(result.entries[0].entryType, "SRS");
  assertStringIncludes(result.entries[0].body, "debounce raw inputs");

  // Second entry
  assertEquals(result.entries[1].displayId, "SRS_BRK_0002");
  assertEquals(result.entries[1].title, "Sensor plausibility check");
  assertEquals(result.entries[1].id, "SRS_01HGW2R9QLP4");

  // Third entry
  assertEquals(result.entries[2].displayId, "SRS_BRK_0003");
  assertEquals(result.entries[2].title, "Brake force computation");
});

Deno.test("compile: extracts reference entries with ID, title, and attributes", async () => {
  const input = `# References

- [ISO-26262-6] ISO 26262 Part 6

  Road vehicles — Functional safety — Part 6: Product development at the
  software level.

  Document: ISO 26262-6:2018\\
  URL: https://www.iso.org/standard/68383.html

- [DO-178C] DO-178C

  Software Considerations in Airborne Systems and Equipment Certification.

  Document: RTCA DO-178C\\
  URL: https://www.rtca.org/products/do-178c/
`;

  const { code, stdout } = await markspec(
    ["compile", "--format", "json", "references.md"],
    { "project.yaml": "name: test-project\n", "references.md": input },
  );

  assertEquals(code, 0);
  const result = JSON.parse(stdout);
  assertEquals(result.entries.length, 2);

  // First reference
  assertEquals(result.entries[0].displayId, "ISO-26262-6");
  assertEquals(result.entries[0].title, "ISO 26262 Part 6");
  assertEquals(result.entries[0].entryType, undefined);
  assertStringIncludes(result.entries[0].body, "Road vehicles");

  // Check attributes
  const doc = result.entries[0].attributes.find(
    (a: { key: string }) => a.key === "Document",
  );
  assertEquals(doc?.value, "ISO 26262-6:2018");

  const url = result.entries[0].attributes.find(
    (a: { key: string }) => a.key === "URL",
  );
  assertEquals(url?.value, "https://www.iso.org/standard/68383.html");

  // Second reference
  assertEquals(result.entries[1].displayId, "DO-178C");
});

Deno.test("compile: preserves source location for entries", async () => {
  const input = `# Requirements

- [SRS_BRK_0001] First entry

  Body text.

  Id: SRS_01HGW2Q8MNP3

- [SRS_BRK_0002] Second entry

  More body text.

  Id: SRS_01HGW2R9QLP4
`;

  const { code, stdout } = await markspec(
    ["compile", "--format", "json", "reqs.md"],
    { "project.yaml": "name: test-project\n", "reqs.md": input },
  );

  assertEquals(code, 0);
  const result = JSON.parse(stdout);
  assertEquals(result.entries.length, 2);

  // First entry starts at line 3
  assertEquals(result.entries[0].location.file, "reqs.md");
  assertEquals(result.entries[0].location.line, 3);

  // Second entry starts at line 9
  assertEquals(result.entries[1].location.file, "reqs.md");
  assertEquals(result.entries[1].location.line, 9);
});

// ---------------------------------------------------------------------------
// Story #9 — Attribute parser
// ---------------------------------------------------------------------------

Deno.test("compile: parses attributes with trailing backslash separators", async () => {
  const input = `# Requirements

- [SRS_BRK_0001] Entry with backslash attributes

  Body.

  Id: SRS_01HGW2Q8MNP3\\
  Satisfies: SYS_BRK_0042\\
  Labels: ASIL-B
`;

  const { code, stdout } = await markspec(
    ["compile", "--format", "json", "reqs.md"],
    { "project.yaml": "name: test-project\n", "reqs.md": input },
  );

  assertEquals(code, 0);
  const result = JSON.parse(stdout);
  const attrs = result.entries[0].attributes;

  assertEquals(attrs.length, 3);
  assertEquals(attrs[0].key, "Id");
  assertEquals(attrs[0].value, "SRS_01HGW2Q8MNP3");
  assertEquals(attrs[1].key, "Satisfies");
  assertEquals(attrs[1].value, "SYS_BRK_0042");
  assertEquals(attrs[2].key, "Labels");
  assertEquals(attrs[2].value, "ASIL-B");
});

Deno.test("compile: parses attributes without trailing backslash (last line)", async () => {
  const input = `# Requirements

- [SRS_BRK_0001] Entry with final attribute no backslash

  Body.

  Id: SRS_01HGW2Q8MNP3
`;

  const { code, stdout } = await markspec(
    ["compile", "--format", "json", "reqs.md"],
    { "project.yaml": "name: test-project\n", "reqs.md": input },
  );

  assertEquals(code, 0);
  const result = JSON.parse(stdout);
  const attrs = result.entries[0].attributes;

  assertEquals(attrs.length, 1);
  assertEquals(attrs[0].key, "Id");
  assertEquals(attrs[0].value, "SRS_01HGW2Q8MNP3");
});

Deno.test("compile: Key: Value in middle of body is not an attribute", async () => {
  const input = `# Requirements

- [SRS_BRK_0001] Entry with inline key-value

  The system uses Key: Value pairs in configuration files.
  This is body text, not an attribute.

  Id: SRS_01HGW2Q8MNP3
`;

  const { code, stdout } = await markspec(
    ["compile", "--format", "json", "reqs.md"],
    { "project.yaml": "name: test-project\n", "reqs.md": input },
  );

  assertEquals(code, 0);
  const result = JSON.parse(stdout);
  const entry = result.entries[0];

  // Only the trailing "Id:" is an attribute, not the "Key: Value" in the body
  assertEquals(entry.attributes.length, 1);
  assertEquals(entry.attributes[0].key, "Id");
  assertStringIncludes(entry.body, "Key: Value pairs");
});
