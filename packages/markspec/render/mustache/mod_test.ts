/**
 * @module render/mustache_test
 *
 * Unit tests for mustache variable preprocessing.
 */

import { assertEquals } from "@std/assert";
import type { MustacheContext } from "./mod.ts";
import { resolveMustache } from "./mod.ts";
import type { CompileResult, Entry, ProjectConfig } from "../../core/mod.ts";
import type { CaptionRegistry } from "../captions/mod.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a minimal ProjectConfig for testing. */
function makeConfig(
  overrides: Partial<ProjectConfig> = {},
): ProjectConfig {
  return {
    name: "io.driftsys.markspec",
    version: "0.2.0",
    labels: [],
    parents: [],
    parentFallback: "",
    ...overrides,
  };
}

/** Build a minimal Entry for testing. */
function makeEntry(displayId: string): Entry {
  return {
    displayId,
    title: `Title for ${displayId}`,
    body: "",
    attributes: [],
    id: undefined,
    entryType: displayId.split("_")[0],
    location: { file: "test.md", line: 1, column: 1 },
    source: "markdown",
  };
}

/** Build a minimal CompileResult with the given entries. */
function makeCompiled(entries: Entry[]): CompileResult {
  const map = new Map(entries.map((e) => [e.displayId, e]));
  return {
    entries: map,
    links: [],
    forward: new Map(),
    reverse: new Map(),
    diagnostics: [],
  };
}

/** Build a CaptionRegistry from simple test data. */
function makeCaptions(
  entries: Array<{
    kind: "figure" | "table";
    slug: string;
    text: string;
    label: string;
  }>,
): CaptionRegistry {
  const map = new Map();
  for (const entry of entries) {
    map.set(entry.slug, {
      caption: {
        kind: entry.kind,
        slug: entry.slug,
        text: entry.text,
        location: { file: "test.md", line: 1, column: 1 },
      },
      chapter: 1,
      sequence: 1,
      label: entry.label,
    });
  }
  return { captions: map };
}

/** Build a default MustacheContext for testing. */
function makeContext(
  overrides: Partial<MustacheContext> = {},
): MustacheContext {
  return {
    compiled: makeCompiled([]),
    config: makeConfig(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Project namespace
// ---------------------------------------------------------------------------

Deno.test("resolveMustache: {{project.name}} resolves to config name", () => {
  const ctx = makeContext({
    config: makeConfig({ name: "io.driftsys.markspec" }),
  });
  const result = resolveMustache("Project: {{project.name}}", ctx);
  assertEquals(result.output, "Project: io.driftsys.markspec");
  assertEquals(result.diagnostics.length, 0);
});

Deno.test("resolveMustache: {{project.version}} resolves to config version", () => {
  const ctx = makeContext({
    config: makeConfig({ version: "1.3.0" }),
  });
  const result = resolveMustache("Version {{project.version}}", ctx);
  assertEquals(result.output, "Version 1.3.0");
  assertEquals(result.diagnostics.length, 0);
});

Deno.test("resolveMustache: {{project.unknown}} produces diagnostic, left unchanged", () => {
  const ctx = makeContext();
  const result = resolveMustache(
    "Value: {{project.unknown}}",
    ctx,
  );
  assertEquals(result.output, "Value: {{project.unknown}}");
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].severity, "error");
  assertEquals(result.diagnostics[0].code, "MSR-E001");
});

// ---------------------------------------------------------------------------
// Requirement namespace
// ---------------------------------------------------------------------------

Deno.test("resolveMustache: {{req.SRS_BRK_0001}} resolves to markdown link", () => {
  const entry = makeEntry("SRS_BRK_0001");
  const ctx = makeContext({
    compiled: makeCompiled([entry]),
  });
  const result = resolveMustache(
    "See {{req.SRS_BRK_0001}} for details.",
    ctx,
  );
  assertEquals(
    result.output,
    "See [SRS_BRK_0001](#srs_brk_0001) for details.",
  );
  assertEquals(result.diagnostics.length, 0);
});

Deno.test("resolveMustache: req lookup is case-insensitive", () => {
  const entry = makeEntry("SRS_BRK_0001");
  const ctx = makeContext({
    compiled: makeCompiled([entry]),
  });
  const result = resolveMustache("See {{req.srs_brk_0001}}", ctx);
  assertEquals(result.output, "See [SRS_BRK_0001](#srs_brk_0001)");
  assertEquals(result.diagnostics.length, 0);
});

Deno.test("resolveMustache: {{req.NONEXISTENT}} produces diagnostic, left unchanged", () => {
  const ctx = makeContext({
    compiled: makeCompiled([]),
  });
  const result = resolveMustache(
    "See {{req.NONEXISTENT}} here.",
    ctx,
  );
  assertEquals(result.output, "See {{req.NONEXISTENT}} here.");
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].severity, "error");
});

