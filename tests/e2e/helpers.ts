/**
 * @module tests/e2e/helpers
 *
 * Shared E2E test helper. Provides the markspec() function that runs
 * the CLI binary via Deno.Command in a temporary directory.
 */

const CLI_ENTRY = new URL(
  "../../packages/markspec/main.ts",
  import.meta.url,
).pathname;

/** Options for the markspec test helper. */
export interface MarkspecOptions {
  /** Files to write before running the command. */
  files?: Record<string, string>;
  /** Working directory relative to the temp root (e.g., `"a/b/c"`). */
  cwd?: string;
  /** Additional Deno permission flags for the subprocess. */
  permissions?: string[];
}

/** Run the markspec CLI with the given args and optional input files. */
export async function markspec(
  args: string[],
  filesOrOptions: Record<string, string> | MarkspecOptions = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const opts: MarkspecOptions = isMarkspecOptions(filesOrOptions)
    ? filesOrOptions
    : { files: filesOrOptions };

  const dir = await Deno.makeTempDir();
  try {
    for (const [name, content] of Object.entries(opts.files ?? {})) {
      const parts = name.split("/");
      if (parts.length > 1) {
        await Deno.mkdir(`${dir}/${parts.slice(0, -1).join("/")}`, {
          recursive: true,
        }).catch(() => {});
      }
      await Deno.writeTextFile(`${dir}/${name}`, content);
    }

    const cwd = opts.cwd ? `${dir}/${opts.cwd}` : dir;
    if (opts.cwd) {
      await Deno.mkdir(cwd, { recursive: true }).catch(() => {});
    }

    const permissions = [
      "--allow-read",
      "--allow-write",
      ...(opts.permissions ?? []),
    ];
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        ...permissions,
        CLI_ENTRY,
        ...args,
      ],
      cwd,
      stdout: "piped",
      stderr: "piped",
    });
    const result = await cmd.output();
    return {
      code: result.code,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

function isMarkspecOptions(
  v: Record<string, string> | MarkspecOptions,
): v is MarkspecOptions {
  return "files" in v || "cwd" in v;
}
