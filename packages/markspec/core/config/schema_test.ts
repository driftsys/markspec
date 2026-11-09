import { assertEquals } from "@std/assert";
import { Ajv } from "ajv";
import { fullFormats } from "ajv-formats/dist/formats.js";
import { ALLOWED_MARKSPEC_YAML_KEYS, parseMarkspecYaml } from "./markspec.ts";
import { parse as parseYaml } from "@std/yaml";
import { ConfigError } from "../model/mod.ts";
import { parseProjectConfig } from "./mod.ts";

const MARKSPEC_SCHEMA_URL = new URL(
  "../../../../schemas/markspec/v1.json",
  import.meta.url,
);

async function loadMarkspecSchema(): Promise<Record<string, unknown>> {
  return JSON.parse(await Deno.readTextFile(MARKSPEC_SCHEMA_URL));
}

Deno.test("markspec.yaml: $schema key emits no unknown-key warning", () => {
  const yaml = [
    "$schema: https://driftsys.github.io/markspec/schemas/markspec/v1.json",
    "profiles:",
    "  - io.example.demo@1.0.0",
  ].join("\n");
  const { diagnostics } = parseMarkspecYaml(yaml, ".markspec.yaml");
  assertEquals(diagnostics.filter((d) => d.code === "MARKSPEC-YAML-001"), []);
});

Deno.test("markspec schema: $id is the canonical URL", async () => {
  const schema = await loadMarkspecSchema();
  assertEquals(
    schema.$id,
    "https://driftsys.github.io/markspec/schemas/markspec/v1.json",
  );
});

Deno.test("markspec schema: keys match parser (minus $schema)", async () => {
  const schema = await loadMarkspecSchema();
  const keys = new Set(
    Object.keys((schema.properties ?? {}) as Record<string, unknown>),
  );
  keys.delete("$schema");
  assertEquals(
    [...keys].sort(),
    [...ALLOWED_MARKSPEC_YAML_KEYS].filter((k) => k !== "$schema").sort(),
  );
});

Deno.test("markspec schema: exclude accepts null or an array of non-empty strings", async () => {
  const schema = await loadMarkspecSchema();
  const validate = new Ajv().compile(schema);
  for (
    const { exclude, valid } of [
      { exclude: [], valid: true },
      { exclude: ["a", "*"], valid: true },
      { exclude: ["skills/", "*.gen.md", "!target/"], valid: true },
      { exclude: "skills/", valid: false },
      { exclude: [123], valid: false },
      { exclude: [""], valid: false },
      { exclude: ["skills/", ""], valid: false },
    ]
  ) {
    assertEquals(validate({ exclude }), valid, JSON.stringify({ exclude }));
  }
});

Deno.test("markspec schema and loader: profile specifier parity", async (t) => {
  const validate = new Ajv().compile(await loadMarkspecSchema());
  for (
    const [specifier, valid] of [
      ["./", true],
      ["../profiles/demo.yaml", true],
      ["git+https://example.com/demo.git#v1", true],
      ["git+https://example.com/demo#v1", false],
      ["git+http://example.com/demo.git/sub/path#main", true],
      ["git+file:///tmp/demo.git#main", true],
      ["npm:demo@1.0.0", true],
      ["npm:@acme/demo@^1", true],
      ["", false],
      ["demo", false],
      ["/profiles/demo.yaml", false],
      [".hidden/profile", false],
      ["git+invalid", false],
      ["git+https://example.com/demo.git", false],
      ["git+https://example.com/demo.git#", false],
      ["git+ssh://example.com/demo.git#v1", false],
      ["npm:demo", false],
      ["npm:demo@", false],
      ["npm:@Acme/demo@1", false],
      ["npm:demo_name@1", false],
      [123, false],
      [null, false],
    ] as const
  ) {
    await t.step(JSON.stringify(specifier), () => {
      const input = { profiles: [specifier] };
      const result = parseMarkspecYaml(JSON.stringify(input), ".markspec.yaml");
      assertEquals(validate(input), valid, "schema acceptance");
      assertEquals(result.config !== null, valid, "loader acceptance");
    });
  }
});

