/**
 * @module cli/commands/score
 *
 * `markspec score` — score a single piece of requirement prose using
 * the PA-3 lint pipeline. One-shot mode via `--text`, batch mode via
 * JSONL on stdin.
 *
 * Exit codes (clig.dev mapping):
 *   0 — at least one input was scored successfully and no malformed lines.
 *   1 — no inputs were scored.
 *   2 — partial: some inputs were malformed but at least one was scored.
 */

import { Command } from "@cliffy/command";
import { scoreText, type ScoreTextResult } from "../../core/lint/mod.ts";

interface ScoreOptions {
  text?: string;
  id?: string;
  format?: string;
}

export const scoreCmd = new Command()
  .description(
    "Score a single piece of requirement prose against the PA-3 rule catalog",
  )
  .option("--text <text:string>", "Inline prose to score")
  .option("--id <id:string>", "Identifier to echo in the result")
  .option(
    "--format <format:string>",
    "Output format (json|text). Default: text when stdout is a TTY, json otherwise.",
  )
  .action(async (options: ScoreOptions) => {
    const format = pickFormat(options.format);

    if (options.text !== undefined) {
      // One-shot mode wins over stdin per the spec.
      const result = await scoreText(options.text, { id: options.id });
      printResult(result, format, true);
      Deno.exit(0);
    }

    // Batch mode reads JSONL from stdin.
    if (Deno.stdin.isTerminal()) {
      // No input requested at all — print help and exit 0.
      await scoreCmd.showHelp();
      Deno.exit(0);
    }

    const stdinText = await readAllStdin();
    if (stdinText.trim().length === 0) {
      // stdin is closed or empty — print help and exit 0.
      await scoreCmd.showHelp();
      Deno.exit(0);
    }
    const lines = stdinText.split("\n");
    let scored = 0;
    let malformed = 0;
    let nonBlankIndex = 0;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (raw.trim().length === 0) continue;
      nonBlankIndex++;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        console.error(`error: malformed JSON on line ${i + 1}`);
        malformed++;
        continue;
      }
      if (!isJsonlInput(parsed)) {
        console.error(`error: missing 'text' field on line ${i + 1}`);
        malformed++;
        continue;
      }
      const id = typeof parsed.id === "string" && parsed.id.length > 0
        ? parsed.id
        : `EXT_${nonBlankIndex}`;
      const result = await scoreText(parsed.text, { id });
      printResult(result, format, false);
      scored++;
    }

    if (scored === 0) Deno.exit(1);
    if (malformed > 0) Deno.exit(2);
    Deno.exit(0);
  });

function pickFormat(opt: string | undefined): "json" | "text" {
  if (opt === "json" || opt === "text") return opt;
  return Deno.stdout.isTerminal() ? "text" : "json";
}

function isJsonlInput(v: unknown): v is { text: string; id?: string } {
  return typeof v === "object" && v !== null &&
    typeof (v as { text?: unknown }).text === "string";
}

function printResult(
  result: ScoreTextResult,
  format: "json" | "text",
  pretty: boolean,
): void {
  if (format === "json") {
    console.log(
      pretty ? JSON.stringify(result, null, 2) : JSON.stringify(result),
    );
    return;
  }
  const header =
    `${result.id} — Score: ${result.score}, Warnings: ${result.warningCount}, Infos: ${result.infoCount}`;
  console.log(header);
  for (const d of result.diagnostics) {
    const loc = d.location
      ? `${d.location.file}:${d.location.line}:${d.location.column} `
      : "";
    console.log(`  ${loc}${d.severity} ${d.slug} [${d.code}]: ${d.message}`);
  }
}

async function readAllStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = Deno.stdin.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(buf);
}
