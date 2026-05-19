/**
 * @module cli/commands/compile
 *
 * `markspec compile` and `markspec export` — parse files, build
 * traceability graph, output JSON / YAML / CSV.
 *
 * The two commands share `compileProject` so they are co-located here.
 */

import { Command } from "@cliffy/command";
import { VERSION } from "../../core/mod.ts";
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
  .arguments("<paths...:string>")
  .action(
    async (
      _options: {
        format?: string;
        output?: string;
        splitThreshold: number;
        withContributors?: boolean;
      },
      ...paths: string[]
    ) => {
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
        ].map(csvQuote);
        lines.push(row.join(","));
      }
      console.log(lines.join("\n"));
    }
  });
