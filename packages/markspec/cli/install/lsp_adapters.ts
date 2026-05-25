/**
 * @module cli/install/lsp_adapters
 *
 * LSP install adapters for `markspec lsp install --editor=<id>`.
 *
 * Each adapter returns an {@linkcode AdapterResult} with separate stdout
 * and stderr strings. The caller writes stdout to process.stdout and
 * stderr to process.stderr, then exits with `exitCode`.
 *
 * stdout carries the config block (machine-readable, pipeable).
 * stderr carries status messages, file paths, and instructions.
 */

import { join } from "@std/path";
import type {
  AdapterResult,
  LspAdapter,
  RenderBlockInput,
} from "./adapters.ts";

/**
 * Return the canonical Lua snippet for nvim-lspconfig.
 * Replace `<BINARY_PATH>` with the output of `which markspec`.
 */
export function neovimAdapter(): AdapterResult {
  const stdout = `-- markspec LSP (managed by markspec lsp install)
-- Replace <BINARY_PATH> with the output of: which markspec
require('lspconfig').markspec.setup({
  cmd = { '<BINARY_PATH>', 'lsp', '--stdio' },
  filetypes = { 'markdown' },
  root_dir = require('lspconfig.util').root_pattern('project.yaml', '.markspec.yaml'),
})`;
  const stderr =
    "Paste the snippet above into your nvim-lspconfig setup file (e.g. ~/.config/nvim/init.lua).";
  return { stdout, stderr, exitCode: 0 };
}

/**
 * Return the JSON fragment for Zed's `settings.json`.
 * Replace `<BINARY_PATH>` with the absolute path to the markspec binary.
 */
export function zedAdapter(): AdapterResult {
  const stdout = `{
  "lsp": {
    "markspec": {
      "binary": { "path": "<BINARY_PATH>", "args": ["lsp", "--stdio"] }
    }
  },
  "file_types": {
    "MarkSpec": ["md"]
  }
}`;
  const stderr =
    "Merge the JSON block above into your Zed settings.json (~/.config/zed/settings.json).";
  return { stdout, stderr, exitCode: 0 };
}

// ---------------------------------------------------------------------------
// neovimDescriptor — new descriptor shape (consumed by orchestrator, Task 6)
// ---------------------------------------------------------------------------

/**
 * Descriptor for the Neovim editor adapter. Pure functions — no I/O.
 * The install orchestrator (Task 6) handles file reads, diff/preview,
 * backup, and writes using this descriptor.
 */
export const neovimDescriptor: LspAdapter = {
  id: "neovim",
  resolveConfigPath(scope, _cwd, home, workspaceRoot) {
    if (scope === "user") {
      return join(home, ".config", "nvim", "lsp", "markspec.lua");
    }
    if (!workspaceRoot) {
      throw new Error("workspace scope requires a workspaceRoot");
    }
    return join(workspaceRoot, ".nvim", "markspec.lua");
  },
  renderBlock(input: RenderBlockInput): string {
    return [
      `-- markspec LSP (managed by markspec lsp install — do not edit)`,
      `require('lspconfig').markspec.setup({`,
      `  cmd = { '${input.binaryPath}', 'lsp', '--stdio' },`,
      `  filetypes = { 'markdown' },`,
      `  root_dir = require('lspconfig.util').root_pattern('markspec.yaml', '.markspec.yaml', 'project.yaml'),`,
      `})`,
    ].join("\n");
  },
};

// ---------------------------------------------------------------------------
// VS Code adapter — verify-and-report
// ---------------------------------------------------------------------------

/** Marketplace extension ID for the bundled VS Code client. */
const VSCODE_EXTENSION_ID = "driftsys.markspec-ide";

/** Marketplace listing URL printed when the extension is missing. */
const VSCODE_MARKETPLACE_URL =
  "https://marketplace.visualstudio.com/items?itemName=driftsys.markspec-ide";

/** Settings.json key the markspec-ide extension reads at startup. */
const VSCODE_SERVER_PATH_KEY = "markspec.server.path";

/**
 * Injectable seams for {@linkcode vscodeAdapter}. Production callers omit
 * `env` and let the orchestrator dispatch through {@linkcode defaultVscodeEnv}
 * (which shells out to `code --list-extensions` and reads the platform's
 * settings.json from disk). Tests pass a fully fake env so no host I/O occurs.
 */
export interface VscodeAdapterEnv {
  readonly platform: "darwin" | "linux" | "win32";
  readonly home: string;
  /**
   * `%APPDATA%` equivalent on Windows. Only consulted when
   * {@linkcode platform} is `"win32"`; safe to omit on POSIX.
   */
  readonly appData?: string;
  /**
   * List installed VS Code extension IDs. Resolve to `undefined` when the
   * `code` CLI is absent on `$PATH` — that's "extension status unknown",
   * not "extension absent".
   */
  readonly listExtensions: () => Promise<readonly string[] | undefined>;
  /**
   * Read VS Code's settings.json at `path`. Resolve to `undefined` when the
   * file does not exist. The returned string is JSONC — comments are
   * tolerated by the adapter's parser.
   */
  readonly readSettings: (path: string) => Promise<string | undefined>;
}

/** Inputs accepted by {@linkcode vscodeAdapter}. */
export interface VscodeAdapterOptions {
  /**
   * Absolute path to the running `markspec` binary. Compared against
   * the `markspec.server.path` value in VS Code's settings.json.
   * The orchestrator threads its `--binary-path` flag here.
   */
  readonly binaryPath: string;
  /** Test-only seam — defaults to {@linkcode defaultVscodeEnv}. */
  readonly env?: VscodeAdapterEnv;
}

