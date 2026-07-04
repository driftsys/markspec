/**
 * @module cli/commands/compile
 *
 * `markspec compile` and `markspec export` — parse files, build
 * traceability graph, output JSON / YAML / CSV.
 *
 * The two commands share `compileProject` so they are co-located here.
 */

import { Command } from "@cliffy/command";
import { formatEntryOrigin, VERSION } from "../../core/mod.ts";
import { compileProject, csvQuote, requireProjectConfig } from "../helpers.ts";

export const compileCmd = new Command()
  .description("Parse files, build traceability graph, output JSON")
  .option("--format <format:string>", "Output format (json|text)", {
    default: "text",
  })
  .option("--output <dir:string>", "Write /api/ directory to <dir>")
  .option(
    "--split-threshold <n:number>",
    "Entry count at which to switch to NDJSON streaming output",
    { default: 1000 },
  )
  .option(
    "--with-contributors",
    "Include git contributor names in properties.git (PII-adjacent, ADR-006; off by default)",
  )
  .option(
    "--frozen",
    "Fail on lockfile drift before compiling (CI gate, MSL-L201/L2xx)",
  )
  .arguments("<paths...:string>")
  .action(
    async (
      _options: {
        format?: string;
        output?: string;
        splitThreshold: number;
        withContributors?: boolean;
        frozen?: boolean;
      },
      ...paths: string[]
    ) => {
      if (_options.frozen) {
        const {
          checkDrift,
          collectProjectEntries,
          deriveUpstreamId,
          discoverProjectRoot,
          loadConfig,
          loadProfileForCommand,
          loadToolConfig,
          parseLockfile,
          resolveUpstreams,
        } = await import("../../core/mod.ts");
        const { join } = await import("@std/path");
        const { denoDiscoveryIO } = await import("../helpers.ts");
        const {
          defaultFetchUrl,
          defaultReadFile,
          loadAllMappings,
          readFileOrUndefined,
        } = await import("./lock.ts");

        const root =
          (await discoverProjectRoot(Deno.cwd(), readFileOrUndefined)) ??
            Deno.cwd();
        const lockPath = join(root, "markspec.lock");
        const tomlRaw = await readFileOrUndefined(lockPath);
        if (tomlRaw === undefined) {
          console.error(
            "error: MSL-L201: markspec.lock is missing under --frozen (run `markspec lock` to generate)",
          );
          Deno.exit(1);
        }
        const parsed = parseLockfile(tomlRaw);
        if (!parsed.lockfile) {
          for (const d of parsed.diagnostics) {
            console.error(`${d.severity}: ${d.code}: ${d.message}`);
          }
          Deno.exit(1);
        }

        const configResult = await loadConfig(root, readFileOrUndefined);
        if (!configResult) {
          console.error("error: project.yaml not found");
          Deno.exit(1);
        }
        const profileResult = await loadProfileForCommand(
          root,
          readFileOrUndefined,
        );
        // Honor .markspec.yaml `exclude:` so `--frozen`'s edge set matches
        // the one `markspec lock` pinned — an entry under an excluded path
        // (e.g. `skills/`) must not spuriously drift the frozen check (#684).
        const toolConfigResult = await loadToolConfig(
          root,
          readFileOrUndefined,
        );
        const entries = await collectProjectEntries(root, denoDiscoveryIO(), {
          exclude: toolConfigResult.config.exclude,
        });
        const mappings = await loadAllMappings(root);

        const resolved = await resolveUpstreams({
          entries,
          profileChain: profileResult.chain ?? [],
          config: configResult.config,
          mappings,
          fetchUrl: defaultFetchUrl,
          readFile: defaultReadFile,
        });
        const declaredReferenceIds = configResult.config.references
          .map((ref) => deriveUpstreamId(ref))
          .filter((id): id is string => id !== undefined);
        const drift = checkDrift(
          parsed.lockfile,
          resolved,
          declaredReferenceIds,
        );
        if (drift.length > 0) {
          for (const d of drift) {
            console.error(`${d.severity}: ${d.code}: ${d.message}`);
          }
          Deno.exit(1);
        }
        // No drift — fall through to the existing compile path.
      }

      const { result, chain } = await compileProject(paths, {
        withContributors: _options.withContributors,
      });

      if (_options.output) {
        const {
          buildManifest,
          buildEdgesNdjson,
          buildEntriesNdjson,
          indexToJson,
          serializeCompileResult,
        } = await import("../../core/mod.ts");
        const configResult = await requireProjectConfig();
        const streaming = result.entries.size >= _options.splitThreshold;

        const manifestJson = buildManifest(
          result,
          configResult.config,
          configResult.projectRoot,
          chain?.effective,
          VERSION,
          streaming,
        );
        await Deno.mkdir(_options.output, { recursive: true });
        await Deno.writeTextFile(
          `${_options.output}/manifest.json`,
          JSON.stringify(manifestJson, null, 2),
        );
        console.error(`wrote ${_options.output}/manifest.json`);

        if (streaming) {
          const { ndjson, index } = buildEntriesNdjson(result.entries);
          await Deno.writeFile(`${_options.output}/entries.ndjson`, ndjson);
          console.error(`wrote ${_options.output}/entries.ndjson`);
          await Deno.writeTextFile(
            `${_options.output}/entries.idx`,
            indexToJson(index),
          );
          console.error(`wrote ${_options.output}/entries.idx`);
          const edgesBytes = buildEdgesNdjson(result.links);
          await Deno.writeFile(`${_options.output}/edges.ndjson`, edgesBytes);
          console.error(`wrote ${_options.output}/edges.ndjson`);
        } else {
          const compiled = serializeCompileResult(result);
          await Deno.writeTextFile(
            `${_options.output}/compiled.json`,
            JSON.stringify(compiled, null, 2),
          );
          console.error(`wrote ${_options.output}/compiled.json`);
        }
        return;
      }

      if (_options.format === "json") {
        const { serializeCompileResult } = await import("../../core/mod.ts");
        const output = serializeCompileResult(result);
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log(
          `${result.entries.size} entries, ${result.links.length} links from ${paths.length} files`,
        );
      }
    },
  );

