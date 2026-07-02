/**
 * @module cli/commands/check
 *
 * `markspec check` — check broken refs, missing Ids, duplicates.
 */

import { Command } from "@cliffy/command";
import { ConfigError } from "../../core/mod.ts";
import type { CaptionConventions, Diagnostic } from "../../core/mod.ts";
import {
  loadActiveProfile,
  readFile,
  renderDiagnosticLocation,
  resolveScope,
} from "../helpers.ts";

export const checkCmd = new Command()
  .description("Check broken refs, missing Ids, duplicates")
  .option("--strict", "Promote warnings to errors")
  .option(
    "--format <format:string>",
    "Output format (json|text)",
    { default: "text" },
  )
  .arguments("[...files:string]")
  .action(
    async (
      options: { strict?: boolean; format?: string; quiet?: boolean },
      ...fileArgs: string[]
    ) => {
      const scope = await resolveScope(fileArgs, {
        verb: "checking",
        quiet: options.quiet === true || options.format === "json",
      });
      const files = scope.files;
      const projectRoot = scope.projectRoot;

      const { loadConfig } = await import("../../core/mod.ts");

      const chain = projectRoot !== undefined
        ? await loadActiveProfile(projectRoot)
        : null;

      // Load project config for config-driven rules (e.g. MSL-C072
      // caption-position convention). Absent config → defaults (rules inactive).
      // A malformed config (ConfigError) IS surfaced — a bad caption-conventions
      // block silently disabling MSL-C072 would be invisible debt (M-1 fix).
      let captionConventions: CaptionConventions = {};
      if (projectRoot !== undefined) {
        try {
          const configResult = await loadConfig(projectRoot, readFile);
          if (configResult) {
            captionConventions = configResult.config.captionConventions;
          }
        } catch (err) {
          if (err instanceof ConfigError) {
            console.error(`error: ${err.message}`);
            Deno.exit(1);
          }
          // Other unexpected errors (I/O, etc.) remain non-fatal — the rule
          // simply stays inactive; the file-missing path already returns undefined
          // from readFile and never throws.
        }
      }

      // Load the delivered corpus (ADR-029) — project-wide only, matching
      // the other composite gates: a file-local `check <file>` cannot
      // distinguish a corpus target from a typo any more than MSL-L006
      // could, so the corpus stays out of scope there.
      const { loadDeliveredCorpus, buildCorpusIndex } = await import(
        "../../core/mod.ts"
      );
      const corpus = scope.projectWide && chain
        ? await loadDeliveredCorpus(chain.effective.delivers, readFile)
        : { entries: [], diagnostics: [] };
      const corpusIndex = buildCorpusIndex(
        scope.projectWide ? chain?.effective.delivers ?? [] : [],
      );

      const {
        detectDirectives,
        parseFile,
        runPipeline,
        validateListingDocuments,
      } = await import("../../core/mod.ts");

      const allEntries = [];
      allEntries.push(...corpus.entries);
      const parseDiagnostics: Diagnostic[] = [];
      // deno-lint-ignore no-explicit-any
      const listingContexts: any[] = [];
      const mdContents = new Map<string, string>();
      for (const filePath of files) {
        let content: string;
        try {
          content = await Deno.readTextFile(filePath);
        } catch {
          console.error(`error: ${filePath}: file not found`);
          Deno.exit(1);
        }
        if (filePath.endsWith(".md")) mdContents.set(filePath, content);
        const result = await parseFile(content, { file: filePath });
        allEntries.push(...result.entries);
        parseDiagnostics.push(...result.diagnostics);
        listingContexts.push({
          file: filePath,
          content,
          entries: result.entries,
          directives: detectDirectives(content, { file: filePath }),
        });
      }

      // projectWide reflects the resolved scope: a bare invocation walks the
      // whole project, so MSL-L006 ("link target does not resolve") is
      // meaningful and fires. Explicit file args stay file-local — that
      // subset cannot distinguish a typo from a valid cross-file target, so
      // MSL-L006 is suppressed. Full existence checks are always available
      // via `markspec compile` or the LSP (which index all files).
      const result = runPipeline(
        allEntries,
        chain?.effective ?? null,
        captionConventions,
        { projectWide: scope.projectWide },
      );

      // Corpus-aware post-pass (ADR-029): a project entry re-declaring a
      // display ID already delivered by the corpus becomes MSL-R014 (not
      // the generic duplicate codes), and pipeline findings located inside
      // a corpus file are downgraded to attributed warnings — a consumer
      // build must not go red over an upstream bug it cannot fix. No-op
      // when no corpus was injected.
      const { attributeCorpusDiagnostics, detectCorpusCollisions } =
        await import("../../core/mod.ts");
      const collisions = detectCorpusCollisions(allEntries);
      const pipelineDiagnostics = [
        ...attributeCorpusDiagnostics(
          result.diagnostics,
          allEntries,
          collisions.collidedTokens,
        ),
        ...collisions.diagnostics,
      ];

      const listingDiagnostics = validateListingDocuments(listingContexts);

      // Gate: fmt drift (project-wide only — the composite `check` gate; a
      // file-local `check <file>` stays a fast structural check, and the
      // canonical agent path runs `fmt` before `check`). Markdown only —
      // `markspec fmt` never rewrites source files.
      const fmtDiagnostics: Diagnostic[] = [];
      if (scope.projectWide) {
        const { format } = await import("../../core/mod.ts");
        for (const [filePath, content] of mdContents) {
          if (format(content, { file: filePath }).changed) {
            fmtDiagnostics.push({
              code: "MSL-F010",
              severity: "error",
              message: "file is not formatted (run `markspec fmt`)",
              location: { file: filePath, line: 1, column: 1 },
            });
          }
        }
      }

      // Gate: lockfile (project-wide only; needs the full corpus to
      // recompute the canonical edge hash). Offline by design — upstream
      // resolution (network) stays in `markspec lock --check`.
      const lockDiagnostics: Diagnostic[] = [];
      if (scope.projectWide && projectRoot !== undefined) {
        const { join } = await import("@std/path");
        const lockRaw = await readFile(join(projectRoot, "markspec.lock"));
        if (lockRaw !== undefined) {
          const { extractEdgeQuads, hashCanonicalEdges, parseLockfile } =
            await import("../../core/mod.ts");
          const parsed = parseLockfile(lockRaw);
          if (!parsed.lockfile) {
            lockDiagnostics.push(...parsed.diagnostics);
          } else {
            // Corpus-blind by design: the lockfile is not corpus-aware yet
            // (ADR-029 defers lockfile integration), so `markspec lock`
            // never counts corpus edges. Counting them here would raise an
            // MSL-L212 drift error that `markspec lock` can never fix —
            // consumer gates must not fail on upstream content the consumer
            // cannot re-lock.
            const projectEntries = allEntries.filter((e) => !e.origin);
            const quads = extractEdgeQuads(projectEntries);
            const currentHash = await hashCanonicalEdges(quads);
            const cache = parsed.lockfile.generatedCache;
            if (cache.edgesHash !== currentHash) {
              lockDiagnostics.push({
                code: "MSL-L212",
                severity: "error",
                message:
                  `traceability edges drifted from markspec.lock: locked ${cache.edgesCount} edge(s), current ${quads.length} (run \`markspec lock\` to refresh)`,
                location: {
                  file: join(projectRoot, "markspec.lock"),
                  line: 1,
                  column: 1,
                },
              });
            }
          }
        }
      }

      // Gate: prose lint (project-wide only, advisory — warnings/info
      // unless --strict). LintDiagnostic carries slug/group/score fields
      // that must not leak into check's stable JSON schema — project to
      // plain Diagnostic. `runLint`'s `readFile` option is typed for
      // glossary-file indexing (`FileReader`, distinct from the CLI's
      // `ReadFile`) and is only needed when `glossaryFilePaths` is
      // supplied; omitted here since `check` passes none.
      const proseDiagnostics: Diagnostic[] = [];
      if (scope.projectWide) {
        const { runLint } = await import("../../core/mod.ts");
        const lintResult = await runLint({ entries: allEntries });
        for (const d of lintResult.diagnostics) {
          proseDiagnostics.push({
            code: d.code,
            severity: d.severity,
            message: d.message,
            location: d.location,
          });
        }
      }

      // Merge parse-level (MSL-P0xx), corpus-load, pipeline, listing,
      // fmt-drift, lockfile-drift, and prose-lint diagnostics.
      const allDiagnostics = [
        ...parseDiagnostics,
        ...corpus.diagnostics,
        ...pipelineDiagnostics,
        ...listingDiagnostics,
        ...fmtDiagnostics,
        ...lockDiagnostics,
        ...proseDiagnostics,
      ];

      // Apply --strict: promote warnings to errors.
      const diagnostics = options.strict
        ? allDiagnostics.map((d) =>
          d.severity === "warning" ? { ...d, severity: "error" as const } : d
        )
        : allDiagnostics;

      const hasErrors = diagnostics.some((d) => d.severity === "error");
      const hasWarnings = diagnostics.some((d) => d.severity === "warning");

      if (options.format === "json") {
        console.log(JSON.stringify(diagnostics, null, 2));
      } else {
        for (const d of diagnostics) {
          const loc = renderDiagnosticLocation(d, corpusIndex);
          console.error(`${d.severity}[${d.code}]: ${loc} ${d.message}`);
        }
      }

      if (hasErrors) {
        Deno.exit(1);
      } else if (hasWarnings) {
        Deno.exit(2);
      }
    },
  );