// ---------------------------------------------------------------------------
// Caption namespaces
// ---------------------------------------------------------------------------

Deno.test("resolveMustache: {{fig.sensor-layout}} resolves to figure label", () => {
  const captions = makeCaptions([
    {
      kind: "figure",
      slug: "sensor-layout",
      text: "Sensor layout",
      label: "Figure 3.2",
    },
  ]);
  const ctx = makeContext({ captions });
  const result = resolveMustache(
    "See {{fig.sensor-layout}} for details.",
    ctx,
  );
  assertEquals(result.output, "See Figure 3.2 for details.");
  assertEquals(result.diagnostics.length, 0);
});

Deno.test("resolveMustache: {{tbl.thresholds}} resolves to table label", () => {
  const captions = makeCaptions([
    {
      kind: "table",
      slug: "thresholds",
      text: "Thresholds",
      label: "Table 1.1",
    },
  ]);
  const ctx = makeContext({ captions });
  const result = resolveMustache(
    "See {{tbl.thresholds}} for values.",
    ctx,
  );
  assertEquals(result.output, "See Table 1.1 for values.");
  assertEquals(result.diagnostics.length, 0);
});

Deno.test("resolveMustache: fig ref without captions registry produces diagnostic", () => {
  const ctx = makeContext();
  const result = resolveMustache("See {{fig.missing}}", ctx);
  assertEquals(result.output, "See {{fig.missing}}");
  assertEquals(result.diagnostics.length, 1);
});

// ---------------------------------------------------------------------------
// Code block exclusion
// ---------------------------------------------------------------------------

Deno.test("resolveMustache: refs inside fenced code blocks are NOT resolved", () => {
  const ctx = makeContext({
    config: makeConfig({ name: "test-project" }),
  });
  const md = `# Example

\`\`\`markdown
{{project.name}}
\`\`\`

After code.
`;
  const result = resolveMustache(md, ctx);
  assertEquals(result.output, md);
  assertEquals(result.diagnostics.length, 0);
});

Deno.test("resolveMustache: refs inside inline code are NOT resolved", () => {
  const ctx = makeContext({
    config: makeConfig({ name: "test-project" }),
  });
  const md = "Use `{{project.name}}` in your config.";
  const result = resolveMustache(md, ctx);
  assertEquals(result.output, md);
  assertEquals(result.diagnostics.length, 0);
});

Deno.test("resolveMustache: refs inside tilde fenced code blocks are NOT resolved", () => {
  const ctx = makeContext({
    config: makeConfig({ name: "test-project" }),
  });
  const md = `# Example

~~~yaml
key: {{project.name}}
~~~

After code.
`;
  const result = resolveMustache(md, ctx);
  assertEquals(result.output, md);
  assertEquals(result.diagnostics.length, 0);
});

// ---------------------------------------------------------------------------
// Multiple refs
// ---------------------------------------------------------------------------

Deno.test("resolveMustache: multiple refs on one line all resolve", () => {
  const entries = [makeEntry("SRS_BRK_0001"), makeEntry("SRS_BRK_0002")];
  const ctx = makeContext({
    config: makeConfig({ name: "demo", version: "1.0.0" }),
    compiled: makeCompiled(entries),
  });
  const md =
    "Project {{project.name}} v{{project.version}}: {{req.SRS_BRK_0001}} and {{req.SRS_BRK_0002}}.";
  const result = resolveMustache(md, ctx);
  assertEquals(
    result.output,
    "Project demo v1.0.0: [SRS_BRK_0001](#srs_brk_0001) and [SRS_BRK_0002](#srs_brk_0002).",
  );
  assertEquals(result.diagnostics.length, 0);
});

// ---------------------------------------------------------------------------
// No refs
// ---------------------------------------------------------------------------

Deno.test("resolveMustache: no refs returns input unchanged", () => {
  const ctx = makeContext();
  const md = "This is plain markdown without any references.";
  const result = resolveMustache(md, ctx);
  assertEquals(result.output, md);
  assertEquals(result.diagnostics.length, 0);
});

// ---------------------------------------------------------------------------
// Unknown namespace
// ---------------------------------------------------------------------------

Deno.test("resolveMustache: unknown namespace produces diagnostic", () => {
  const ctx = makeContext();
  const result = resolveMustache("See {{xyz.something}} here.", ctx);
  assertEquals(result.output, "See {{xyz.something}} here.");
  assertEquals(result.diagnostics.length, 1);
  assertEquals(result.diagnostics[0].code, "MSR-E001");
});