export const exportCmd = new Command()
  .description(
    "Emit the compiled traceability graph in json, yaml, or csv (reqif pending)",
  )
  .arguments("<format:string> <paths...:string>")
  .action(async (_options, format: string, ...paths: string[]) => {
    if (format !== "json" && format !== "yaml" && format !== "csv") {
      console.error(
        `error: unknown export format '${format}' (supported: json, yaml, csv)`,
      );
      Deno.exit(1);
    }
    const { result } = await compileProject(paths);
    const { serializeCompileResult } = await import("../../core/mod.ts");
    const output = serializeCompileResult(result);
    if (format === "json") {
      console.log(JSON.stringify(output, null, 2));
    } else if (format === "yaml") {
      // Round-trip through JSON to strip undefined values — @std/yaml's
      // stringify throws on undefined, but the Entry shape carries
      // optional fields (type, id, properties) that may legitimately
      // be undefined. JSON.stringify drops them.
      const jsonSafe = JSON.parse(JSON.stringify(output));
      const { stringify } = await import("@std/yaml");
      console.log(stringify(jsonSafe));
    } else {
      // CSV: one row per entry, fixed-shape header. Values are
      // RFC-4180 quoted when they contain a comma, double quote,
      // or newline; internal quotes are doubled.
      const headers = [
        "displayId",
        "title",
        "type",
        "shape",
        "id",
        "file",
        "line",
        "origin",
      ];
      const lines = [headers.join(",")];
      for (const entry of Object.values(output.entries)) {
        const row = [
          entry.displayId,
          entry.title,
          entry.type ?? "",
          entry.shape,
          entry.id ?? "",
          entry.location.file,
          String(entry.location.line),
          // ADR-030 provenance — same cell convention as the reporter's
          // originCell: profile label for corpus entries, "project" for
          // project-authored ones.
          entry.origin ? formatEntryOrigin(entry.origin) : "project",
        ].map(csvQuote);
        lines.push(row.join(","));
      }
      console.log(lines.join("\n"));
    }
  });
