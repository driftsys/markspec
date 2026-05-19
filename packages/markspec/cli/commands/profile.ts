/**
 * @module cli/commands/profile
 *
 * `markspec profile` command group — show, new, publish, add, describe.
 */

import { Command } from "@cliffy/command";
import type { ProfileElementKind } from "../../core/mod.ts";
import {
  loadActiveProfile,
  readFile,
  requireProjectConfig,
} from "../helpers.ts";

export const profileCmd = new Command()
  .description("Profile management")
  .command("show")
  .description("Show the active profile chain")
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .action(async (options: { format?: string }) => {
    const { config: _config, projectRoot } = await requireProjectConfig();
    const chain = await loadActiveProfile(projectRoot);
    const { buildProfileIntrospection } = await import("../../core/mod.ts");
    const intro = buildProfileIntrospection(chain);
    const overview = intro.overview();

    if (options.format === "json") {
      console.log(JSON.stringify(overview, null, 2));
    } else {
      if (!chain) {
        console.error("no profile configured for this project");
      } else {
        const active = overview.tiers[0];
        console.log(`Active profile: ${active.id}@${active.version}`);
        if (active.summary && active.summary !== active.id) {
          console.log(active.summary);
        }
        console.log("");

        const groups: Array<
          { label: string; kind: string }
        > = [
          { label: "Entry types", kind: "type" },
          { label: "Attributes", kind: "attribute" },
          { label: "Relations", kind: "relation" },
          { label: "Label concerns", kind: "label-concern" },
          { label: "Conventions", kind: "convention" },
        ];
        for (const { label, kind } of groups) {
          const items = overview.elements.filter((e) => e.kind === kind);
          if (items.length === 0) continue;
          console.log(`${label} (${items.length}):`);
          for (const item of items) {
            console.log(`  - ${item.name}: ${item.summary}`);
          }
          console.log("");
        }
      }
    }
  })
  .command("new <id:string>")
  .description("Scaffold a new profile directory")
  .option("--dir <dir:string>", "Override output directory")
  .action(async (options: { dir?: string }, id: string) => {
    const PROFILE_ID_RE = /^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9-]*$/;
    if (!PROFILE_ID_RE.test(id)) {
      console.error(
        `error: invalid profile id '${id}'\n` +
          "  expected: lowercase alphanumeric with hyphens, optional @scope/ prefix\n" +
          "  examples: my-profile, @org/my-profile",
      );
      Deno.exit(1);
    }

    const dirName = id.includes("/") ? id.split("/")[1] : id;
    const targetDir = options.dir ?? `./${dirName}`;

    try {
      await Deno.stat(targetDir);
      console.error(`error: directory '${targetDir}' already exists`);
      Deno.exit(1);
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }

    await Deno.mkdir(targetDir, { recursive: true });

    const manifest = `id: "${id}"
version: 0.1.0
description: ""
# license: MIT
# extends: "./path/to/parent"

profile:
  # Universal scope
  attributes: []
  labels: []

  # Per-type scope (use extends: to link to a core type, e.g. extends: Requirement)
  types: {}

  # Document scope
  documents:
    types: []
    frontMatter: []
`;

    const readme = `# ${id}\n\nA MarkSpec profile.\n`;

    await Deno.writeTextFile(`${targetDir}/markspec.yaml`, manifest);
    await Deno.writeTextFile(`${targetDir}/README.md`, readme);

    console.error(`created profile at ${targetDir}/`);
  })
  .command("publish")
  .description("Validate a profile manifest for publishability")
  .option("--dry-run", "Validate only (default)", { default: true })
  .option("--dir <dir:string>", "Profile directory", { default: "." })
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .action(
    async (options: { dryRun?: boolean; dir?: string; format?: string }) => {
      const { parseManifest } = await import("../../core/mod.ts");
      const dir = options.dir ?? ".";
      const manifestPath = `${dir}/markspec.yaml`;

      let rawYaml: string;
      try {
        rawYaml = await Deno.readTextFile(manifestPath);
      } catch {
        console.error(`error: no markspec.yaml found at ${manifestPath}`);
        Deno.exit(1);
      }

      const result = parseManifest(rawYaml, manifestPath);
      const diagnostics = [...result.diagnostics];

      if (result.manifest) {
        if (!result.manifest.description) {
          diagnostics.push({
            code: "PROFILE-PUB-001",
            severity: "warning",
            message:
              "profile is missing 'description' (recommended for publishing)",
            location: { file: manifestPath, line: 1, column: 1 },
          });
        }
        if (!result.manifest.license) {
          diagnostics.push({
            code: "PROFILE-PUB-002",
            severity: "warning",
            message:
              "profile is missing 'license' (recommended for publishing)",
            location: { file: manifestPath, line: 1, column: 1 },
          });
        }
      }

      const hasErrors = diagnostics.some((d) => d.severity === "error");

      if (options.format === "json") {
        const output = {
          valid: !hasErrors,
          profile: result.manifest
            ? { id: result.manifest.id, version: result.manifest.version }
            : null,
          diagnostics: diagnostics.map((d) => ({
            severity: d.severity,
            code: d.code,
            message: d.message,
          })),
        };
        console.log(JSON.stringify(output, null, 2));
      } else {
        for (const diag of diagnostics) {
          console.error(`${diag.severity}[${diag.code}]: ${diag.message}`);
        }
        if (!hasErrors) {
          console.error(
            result.manifest
              ? `✓ ${result.manifest.id}@${result.manifest.version} is valid for publishing`
              : "✓ profile is valid",
          );
        }
      }

      Deno.exit(hasErrors ? 1 : 0);
    },
  )
  .command("add <spec:string>")
  .description("Add a profile to the project")
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .action(async (options: { format?: string }, spec: string) => {
    const { config: _config, projectRoot } = await requireProjectConfig();

    // Parse the specifier string to validate format.
    const { parseMarkspecYaml } = await import("../../core/mod.ts");
    const testYaml = `profiles:\n  - "${spec}"\n`;
    const parseResult = parseMarkspecYaml(testYaml, "<cli>");

    if (!parseResult.config || parseResult.config.profiles.length === 0) {
      for (const diag of parseResult.diagnostics) {
        console.error(`${diag.severity}[${diag.code}]: ${diag.message}`);
      }
      Deno.exit(1);
    }

    const specifier = parseResult.config.profiles[0];

    // For local specifiers, validate the profile exists by attempting load.
    if (specifier.kind === "local") {
      const { loadChain } = await import("../../core/mod.ts");
      const chainResult = await loadChain(
        specifier,
        projectRoot,
        projectRoot,
        readFile,
      );

      let sawError = false;
      for (const diag of chainResult.diagnostics) {
        console.error(`${diag.severity}[${diag.code}]: ${diag.message}`);
        if (diag.severity === "error") sawError = true;
      }
      if (sawError || !chainResult.chain) {
        Deno.exit(1);
      }
    }

    // Record the specifier in .markspec.yaml.
    const { addProfileSpecifier } = await import("../../core/mod.ts");
    await addProfileSpecifier(
      spec,
      readFile,
      (path: string, content: string) => Deno.writeTextFile(path, content),
      projectRoot,
    );

    if (options.format === "json") {
      console.log(JSON.stringify({ added: spec }));
    } else {
      console.error(`added profile: ${spec}`);
    }
  })
  .command("describe <kind:string> <name:string>")
  .description(
    "Show full details for a profile element (type, attribute, relation, label, convention)",
  )
  .option("--format <format:string>", "Output format (text|json)", {
    default: "text",
  })
  .action(
    async (options: { format?: string }, kind: string, name: string) => {
      const { projectRoot } = await requireProjectConfig();
      const chain = await loadActiveProfile(projectRoot);
      const { buildProfileIntrospection } = await import("../../core/mod.ts");
      const intro = buildProfileIntrospection(chain);

      // Normalize "label" → "label-concern" for CLI ergonomics.
      const VALID_KINDS = [
        "type",
        "attribute",
        "relation",
        "label",
        "convention",
      ] as const;
      type CliKind = (typeof VALID_KINDS)[number];
      const KIND_MAP: Record<CliKind, ProfileElementKind> = {
        type: "type",
        attribute: "attribute",
        relation: "relation",
        label: "label-concern",
        convention: "convention",
      };
      if (!VALID_KINDS.includes(kind as CliKind)) {
        console.error(
          `error: unknown kind '${kind}' (valid: ${VALID_KINDS.join(", ")})`,
        );
        Deno.exit(1);
      }
      const elementKind = KIND_MAP[kind as CliKind];
      const detail = intro.describe(elementKind, name);

      if (!detail) {
        const candidates = intro.resolve(name).filter((c) =>
          c.kind === elementKind
        );
        if (candidates.length > 0) {
          console.error(`error: no '${kind}' element named '${name}'`);
          console.error("  did you mean:");
          for (const c of candidates) {
            console.error(`    ${c.name} (${c.kind})`);
          }
        } else {
          console.error(
            `error: no '${kind}' element named '${name}' in the active profile`,
          );
        }
        Deno.exit(1);
      }

      if (options.format === "json") {
        console.log(JSON.stringify(detail, null, 2));
      } else {
        const { renderProfileDetail } = await import(
          "../../mcp/resources/profile.ts"
        );
        console.log(renderProfileDetail(detail));
      }
    },
  );