/**
 * Default `VscodeAdapterEnv` wired to real Deno APIs. Spawns `code
 * --list-extensions` for detection and reads the platform's user
 * settings.json from disk.
 */
export function defaultVscodeEnv(): VscodeAdapterEnv {
  const platform: VscodeAdapterEnv["platform"] = Deno.build.os === "windows"
    ? "win32"
    : Deno.build.os === "darwin"
    ? "darwin"
    : "linux";
  return {
    platform,
    home: Deno.env.get(platform === "win32" ? "USERPROFILE" : "HOME") ?? "",
    appData: Deno.env.get("APPDATA") ?? undefined,
    listExtensions: async () => {
      try {
        const cmd = new Deno.Command("code", {
          args: ["--list-extensions"],
          stdout: "piped",
          stderr: "null",
        });
        const out = await cmd.output();
        if (!out.success) return undefined;
        return new TextDecoder().decode(out.stdout)
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      } catch {
        return undefined;
      }
    },
    readSettings: async (path) => {
      try {
        return await Deno.readTextFile(path);
      } catch {
        return undefined;
      }
    },
  };
}

/**
 * Resolve the user-scope settings.json path per platform — same locations
 * VS Code itself reads from at startup.
 */
function userSettingsPath(env: VscodeAdapterEnv): string {
  if (env.platform === "darwin") {
    return join(
      env.home,
      "Library",
      "Application Support",
      "Code",
      "User",
      "settings.json",
    );
  }
  if (env.platform === "win32") {
    // APPDATA is the canonical location; fall back to HOME-derived path if absent.
    const base = env.appData ?? join(env.home, "AppData", "Roaming");
    return join(base, "Code", "User", "settings.json");
  }
  return join(env.home, ".config", "Code", "User", "settings.json");
}

/** Build the remediation snippet shown when settings.json needs an edit. */
function remediationSnippet(binaryPath: string, settingsPath: string): string {
  const escaped = JSON.stringify(binaryPath);
  return [
    `Add this to ${settingsPath}:`,
    "",
    "  {",
    `    "${VSCODE_SERVER_PATH_KEY}": ${escaped}`,
    "  }",
  ].join("\n");
}

/**
 * VS Code adapter — verify-and-report. Per spec §4.3 this adapter never
 * writes config; it inspects the installed extension and VS Code's
 * settings.json and prints either a success line or a remediation snippet.
 *
 * Per spec §8 Q5 it MUST NOT suggest `code --install-extension`. When the
 * extension is absent, the only call-to-action is the marketplace URL.
 */
export async function vscodeAdapter(
  options: VscodeAdapterOptions,
): Promise<AdapterResult> {
  const env = options.env ?? defaultVscodeEnv();
  const extensions = await env.listExtensions();
  const installed = extensions !== undefined &&
    extensions.includes(VSCODE_EXTENSION_ID);

  // Branch 1: extension absent (or status unknown because `code` is missing).
  // Both paths point at the marketplace URL — the user installs from there.
  if (!installed) {
    const reason = extensions === undefined
      ? `VS Code 'code' CLI not found on PATH; cannot verify extension. ` +
        `Install the markspec-ide extension from:`
      : `VS Code extension ${VSCODE_EXTENSION_ID} is not installed. ` +
        `Install it from:`;
    return {
      stdout: "",
      stderr: `${reason}\n  ${VSCODE_MARKETPLACE_URL}`,
      exitCode: 0,
    };
  }

  // Branch 2: extension installed — verify markspec.server.path in settings.json.
  const settingsPath = userSettingsPath(env);
  const raw = await env.readSettings(settingsPath);

  if (raw === undefined) {
    return {
      stdout: "",
      stderr: [
        `VS Code extension ${VSCODE_EXTENSION_ID} is installed but ${settingsPath} does not exist.`,
        remediationSnippet(options.binaryPath, settingsPath),
      ].join("\n"),
      exitCode: 0,
    };
  }

  // Tolerate JSONC. Lazy-import keeps the dep out of code paths that
  // never hit this adapter (the orchestrator only loads it on
  // --editor=vscode).
  const { parse } = await import("@std/jsonc");
  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch (err) {
    return {
      stdout: "",
      stderr:
        `VS Code extension ${VSCODE_EXTENSION_ID} is installed but ${settingsPath} is not valid JSONC: ${
          (err as Error).message
        }\nFix the file by hand, then re-run.`,
      exitCode: 0,
    };
  }
  const configured = isJsonObject(parsed)
    ? parsed[VSCODE_SERVER_PATH_KEY]
    : undefined;

  if (typeof configured !== "string" || configured.length === 0) {
    return {
      stdout: "",
      stderr: [
        `VS Code extension ${VSCODE_EXTENSION_ID} is installed but ${VSCODE_SERVER_PATH_KEY} is not set in ${settingsPath}.`,
        remediationSnippet(options.binaryPath, settingsPath),
      ].join("\n"),
      exitCode: 0,
    };
  }

  if (configured !== options.binaryPath) {
    return {
      stdout: "",
      stderr: [
        `VS Code extension ${VSCODE_EXTENSION_ID} is installed but ${VSCODE_SERVER_PATH_KEY} in ${settingsPath} points at ${configured}, not ${options.binaryPath}.`,
        remediationSnippet(options.binaryPath, settingsPath),
      ].join("\n"),
      exitCode: 0,
    };
  }

  return {
    stdout: "",
    stderr:
      `VS Code extension ${VSCODE_EXTENSION_ID} is installed and ${VSCODE_SERVER_PATH_KEY} in ${settingsPath} matches ${options.binaryPath}. No action needed.`,
    exitCode: 0,
  };
}

/** Type guard for a plain JSON object — narrows `unknown` for property access. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
