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

/** Run the markspec CLI with the given args and optional input files. */
export async function markspec(
  args: string[],
  files: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const dir = await Deno.makeTempDir();
  try {
    for (const [name, content] of Object.entries(files)) {
      const parts = name.split("/");
      if (parts.length > 1) {
        await Deno.mkdir(`${dir}/${parts.slice(0, -1).join("/")}`, {
          recursive: true,
        }).catch(() => {});
      }
      await Deno.writeTextFile(`${dir}/${name}`, content);
    }
    const cmd = new Deno.Command("deno", {
      args: [
        "run",
        "--allow-read",
        "--allow-write",
        CLI_ENTRY,
        ...args,
      ],
      cwd: dir,
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
