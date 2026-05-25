/**
 * @module tests/e2e/mcp_install_test
 *
 * End-to-end tests for `markspec mcp install`. Exercises the
 * mcp_orchestrator wiring — JSON managed-block writes, idempotence,
 * --print, --remove, non-TTY safety, vscode verify-only path, and
 * Q5 parity (no `code --install-extension`).
 *
 * The `markspec()` helper spawns the CLI as a subprocess with piped
 * stdin, so `Deno.stdin.isTerminal()` returns false — non-TTY
 * branch is exercised by default unless `--force` is passed.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, join } from "@std/path";
import { markspec } from "./helpers.ts";

// ---------------------------------------------------------------------------
// Test 1: --print emits full file to stdout, "would write to" to stderr
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install claude-desktop: --print emits full file to stdout, would-write to stderr",
  async () => {
    const { code, stdout, stderr } = await markspec(
      [
        "mcp",
        "install",
        "--client=claude-desktop",
        "--print",
        "--binary-path=markspec",
      ],
      { permissions: ["--allow-env"] },
    );
    assertEquals(code, 0);
    assertStringIncludes(stdout, '"mcpServers"');
    assertStringIncludes(stdout, '"markspec"');
    assertStringIncludes(stdout, '"command": "markspec"');
    assertStringIncludes(stdout, '"args"');
    assertStringIncludes(stderr, "would write to ");
    assertStringIncludes(
      stderr.replaceAll("\\", "/"),
      "claude_desktop_config.json",
    );
  },
);

// ---------------------------------------------------------------------------
// Test 2: unknown client suggests correction
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install: unknown client suggests correction",
  async () => {
    const { code, stderr } = await markspec(
      ["mcp", "install", "--client=claude-desktp", "--print"],
      { permissions: ["--allow-env"] },
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "unknown client 'claude-desktp'");
    assertStringIncludes(stderr, "did you mean: claude-desktop");
  },
);

// ---------------------------------------------------------------------------
// Test 3: non-TTY without --force → exit 1 with remediation hint
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install claude-desktop: non-TTY without --force → exit 1 with remediation",
  async () => {
    const { code, stderr } = await markspec(
      ["mcp", "install", "--client=claude-desktop", "--binary-path=markspec"],
      { permissions: ["--allow-env"] },
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "non-interactive");
    assertStringIncludes(stderr, "--force");
    // The message must not appear doubled (formatting regression guard)
    assert(!stderr.includes("\n\nerror: non-interactive"));
  },
);

// ---------------------------------------------------------------------------
// Test 4: --scope=workspace rejected for claude-desktop
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install claude-desktop: --scope=workspace → exit 1 (per-user app)",
  async () => {
    const { code, stderr } = await markspec(
      [
        "mcp",
        "install",
        "--client=claude-desktop",
        "--scope=workspace",
        "--print",
      ],
      { permissions: ["--allow-env"] },
    );
    assertEquals(code, 1);
    assertStringIncludes(stderr, "--scope=workspace is not supported");
    assertStringIncludes(stderr, "claude-desktop");
  },
);

// ---------------------------------------------------------------------------
// Test 5: vscode never emits `code --install-extension` (spec §8 Q5)
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install vscode: never suggests `code --install-extension` (parity with spec §8 Q5)",
  async () => {
    const { code, stderr } = await markspec(
      ["mcp", "install", "--client=vscode"],
      { permissions: ["--allow-env", "--allow-run"] },
    );
    assertEquals(code, 0);
    assertStringIncludes(stderr, "driftsys.markspec-ide");
    assertEquals(
      stderr.includes("code --install-extension"),
      false,
      "stderr must never suggest `code --install-extension`",
    );
  },
);

// ---------------------------------------------------------------------------
// Direct subprocess helper — for tests that need a controlled HOME dir
// ---------------------------------------------------------------------------

const CLI_ENTRY = fromFileUrl(
  new URL("../../packages/markspec/main.ts", import.meta.url),
);

async function runMcpInstallE2e(
  args: string[],
  homeDir: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  // Inherit the parent environment so Windows-specific vars
  // (SYSTEMROOT, TMP, PATH, …) reach the subprocess — Deno needs them
  // to function on Windows. Strip GIT_* like the shared helper does.
  // Then override HOME / USERPROFILE / APPDATA to point at the temp
  // dir so the orchestrator writes there instead of the real user
  // config locations.
  const parentEnv = Deno.env.toObject();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(parentEnv)) {
    if (!k.startsWith("GIT_")) env[k] = v;
  }
  env.HOME = homeDir;
  env.USERPROFILE = homeDir;
  env.APPDATA = join(homeDir, "AppData", "Roaming");
  const cmd = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env",
      "--allow-run",
      CLI_ENTRY,
      ...args,
    ],
    stdout: "piped",
    stderr: "piped",
    clearEnv: true,
    env,
  });
  const result = await cmd.output();
  return {
    code: result.code,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

function expectedConfigPath(homeDir: string): string {
  if (Deno.build.os === "darwin") {
    return join(
      homeDir,
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
  }
  if (Deno.build.os === "windows") {
    return join(
      homeDir,
      "AppData",
      "Roaming",
      "Claude",
      "claude_desktop_config.json",
    );
  }
  return join(homeDir, ".config", "Claude", "claude_desktop_config.json");
}

// ---------------------------------------------------------------------------
// Test 6: --force writes managed entry; re-run is no-op (idempotence)
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install claude-desktop: --force writes managed entry; re-run is no-op",
  async () => {
    const homeDir = await Deno.makeTempDir();
    try {
      const first = await runMcpInstallE2e(
        [
          "mcp",
          "install",
          "--client=claude-desktop",
          "--binary-path=/opt/markspec/markspec",
          "--force",
        ],
        homeDir,
      );
      assertEquals(first.code, 0, first.stderr);
      assertStringIncludes(first.stderr, "wrote ");

      const configPath = expectedConfigPath(homeDir);
      const written = await Deno.readTextFile(configPath);
      const parsed = JSON.parse(written);
      assertEquals(
        parsed.mcpServers.markspec.command,
        "/opt/markspec/markspec",
      );
      assertEquals(parsed.mcpServers.markspec.args, ["mcp"]);

      // Second run with identical args must be a no-op.
      const second = await runMcpInstallE2e(
        [
          "mcp",
          "install",
          "--client=claude-desktop",
          "--binary-path=/opt/markspec/markspec",
          "--force",
        ],
        homeDir,
      );
      assertEquals(second.code, 0, second.stderr);
      assertStringIncludes(second.stderr, "already up to date");
    } finally {
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Test 7: preserves sibling keys and JSONC comments
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install claude-desktop: preserves sibling keys and JSONC comments",
  async () => {
    const homeDir = await Deno.makeTempDir();
    try {
      const configPath = expectedConfigPath(homeDir);
      const configDir = dirname(configPath);
      await Deno.mkdir(configDir, { recursive: true });
      const initial = `{
  // top comment
  "mcpServers": {
    "other-server": { "command": "other", "args": ["run"] }
  },
  /* block */ "globalShortcut": "Cmd+Space"
}
`;
      await Deno.writeTextFile(configPath, initial);

      const r = await runMcpInstallE2e(
        [
          "mcp",
          "install",
          "--client=claude-desktop",
          "--binary-path=markspec",
          "--force",
        ],
        homeDir,
      );
      assertEquals(r.code, 0, r.stderr);

      const written = await Deno.readTextFile(configPath);
      assertStringIncludes(written, "// top comment");
      assertStringIncludes(written, "/* block */");
      assertStringIncludes(written, '"other-server"');
      assertStringIncludes(written, '"globalShortcut"');
      assertStringIncludes(written, '"markspec"');
    } finally {
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);

// ---------------------------------------------------------------------------
// Test 8: --remove strips only the markspec entry; re-remove is no-op
// ---------------------------------------------------------------------------

Deno.test(
  "mcp install claude-desktop: --remove strips only the markspec entry",
  async () => {
    const homeDir = await Deno.makeTempDir();
    try {
      // First: install to create the entry.
      await runMcpInstallE2e(
        [
          "mcp",
          "install",
          "--client=claude-desktop",
          "--binary-path=markspec",
          "--force",
        ],
        homeDir,
      );

      // Remove it.
      const r = await runMcpInstallE2e(
        [
          "mcp",
          "install",
          "--client=claude-desktop",
          "--remove",
          "--force",
        ],
        homeDir,
      );
      assertEquals(r.code, 0, r.stderr);
      assertStringIncludes(r.stderr, "wrote ");

      const configPath = expectedConfigPath(homeDir);
      const written = await Deno.readTextFile(configPath);
      const parsed = JSON.parse(written);
      assertEquals(parsed.mcpServers?.markspec, undefined);

      // Re-remove must be a no-op.
      const second = await runMcpInstallE2e(
        ["mcp", "install", "--client=claude-desktop", "--remove", "--force"],
        homeDir,
      );
      assertEquals(second.code, 0, second.stderr);
      assertStringIncludes(second.stderr, "already removed");
    } finally {
      await Deno.remove(homeDir, { recursive: true });
    }
  },
);