Deno.test("markspec schema and loader: empty tool config parity", async (t) => {
  const validate = new Ajv().compile(await loadMarkspecSchema());
  for (
    const yaml of [
      "{}",
      "exclude:",
      "exclude: null",
      "exclude: []",
      "caption-conventions:",
      "caption-conventions: null",
      "caption-conventions: {}",
      "exclude:\ncaption-conventions:",
    ]
  ) {
    await t.step(yaml, () => {
      const result = parseMarkspecYaml(yaml, ".markspec.yaml");
      assertEquals(validate(parseYaml(yaml)), true, "schema acceptance");
      assertEquals(result.config?.exclude, []);
      assertEquals(result.config?.captionConventions, {});
    });
  }
});

Deno.test("markspec schema and loader: tool config value parity", async (t) => {
  const validate = new Ajv().compile(await loadMarkspecSchema());
  for (
    const [input, valid] of [
      [{ profiles: [] }, true],
      [{ profiles: null }, false],
      [{ profiles: "./demo" }, false],
      [{ exclude: ["docs/", "!docs/keep.md"] }, true],
      [{ exclude: "docs/" }, false],
      [{ exclude: [""] }, false],
      [{ exclude: [123] }, false],
      [{ "caption-conventions": { Figure: "above", Table: "below" } }, true],
      [{ "caption-conventions": [] }, false],
      [{ "caption-conventions": "above" }, false],
      [{ "caption-conventions": { Figure: null } }, false],
      [{ "caption-conventions": { Figure: "before" } }, false],
      [{ "caption-conventions": { Unknown: "above" } }, false],
    ] as const
  ) {
    await t.step(JSON.stringify(input), () => {
      const result = parseMarkspecYaml(JSON.stringify(input), ".markspec.yaml");
      assertEquals(validate(input), valid, "schema acceptance");
      assertEquals(result.config !== null, valid, "loader acceptance");
    });
  }
});

Deno.test("project schema and loader: reference list parity", async (t) => {
  const schema = JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../../tests/fixtures/config/project-schema-fields.json",
        import.meta.url,
      ),
    ),
  );
  const validate = new Ajv().addFormat("uri", fullFormats.uri).compile(schema);
  const ref = {
    url: "https://example.com/demo",
    name: "demo",
    version: "main",
  };
  for (const field of ["dependencies", "references"]) {
    for (
      const [value, valid] of [
        [undefined, true],
        [[ref], true],
        [[], false],
        [null, false],
        [[ref, { version: "main", name: "demo", url: ref.url }], false],
        [[ref, { ...ref, version: "v1" }], true],
        [[ref, { ...ref, url: "https://example.com/other" }], true],
        [[ref, { ...ref, name: "other" }], true],
        [[{ url: ref.url }, { url: ref.url }], false],
        [[{ url: ref.url, name: "a" }, { url: ref.url, name: "a" }], false],
        [
          [{ url: ref.url, version: "a" }, { url: ref.url, version: "a" }],
          false,
        ],
        [[ref, { url: "https://example.com/other" }, ref], false],
        [[{ ...ref, version: "" }], true],
        [[{ ...ref, url: "not-a-url" }], false],
        [[{ ...ref, url: "https://example.com/bad path" }], false],
        [[{ ...ref, url: "https://example.com/%zz" }], false],
        [[{ ...ref, url: "https://user@example.com:443/%zz" }], false],
        [[{ ...ref, url: "git@host/path:repo" }], false],
        [[{ ...ref, url: "git@example.com:bad path/demo.git" }], false],
        [[{ ...ref, url: "C:\\repo" }], false],
        [[{ ...ref, url: "C:/repo" }], true],
        [[{ ...ref, url: "urn:example:demo" }], true],
        [[{ ...ref, url: "file:///tmp/demo" }], true],
        [[{ ...ref, url: "ssh://git@example.com/demo.git" }], true],
        [[{ ...ref, version: null }], false],
        [[{ ...ref, version: 1 }], false],
        [[{ ...ref, name: null }], false],
        [[{ ...ref, name: 1 }], false],
        ...(field === "references"
          ? [
            [[{ url: "../demo" }], false],
            [[{ url: "git@github.com:acme/demo.git" }], false],
          ] as const
          : []),
        ["invalid", false],
        [[null], false],
        [[{}], false],
      ] as const
    ) {
      await t.step(`${field}: ${JSON.stringify(value)}`, () => {
        const input = { name: "demo", version: "1.0.0", [field]: value };
        let accepted = true;
        try {
          parseProjectConfig(JSON.stringify(input), "project.yaml");
        } catch (error) {
          if (!(error instanceof ConfigError)) throw error;
          accepted = false;
          assertEquals(
            error.fieldErrors.some((e) => e.field.startsWith(field)),
            true,
          );
        }
        assertEquals(validate(input), valid, "schema acceptance");
        assertEquals(accepted, valid, "loader acceptance");
      });
    }
  }
});

