/**
 * @module cli/commands/init
 *
 * `markspec init` — scaffold a new MarkSpec project. See slice G1 of
 * the install/upgrade devex epic. Wires the Cliffy surface to the
 * `runInit` orchestrator.
 */

import { Command, EnumType } from "@cliffy/command";
import { resolve } from "@std/path";
import { VERSION } from "../../core/mod.ts";
import { parseProfileSpec } from "../init/mod.ts";
import { parseWhichOutput } from "../init/which_command.ts";

const clientType = new EnumType(["claude", "opencode"]);
const formatType = new EnumType(["text", "json"]);

interface InitOptions {
  client?: string[];
  allClients?: boolean;
  /** `false` when `--no-profile` is passed (Cliffy negation flag). */
  mcp?: boolean;
  skills?: boolean;
  /** `false` when `--no-profile` is passed (Cliffy negation flag). */
  profile?: string | false;
  binaryPath?: string;
  dryRun?: boolean;
  force?: boolean;
  format?: string;
  quiet?: boolean;
}

export const initCmd = new Command()
  .description("Scaffold a new MarkSpec project")
  .type("client", clientType)
  .type("format", formatType)
  .arguments("[target-dir:string]")
  .option(
    "--client <id:client>",
    "Force write for the named client (repeatable)",
    { collect: true },
  )
  .option(
    "--all-clients",
    "Write configs for claude + opencode regardless of detection",
  )
  .option("--no-mcp", "Skip all MCP scaffolding")
  .option("--no-skills", "Skip 'upskill add'")
  .option("--profile <spec:string>", "Profile spec; see --help for grammar", {
    conflicts: ["no-profile"],
  })
  .option("--no-profile", "Core-only mode (default-profile: false)")
  .option(
    "--binary-path <path:string>",
    "Absolute path to markspec binary for MCP configs",
  )
  .option("--dry-run", "Report decisions, write nothing")
  .option(
    "--force",
    "Overwrite skip-on-exists files; required for non-empty target dir and non-TTY",
  )
  .option("--format <fmt:format>", "Summary format", { default: "text" })
  .option("-q, --quiet", "Errors only")
  .example("Scaffold a project in cwd", "markspec init")
  .example("Scaffold in a new subdir", "markspec init ./my-project")
  .example(
    "Use a git profile",
    "markspec init --profile git+https://github.com/org/profile",
  )
  .example(
    "Force all clients + absolute binary",
    "markspec init --all-clients --binary-path /opt/markspec/bin/markspec",
  )
  .example("Dry-run JSON", "markspec init --dry-run --format json")
  .action(async (options: InitOptions, target?: string) => {
    const { runInit, createDenoFs, renderJsonSummary, renderTextSummary } =
      await import("../init/mod.ts");

    const targetDir = resolve(target ?? Deno.cwd());
    const fs = createDenoFs();
    const profileChoice = resolveProfileFromFlags(options);
    const forcedClients = (options.client ?? []) as Array<
      "claude" | "opencode"
    >;

    const whichCommand = async (name: string): Promise<string | undefined> => {
      const cmd = Deno.build.os === "windows" ? "where" : "which";
      try {
        const p = new Deno.Command(cmd, {
          args: [name],
          stdout: "piped",
          stderr: "null",
        });
        const out = await p.output();
        return parseWhichOutput(out.code, out.stdout);
      } catch {
        return undefined;
      }
    };

    const pathExists = async (p: string): Promise<boolean> => {
      try {
        await Deno.stat(p);
        return true;
      } catch {
        return false;
      }
    };

    const detectEnv = {
      whichCommand,
      pathExists,
      projectRoot: targetDir,
      homeDir: Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "/",
    };

    const binaryEnv = {
      whichCommand,
      pathExists,
      execPath: () => Deno.execPath(),
    };

    const { claudeCodeDescriptor } = await import(
      "../install/mcp_adapters_claude_code.ts"
    );
    const { opencodeDescriptor } = await import(
      "../install/mcp_adapters_opencode.ts"
    );
    const mcpAdapters = new Map([
      ["claude" as const, claudeCodeDescriptor],
      ["opencode" as const, opencodeDescriptor],
    ]);

    const result = await runInit({
      targetDir,
      profileChoice,
      forcedClients,
      allClients: options.allClients ?? false,
      noMcp: options.mcp === false,
      noSkills: options.skills === false,
      binaryPathFlag: options.binaryPath,
      force: options.force ?? false,
      dryRun: options.dryRun ?? false,
      fs,
      detectEnv,
      binaryEnv,
      mcpAdapters,
      mcpRunner: async (opts) => {
        const { runMcpInstall } = await import(
          "../install/mcp_orchestrator.ts"
        );
        return runMcpInstall(opts);
      },
      execRunner: async (cmd, args, opts) => {
        try {
          const p = new Deno.Command(cmd, {
            args: [...args],
            cwd: opts?.cwd,
            stdout: "piped",
            stderr: "piped",
          });
          const o = await p.output();
          return {
            code: o.code,
            stdout: new TextDecoder().decode(o.stdout),
            stderr: new TextDecoder().decode(o.stderr),
          };
        } catch (err) {
          return { code: 127, stdout: "", stderr: `${cmd}: ${err}` };
        }
      },
      now: () => new Date().toISOString().replace(/\.\d+Z$/, "Z"),
      version: VERSION,
    });

    if (options.format === "json") {
      await Deno.stdout.write(
        new TextEncoder().encode(renderJsonSummary(result)),
      );
    } else if (!options.quiet) {
      await Deno.stderr.write(
        new TextEncoder().encode(renderTextSummary(result)),
      );
    }
    Deno.exit(result.exitCode);
  });

function resolveProfileFromFlags(
  options: InitOptions,
): import("../init/mod.ts").ProfileChoice {
  // Cliffy: when --no-profile is passed, options.profile is `false`
  // (the boolean negation value). Check for that first.
  if (options.profile === false) {
    return { kind: "none" };
  }
  if (options.profile === undefined) {
    // No --profile, no --no-profile → always the bundled default. This is the
    // intentional behaviour: init never prompts, so CI / piped runs do not
    // block. The TTY numbered picker (`runProfilePicker`, in
    // `cli/init/profile_picker.ts`) is implemented + unit-tested but kept
    // dormant — wiring it is a deliberate future opt-in, not a default change.
    return { kind: "bundled" };
  }
  const parsed = parseProfileSpec(options.profile);
  if (parsed) return parsed;
  console.error(
    `error: unrecognized --profile spec '${options.profile.trim()}'`,
  );
  console.error(
    "       accepted: bundled | false | git+https://... | ./path | /abs/path",
  );
  Deno.exit(1);
}