Deno.test("projectRef: empty version is preserved", () => {
  for (const field of ["dependencies", "references"] as const) {
    const config = parseProjectConfig(
      JSON.stringify({
        name: "demo",
        version: "1.0.0",
        [field]: [{ url: "https://example.com/demo", version: "" }],
      }),
      "project.yaml",
    );
    assertEquals(config[field][0].version, "");
  }
});

Deno.test("project schema and loader: version type parity", async (t) => {
  const schema = JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../../tests/fixtures/config/project-schema-fields.json",
        import.meta.url,
      ),
    ),
  );
  const validate = new Ajv().addFormat("uri", fullFormats.uri).compile(schema);
  for (
    const [version, valid] of [
      ["1.0.0", true],
      ["main", true],
      [undefined, false],
      [null, false],
      [true, false],
      [[], false],
      [{}, false],
      [{ toString: null }, false],
    ] as const
  ) {
    await t.step(JSON.stringify(version) ?? "absent", () => {
      const input: Record<string, unknown> = { name: "demo", version };
      let accepted = true;
      try {
        parseProjectConfig(JSON.stringify(input), "project.yaml");
      } catch (error) {
        if (!(error instanceof ConfigError)) throw error;
        accepted = false;
        assertEquals(
          error.fieldErrors.some((e) => e.field === "version"),
          true,
        );
      }
      assertEquals(validate(input), valid, "schema acceptance");
      assertEquals(accepted, valid, "loader acceptance");
    });
  }
});

Deno.test("project schema and loader: documented behavior exceptions", async (t) => {
  const schema = JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../../tests/fixtures/config/project-schema-fields.json",
        import.meta.url,
      ),
    ),
  );
  const validate = new Ajv().addFormat("uri", fullFormats.uri).compile(schema);
  // These differences preserve loader behavior documented in docs/guide/cli.md.
  // Keep them explicit so the parity tests cannot hide a new disagreement.
  const exceptions: {
    description: string;
    input: Record<string, unknown>;
    schemaAccepted: boolean;
    loaderAccepted: boolean;
  }[] = [
    {
      description: "empty project version remains invalid",
      input: { name: "demo", version: "" },
      schemaAccepted: true,
      loaderAccepted: false,
    },
    {
      description: "numeric project version retains coercion and a warning",
      input: { name: "demo", version: 1 },
      schemaAccepted: false,
      loaderAccepted: true,
    },
  ];
  for (const field of ["dependencies", "references"]) {
    exceptions.push({
      description: `${field}: unsafe cache directory name remains invalid`,
      input: {
        name: "demo",
        version: "1.0.0",
        [field]: [{ url: "https://example.com/demo", name: "../bad" }],
      },
      schemaAccepted: true,
      loaderAccepted: false,
    });
  }
  for (
    const url of [
      "../demo",
      "./demo",
      "/tmp/demo",
      "git@github.com:acme/demo.git",
    ]
  ) {
    exceptions.push({
      description: `dependencies: Git location ${url} remains valid`,
      input: { name: "demo", version: "1.0.0", dependencies: [{ url }] },
      schemaAccepted: false,
      loaderAccepted: true,
    });
  }
  for (const exception of exceptions) {
    await t.step(exception.description, () => {
      let accepted = true;
      const warnings: string[] = [];
      const originalError = console.error;
      console.error = (message: string) => warnings.push(message);
      try {
        const config = parseProjectConfig(
          JSON.stringify(exception.input),
          "project.yaml",
        );
        if (typeof exception.input.version === "number") {
          assertEquals(config.version, "1");
          assertEquals(warnings.length, 1);
        }
      } catch (error) {
        if (!(error instanceof ConfigError)) throw error;
        accepted = false;
      } finally {
        console.error = originalError;
      }
      assertEquals(
        validate(exception.input),
        exception.schemaAccepted,
        "schema acceptance",
      );
      assertEquals(
        accepted,
        exception.loaderAccepted,
        "documented loader exception",
      );
    });
  }
});
